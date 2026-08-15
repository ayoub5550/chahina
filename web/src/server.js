/**
 * Truckly API — "أوبر الشاحنات" / "Uber pour camions"
 * Self-hosted: Express + SQLite + JWT. Payments via Chargily Pay (Algeria).
 * Trilingual API messages: ar / fr / en.
 */
const express = require("express");
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("./db");
const chargily = require("./chargily");
const { t, pickLang, LANGS, TRUCK_TYPES } = require("./i18n");
const fs = require("fs");
const crypto = require("crypto");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || "truckly-dev-secret-change-me";
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, "");

const app = express();
app.use(cors());

// Chargily webhook needs the raw body for HMAC verification -> mount before json parser
app.post("/api/webhooks/chargily", express.raw({ type: "*/*" }), (req, res) => {
  const raw = req.body instanceof Buffer ? req.body.toString("utf8") : String(req.body || "");
  if (!chargily.verifySignature(raw, req.headers["signature"])) {
    console.warn("[chargily] invalid webhook signature");
    return res.status(403).json({ error: "invalid signature" });
  }
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return res.status(400).json({ error: "bad payload" });
  }
  handleChargilyEvent(event);
  res.json({ received: true });
});

app.use(express.json({ limit: "8mb" }));
app.use((req, _res, next) => {
  req.lang = pickLang(req);
  next();
});

// ---------- helpers ----------
const TRUCK_KEYS = TRUCK_TYPES.map((x) => x.key);

function sign(user) {
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: "30d" });
}

function auth(required = true) {
  return (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) {
      if (!required) return next();
      return res.status(401).json({ error: t("login_required", req.lang) });
    }
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = db.prepare("SELECT id, name, phone, role, city, lang, bio, photo_url FROM users WHERE id = ?").get(payload.id);
      if (!req.user) return res.status(401).json({ error: t("account_missing", req.lang) });
      db.prepare("UPDATE users SET last_seen=datetime('now') WHERE id=?").run(req.user.id);
      next();
    } catch (e) {
      return res.status(401).json({ error: t("session_expired", req.lang) });
    }
  };
}

function requireRole(role) {
  return (req, res, next) =>
    req.user && req.user.role === role ? next() : res.status(403).json({ error: t("forbidden_role", req.lang) });
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function ratingOf(userId) {
  const r = db
    .prepare("SELECT ROUND(AVG(stars),1) AS avg, COUNT(*) AS n FROM ratings WHERE ratee_id = ?")
    .get(userId);
  return { rating: r.avg, ratings_count: r.n };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const ok = (res, data) => res.json(data);
const bad = (res, req, key, code = 400, arg) => res.status(code).json({ error: t(key, req.lang, arg), key });

function notify(userId, kind, messageKey, shipmentId = null, extra = null) {
  if (!userId) return;
  db.prepare(
    "INSERT INTO notifications (user_id, kind, message_key, shipment_id, extra) VALUES (?,?,?,?,?)"
  ).run(userId, kind, messageKey, shipmentId, extra ? JSON.stringify(extra) : null);
}

/** Suggested fair price (DZD) — distance + weight + truck type factor. */
function suggestPrice(distanceKm, weightTons, truckKey) {
  const base = 1500;
  const perKm = 55;
  const perTon = 350;
  const factor = { small: 0.85, medium: 1, large: 1.3, refrigerated: 1.45, tanker: 1.4, tipper: 1.2, car_carrier: 1.35, moving: 1.1 }[truckKey] || 1;
  const raw = (base + distanceKm * perKm + (weightTons || 0) * perTon) * factor;
  const round = (v) => Math.round(v / 100) * 100;
  return { min: round(raw * 0.85), suggested: round(raw), max: round(raw * 1.2) };
}

/** What a carrier's own tariff charges for a trip of `km` kilometres. */
function tariffOf(truck) {
  if (!truck || !truck.base_price || !truck.base_km) return null;
  const perKm = truck.base_price / truck.base_km;
  return { base_km: truck.base_km, base_price: truck.base_price, per_km: Math.round(perKm * 10) / 10, min_price: truck.min_price || null };
}
function estimateFor(truck, km) {
  const tar = tariffOf(truck);
  if (!tar || km == null) return null;
  const raw = tar.per_km * km;
  return Math.max(Math.round(raw / 50) * 50, tar.min_price || 0);
}

/** Store a data-URL image and return its public path. */
function saveDataUrl(dataUrl) {
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(String(dataUrl || ""));
  if (!m) return null;
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 6 * 1024 * 1024) return null;
  const ext = m[1].toLowerCase() === "png" ? "png" : m[1].toLowerCase() === "webp" ? "webp" : "jpg";
  const name = crypto.randomBytes(12).toString("hex") + "." + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return "/uploads/" + name;
}

app.post("/api/upload", auth(), (req, res) => {
  const url = saveDataUrl(req.body?.image);
  if (!url) return bad(res, req, "bad_image");
  ok(res, { url });
});

// ---------- auth ----------
app.post("/api/auth/register", (req, res) => {
  const { name, phone, password, role, city, lang } = req.body || {};
  if (!name || !phone || !password || !role) return bad(res, req, "register_fields");
  if (!["shipper", "carrier"].includes(role)) return bad(res, req, "bad_role");
  if (String(password).length < 6) return bad(res, req, "short_password");
  const cleanPhone = String(phone).replace(/\s+/g, "");
  if (db.prepare("SELECT 1 FROM users WHERE phone = ?").get(cleanPhone)) return bad(res, req, "phone_taken");

  const info = db
    .prepare("INSERT INTO users (name, phone, password_hash, role, city, lang) VALUES (?,?,?,?,?,?)")
    .run(
      String(name).trim(),
      cleanPhone,
      bcrypt.hashSync(String(password), 10),
      role,
      city || null,
      LANGS.includes(lang) ? lang : req.lang
    );
  const user = db
    .prepare("SELECT id, name, phone, role, city, lang FROM users WHERE id = ?")
    .get(info.lastInsertRowid);
  ok(res, { token: sign(user), user });
});

app.post("/api/auth/login", (req, res) => {
  const { phone, password } = req.body || {};
  const cleanPhone = String(phone || "").replace(/\s+/g, "");
  const row = db.prepare("SELECT * FROM users WHERE phone = ?").get(cleanPhone);
  if (!row || !bcrypt.compareSync(String(password || ""), row.password_hash))
    return bad(res, req, "bad_credentials", 401);
  const user = { id: row.id, name: row.name, phone: row.phone, role: row.role, city: row.city, lang: row.lang };
  ok(res, { token: sign(user), user });
});

app.get("/api/me", auth(), (req, res) => {
  const truck = db.prepare("SELECT * FROM trucks WHERE user_id = ?").get(req.user.id) || null;
  const unread = db.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND seen=0").get(req.user.id).n;
  const unread_chat = db.prepare("SELECT COUNT(*) n FROM messages WHERE receiver_id=? AND seen=0").get(req.user.id).n;
  ok(res, { user: { ...req.user, ...ratingOf(req.user.id) }, truck: truck ? { ...truck, tariff: tariffOf(truck) } : null, unread, unread_chat });
});

app.put("/api/me", auth(), (req, res) => {
  const { name, city, lang, bio } = req.body || {};
  let photo = req.body?.photo_url || null;
  if (req.body?.photo) photo = saveDataUrl(req.body.photo) || photo;
  db.prepare(
    "UPDATE users SET name=COALESCE(?,name), city=COALESCE(?,city), lang=COALESCE(?,lang), bio=COALESCE(?,bio), photo_url=COALESCE(?,photo_url) WHERE id=?"
  ).run(name || null, city || null, LANGS.includes(lang) ? lang : null, bio ?? null, photo, req.user.id);
  ok(res, { user: db.prepare("SELECT id,name,phone,role,city,lang,bio,photo_url FROM users WHERE id=?").get(req.user.id) });
});

// ---------- notifications ----------
app.get("/api/notifications", auth(), (req, res) => {
  const rows = db
    .prepare("SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 30")
    .all(req.user.id)
    .map((n) => ({ ...n, text: t(n.message_key, req.lang), extra: n.extra ? JSON.parse(n.extra) : null }));
  ok(res, { notifications: rows, unread: rows.filter((n) => !n.seen).length });
});

app.post("/api/notifications/seen", auth(), (req, res) => {
  db.prepare("UPDATE notifications SET seen=1 WHERE user_id=?").run(req.user.id);
  ok(res, { success: true });
});

// ---------- trucks (carrier) ----------
app.put("/api/truck", auth(), requireRole("carrier"), (req, res) => {
  const b0 = req.body || {};
  const { truck_type, capacity_tons, plate, available, lat, lng } = b0;
  let photo_url = b0.photo_url || null;
  if (b0.photo) photo_url = saveDataUrl(b0.photo) || photo_url;
  if (!TRUCK_KEYS.includes(truck_type) || !num(capacity_tons)) return bad(res, req, "truck_fields");
  const existing = db.prepare("SELECT * FROM trucks WHERE user_id = ?").get(req.user.id);
  if (existing) {
    db.prepare(
      `UPDATE trucks SET truck_type=?, capacity_tons=?, plate=?, available=?, lat=COALESCE(?,lat), lng=COALESCE(?,lng),
        photo_url=COALESCE(?,photo_url), base_km=COALESCE(?,base_km), base_price=COALESCE(?,base_price),
        min_price=COALESCE(?,min_price), description=COALESCE(?,description), updated_at=datetime('now') WHERE user_id=?`
    ).run(truck_type, num(capacity_tons), plate || null, available === false ? 0 : 1, num(lat), num(lng),
      photo_url, num(b0.base_km), num(b0.base_price), num(b0.min_price), b0.description ?? null, req.user.id);
  } else {
    db.prepare(
      `INSERT INTO trucks (user_id, truck_type, capacity_tons, plate, available, lat, lng, photo_url, base_km, base_price, min_price, description, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`
    ).run(req.user.id, truck_type, num(capacity_tons), plate || null, available === false ? 0 : 1, num(lat), num(lng),
      photo_url, num(b0.base_km), num(b0.base_price), num(b0.min_price), b0.description || null);
  }
  const saved = db.prepare("SELECT * FROM trucks WHERE user_id = ?").get(req.user.id);
  ok(res, { truck: { ...saved, tariff: tariffOf(saved) } });
});

app.post("/api/truck/location", auth(), requireRole("carrier"), (req, res) => {
  const lat = num(req.body?.lat),
    lng = num(req.body?.lng);
  if (lat === null || lng === null) return bad(res, req, "coords_required");
  const r = db
    .prepare("UPDATE trucks SET lat=?, lng=?, updated_at=datetime('now') WHERE user_id=?")
    .run(lat, lng, req.user.id);
  if (!r.changes) return bad(res, req, "register_truck_first");
  // if the carrier is on an active trip, record a tracking point too
  const active = db
    .prepare("SELECT id FROM shipments WHERE carrier_id=? AND status IN ('accepted','picked_up') ORDER BY id DESC LIMIT 1")
    .get(req.user.id);
  if (active) db.prepare("INSERT INTO track_points (shipment_id, lat, lng) VALUES (?,?,?)").run(active.id, lat, lng);
  ok(res, { success: true, tracking_shipment_id: active ? active.id : null });
});

app.post("/api/truck/availability", auth(), requireRole("carrier"), (req, res) => {
  db.prepare("UPDATE trucks SET available=? WHERE user_id=?").run(req.body?.available ? 1 : 0, req.user.id);
  ok(res, { truck: db.prepare("SELECT * FROM trucks WHERE user_id=?").get(req.user.id) });
});

// nearest available trucks — the core "أقرب شاحنة" feature
app.get("/api/trucks/nearby", auth(false), (req, res) => {
  const lat = num(req.query.lat),
    lng = num(req.query.lng);
  const radius = num(req.query.radius) || 100;
  const type = req.query.truck_type;
  const minCap = num(req.query.min_tons);
  let rows = db
    .prepare(
      `SELECT t.*, u.name, u.city, u.photo_url AS user_photo, u.last_seen FROM trucks t JOIN users u ON u.id=t.user_id
       WHERE t.available=1 AND t.lat IS NOT NULL AND t.lng IS NOT NULL`
    )
    .all();
  if (type) rows = rows.filter((r) => r.truck_type === type);
  if (req.query.only_favorites === "1" && req.user) {
    const favIds = db.prepare("SELECT carrier_id FROM favorites WHERE user_id=?").all(req.user.id).map((f) => f.carrier_id);
    rows = rows.filter((r) => favIds.includes(r.user_id));
  }
  if (minCap) rows = rows.filter((r) => r.capacity_tons >= minCap);
  let out = rows.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    name: r.name,
    truck_type: r.truck_type,
    capacity_tons: r.capacity_tons,
    plate: r.plate,
    photo_url: r.photo_url,
    user_photo: r.user_photo,
    online: r.last_seen ? Date.now() - Date.parse(r.last_seen + "Z") < 10 * 60 * 1000 : false,
    description: r.description,
    tariff: tariffOf(r),
    lat: r.lat,
    lng: r.lng,
    updated_at: r.updated_at,
    ...ratingOf(r.user_id),
    distance_km: lat !== null && lng !== null ? Math.round(haversineKm(lat, lng, r.lat, r.lng) * 10) / 10 : null,
  }));
  if (req.user) {
    const favSet = new Set(db.prepare("SELECT carrier_id FROM favorites WHERE user_id=?").all(req.user.id).map((f) => f.carrier_id));
    out = out.map((r) => ({ ...r, favorite: favSet.has(r.user_id) }));
  }
  // optional trip estimate: how much would each carrier charge for `trip_km`?
  const tripKm = num(req.query.trip_km);
  if (tripKm) out = out.map((r) => ({ ...r, trip_estimate: estimateFor(rows.find((x) => x.user_id === r.user_id), tripKm) }));
  if (lat !== null && lng !== null) out = out.filter((r) => r.distance_km <= radius);
  const sort = req.query.sort || (lat !== null ? "distance" : "price");
  const byPrice = (a, b) => {
    const pa = a.trip_estimate ?? (a.tariff ? a.tariff.per_km : Infinity);
    const pb = b.trip_estimate ?? (b.tariff ? b.tariff.per_km : Infinity);
    return pa - pb;
  };
  if (sort === "price") out.sort(byPrice);
  else if (sort === "rating") out.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  else if (lat !== null && lng !== null) out.sort((a, b) => a.distance_km - b.distance_km);
  // mark the cheapest offer so the shipper sees it instantly
  const cheapest = [...out].sort(byPrice)[0];
  if (cheapest && (cheapest.trip_estimate != null || cheapest.tariff)) cheapest.cheapest = true;
  ok(res, { trucks: out.slice(0, 100) });
});

// ---------- shipments ----------
app.post("/api/shipments", auth(), requireRole("shipper"), (req, res) => {
  const b = req.body || {};
  const required = [
    "pickup_label",
    "pickup_lat",
    "pickup_lng",
    "dropoff_label",
    "dropoff_lat",
    "dropoff_lng",
    "cargo",
    "weight_tons",
    "truck_type",
  ];
  for (const k of required)
    if (b[k] === undefined || b[k] === null || b[k] === "") return bad(res, req, "field_required", 400, k);
  if (!TRUCK_KEYS.includes(b.truck_type)) return bad(res, req, "truck_fields");
  const info = db
    .prepare(
      `INSERT INTO shipments (shipper_id, pickup_label, pickup_lat, pickup_lng, dropoff_label, dropoff_lat, dropoff_lng, cargo, weight_tons, truck_type, budget, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      req.user.id,
      b.pickup_label,
      num(b.pickup_lat),
      num(b.pickup_lng),
      b.dropoff_label,
      num(b.dropoff_lat),
      num(b.dropoff_lng),
      b.cargo,
      num(b.weight_tons),
      b.truck_type,
      num(b.budget),
      b.notes || null
    );
  db.prepare("UPDATE shipments SET distance_km=? WHERE id=?").run(
    Math.round(haversineKm(num(b.pickup_lat), num(b.pickup_lng), num(b.dropoff_lat), num(b.dropoff_lng)) * 10) / 10,
    info.lastInsertRowid
  );
  const shipment = getShipment(info.lastInsertRowid);
  // notify nearby available carriers with a matching truck (<= 150 km from pickup)
  const carriers = db
    .prepare("SELECT user_id, lat, lng, truck_type FROM trucks WHERE available=1 AND lat IS NOT NULL")
    .all();
  for (const c of carriers) {
    if (c.truck_type !== shipment.truck_type) continue;
    if (haversineKm(c.lat, c.lng, shipment.pickup_lat, shipment.pickup_lng) > 150) continue;
    notify(c.user_id, "new_shipment", "n_new_shipment", shipment.id);
  }
  ok(res, { shipment });
});

function getShipment(id) {
  const s = db
    .prepare(
      `SELECT s.*, sh.name AS shipper_name, sh.phone AS shipper_phone, c.name AS carrier_name, c.phone AS carrier_phone
       FROM shipments s JOIN users sh ON sh.id=s.shipper_id LEFT JOIN users c ON c.id=s.carrier_id WHERE s.id=?`
    )
    .get(id);
  if (!s) return null;
  s.distance_km = Math.round(haversineKm(s.pickup_lat, s.pickup_lng, s.dropoff_lat, s.dropoff_lng) * 10) / 10;
  s.offers_count = db.prepare("SELECT COUNT(*) n FROM offers WHERE shipment_id=?").get(id).n;
  s.price_hint = suggestPrice(s.distance_km, s.weight_tons, s.truck_type);
  return s;
}

/** Hide phone numbers until a carrier is chosen. */
function maskShipment(s, viewerId) {
  const involved = viewerId && (s.shipper_id === viewerId || s.carrier_id === viewerId);
  const agreed = ["accepted", "picked_up", "delivered"].includes(s.status);
  if (!involved || !agreed) return { ...s, shipper_phone: undefined, carrier_phone: undefined };
  return s;
}

app.get("/api/shipments/mine", auth(), (req, res) => {
  const rows =
    req.user.role === "shipper"
      ? db.prepare("SELECT id FROM shipments WHERE shipper_id=? ORDER BY id DESC").all(req.user.id)
      : db
          .prepare(
            "SELECT DISTINCT s.id FROM shipments s LEFT JOIN offers o ON o.shipment_id=s.id WHERE s.carrier_id=? OR o.carrier_id=? ORDER BY s.id DESC"
          )
          .all(req.user.id, req.user.id);
  ok(res, { shipments: rows.map((r) => maskShipment(getShipment(r.id), req.user.id)) });
});

// open shipments board for carriers, sorted by distance from their truck
app.get("/api/shipments/open", auth(), requireRole("carrier"), (req, res) => {
  const truck = db.prepare("SELECT * FROM trucks WHERE user_id=?").get(req.user.id);
  let rows = db
    .prepare("SELECT id FROM shipments WHERE status='open' ORDER BY id DESC")
    .all()
    .map((r) => getShipment(r.id));
  rows = rows.map((s) => ({
    ...maskShipment(s, req.user.id),
    pickup_distance_km:
      truck && truck.lat != null
        ? Math.round(haversineKm(truck.lat, truck.lng, s.pickup_lat, s.pickup_lng) * 10) / 10
        : null,
    my_offer: db.prepare("SELECT * FROM offers WHERE shipment_id=? AND carrier_id=?").get(s.id, req.user.id) || null,
  }));
  if (truck && truck.lat != null) rows.sort((a, b) => a.pickup_distance_km - b.pickup_distance_km);
  ok(res, { shipments: rows });
});

app.get("/api/shipments/:id", auth(), (req, res) => {
  const s = getShipment(Number(req.params.id));
  if (!s) return bad(res, req, "shipment_missing", 404);
  const offers = db
    .prepare(
      "SELECT o.*, u.name, u.phone FROM offers o JOIN users u ON u.id=o.carrier_id WHERE o.shipment_id=? ORDER BY o.price ASC"
    )
    .all(s.id)
    .map((o) => ({ ...o, ...ratingOf(o.carrier_id), phone: s.carrier_id === o.carrier_id ? o.phone : undefined }));
  ok(res, {
    shipment: maskShipment(s, req.user.id),
    offers: s.shipper_id === req.user.id ? offers : offers.filter((o) => o.carrier_id === req.user.id),
  });
});

// live tracking of the carrier during an active trip
app.get("/api/shipments/:id/track", auth(), (req, res) => {
  const s = getShipment(Number(req.params.id));
  if (!s) return bad(res, req, "shipment_missing", 404);
  if (s.shipper_id !== req.user.id && s.carrier_id !== req.user.id) return bad(res, req, "forbidden", 403);
  const points = db
    .prepare("SELECT lat, lng, created_at FROM track_points WHERE shipment_id=? ORDER BY id DESC LIMIT 50")
    .all(s.id)
    .reverse();
  ok(res, { points, last: points[points.length - 1] || null });
});

app.post("/api/shipments/:id/offers", auth(), requireRole("carrier"), (req, res) => {
  const s = getShipment(Number(req.params.id));
  if (!s) return bad(res, req, "shipment_missing", 404);
  if (s.status !== "open") return bad(res, req, "shipment_closed");
  const price = num(req.body?.price);
  if (!price || price <= 0) return bad(res, req, "bad_price");
  db.prepare(
    `INSERT INTO offers (shipment_id, carrier_id, price, message) VALUES (?,?,?,?)
     ON CONFLICT(shipment_id, carrier_id) DO UPDATE SET price=excluded.price, message=excluded.message, status='pending'`
  ).run(s.id, req.user.id, price, req.body?.message || null);
  notify(s.shipper_id, "offer", "n_new_offer", s.id, { price });
  ok(res, { success: true });
});

app.post("/api/offers/:id/accept", auth(), requireRole("shipper"), (req, res) => {
  const offer = db.prepare("SELECT * FROM offers WHERE id=?").get(Number(req.params.id));
  if (!offer) return bad(res, req, "offer_missing", 404);
  const s = getShipment(offer.shipment_id);
  if (s.shipper_id !== req.user.id) return bad(res, req, "forbidden", 403);
  if (s.status !== "open") return bad(res, req, "carrier_chosen");
  const tx = db.transaction(() => {
    db.prepare("UPDATE shipments SET carrier_id=?, agreed_price=?, status='accepted' WHERE id=?").run(
      offer.carrier_id,
      offer.price,
      s.id
    );
    db.prepare("UPDATE offers SET status='accepted' WHERE id=?").run(offer.id);
    db.prepare("UPDATE offers SET status='rejected' WHERE shipment_id=? AND id<>?").run(s.id, offer.id);
  });
  tx();
  notify(offer.carrier_id, "offer_accepted", "n_offer_accepted", s.id, { price: offer.price });
  ok(res, { shipment: maskShipment(getShipment(s.id), req.user.id) });
});

const FLOW = { accepted: "picked_up", picked_up: "delivered" };
app.post("/api/shipments/:id/status", auth(), (req, res) => {
  const s = getShipment(Number(req.params.id));
  if (!s) return bad(res, req, "shipment_missing", 404);
  const next = req.body?.status;
  if (next === "cancelled") {
    if (s.shipper_id !== req.user.id) return bad(res, req, "forbidden", 403);
    if (["delivered"].includes(s.status)) return bad(res, req, "cannot_cancel");
    db.prepare("UPDATE shipments SET status='cancelled' WHERE id=?").run(s.id);
    if (s.carrier_id) notify(s.carrier_id, "status", "n_status", s.id, { status: "cancelled" });
    return ok(res, { shipment: maskShipment(getShipment(s.id), req.user.id) });
  }
  if (s.carrier_id !== req.user.id) return bad(res, req, "forbidden", 403);
  if (FLOW[s.status] !== next) return bad(res, req, "bad_transition");
  let podUrl = null;
  if (next === "delivered" && req.body?.pod_photo) {
    try { podUrl = saveDataUrl(req.body.pod_photo); } catch (e) { return bad(res, req, "bad_image"); }
  }
  db.prepare("UPDATE shipments SET status=?, pod_photo_url=COALESCE(?, pod_photo_url), delivered_at=CASE WHEN ?='delivered' THEN datetime('now') ELSE delivered_at END WHERE id=?")
    .run(next, podUrl, next, s.id);
  notify(s.shipper_id, "status", "n_status", s.id, { status: next });
  ok(res, { shipment: maskShipment(getShipment(s.id), req.user.id) });
});

app.post("/api/shipments/:id/rate", auth(), (req, res) => {
  const s = getShipment(Number(req.params.id));
  if (!s) return bad(res, req, "shipment_missing", 404);
  if (s.status !== "delivered") return bad(res, req, "rate_after_delivery");
  const isShipper = s.shipper_id === req.user.id;
  const isCarrier = s.carrier_id === req.user.id;
  if (!isShipper && !isCarrier) return bad(res, req, "forbidden", 403);
  const stars = num(req.body?.stars);
  if (!stars || stars < 1 || stars > 5) return bad(res, req, "bad_stars");
  const ratee = isShipper ? s.carrier_id : s.shipper_id;
  db.prepare(
    `INSERT INTO ratings (shipment_id, rater_id, ratee_id, stars, comment) VALUES (?,?,?,?,?)
     ON CONFLICT(shipment_id, rater_id) DO UPDATE SET stars=excluded.stars, comment=excluded.comment`
  ).run(s.id, req.user.id, ratee, Math.round(stars), req.body?.comment || null);
  ok(res, { success: true });
});

// ---------- payments (Chargily Pay) ----------
app.post("/api/shipments/:id/pay", auth(), requireRole("shipper"), async (req, res) => {
  if (!chargily.enabled()) return bad(res, req, "pay_not_configured", 503);
  const s = getShipment(Number(req.params.id));
  if (!s) return bad(res, req, "shipment_missing", 404);
  if (s.shipper_id !== req.user.id) return bad(res, req, "forbidden", 403);
  if (!s.agreed_price || !["accepted", "picked_up", "delivered"].includes(s.status))
    return bad(res, req, "pay_needs_agreement");
  if (s.payment_status === "paid") return bad(res, req, "already_paid");
  try {
    const checkout = await chargily.createCheckout({
      amount: s.agreed_price,
      locale: req.user.lang || req.lang,
      description: `Truckly #${s.id} — ${s.pickup_label} → ${s.dropoff_label}`,
      successUrl: `${PUBLIC_URL}/?pay=success&shipment=${s.id}`,
      failureUrl: `${PUBLIC_URL}/?pay=failed&shipment=${s.id}`,
      webhookUrl: `${PUBLIC_URL}/api/webhooks/chargily`,
      metadata: { shipment_id: s.id, user_id: req.user.id },
    });
    db.prepare(
      "INSERT INTO payments (shipment_id, user_id, checkout_id, amount, status, url) VALUES (?,?,?,?, 'pending', ?)"
    ).run(s.id, req.user.id, checkout.id, s.agreed_price, checkout.url);
    db.prepare("UPDATE shipments SET payment_status='pending', payment_method='chargily' WHERE id=?").run(s.id);
    ok(res, { checkout_url: checkout.url, checkout_id: checkout.id });
  } catch (e) {
    console.error("[chargily] create checkout failed:", e.message);
    return bad(res, req, "pay_failed", 502);
  }
});

app.get("/api/shipments/:id/payment", auth(), (req, res) => {
  const s = getShipment(Number(req.params.id));
  if (!s) return bad(res, req, "shipment_missing", 404);
  if (s.shipper_id !== req.user.id && s.carrier_id !== req.user.id) return bad(res, req, "forbidden", 403);
  const p = db.prepare("SELECT * FROM payments WHERE shipment_id=? ORDER BY id DESC LIMIT 1").get(s.id) || null;
  ok(res, { payment_status: s.payment_status, payment: p });
});

function handleChargilyEvent(event) {
  const type = event?.type;
  const data = event?.data || {};
  const checkoutId = data.id;
  if (!checkoutId) return;
  const pay = db.prepare("SELECT * FROM payments WHERE checkout_id=?").get(checkoutId);
  const shipmentId = pay?.shipment_id || Number(data?.metadata?.[0]?.shipment_id) || null;
  const status = type === "checkout.paid" ? "paid" : type === "checkout.failed" ? "failed" : "canceled";
  if (pay) db.prepare("UPDATE payments SET status=?, updated_at=datetime('now') WHERE id=?").run(status, pay.id);
  if (shipmentId) {
    db.prepare("UPDATE shipments SET payment_status=? WHERE id=?").run(status === "paid" ? "paid" : "unpaid", shipmentId);
    if (status === "paid") {
      const s = getShipment(shipmentId);
      notify(s?.carrier_id, "payment", "n_paid", shipmentId, { amount: data.amount });
      notify(s?.shipper_id, "payment", "n_paid", shipmentId, { amount: data.amount });
    }
  }
  console.log(`[chargily] ${type} checkout=${checkoutId} shipment=${shipmentId}`);
}

// ---------- misc ----------
app.get("/api/users/:id", (req, res) => {
  const u = db.prepare("SELECT id, name, role, city, bio, photo_url, created_at FROM users WHERE id=?").get(Number(req.params.id));
  if (!u) return bad(res, req, "not_found", 404);
  const truckRow = db.prepare("SELECT * FROM trucks WHERE user_id=?").get(u.id) || null;
  u.truck = truckRow ? { ...truckRow, tariff: tariffOf(truckRow) } : null;
  u.trips = db
    .prepare("SELECT COUNT(*) n FROM shipments WHERE status='delivered' AND (carrier_id=? OR shipper_id=?)")
    .get(u.id, u.id).n;
  const reviews = db
    .prepare(
      "SELECT r.stars, r.comment, r.created_at, u.name AS rater FROM ratings r JOIN users u ON u.id=r.rater_id WHERE r.ratee_id=? ORDER BY r.id DESC LIMIT 20"
    )
    .all(u.id);
  ok(res, { user: { ...u, ...ratingOf(u.id) }, reviews });
});

// ---------- favorites ----------
app.get("/api/favorites", auth(), (req, res) => {
  const rows = db
    .prepare(
      `SELECT u.id, u.name, u.city, u.photo_url, t.truck_type, t.capacity_tons, t.photo_url AS truck_photo, t.available,
              t.base_km, t.base_price, t.min_price
         FROM favorites f JOIN users u ON u.id=f.carrier_id LEFT JOIN trucks t ON t.user_id=u.id
        WHERE f.user_id=? ORDER BY f.id DESC`
    )
    .all(req.user.id)
    .map((r) => ({ ...r, ...ratingOf(r.id), tariff: tariffOf(r) }));
  ok(res, { favorites: rows, ids: rows.map((r) => r.id) });
});

app.post("/api/favorites/:carrierId", auth(), (req, res) => {
  const cid = Number(req.params.carrierId);
  const c = db.prepare("SELECT id, role FROM users WHERE id=?").get(cid);
  if (!c || c.role !== "carrier") return bad(res, req, "not_found", 404);
  const has = db.prepare("SELECT id FROM favorites WHERE user_id=? AND carrier_id=?").get(req.user.id, cid);
  if (has) db.prepare("DELETE FROM favorites WHERE id=?").run(has.id);
  else db.prepare("INSERT INTO favorites (user_id, carrier_id) VALUES (?,?)").run(req.user.id, cid);
  ok(res, { favorite: !has });
});

// ---------- dashboard ----------
app.get("/api/dashboard", auth(), (req, res) => {
  const me = req.user.id;
  const isCarrier = req.user.role === "carrier";
  const col = isCarrier ? "carrier_id" : "shipper_id";
  const money = (v) => Math.round(v || 0);

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(status='delivered') AS delivered,
              SUM(status IN ('accepted','picked_up')) AS active,
              SUM(status='open') AS open,
              SUM(status='cancelled') AS cancelled,
              SUM(CASE WHEN status='delivered' THEN agreed_price ELSE 0 END) AS earned,
              SUM(CASE WHEN status='delivered' THEN distance_km ELSE 0 END) AS km
         FROM shipments WHERE ${col}=?`
    )
    .get(me);

  const month = db
    .prepare(
      `SELECT SUM(CASE WHEN status='delivered' THEN agreed_price ELSE 0 END) AS earned, SUM(status='delivered') AS delivered
         FROM shipments WHERE ${col}=? AND created_at >= date('now','start of month')`
    )
    .get(me);

  // last 6 months series
  const series = db
    .prepare(
      `SELECT strftime('%Y-%m', created_at) AS m,
              SUM(CASE WHEN status='delivered' THEN agreed_price ELSE 0 END) AS amount,
              SUM(status='delivered') AS trips
         FROM shipments WHERE ${col}=? AND created_at >= date('now','-5 months','start of month')
        GROUP BY m ORDER BY m`
    )
    .all(me);
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const hit = series.find((r) => r.m === key);
    months.push({ month: key, amount: money(hit?.amount), trips: hit?.trips || 0 });
  }

  const rating = ratingOf(me);
  const unreadChat = db.prepare("SELECT COUNT(*) n FROM messages WHERE receiver_id=? AND seen=0").get(me).n;
  const out = {
    role: req.user.role,
    totals: {
      total: totals.total || 0,
      delivered: totals.delivered || 0,
      active: totals.active || 0,
      open: totals.open || 0,
      cancelled: totals.cancelled || 0,
      amount: money(totals.earned),
      km: Math.round(totals.km || 0),
    },
    month: { amount: money(month?.earned), delivered: month?.delivered || 0 },
    months,
    rating,
    unread_chat: unreadChat,
    tips: [],
  };

  if (isCarrier) {
    const truck = db.prepare("SELECT * FROM trucks WHERE user_id=?").get(me) || null;
    const offers = db
      .prepare("SELECT COUNT(*) AS sent, SUM(status='accepted') AS won FROM offers WHERE carrier_id=?")
      .get(me);
    out.offers = { sent: offers.sent || 0, won: offers.won || 0, win_rate: offers.sent ? Math.round(((offers.won || 0) / offers.sent) * 100) : null };
    out.truck = truck ? { ...truck, tariff: tariffOf(truck) } : null;

    // market position: my per-km vs other carriers with a tariff
    const market = db
      .prepare("SELECT user_id, base_km, base_price FROM trucks WHERE base_price IS NOT NULL AND base_km IS NOT NULL")
      .all()
      .map((t) => ({ user_id: t.user_id, per_km: t.base_price / t.base_km }))
      .sort((a, b) => a.per_km - b.per_km);
    const mine = market.find((m) => m.user_id === me);
    if (market.length) {
      const avg = market.reduce((a, b) => a + b.per_km, 0) / market.length;
      out.market = {
        avg_per_km: Math.round(avg * 10) / 10,
        cheapest_per_km: Math.round(market[0].per_km * 10) / 10,
        carriers: market.length,
        my_per_km: mine ? Math.round(mine.per_km * 10) / 10 : null,
        my_rank: mine ? market.findIndex((m) => m.user_id === me) + 1 : null,
      };
    }
    // profile completeness + actionable tips
    const checks = [
      { key: "tip_add_truck", done: !!truck },
      { key: "tip_add_photo", done: !!truck?.photo_url },
      { key: "tip_set_tariff", done: !!(truck?.base_price && truck?.base_km) },
      { key: "tip_share_loc", done: !!(truck?.lat && truck?.lng) },
      { key: "tip_available", done: !!truck?.available },
      { key: "tip_add_bio", done: !!req.user.bio },
      { key: "tip_avatar", done: !!req.user.photo_url },
    ];
    out.checklist = checks;
    out.completeness = Math.round((checks.filter((c) => c.done).length / checks.length) * 100);
    if (out.market?.my_per_km && out.market.my_per_km > out.market.avg_per_km)
      out.tips.push({ key: "tip_price_above_avg", arg: out.market.avg_per_km });
  } else {
    const paid = db
      .prepare("SELECT COUNT(*) n FROM shipments WHERE shipper_id=? AND payment_status='paid'")
      .get(me).n;
    out.paid_count = paid;
    const favs = db.prepare("SELECT COUNT(*) n FROM favorites WHERE user_id=?").get(me).n;
    out.favorites = favs;
    const avgKm = db
      .prepare("SELECT AVG(agreed_price/NULLIF(distance_km,0)) v FROM shipments WHERE shipper_id=? AND status='delivered' AND agreed_price>0")
      .get(me).v;
    out.avg_per_km = avgKm ? Math.round(avgKm * 10) / 10 : null;
    const checks = [
      { key: "tip_first_order", done: (totals.total || 0) > 0 },
      { key: "tip_avatar", done: !!req.user.photo_url },
      { key: "tip_add_bio", done: !!req.user.bio },
      { key: "tip_fav_carrier", done: favs > 0 },
      { key: "tip_rate_carrier", done: db.prepare("SELECT COUNT(*) n FROM ratings WHERE rater_id=?").get(me).n > 0 },
    ];
    out.checklist = checks;
    out.completeness = Math.round((checks.filter((c) => c.done).length / checks.length) * 100);
  }
  ok(res, out);
});

// ---------- chat ----------
app.get("/api/conversations", auth(), (req, res) => {
  const rows = db
    .prepare(
      `SELECT other_id, MAX(id) AS last_id FROM (
         SELECT id, receiver_id AS other_id FROM messages WHERE sender_id=?
         UNION ALL
         SELECT id, sender_id AS other_id FROM messages WHERE receiver_id=?
       ) GROUP BY other_id ORDER BY last_id DESC LIMIT 50`
    )
    .all(req.user.id, req.user.id);
  const out = rows.map((r) => {
    const last = db.prepare("SELECT * FROM messages WHERE id=?").get(r.last_id);
    const u = db.prepare("SELECT id, name, role, photo_url FROM users WHERE id=?").get(r.other_id);
    const unread = db
      .prepare("SELECT COUNT(*) n FROM messages WHERE sender_id=? AND receiver_id=? AND seen=0")
      .get(r.other_id, req.user.id).n;
    return { user: { ...u, ...ratingOf(r.other_id) }, last, unread };
  });
  ok(res, { conversations: out, unread_total: out.reduce((a, c) => a + c.unread, 0) });
});

app.get("/api/messages/:userId", auth(), (req, res) => {
  const other = Number(req.params.userId);
  const u = db.prepare("SELECT id, name, role, photo_url FROM users WHERE id=?").get(other);
  if (!u) return bad(res, req, "not_found", 404);
  const messages = db
    .prepare(
      `SELECT * FROM messages WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)
       ORDER BY id ASC LIMIT 300`
    )
    .all(req.user.id, other, other, req.user.id);
  db.prepare("UPDATE messages SET seen=1 WHERE sender_id=? AND receiver_id=? AND seen=0").run(other, req.user.id);
  ok(res, { user: { ...u, ...ratingOf(other) }, messages, me: req.user.id });
});

app.post("/api/messages/:userId", auth(), (req, res) => {
  const other = Number(req.params.userId);
  if (other === req.user.id) return bad(res, req, "forbidden", 403);
  if (!db.prepare("SELECT 1 FROM users WHERE id=?").get(other)) return bad(res, req, "not_found", 404);
  const text = String(req.body?.text || "").trim().slice(0, 2000);
  if (!text) return bad(res, req, "empty_message");
  const sid = num(req.body?.shipment_id) || null; // 0/null/undefined -> no shipment link
  const info = db
    .prepare("INSERT INTO messages (sender_id, receiver_id, shipment_id, text) VALUES (?,?,?,?)")
    .run(req.user.id, other, sid, text);
  notify(other, "message", "n_new_message", sid, { from: req.user.name, user_id: req.user.id });
  ok(res, { message: db.prepare("SELECT * FROM messages WHERE id=?").get(info.lastInsertRowid) });
});

app.get("/api/price-hint", (req, res) => {
  const d = num(req.query.distance_km) || 0;
  const w = num(req.query.weight_tons) || 0;
  ok(res, suggestPrice(d, w, req.query.truck_type));
});

app.get("/api/meta", (_req, res) => {
  const stats = {
    users: db.prepare("SELECT COUNT(*) n FROM users").get().n,
    trucks: db.prepare("SELECT COUNT(*) n FROM trucks").get().n,
    shipments: db.prepare("SELECT COUNT(*) n FROM shipments").get().n,
    delivered: db.prepare("SELECT COUNT(*) n FROM shipments WHERE status='delivered'").get().n,
  };
  ok(res, { truck_types: TRUCK_TYPES, stats, payments_enabled: chargily.enabled(), payment_mode: chargily.MODE });
});

app.get("/api/health", (_req, res) => ok(res, { status: "ok", time: new Date().toISOString() }));

// ---------- static frontend ----------
app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "30d" }));
app.use(express.static(path.join(__dirname, "..", "public")));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "index.html")));

// backfill trip distance for shipments created before v4
for (const r of db.prepare("SELECT id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng FROM shipments WHERE distance_km IS NULL").all()) {
  db.prepare("UPDATE shipments SET distance_km=? WHERE id=?")
    .run(Math.round(haversineKm(r.pickup_lat, r.pickup_lng, r.dropoff_lat, r.dropoff_lng) * 10) / 10, r.id);
}

app.listen(PORT, () => console.log(`Truckly API + web on :${PORT} (payments: ${chargily.enabled() ? chargily.MODE : "off"})`));

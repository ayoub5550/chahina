const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "truckly.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('shipper','carrier')),
  city TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trucks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  truck_type TEXT NOT NULL,
  capacity_tons REAL NOT NULL,
  plate TEXT,
  available INTEGER NOT NULL DEFAULT 1,
  lat REAL,
  lng REAL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS shipments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shipper_id INTEGER NOT NULL REFERENCES users(id),
  carrier_id INTEGER REFERENCES users(id),
  pickup_label TEXT NOT NULL,
  pickup_lat REAL NOT NULL,
  pickup_lng REAL NOT NULL,
  dropoff_label TEXT NOT NULL,
  dropoff_lat REAL NOT NULL,
  dropoff_lng REAL NOT NULL,
  cargo TEXT NOT NULL,
  weight_tons REAL NOT NULL,
  truck_type TEXT NOT NULL,
  budget REAL,
  notes TEXT,
  agreed_price REAL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id INTEGER NOT NULL REFERENCES shipments(id),
  carrier_id INTEGER NOT NULL REFERENCES users(id),
  price REAL NOT NULL,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (shipment_id, carrier_id)
);

CREATE TABLE IF NOT EXISTS ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id INTEGER NOT NULL REFERENCES shipments(id),
  rater_id INTEGER NOT NULL REFERENCES users(id),
  ratee_id INTEGER NOT NULL REFERENCES users(id),
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (shipment_id, rater_id)
);

CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status);
CREATE INDEX IF NOT EXISTS idx_offers_shipment ON offers(shipment_id);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  message_key TEXT NOT NULL,
  shipment_id INTEGER,
  extra TEXT,
  seen INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id INTEGER NOT NULL REFERENCES shipments(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  checkout_id TEXT UNIQUE,
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS track_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id INTEGER NOT NULL REFERENCES shipments(id),
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, seen);
CREATE INDEX IF NOT EXISTS idx_track_shipment ON track_points(shipment_id);
`);

// --- lightweight migrations (safe to re-run) ---
function addColumn(table, col, decl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
}
addColumn("users", "lang", "TEXT DEFAULT 'ar'");
addColumn("shipments", "payment_status", "TEXT NOT NULL DEFAULT 'unpaid'");
addColumn("shipments", "payment_method", "TEXT DEFAULT 'cash'");

// v3: truck photo, per-km pricing, profiles, chat
addColumn("trucks", "photo_url", "TEXT");
addColumn("trucks", "base_km", "REAL");        // e.g. 10
addColumn("trucks", "base_price", "REAL");     // e.g. 2000 DZD for base_km
addColumn("trucks", "min_price", "REAL");      // minimum trip fare
addColumn("trucks", "description", "TEXT");
addColumn("users", "photo_url", "TEXT");
addColumn("users", "bio", "TEXT");

db.exec(`
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id INTEGER NOT NULL REFERENCES users(id),
  receiver_id INTEGER NOT NULL REFERENCES users(id),
  shipment_id INTEGER REFERENCES shipments(id),
  text TEXT NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_msg_pair ON messages(sender_id, receiver_id, id);
CREATE INDEX IF NOT EXISTS idx_msg_inbox ON messages(receiver_id, seen);
`);

// v4: proof of delivery, favorites, truck stats
addColumn("shipments", "pod_photo_url", "TEXT");
addColumn("shipments", "delivered_at", "TEXT");
addColumn("shipments", "distance_km", "REAL");
addColumn("users", "last_seen", "TEXT");

db.exec(`
CREATE TABLE IF NOT EXISTS favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  carrier_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, carrier_id)
);
CREATE INDEX IF NOT EXISTS idx_fav_user ON favorites(user_id);
`);


// v5: verification, saved places, extra truck photos
addColumn("users", "verified", "INTEGER NOT NULL DEFAULT 0");
addColumn("users", "id_doc_url", "TEXT");
addColumn("trucks", "photos", "TEXT");            // JSON array of extra photos
addColumn("shipments", "requested_at", "TEXT");
addColumn("shipments", "auto_price", "REAL");     // price computed from carrier tariff

db.exec(`
CREATE TABLE IF NOT EXISTS places (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  label TEXT NOT NULL,
  address TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_places_user ON places(user_id);
`);

// truck types used to be stored as Arabic labels; migrate them to stable keys
const LEGACY = {
  "\u0634\u0627\u062d\u0646\u0629 \u0635\u063a\u064a\u0631\u0629": "small",
  "\u0634\u0627\u062d\u0646\u0629 \u0645\u062a\u0648\u0633\u0637\u0629": "medium",
  "\u0634\u0627\u062d\u0646\u0629 \u0643\u0628\u064a\u0631\u0629": "large",
  "\u0645\u0628\u0631\u062f\u0629": "refrigerated",
  "\u0635\u0647\u0631\u064a\u062c": "tanker",
  "\u0642\u0644\u0627\u0628": "tipper",
  "\u0646\u0642\u0644 \u0633\u064a\u0627\u0631\u0627\u062a": "car_carrier",
};
for (const [label, key] of Object.entries(LEGACY)) {
  db.prepare("UPDATE trucks SET truck_type=? WHERE truck_type=?").run(key, label);
  db.prepare("UPDATE shipments SET truck_type=? WHERE truck_type=?").run(key, label);
}

// v6: rich chat (photos, location), message reactions
addColumn("messages", "kind", "TEXT NOT NULL DEFAULT 'text'");
addColumn("messages", "media_url", "TEXT");
addColumn("messages", "lat", "REAL");
addColumn("messages", "lng", "REAL");

module.exports = db;

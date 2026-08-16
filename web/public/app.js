/* شاحنتي / Chahina — PWA front-end (ar / fr / en) */
const ORIGIN = (window.API_ORIGIN || "").replace(/\/$/, "");
const API = ORIGIN + "/api";
/** Make server-relative media URLs absolute (needed when the app runs from bundled files). */
const mediaUrl = (u) => (typeof u === "string" && u.startsWith("/") ? ORIGIN + u : u);
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const state = {
  token: localStorage.getItem("tk_token"),
  // Algeria-first: Arabic by default, French only if the phone is set to French
  lang: localStorage.getItem("tk_lang") || ((navigator.language || "ar").slice(0, 2) === "fr" ? "fr" : "ar"),
  user: null,
  truck: null,
  map: null,
  markers: [],
  me: null,
  types: [],
  meta: null,
  trackTimer: null,
};
if (!["ar", "fr", "en"].includes(state.lang)) state.lang = "ar";

/* ---------- i18n ---------- */
const T = (k, arg) => {
  const s = (window.I18N[state.lang] && window.I18N[state.lang][k]) || window.I18N.ar[k] || k;
  return arg !== undefined ? String(s).replace("%s", arg) : s;
};
const truckLabel = (key) => T("tt_" + key);

function applyLang() {
  const dict = window.I18N[state.lang];
  document.documentElement.lang = state.lang;
  document.documentElement.dir = dict.dir;
  $$("[data-i18n]").forEach((el) => (el.textContent = T(el.dataset.i18n)));
  $$("[data-i18n-ph]").forEach((el) => (el.placeholder = T(el.dataset.i18nPh)));
  $$("#lang-switch-auth button").forEach((b) => b.classList.toggle("active", b.dataset.lang === state.lang));
  const sel = $("#lang-select");
  if (sel) sel.value = state.lang;
  if (state.user) renderUserChrome();
}

function setLang(lang) {
  state.lang = lang;
  localStorage.setItem("tk_lang", lang);
  applyLang();
  if (state.user) {
    api("/me", { method: "PUT", body: { lang } }).catch(() => {});
    fillTypeFilter();
    if (state.user.role === "shipper") refreshTrucks();
    else renderTruckPanel();
  }
}
$$("#lang-switch-auth button").forEach((b) => (b.onclick = () => setLang(b.dataset.lang)));
$("#lang-select").onchange = (e) => setLang(e.target.value);

/* ---------- utils ---------- */
async function api(path, { method = "GET", body, raw = false } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Lang": state.lang,
      ...(state.token ? { Authorization: "Bearer " + state.token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) {
    const text = await res.text();
    if (!res.ok) throw new Error(T("generic_error"));
    return text;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || T("generic_error"));
  return data;
}
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), 2800);
}
const stars = (r, n) =>
  r ? `<span class="stars">${"★".repeat(Math.round(r))}${"☆".repeat(5 - Math.round(r))}</span> ${r} (${n})` : `<small>${T("no_ratings")}</small>`;
const statusLabel = (s) => T("status_" + s);
const money = (v) => (v == null ? "—" : Number(v).toLocaleString(state.lang === "ar" ? "ar-DZ" : state.lang) + " " + T("currency"));
const short = (t) => (t || "").split(",").slice(0, 2).join("، ");
const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const avatar = (url, name, cls = "") =>
  url
    ? `<img class="avatar ${cls}" src="${esc(mediaUrl(url))}" alt="${esc(name || "")}">`
    : `<div class="avatar ph ${cls}">${esc((name || "?").trim().charAt(0).toUpperCase())}</div>`;
const timeShort = (ts) => String(ts || "").slice(5, 16);

/** Read a file input into a downscaled data-URL so uploads stay small. */
function readImage(file, max = 1000) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    if (file.size > 12 * 1024 * 1024) return reject(new Error(T("photo_too_big")));
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = () => reject(new Error(T("photo_too_big")));
      img.src = fr.result;
    };
    fr.onerror = () => reject(new Error(T("photo_too_big")));
    fr.readAsDataURL(file);
  });
}

/** Wire a "choose photo" control; calls back with the data-URL. */
function wirePhotoPicker(rootSel, onPicked) {
  const wrap = $(rootSel);
  if (!wrap) return;
  const input = $("input[type=file]", wrap);
  const btn = $("button", wrap);
  btn.onclick = () => input.click();
  input.onchange = async () => {
    try {
      const data = await readImage(input.files[0]);
      if (!data) return;
      const prev = $("img", wrap) || $(".avatar", wrap);
      if (prev && prev.tagName === "IMG") prev.src = data;
      onPicked(data);
      toast(T("image_saved"));
    } catch (e) { toast(e.message); }
  };
}

const empty = (icon, title, text) =>
  `<div class="empty"><span class="ic">${icon}</span><b>${title}</b><p>${text || ""}</p></div>`;

const tariffText = (tf) =>
  tf ? `${money(tf.base_price)} / ${tf.base_km} ${T("km")} <small>(${tf.per_km} ${T("per_km")})</small>` : `<small>${T("no_tariff")}</small>`;

function openModal(title, html) {
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = html;
  $("#modal").classList.remove("hidden");
}
function closeModal() {
  $("#modal").classList.add("hidden");
  if (state.trackTimer) { clearInterval(state.trackTimer); state.trackTimer = null; }
}
$("#modal-close").onclick = closeModal;
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error(T("geo_unsupported")));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => reject(new Error(T("geo_failed"))),
      { enableHighAccuracy: true, timeout: 12000 }
    );
  });
}
async function geocode(q) {
  const r = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=${state.lang}&q=${encodeURIComponent(q)}`
  );
  const j = await r.json();
  return j[0] ? { lat: +j[0].lat, lng: +j[0].lon, label: j[0].display_name } : null;
}

/** Map point picker — works even without GPS permission or HTTPS. */
function pickOnMap(initial) {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "picker-overlay";
    wrap.innerHTML = `<div class="picker-card">
      <div class="modal-head"><b>${T("pick_map_title")}</b><button class="btn ghost small" data-x>✕</button></div>
      <div id="pick-map" class="map-pick"></div>
      <button class="btn primary block" data-ok>${T("confirm_point")}</button></div>`;
    document.body.appendChild(wrap);
    const center = initial || state.me || { lat: 36.75, lng: 3.06 };
    const m = L.map(wrap.querySelector("#pick-map")).setView([center.lat, center.lng], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(m);
    const marker = L.marker([center.lat, center.lng], { draggable: true }).addTo(m);
    m.on("click", (e) => marker.setLatLng(e.latlng));
    setTimeout(() => m.invalidateSize(), 120);
    const done = (val) => { document.body.removeChild(wrap); resolve(val); };
    wrap.querySelector("[data-x]").onclick = () => done(null);
    wrap.querySelector("[data-ok]").onclick = () => {
      const ll = marker.getLatLng();
      done({ lat: ll.lat, lng: ll.lng });
    };
  });
}

/* ---------- auth ---------- */
$$(".tab").forEach((t) => (t.onclick = () => {
  $$(".tab").forEach((x) => x.classList.toggle("active", x === t));
  $("#form-login").classList.toggle("hidden", t.dataset.auth !== "login");
  $("#form-register").classList.toggle("hidden", t.dataset.auth !== "register");
  $("#auth-error").textContent = "";
}));

$("#form-login").onsubmit = async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  try { await afterAuth(await api("/auth/login", { method: "POST", body: f })); }
  catch (err) { $("#auth-error").textContent = err.message; }
};
$("#form-register").onsubmit = async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  try { await afterAuth(await api("/auth/register", { method: "POST", body: { ...f, lang: state.lang } })); }
  catch (err) { $("#auth-error").textContent = err.message; }
};
async function afterAuth({ token, user }) {
  state.token = token;
  localStorage.setItem("tk_token", token);
  state.user = user;
  await boot();
}
$("#btn-logout").onclick = () => { localStorage.removeItem("tk_token"); location.reload(); };

/* ---------- theme ---------- */
function applyTheme(t) {
  state.theme = t;
  localStorage.setItem("tk_theme", t);
  document.documentElement.setAttribute("data-theme", t);
  const btn = $("#btn-theme");
  if (btn) btn.textContent = t === "light" ? "☀️" : "🌙";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = t === "light" ? "#f2f5fa" : "#070d18";
}
applyTheme(localStorage.getItem("tk_theme") || "dark");
$("#btn-theme").onclick = () => applyTheme(state.theme === "light" ? "dark" : "light");

/* ---------- navigation ---------- */
$$(".nav").forEach((b) => (b.onclick = () => {
  $$(".nav").forEach((x) => x.classList.toggle("active", x === b));
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + b.dataset.view));
  if (b.dataset.view === "map" && state.map) setTimeout(() => state.map.invalidateSize(), 60);
  if (b.dataset.view === "shipments") loadShipments();
  if (b.dataset.view === "profile") loadProfile();
  if (b.dataset.view === "chats") loadChats();
  if (b.dataset.view === "dash") loadDash();
}));

/* ---------- boot ---------- */
function fillTypeFilter() {
  $("#filter-type").innerHTML =
    `<option value="">${T("all_types")}</option>` + state.types.map((t) => `<option value="${t.key}">${truckLabel(t.key)}</option>`).join("");
}
function renderUserChrome() {
  const u = state.user;
  $("#me-name").textContent = u.name;
  $("#me-role").textContent = u.role === "shipper" ? T("role_shipper_s") : T("role_carrier_s");
  $("#me-rating").innerHTML = u.rating ? `★ ${u.rating}` : T("new_badge");
  $("#nav-ship-label").textContent = u.role === "shipper" ? T("my_shipments") : T("requests");
  $("#shipments-title").textContent = u.role === "shipper" ? T("my_shipments") : T("nearby_requests");
}

async function boot() {
  applyLang();
  state.meta = await api("/meta");
  state.types = state.meta.truck_types;
  if (!state.token) { $("#screen-auth").classList.add("active"); return; }
  let me;
  try { me = await api("/me"); } catch { localStorage.removeItem("tk_token"); location.reload(); return; }
  state.user = me.user;
  state.truck = me.truck;
  if (me.user.lang && !localStorage.getItem("tk_lang")) state.lang = me.user.lang;
  applyLang();
  $("#screen-auth").classList.remove("active");
  $("#screen-app").classList.add("active");
  renderUserChrome();
  const shipper = me.user.role === "shipper";
  $("#map-panel-shipper").classList.toggle("hidden", !shipper);
  $("#map-panel-carrier").classList.toggle("hidden", shipper);
  fillTypeFilter();
  initMap();
  if (shipper) refreshTrucks(); else renderTruckPanel();
  pollNotifications();
  setInterval(pollNotifications, 30000);
  handlePaymentReturn();
}

/* ---------- notifications ---------- */
async function pollNotifications() {
  try {
    const { notifications, unread } = await api("/notifications");
    state.notifications = notifications;
    const c = $("#bell-count");
    c.textContent = unread;
    c.classList.toggle("hidden", !unread);
    if (unread && unread > (state._lastUnread || 0) && "Notification" in window && Notification.permission === "granted") {
      new Notification(T("app_name"), { body: notifications[0].text, icon: "/icon.png" });
    }
    state._lastUnread = unread;
    const me = await api("/me");
    const cc = $("#chat-count");
    cc.textContent = me.unread_chat;
    cc.classList.toggle("hidden", !me.unread_chat);
  } catch {}
}
$("#btn-bell").onclick = async () => {
  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
  const list = state.notifications || [];
  openModal(
    T("notifications"),
    list.length
      ? list
          .map((n) => `<div class="item ${n.seen ? "" : "unseen"}" ${
            n.kind === "message" && n.extra?.user_id ? `data-chatn="${n.extra.user_id}"` : n.shipment_id ? `data-open="${n.shipment_id}"` : ""
          }>
              <b>${n.text}${n.extra?.from ? " — " + esc(n.extra.from) : ""}</b><div class="meta">${n.created_at}${n.extra?.price ? " • " + money(n.extra.price) : ""}</div></div>`)
          .join("")
      : `<p class="hint">${T("no_notifications")}</p>`
  );
  $$("#modal-body [data-open]").forEach((el) => (el.onclick = () => openShipment(+el.dataset.open)));
  $$("#modal-body [data-chatn]").forEach((el) => (el.onclick = () => openChat(+el.dataset.chatn)));
  await api("/notifications/seen", { method: "POST" }).catch(() => {});
  pollNotifications();
};

/* ---------- map ---------- */
function initMap() {
  if (state.map) return;
  state.map = L.map("map", { zoomControl: false }).setView([36.75, 3.06], 11);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(state.map);
  L.control.zoom({ position: "topleft" }).addTo(state.map);
  getPosition()
    .then((p) => { state.me = p; state.map.setView([p.lat, p.lng], 12); if (state.user.role === "shipper") refreshTrucks(); })
    .catch(() => {});
}
const truckIcon = L.divIcon({ className: "", html: '<div class="truck-pin">🚛</div>', iconSize: [30, 30], iconAnchor: [15, 15] });

async function refreshTrucks() {
  if (!state.map) return;
  const c = state.me || { lat: state.map.getCenter().lat, lng: state.map.getCenter().lng };
  const q = new URLSearchParams({ lat: c.lat, lng: c.lng, radius: 300 });
  if ($("#filter-type").value) q.set("truck_type", $("#filter-type").value);
  if ($("#filter-tons").value) q.set("min_tons", $("#filter-tons").value);
  if ($("#filter-sort").value) q.set("sort", $("#filter-sort").value);
  if ($("#filter-tripkm").value) q.set("trip_km", $("#filter-tripkm").value);
  if ($("#filter-fav").checked) q.set("only_favorites", "1");
  if ($("#filter-q") && $("#filter-q").value.trim()) q.set("q", $("#filter-q").value.trim());
  if ($("#filter-maxkm") && $("#filter-maxkm").value) q.set("max_per_km", $("#filter-maxkm").value);
  if ($("#filter-rating") && $("#filter-rating").value) q.set("min_rating", $("#filter-rating").value);
  if ($("#filter-verified") && $("#filter-verified").checked) q.set("verified", "1");
  const { trucks } = await api("/trucks/nearby?" + q);
  state.markers.forEach((m) => state.map.removeLayer(m));
  state.markers = trucks.map((t) =>
    L.marker([t.lat, t.lng], { icon: truckIcon })
      .addTo(state.map)
      .bindPopup(
        `<b>${t.name}</b><br>${truckLabel(t.truck_type)} — ${t.capacity_tons} ${T("ton")}<br>${
          t.rating ? "★ " + t.rating : T("no_ratings")
        }${t.distance_km != null ? `<br>${t.distance_km} ${T("km")}` : ""}`
      )
  );
  // Keep every nearby truck visible above the sheet instead of showing an empty map
  if (state.markers.length) {
    const pts = trucks.map((t) => [t.lat, t.lng]);
    if (state.me) pts.push([state.me.lat, state.me.lng]);
    try {
      const sheetH = Math.round(window.innerHeight * 0.45);
      state.map.fitBounds(L.latLngBounds(pts).pad(0.15), {
        paddingTopLeft: [24, 70],
        paddingBottomRight: [24, sheetH],
        maxZoom: 13,
        animate: false,
      });
    } catch {}
  } else if (state.me) {
    state.map.setView([state.me.lat, state.me.lng], 12);
  }
  $("#trucks-list").innerHTML = trucks.length
    ? trucks
        .slice(0, 20)
        .map(
          (t) => `<div class="item row-card ${t.cheapest ? "cheap" : ""}">
        ${t.photo_url ? `<img class="truck-thumb" src="${esc(mediaUrl(t.photo_url))}" alt="">` : avatar(null, t.name)}
        <div class="grow">
          <div class="row"><b>${t.online ? '<span class="online-dot"></span>' : ""}${esc(t.name)}${t.verified ? ' <span class="verified" title="'+T("verified")+'">✔</span>' : ""}</b>${
            t.cheapest ? `<span class="badge cheap">${T("cheapest")} 🏆</span>` : t.distance_km != null ? `<span class="badge">${t.distance_km} ${T("km")}</span>` : ""
          }</div>
          <div class="meta">${truckLabel(t.truck_type)} • ${t.capacity_tons} ${T("ton")}${t.plate ? " • " + esc(t.plate) : ""}</div>
          <div class="meta">${tariffText(t.tariff)}</div>
          ${t.trip_estimate != null ? `<div class="row"><span class="meta">${T("est_for_trip")}</span><span class="price-tag">${money(t.trip_estimate)}</span></div>` : ""}
          <div class="meta">${stars(t.rating, t.ratings_count)}</div>
          <div class="card-actions">
            <button class="btn primary small" data-book="${t.user_id}" data-bookname="${esc(t.name)}">⚡ ${T("book_now")}</button>
            <button class="btn ghost small" data-profile="${t.user_id}">${T("view_profile")}</button>
            <button class="btn ghost small" data-chat="${t.user_id}">💬 ${T("chat")}</button>
            <button class="btn ghost small fav ${t.favorite ? "on" : ""}" data-fav="${t.user_id}" title="${T("favorite")}">${t.favorite ? "★" : "☆"}</button>
          </div>
        </div>
      </div>`
        )
        .join("")
    : empty("🚚", T("no_trucks"), T("no_trucks_hint"));
  $$("#trucks-list [data-fav]").forEach((el) => (el.onclick = async (ev) => {
    ev.stopPropagation();
    try {
      const { favorite } = await api("/favorites/" + el.dataset.fav, { method: "POST" });
      el.classList.toggle("on", favorite);
      el.textContent = favorite ? "★" : "☆";
      toast(favorite ? T("fav_added") : T("fav_removed"));
    } catch (e) { toast(e.message); }
  }));
  $$("#trucks-list [data-profile]").forEach((el) => (el.onclick = () => openProfile(+el.dataset.profile)));
  $$("#trucks-list [data-chat]").forEach((el) => (el.onclick = () => openChat(+el.dataset.chat)));
}
$("#filter-type").onchange = refreshTrucks;
$("#filter-sort").onchange = refreshTrucks;
$("#filter-tripkm").oninput = () => { clearTimeout(refreshTrucks._t); refreshTrucks._t = setTimeout(refreshTrucks, 500); };
$("#filter-tons").onchange = refreshTrucks;
$("#filter-fav").onchange = refreshTrucks;
$("#btn-locate").onclick = async () => {
  try {
    state.me = await getPosition();
  } catch (e) {
    toast(e.message);
    const p = await pickOnMap();
    if (!p) return;
    state.me = p;
  }
  state.map.setView([state.me.lat, state.me.lng], 13);
  refreshTrucks();
};

/* ---------- carrier panel ---------- */
function renderTruckPanel() {
  const t = state.truck;
  $("#toggle-available").checked = !!(t && t.available);
  $("#truck-summary").innerHTML = t
    ? `${t.photo_url ? `<img class="truck-photo" src="${esc(mediaUrl(t.photo_url))}" alt="">` : ""}
       <b>${truckLabel(t.truck_type)}</b> — ${t.capacity_tons} ${T("ton")}<br>
       <span class="meta">${esc(t.plate || "—")} • ${t.lat ? "📍 " + T("loc_updated") : T("share_loc")}</span><br>
       <span class="meta">${T("tariff")}: ${tariffText(t.tariff)}</span>`
    : `<span class="meta">${T("edit_truck")}</span>`;
  if (t && t.lat && state.map) {
    state.map.setView([t.lat, t.lng], 12);
    L.marker([t.lat, t.lng], { icon: truckIcon }).addTo(state.map);
  }
}
$("#btn-truck-edit").onclick = () => {
  const t = state.truck || {};
  openModal(
    T("truck_data"),
    `<form id="form-truck" class="form-grid">
      <div id="truck-photo-pick" class="photo-pick">
        ${t.photo_url ? `<img class="truck-thumb" src="${esc(mediaUrl(t.photo_url))}" alt="">` : `<div class="truck-thumb avatar ph">🚚</div>`}
        <button type="button" class="btn ghost small">${t.photo_url ? T("change_photo") : T("upload_photo")}</button>
        <input type="file" accept="image/*">
      </div>
      <label>${T("truck_type")}<select name="truck_type">${state.types
        .map((x) => `<option value="${x.key}" ${t.truck_type === x.key ? "selected" : ""}>${truckLabel(x.key)}</option>`)
        .join("")}</select></label>
      <label>${T("capacity")}<input name="capacity_tons" type="number" step="0.5" min="0.5" value="${t.capacity_tons || ""}" required></label>
      <label>${T("plate")}<input name="plate" value="${esc(t.plate || "")}"></label>
      <label>${T("truck_desc")}<textarea name="description" rows="2" placeholder="${T("truck_desc_ph")}">${esc(t.description || "")}</textarea></label>
      <h4>${T("pricing")} <small class="meta">— ${T("pricing_ex")}</small></h4>
      <div class="pricing-row">
        <label>${T("base_km")}<input name="base_km" type="number" min="1" step="1" value="${t.base_km || 10}"></label>
        <label>${T("base_price")}<input name="base_price" type="number" min="0" step="50" value="${t.base_price || ""}" placeholder="2000"></label>
      </div>
      <label>${T("min_price")}<input name="min_price" type="number" min="0" step="50" value="${t.min_price || ""}"></label>
      <p id="price-preview" class="meta"></p>
      <p class="tip">${T("pricing_tip")}</p>
      <button class="btn primary" type="submit">${T("save")}</button>
    </form>`
  );
  let truckPhoto = null;
  wirePhotoPicker("#truck-photo-pick", (d) => (truckPhoto = d));
  const preview = () => {
    const km = Number($("#form-truck [name=base_km]").value);
    const pr = Number($("#form-truck [name=base_price]").value);
    $("#price-preview").innerHTML = km > 0 && pr > 0 ? `≈ <b>${Math.round((pr / km) * 10) / 10} ${T("per_km")}</b>` : "";
  };
  $("#form-truck [name=base_km]").oninput = preview;
  $("#form-truck [name=base_price]").oninput = preview;
  preview();
  $("#form-truck").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      const pos = await getPosition().catch(() => null);
      const { truck } = await api("/truck", { method: "PUT", body: { ...f, ...(pos || {}), photo: truckPhoto } });
      state.truck = truck;
      closeModal();
      renderTruckPanel();
      toast(T("saved"));
    } catch (err) { toast(err.message); }
  };
};
$("#btn-share-loc").onclick = async () => {
  let p;
  try { p = await getPosition(); }
  catch (e) { toast(e.message); p = await pickOnMap(state.truck && state.truck.lat ? { lat: state.truck.lat, lng: state.truck.lng } : null); }
  if (!p) return;
  try {
    await api("/truck/location", { method: "POST", body: p });
    state.truck = (await api("/me")).truck;
    renderTruckPanel();
    toast(T("loc_updated"));
  } catch (e) { toast(e.message); }
};
$("#toggle-available").onchange = async (e) => {
  try {
    state.truck = (await api("/truck/availability", { method: "POST", body: { available: e.target.checked } })).truck;
    toast(e.target.checked ? T("you_available") : T("you_unavailable"));
  } catch (err) { toast(err.message); }
};

/* ---------- new shipment ---------- */
$("#btn-new-shipment").onclick = () => {
  openModal(
    T("shipment_request"),
    `<form id="form-shipment" class="form-grid">
      <label>${T("pickup")}<div class="with-btn"><input name="pickup_label" placeholder="${T("pickup_ph")}" required><button type="button" class="btn ghost small" data-pick="pickup">${T("pick_on_map")}</button></div></label>
      <label>${T("dropoff")}<div class="with-btn"><input name="dropoff_label" placeholder="${T("dropoff_ph")}" required><button type="button" class="btn ghost small" data-pick="dropoff">${T("pick_on_map")}</button></div></label>
      <label>${T("cargo")}<input name="cargo" placeholder="${T("cargo_ph")}" required></label>
      <label>${T("weight")}<input name="weight_tons" type="number" step="0.5" min="0.1" required></label>
      <label>${T("truck_needed")}<select name="truck_type">${state.types.map((x) => `<option value="${x.key}">${truckLabel(x.key)}</option>`).join("")}</select></label>
      <label>${T("budget")}<input name="budget" type="number" min="0"></label>
      <label>${T("notes")}<textarea name="notes" rows="2" placeholder="${T("notes_ph")}"></textarea></label>
      <p class="hint" id="price-hint"></p>
      <button class="btn primary" type="submit">${T("publish")}</button>
    </form>`
  );
  const form = $("#form-shipment");
  const picked = {};
  $$("#modal-body [data-pick]").forEach((b) => (b.onclick = async () => {
    const p = await pickOnMap();
    if (!p) return;
    picked[b.dataset.pick] = p;
    const input = form[b.dataset.pick + "_label"];
    if (!input.value) input.value = `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`;
    b.textContent = "✅";
    updateHint();
  }));

  async function updateHint() {
    if (!picked.pickup || !picked.dropoff) return;
    const R = 6371, toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(picked.dropoff.lat - picked.pickup.lat), dLng = toRad(picked.dropoff.lng - picked.pickup.lng);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(picked.pickup.lat)) * Math.cos(toRad(picked.dropoff.lat)) * Math.sin(dLng / 2) ** 2;
    const km = Math.round(2 * R * Math.asin(Math.sqrt(a)));
    const w = form.weight_tons.value || 0;
    const h = await api(`/price-hint?distance_km=${km}&weight_tons=${w}&truck_type=${form.truck_type.value}`);
    $("#price-hint").textContent = `${T("price_hint")}: ${money(h.min)} – ${money(h.max)} (${km} ${T("km")})`;
  }
  form.weight_tons.onchange = updateHint;
  form.truck_type.onchange = updateHint;

  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = T("publishing");
    const f = Object.fromEntries(new FormData(e.target));
    try {
      const from = picked.pickup || (await geocode(f.pickup_label)) || state.me;
      const to = picked.dropoff || (await geocode(f.dropoff_label));
      if (!from) throw new Error(T("geocode_pickup_failed"));
      if (!to) throw new Error(T("geocode_dropoff_failed"));
      await api("/shipments", {
        method: "POST",
        body: { ...f, pickup_lat: from.lat, pickup_lng: from.lng, dropoff_lat: to.lat, dropoff_lng: to.lng },
      });
      closeModal();
      toast(T("published"));
      $$(".nav").find((b) => b.dataset.view === "shipments").click();
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
      btn.textContent = T("publish");
    }
  };
};

/* ---------- shipments ---------- */
async function loadShipments() {
  const shipper = state.user.role === "shipper";
  $("#shipments-title").textContent = shipper ? T("my_shipments") : T("nearby_requests");
  const data = shipper ? await api("/shipments/mine") : await api("/shipments/open");
  const mine = shipper ? null : (await api("/shipments/mine")).shipments.filter((s) => s.carrier_id === state.user.id && s.status !== "delivered");
  const list = [...(mine || []), ...data.shipments.filter((s) => !(mine || []).some((m) => m.id === s.id))];
  $("#shipments-list").innerHTML = list.length
    ? list.map((s) => card(s, shipper)).join("")
    : empty("📦", T("nothing_yet"), shipper ? T("nothing_yet_shipper") : T("nothing_yet_carrier"));
  $$("#shipments-list .item").forEach((el) => (el.onclick = () => openShipment(+el.dataset.id)));
}
function card(s, shipper) {
  return `<div class="item" data-id="${s.id}">
    <div class="row"><b>${s.cargo}</b><span class="badge ${s.status}">${statusLabel(s.status)}</span></div>
    <div class="meta">${T("from")} ${short(s.pickup_label)} ← ${T("to")} ${short(s.dropoff_label)} • ${s.distance_km} ${T("km")}</div>
    <div class="meta">${truckLabel(s.truck_type)} • ${s.weight_tons} ${T("ton")} • ${
      s.agreed_price ? T("agreed") + ": " + money(s.agreed_price) : s.budget ? T("budget_short") + ": " + money(s.budget) : T("negotiable")
    }${s.payment_status === "paid" ? " • " + T("paid") : ""}</div>
    <div class="meta">${shipper ? `${s.offers_count} ${T("offers_count")}` : s.pickup_distance_km != null ? T("pickup_away", s.pickup_distance_km) : ""}</div>
  </div>`;
}

async function openShipment(id) {
  const { shipment: s, offers } = await api("/shipments/" + id);
  const shipper = state.user.role === "shipper";
  let html = `
    <div class="item">
      <div class="row"><b>${s.cargo}</b><span class="badge ${s.status}">${statusLabel(s.status)}</span></div>
      <div class="meta">${T("from")}: ${s.pickup_label}</div>
      <div class="meta">${T("to")}: ${s.dropoff_label}</div>
      <div class="meta">${truckLabel(s.truck_type)} • ${s.weight_tons} ${T("ton")} • ${T("distance")} ${s.distance_km} ${T("km")}</div>
      ${s.notes ? `<div class="meta">${T("notes")}: ${s.notes}</div>` : ""}
      ${s.price_hint && !s.agreed_price ? `<div class="meta">${T("price_hint")}: ${money(s.price_hint.min)} – ${money(s.price_hint.max)}</div>` : ""}
      ${s.carrier_id ? `<div class="meta">${T("carrier")}: ${s.carrier_name}${s.carrier_phone ? " — " + s.carrier_phone : ""} • ${money(s.agreed_price)}</div>` : ""}
      ${!shipper ? `<div class="meta">${T("shipper")}: ${s.shipper_phone ? s.shipper_name + " — " + s.shipper_phone : T("phone_after_accept")}</div>` : ""}
      ${
        (shipper ? s.carrier_id : s.shipper_id)
          ? `<div class="card-actions">
               <button class="btn ghost small" data-profile="${shipper ? s.carrier_id : s.shipper_id}">${T("view_profile")}</button>
               <button class="btn primary small" data-chatship="${shipper ? s.carrier_id : s.shipper_id}">💬 ${T("chat")}</button>
             </div>`
          : ""
      }
      ${s.agreed_price ? `<div class="meta">${T("payment")}: ${s.payment_status === "paid" ? T("paid") : s.payment_status === "pending" ? T("pending_payment") : T("unpaid")}</div>` : ""}
    </div>`;

  if (shipper && s.status === "open") {
    html +=
      `<h4>${T("offers")} (${offers.length})</h4>` +
      (offers.length
        ? offers
            .map(
              (o) => `<div class="item"><div class="row"><b>${esc(o.name)}</b><b class="price-tag">${money(o.price)}</b></div>
          <div class="meta">${stars(o.rating, o.ratings_count)}</div>
          <div class="meta">${esc(o.message || "")}</div>
          <div class="card-actions">
            <button class="btn ghost small" data-profile="${o.carrier_id}">${T("view_profile")}</button>
            <button class="btn ghost small" data-chatship="${o.carrier_id}">💬 ${T("chat")}</button>
          </div>
          <button class="btn primary block" data-accept="${o.id}">${T("accept_offer")}</button></div>`
            )
            .join("")
        : `<p class="hint">${T("no_offers")}</p>`);
    html += `<button class="btn ghost block" data-cancel="${s.id}">${T("cancel_request")}</button>`;
  }
  if (!shipper && s.status === "open") {
    const mine = offers[0];
    html += `<form id="form-offer" class="form-grid">
      <label>${T("your_price")}<input name="price" type="number" min="1" value="${mine ? mine.price : s.budget || (s.price_hint ? s.price_hint.suggested : "")}" required></label>
      <label>${T("message_to_shipper")}<input name="message" value="${mine?.message || ""}" placeholder="${T("message_ph")}"></label>
      <button class="btn primary" type="submit">${mine ? T("update_offer") : T("send_offer")}</button></form>`;
  }
  if (!shipper && s.carrier_id === state.user.id && (s.status === "accepted" || s.status === "picked_up")) {
    html += `<button class="btn primary block" data-status="${s.status === "accepted" ? "picked_up" : "delivered"}" data-sid="${s.id}">
      ${s.status === "accepted" ? T("mark_picked") : T("mark_delivered")}</button>`;
  }
  // payment (shipper, price agreed, not paid yet)
  if (shipper && s.agreed_price && s.payment_status !== "paid" && state.meta.payments_enabled && ["accepted", "picked_up", "delivered"].includes(s.status)) {
    html += `<button class="btn primary block" data-pay="${s.id}">${T("pay_online")} — ${money(s.agreed_price)}</button>`;
  }
  // live tracking during an active trip
  if ((shipper || s.carrier_id === state.user.id) && ["accepted", "picked_up"].includes(s.status)) {
    html += `<h4>${T("track_carrier")}</h4><div id="track-map" class="map-pick"></div><p class="hint" id="track-hint"></p>`;
  }
  if (s.pod_photo_url) {
    html += `<h4>${T("pod_title")}</h4><img class="truck-photo" src="${esc(mediaUrl(s.pod_photo_url))}" alt="">`;
  }
  if (s.status === "delivered" && (shipper || s.carrier_id === state.user.id)) {
    html += `<h4>${T("rate_other")}</h4><div class="row" id="rate-row">${[1, 2, 3, 4, 5]
      .map((n) => `<button class="btn ghost" data-rate="${n}" data-sid="${s.id}">${"★".repeat(n)}</button>`)
      .join("")}</div>`;
  }
  if (!shipper && s.carrier_id === state.user.id && s.status === "requested") {
    html += `<div class="req-actions"><button class="btn primary block" data-respond="1" data-sid="${s.id}">✅ ${T("accept_request")}</button>
      <button class="btn ghost block" data-respond="0" data-sid="${s.id}">${T("decline_request")}</button></div>`;
  }
  if (shipper && s.status === "requested") {
    html += `<p class="hint">${T("waiting_carrier")}</p><button class="btn ghost block" data-cancel="${s.id}">${T("cancel_request")}</button>`;
  }
  if (s.agreed_price && ["accepted", "picked_up", "delivered"].includes(s.status)) {
    html += `<button class="btn ghost block" data-invoice="${s.id}">🧾 ${T("invoice")}</button>`;
  }
  openModal(`${T("shipment_details")} #${s.id}`, html);
  wireShipmentActions(s.id);

  const body = $("#modal-body");
  body.querySelectorAll("[data-accept]").forEach((b) => (b.onclick = async () => {
    try { await api(`/offers/${b.dataset.accept}/accept`, { method: "POST" }); toast(T("offer_accepted")); closeModal(); loadShipments(); }
    catch (e) { toast(e.message); }
  }));
  const cancelBtn = body.querySelector("[data-cancel]");
  if (cancelBtn) cancelBtn.onclick = async () => {
    if (!confirm(T("confirm_cancel"))) return;
    await api(`/shipments/${cancelBtn.dataset.cancel}/status`, { method: "POST", body: { status: "cancelled" } });
    closeModal();
    loadShipments();
  };
  const invBtn = body.querySelector("[data-invoice]");
  if (invBtn) invBtn.onclick = () => {
    const w = window.open("", "_blank");
    api(`/shipments/${invBtn.dataset.invoice}/invoice`, { raw: true })
      .then((html) => { if (w) { w.document.write(html); w.document.close(); } })
      .catch((e) => toast(e.message));
  };
  body.querySelectorAll("[data-respond]").forEach((b) => (b.onclick = async () => {
    try {
      await api(`/shipments/${b.dataset.sid}/respond`, { method: "POST", body: { accept: b.dataset.respond === "1" } });
      toast(b.dataset.respond === "1" ? T("request_accepted") : T("request_declined"));
      closeModal();
      loadShipments();
      if (window.CHV2) CHV2.loadRequests();
    } catch (e) { toast(e.message); }
  }));
  const statusBtn = body.querySelector("[data-status]");
  if (statusBtn) statusBtn.onclick = async () => {
    let pod = null;
    if (statusBtn.dataset.status === "delivered") pod = await askPod();
    await api(`/shipments/${statusBtn.dataset.sid}/status`, { method: "POST", body: { status: statusBtn.dataset.status, pod_photo: pod } });
    toast(T("status_updated"));
    closeModal();
    loadShipments();
  };
  const payBtn = body.querySelector("[data-pay]");
  if (payBtn) payBtn.onclick = async () => {
    payBtn.disabled = true;
    try {
      const { checkout_url } = await api(`/shipments/${payBtn.dataset.pay}/pay`, { method: "POST" });
      location.href = checkout_url;
    } catch (e) { toast(e.message); payBtn.disabled = false; }
  };
  body.querySelectorAll("[data-rate]").forEach((b) => (b.onclick = async () => {
    try { await api(`/shipments/${b.dataset.sid}/rate`, { method: "POST", body: { stars: +b.dataset.rate } }); toast(T("thanks_rating")); closeModal(); }
    catch (e) { toast(e.message); }
  }));
  const offerForm = body.querySelector("#form-offer");
  if (offerForm) offerForm.onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try { await api(`/shipments/${s.id}/offers`, { method: "POST", body: f }); toast(T("offer_sent")); closeModal(); loadShipments(); }
    catch (err) { toast(err.message); }
  };
  if (body.querySelector("#track-map")) startTracking(s);
}

/* ---------- live tracking ---------- */
function wireShipmentActions(shipmentId) {
  $$("#modal-body [data-profile]").forEach((el) => (el.onclick = () => openProfile(+el.dataset.profile)));
  $$("#modal-body [data-chatship]").forEach((el) => (el.onclick = () => openChat(+el.dataset.chatship, shipmentId)));
}

function startTracking(s) {
  const map = L.map("track-map").setView([s.pickup_lat, s.pickup_lng], 10);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
  L.marker([s.pickup_lat, s.pickup_lng]).addTo(map).bindPopup(T("from"));
  L.marker([s.dropoff_lat, s.dropoff_lng]).addTo(map).bindPopup(T("to"));
  setTimeout(() => map.invalidateSize(), 150);
  let truckMarker = null, line = null;
  const refresh = async () => {
    try {
      const { points, last } = await api(`/shipments/${s.id}/track`);
      if (!last) { $("#track-hint").textContent = T("tracking_none"); return; }
      $("#track-hint").textContent = last.created_at;
      const latlngs = points.map((p) => [p.lat, p.lng]);
      if (line) map.removeLayer(line);
      line = L.polyline(latlngs, { color: "#f4b400" }).addTo(map);
      if (truckMarker) truckMarker.setLatLng([last.lat, last.lng]);
      else truckMarker = L.marker([last.lat, last.lng], { icon: truckIcon }).addTo(map);
      map.fitBounds(L.latLngBounds([...latlngs, [s.pickup_lat, s.pickup_lng], [s.dropoff_lat, s.dropoff_lng]]).pad(0.2));
    } catch {}
  };
  refresh();
  state.trackTimer = setInterval(refresh, 15000);
}

/* ---------- payment return ---------- */
function handlePaymentReturn() {
  const q = new URLSearchParams(location.search);
  const pay = q.get("pay");
  if (!pay) return;
  toast(pay === "success" ? T("pay_success") : T("pay_failed_msg"));
  const sid = q.get("shipment");
  history.replaceState({}, "", "/");
  if (sid) setTimeout(() => openShipment(+sid), 600);
}


/** Ask the carrier for an optional proof-of-delivery photo. Resolves to data-URL or null. */
function askPod() {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "picker-overlay";
    wrap.innerHTML = `<div class="picker-card">
      <b>${T("pod_title")}</b>
      <p class="hint">${T("pod_hint")}</p>
      <div id="pod-pick" class="photo-pick">
        <div class="avatar lg ph">📷</div>
        <button type="button" class="btn ghost small">${T("upload_photo")}</button>
        <input type="file" accept="image/*" capture="environment">
      </div>
      <div class="card-actions" style="margin-top:12px">
        <button class="btn ghost" id="pod-skip">${T("skip")}</button>
        <button class="btn primary" id="pod-done">${T("confirm_delivery")}</button>
      </div>
    </div>`;
    document.body.appendChild(wrap);
    let photo = null;
    wirePhotoPicker("#pod-pick", (d) => (photo = d));
    const end = (v) => { wrap.remove(); resolve(v); };
    $("#pod-skip", wrap).onclick = () => end(null);
    $("#pod-done", wrap).onclick = () => end(photo);
  });
}

/* ---------- dashboard ---------- */
const MONTH_LABEL = (key) => {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  try { return d.toLocaleDateString(state.lang === "ar" ? "ar-DZ" : state.lang, { month: "short" }); }
  catch (e) { return key.slice(5); }
};

function chart(months, mode) {
  const vals = months.map((m) => (mode === "trips" ? m.trips : m.amount));
  const max = Math.max(...vals, 1);
  return `<div class="chart">${months
    .map((m, i) => {
      const v = vals[i];
      const h = Math.max(4, Math.round((v / max) * 100));
      return `<div class="bar">
        <span class="val">${v ? (mode === "trips" ? v : shortMoney(v)) : ""}</span>
        <span class="fill ${v ? "" : "zero"}" style="height:${v ? h : 4}%"></span>
        <span class="cap">${MONTH_LABEL(m.month)}</span>
      </div>`;
    })
    .join("")}</div>`;
}
const shortMoney = (v) => (v >= 1000 ? Math.round(v / 100) / 10 + "k" : String(v));

function statCard(icon, value, label) {
  return `<div class="stat"><span class="ic">${icon}</span><span class="v">${value}</span><span class="k">${label}</span></div>`;
}

async function loadDash() {
  const box = $("#dash-body");
  box.innerHTML = `<div class="list">${'<div class="skel"></div>'.repeat(3)}</div>`;
  let d;
  try { d = await api("/dashboard"); } catch (e) { box.innerHTML = `<p class="hint">${esc(e.message)}</p>`; return; }
  state.dash = d;
  const carrier = d.role === "carrier";
  const t = d.totals;

  let html = `
    <div class="dash-hero">
      <div class="lbl">${carrier ? T("earned_this_month") : T("spent_this_month")}</div>
      <div class="big">${money(d.month.amount)}</div>
      <div class="meta">${T("this_month_trips", d.month.delivered)} • ${T("all_time")}: <b>${money(t.amount)}</b></div>
    </div>

    <div class="stat-grid">
      ${statCard("✅", t.delivered, T("completed_trips"))}
      ${statCard("🚚", t.active, T("in_progress"))}
      ${statCard("⭐", d.rating.rating ? d.rating.rating + " (" + d.rating.ratings_count + ")" : "—", T("rating"))}
      ${statCard("🛣️", t.km + " " + T("km"), T("total_distance"))}
    </div>

    <h4>${T("last_6_months")}</h4>
    <div class="item">${chart(d.months, "amount")}</div>`;

  if (carrier) {
    html += `
      <div class="stat-grid" style="margin-top:12px">
        ${statCard("📨", d.offers.sent, T("offers_sent"))}
        ${statCard("🏆", d.offers.won, T("offers_won"))}
        ${statCard("🎯", d.offers.win_rate == null ? "—" : d.offers.win_rate + "%", T("win_rate"))}
        ${statCard("💬", d.unread_chat, T("unread_messages"))}
      </div>`;
    if (d.market) {
      const m = d.market;
      const good = m.my_per_km != null && m.my_per_km <= m.avg_per_km;
      html += `
        <h4>${T("market_position")}</h4>
        <div class="item">
          <div class="row"><b>${T("my_price_per_km")}</b><span class="price-tag">${m.my_per_km != null ? m.my_per_km + " " + T("per_km") : "—"}</span></div>
          <div class="meta">${T("market_avg")}: <b>${m.avg_per_km} ${T("per_km")}</b> • ${T("cheapest_in_market")}: <b>${m.cheapest_per_km}</b></div>
          <div class="meta">${T("carriers_count", m.carriers)}</div>
          ${m.my_rank ? `<div style="margin-top:8px"><span class="rank-pill ${good ? "good" : "warn"}">${good ? "🏆" : "⚠️"} ${T("your_rank", m.my_rank)}</span></div>` : ""}
          ${!good && m.my_per_km != null ? `<p class="tip" style="margin-top:9px">${T("tip_price_above_avg", m.avg_per_km)}</p>` : ""}
        </div>`;
    }
  } else {
    html += `
      <div class="stat-grid" style="margin-top:12px">
        ${statCard("📋", t.total, T("total_orders"))}
        ${statCard("💳", d.paid_count, T("paid_online"))}
        ${statCard("★", d.favorites, T("favorites"))}
        ${statCard("📏", d.avg_per_km ? d.avg_per_km + " " + T("per_km") : "—", T("avg_paid_per_km"))}
      </div>`;
  }

  html += `
    <h4>${T("grow_checklist")}</h4>
    <div class="item">
      <div class="row"><b>${T("profile_strength")}</b><b class="price-tag">${d.completeness}%</b></div>
      <div class="progress"><i style="width:${d.completeness}%"></i></div>
      <div class="check-list">
        ${d.checklist.map((c) => `<div class="check ${c.done ? "done" : ""}"><b>${c.done ? "✓" : ""}</b><span>${T(c.key)}</span></div>`).join("")}
      </div>
    </div>
    <div class="card-actions" style="margin-top:12px">
      <button class="btn ghost small" id="dash-go-profile">👤 ${T("account")}</button>
      <button class="btn ghost small" id="dash-share">🔗 ${T("share_app")}</button>
    </div>`;

  box.innerHTML = html;
  $("#dash-go-profile").onclick = () => $$(".nav").find((b) => b.dataset.view === "profile").click();
  $("#dash-share").onclick = shareApp;
}
$("#btn-dash-refresh").onclick = loadDash;

async function shareApp() {
  const url = location.origin;
  const text = `${T("app_name")} — ${T("tagline")}`;
  try {
    if (navigator.share) await navigator.share({ title: T("app_name"), text, url });
    else { await navigator.clipboard.writeText(url); toast(T("link_copied")); }
  } catch (e) { /* user cancelled */ }
}

/* ---------- profile (every registered user) ---------- */
async function loadProfile() {
  const me = await api("/me");
  state.user = me.user;
  state.truck = me.truck;
  const pub = await api("/users/" + me.user.id);
  $("#profile-body").innerHTML = `
    <div class="item profile-head">
      ${avatar(me.user.photo_url, me.user.name, "lg")}
      <h3>${esc(me.user.name)}</h3>
      <span class="badge">${me.user.role === "shipper" ? T("role_shipper_s") : T("role_carrier_s")}</span>
      <div class="meta">${esc(me.user.phone)}${me.user.city ? " • " + esc(me.user.city) : ""}</div>
      <div class="meta">${stars(pub.user.rating, pub.user.ratings_count)} • ${pub.user.trips} ${T("trips_done")}</div>
      ${me.user.bio ? `<div class="meta">${esc(me.user.bio)}</div>` : ""}
      ${me.user.verified ? `<span class="badge verified-badge">✔ ${T("verified")}</span>` : ""}
      <div class="card-actions center">
        <button id="btn-edit-profile" class="btn ghost small">${T("edit_profile")}</button>
        <button id="btn-places" class="btn ghost small">📍 ${T("my_places")}</button>
        ${me.user.verified ? "" : `<button id="btn-verify" class="btn ghost small">✔ ${T("verify_account")}</button>`}
      </div>
    </div>
    ${
      me.truck
        ? `<div class="item">
             ${me.truck.photo_url ? `<img class="truck-photo" src="${esc(mediaUrl(me.truck.photo_url))}" alt="">` : ""}
             <b>${T("my_truck_state")}</b>
             <div class="meta">${truckLabel(me.truck.truck_type)} • ${me.truck.capacity_tons} ${T("ton")} • ${me.truck.available ? T("available") : "—"}</div>
             <div class="meta">${T("tariff")}: ${tariffText(me.truck.tariff)}</div>
           </div>`
        : ""
    }
    <h4>${T("reviews")}</h4>
    ${
      pub.reviews.length
        ? pub.reviews
            .map((r) => `<div class="item"><div class="row"><b>${esc(r.rater)}</b><span class="stars">${"★".repeat(r.stars)}</span></div><div class="meta">${esc(r.comment || "")}</div></div>`)
            .join("")
        : `<p class="hint">${T("no_ratings")}</p>`
    }`;
  $("#btn-edit-profile").onclick = () => openProfileEditor(me.user);
  if ($("#btn-places")) $("#btn-places").onclick = () => window.CHV2 && CHV2.openPlaces();
  if ($("#btn-verify")) $("#btn-verify").onclick = () => window.CHV2 && CHV2.openVerify();
}

function openProfileEditor(u) {
  openModal(
    T("edit_profile"),
    `<form id="form-profile" class="form-grid">
      <div id="me-photo-pick" class="photo-pick">
        ${u.photo_url ? `<img class="avatar lg" src="${esc(mediaUrl(u.photo_url))}" alt="">` : `<div class="avatar lg ph">${esc((u.name || "?").charAt(0))}</div>`}
        <button type="button" class="btn ghost small">${u.photo_url ? T("change_photo") : T("upload_photo")}</button>
        <input type="file" accept="image/*">
      </div>
      <label>${T("full_name")}<input name="name" value="${esc(u.name || "")}" required></label>
      <label>${T("city")}<input name="city" value="${esc(u.city || "")}" placeholder="${T("city_ph")}"></label>
      <label>${T("bio")}<textarea name="bio" rows="3" placeholder="${T("bio_ph")}">${esc(u.bio || "")}</textarea></label>
      <button class="btn primary" type="submit">${T("save")}</button>
    </form>`
  );
  let photo = null;
  wirePhotoPicker("#me-photo-pick", (d) => (photo = d));
  $("#form-profile").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      const { user } = await api("/me", { method: "PUT", body: { ...f, photo } });
      state.user = { ...state.user, ...user };
      closeModal();
      renderUserChrome();
      loadProfile();
      toast(T("saved"));
    } catch (err) { toast(err.message); }
  };
}

/** Public profile of any user — carrier or shipper. */
async function openProfile(userId) {
  if (userId === state.user.id) {
    closeModal();
    $$(".nav").find((b) => b.dataset.view === "profile").click();
    return;
  }
  try {
    const { user, reviews } = await api("/users/" + userId);
    openModal(
      T("profile"),
      `<div class="profile-head">
        ${avatar(user.photo_url, user.name, "lg")}
        <h3>${esc(user.name)}</h3>
        <span class="badge">${user.role === "shipper" ? T("role_shipper_s") : T("role_carrier_s")}</span>
        <div class="meta">${user.city ? esc(user.city) + " • " : ""}${T("member_since")} ${String(user.created_at).slice(0, 7)}</div>
        <div class="meta">${stars(user.rating, user.ratings_count)} • ${user.trips} ${T("trips_done")}</div>
        ${user.bio ? `<p class="meta">${esc(user.bio)}</p>` : ""}
      </div>
      ${
        user.truck
          ? `<div class="item">
               ${user.truck.photo_url ? `<img class="truck-photo" src="${esc(mediaUrl(user.truck.photo_url))}" alt="">` : ""}
               <div class="row"><b>${truckLabel(user.truck.truck_type)}</b><span class="badge">${user.truck.capacity_tons} ${T("ton")}</span></div>
               ${user.truck.description ? `<div class="meta">${esc(user.truck.description)}</div>` : ""}
               <div class="row"><span class="meta">${T("tariff")}</span><span class="price-tag">${tariffText(user.truck.tariff)}</span></div>
             </div>`
          : ""
      }
      <button id="btn-open-chat" class="btn primary block">💬 ${T("chat")}</button>
      <h4>${T("reviews")}</h4>
      ${
        reviews.length
          ? reviews
              .map((r) => `<div class="item"><div class="row"><b>${esc(r.rater)}</b><span class="stars">${"★".repeat(r.stars)}</span></div><div class="meta">${esc(r.comment || "")}</div></div>`)
              .join("")
          : `<p class="hint">${T("no_ratings")}</p>`
      }`
    );
    $("#btn-open-chat").onclick = () => openChat(userId);
  } catch (e) { toast(e.message); }
}

/* ---------- chat ---------- */
async function loadChats() {
  try {
    const { conversations } = await api("/conversations");
    $("#chats-list").innerHTML = conversations.length
      ? conversations
          .map(
            (c) => `<div class="item row-card" data-chat="${c.user.id}">
              ${avatar(c.user.photo_url, c.user.name)}
              <div class="grow">
                <div class="row"><b>${esc(c.user.name)}</b>${c.unread ? `<span class="badge cheap">${c.unread}</span>` : `<small class="meta">${timeShort(c.last.created_at)}</small>`}</div>
                <div class="meta">${esc(String(c.last.text).slice(0, 60))}</div>
              </div>
            </div>`
          )
          .join("")
      : empty("💬", T("no_chats"), T("no_chats_hint"));
    $$("#chats-list [data-chat]").forEach((el) => (el.onclick = () => openChat(+el.dataset.chat)));
  } catch (e) { toast(e.message); }
}

async function openChat(userId, shipmentId = null) {
  clearInterval(state.chatTimer);
  const render = (data) => {
    const box = $("#chat-msgs");
    const atBottom = !box || box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    const html = data.messages.length
      ? data.messages
          .map(
            (m) => `<div class="bubble ${m.sender_id === data.me ? "me" : "them"}">${esc(m.text)}<time>${timeShort(m.created_at)}</time></div>`
          )
          .join("")
      : `<p class="hint">${T("chat_empty")}</p>`;
    if (box) {
      box.innerHTML = html;
      if (atBottom) box.scrollTop = box.scrollHeight;
    }
    return html;
  };

  try {
    const data = await api("/messages/" + userId);
    openModal(
      T("chat_with", data.user.name),
      `<div class="chat-wrap">
        <div id="chat-msgs" class="chat-msgs"></div>
        <form id="chat-form" class="chat-input">
          <input name="text" autocomplete="off" placeholder="${T("type_message")}" required>
          <button class="btn primary" type="submit">${T("send")}</button>
        </form>
      </div>`
    );
    render(data);
    $("#chat-msgs").scrollTop = $("#chat-msgs").scrollHeight;
    $("#chat-form").onsubmit = async (e) => {
      e.preventDefault();
      const input = $("#chat-form [name=text]");
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      try {
        await api("/messages/" + userId, { method: "POST", body: { text, shipment_id: shipmentId } });
        render(await api("/messages/" + userId));
      } catch (err) { toast(err.message); }
    };
    // live refresh while the chat is open
    state.chatTimer = setInterval(async () => {
      if ($("#modal").classList.contains("hidden") || !$("#chat-msgs")) return clearInterval(state.chatTimer);
      try { render(await api("/messages/" + userId)); pollNotifications(); } catch {}
    }, 5000);
  } catch (e) { toast(e.message); }
}

/* ---------- start ---------- */
boot();
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});


/* ---------- v2 hooks ---------- */
window.CH = { get state() { return state; }, api, T, toast, money, esc, openModal, closeModal, stars, truckLabel,
  refreshTrucks, loadShipments, getPosition, geocode, pickOnMap, openChat, openProfile, avatar, readImage, wirePhotoPicker, empty, timeShort };

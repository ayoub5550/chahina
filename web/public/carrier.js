/* carrier.js — carrier work experience (v2.5)
   Adds a real "work home" for truck owners: live stats, nearby loads with
   one-tap offers at their own tariff, quick tariff editing and silent
   location refresh. Only adds new elements; never moves app.js elements. */
(function () {
  const H = window.CH;
  if (!H) return;
  const { api, T: T0, toast, money, esc } = H;
  const $ = (s, r = document) => (r || document).querySelector(s);
  const $$ = (s, r = document) => Array.from((r || document).querySelectorAll(s));

  const L = () => (document.documentElement.lang || "ar");
  function T(o) { return typeof o === "string" ? T0(o) : o[L()] || o.ar; }

  let truck = null, openLoads = [], stats = null, busy = false;

  const isCarrier = () => H.state.user && H.state.user.role === "carrier";

  function suggest(km) {
    if (!truck || !truck.base_price || !truck.base_km || km == null) return null;
    const perKm = truck.base_price / truck.base_km;
    return Math.max(Math.round((perKm * km) / 50) * 50, truck.min_price || 0);
  }

  /* ---------------- data ---------------- */
  async function refresh() {
    if (!isCarrier() || busy) return;
    busy = true;
    try {
      const [me, loads, dash] = await Promise.all([
        api("/me").catch(() => null),
        api("/shipments/open").catch(() => ({ shipments: [] })),
        api("/dashboard").catch(() => null),
      ]);
      if (me) truck = me.truck;
      if (truck && truck.lat != null && H.state.map && !window.__cwCentered) {
        try { H.state.map.setView([truck.lat, truck.lng], 11); window.__cwCentered = true; } catch (e) {}
      }
      openLoads = (loads.shipments || []).filter((s) => s.status === "open");
      stats = dash;
      render();
    } finally { busy = false; }
  }

  /* ---------------- ui ---------------- */
  function host() {
    const panel = $("#map-panel-carrier");
    if (!panel) return null;
    let h = $("#carrier-work");
    if (!h) {
      h = document.createElement("div");
      h.id = "carrier-work";
      panel.insertBefore(h, panel.firstChild);
    }
    return h;
  }

  function statChips() {
    const t = stats && stats.totals ? stats.totals : {};
    const m = stats && stats.month ? stats.month : {};
    const items = [
      { v: openLoads.length, l: T({ ar: "حمولة متاحة", fr: "offres", en: "loads" }), hot: openLoads.length > 0 },
      { v: t.active || 0, l: T({ ar: "رحلة جارية", fr: "en cours", en: "active" }) },
      { v: t.delivered || 0, l: T({ ar: "رحلة منجزة", fr: "livrées", en: "done" }) },
      { v: money(m.earned || 0), l: T({ ar: "مداخيل الشهر", fr: "ce mois", en: "this month" }), wide: true },
    ];
    return `<div class="cw-stats">${items
      .map((i) => `<div class="cw-stat${i.hot ? " hot" : ""}${i.wide ? " wide" : ""}"><b>${i.v}</b><span>${i.l}</span></div>`)
      .join("")}</div>`;
  }

  function tariffLine() {
    if (!truck) return "";
    const per = truck.base_price && truck.base_km ? Math.round((truck.base_price / truck.base_km) * 10) / 10 : null;
    return `<div class="cw-tariff">
      <div><span>${T({ ar: "سعرك", fr: "Votre tarif", en: "Your rate" })}</span>
        <b>${per ? per + " " + T({ ar: "دج/كم", fr: "DA/km", en: "DZD/km" }) : T({ ar: "غير محدد", fr: "non défini", en: "not set" })}</b></div>
      <button class="btn ghost small" id="cw-price">${T({ ar: "تغيير", fr: "Modifier", en: "Change" })}</button>
    </div>
    ${per && per > 120 ? `<div class="cw-tip">💡 ${T({ ar: "سعرك أعلى من المتوسط — خفّضه قليلاً لتحصل على زبائن أكثر.", fr: "Tarif au-dessus de la moyenne — baissez un peu pour plus de clients.", en: "Above average — lower it a bit to win more jobs." })}</div>` : ""}`;
  }

  function loadCard(s) {
    const price = suggest(s.distance_km);
    const mine = s.my_offer;
    return `<div class="cw-load" data-id="${s.id}">
      <div class="row"><b>${esc(s.cargo)}</b><span class="cw-km">${s.distance_km} ${T("km")}</span></div>
      <div class="meta">${esc(s.pickup_label || "")} ← ${esc(s.dropoff_label || "")}</div>
      <div class="meta">${s.weight_tons} ${T("ton")}${s.pickup_distance_km != null ? " • " + T({ ar: "على بعد", fr: "à", en: "away" }) + " " + s.pickup_distance_km + " " + T("km") : ""}${s.budget ? " • " + T({ ar: "ميزانية", fr: "budget", en: "budget" }) + " " + money(s.budget) : ""}</div>
      ${mine
        ? `<div class="cw-sent">✅ ${T({ ar: "عرضك", fr: "Votre offre", en: "Your offer" })}: <b>${money(mine.price)}</b> — ${T({ ar: "في انتظار الرد", fr: "en attente", en: "waiting" })}</div>
           <div class="cw-actions"><button class="btn ghost small" data-open="${s.id}">${T({ ar: "تفاصيل", fr: "Détails", en: "Details" })}</button></div>`
        : `<div class="cw-offer">
             <button class="btn ghost tiny" data-minus="${s.id}">−</button>
             <input class="cw-price" type="number" inputmode="numeric" value="${price || s.budget || ""}" data-price="${s.id}">
             <button class="btn ghost tiny" data-plus="${s.id}">+</button>
           </div>
           <div class="cw-actions">
             <button class="btn primary block" data-send="${s.id}">📩 ${T({ ar: "أرسل عرضي", fr: "Envoyer l'offre", en: "Send offer" })}</button>
             <button class="btn ghost small" data-open="${s.id}">${T({ ar: "تفاصيل", fr: "Détails", en: "Details" })}</button>
           </div>`}
    </div>`;
  }

  function render() {
    const h = host();
    if (!h || !isCarrier()) return;
    const list = openLoads.slice(0, 6);
    h.innerHTML = `
      ${statChips()}
      ${tariffLine()}
      <div class="cw-head"><b>🚚 ${T({ ar: "حمولات تبحث عن شاحنة", fr: "Chargements disponibles", en: "Loads looking for a truck" })}</b>
        <button class="btn ghost tiny" id="cw-refresh">↻</button></div>
      ${list.length ? list.map(loadCard).join("") : `<div class="cw-empty">${T({ ar: "لا توجد حمولات الآن. أبقِ حالتك «متاح» وسنعلمك فور وصول طلب.", fr: "Aucun chargement pour l'instant.", en: "No loads right now." })}</div>`}
    `;
    wire(h);
  }

  function wire(h) {
    const r = $("#cw-refresh", h);
    if (r) r.onclick = refresh;
    const p = $("#cw-price", h);
    if (p) p.onclick = openTariff;
    $$("[data-plus]", h).forEach((b) => (b.onclick = () => bump(b.dataset.plus, +500)));
    $$("[data-minus]", h).forEach((b) => (b.onclick = () => bump(b.dataset.minus, -500)));
    $$("[data-send]", h).forEach((b) => (b.onclick = () => sendOffer(b.dataset.send, b)));
    $$("[data-open]", h).forEach((b) => (b.onclick = () => openDetails(b.dataset.open)));
  }

  function bump(id, d) {
    const inp = $(`[data-price="${id}"]`);
    if (!inp) return;
    const v = Math.max(0, (parseInt(inp.value || "0", 10) || 0) + d);
    inp.value = v;
    if (navigator.vibrate) navigator.vibrate(6);
  }

  async function sendOffer(id, btn) {
    const inp = $(`[data-price="${id}"]`);
    const price = parseInt(inp && inp.value, 10);
    if (!price) return toast(T({ ar: "أدخل سعرك أولاً", fr: "Saisissez un prix", en: "Enter a price" }));
    btn.disabled = true;
    try {
      await api(`/shipments/${id}/offers`, { method: "POST", body: { price } });
      toast(T({ ar: "أُرسل عرضك ✅", fr: "Offre envoyée ✅", en: "Offer sent ✅" }));
      if (navigator.vibrate) navigator.vibrate(12);
      refresh();
      H.loadShipments && H.loadShipments();
    } catch (e) {
      toast(e.message);
      btn.disabled = false;
    }
  }

  function openDetails(id) {
    // reuse the app's own shipment modal by clicking its list row when present
    const row = $(`#shipments-list .item[data-id="${id}"]`);
    if (row) return row.click();
    const nav = $('[data-view="shipments"]');
    if (nav) nav.click();
    setTimeout(() => {
      const r2 = $(`#shipments-list .item[data-id="${id}"]`);
      if (r2) r2.click();
    }, 700);
  }

  function openTariff() {
    const per = truck && truck.base_price && truck.base_km ? Math.round(truck.base_price / truck.base_km) : 100;
    H.openModal(
      T({ ar: "تسعيرتك", fr: "Votre tarif", en: "Your rate" }),
      `<form id="cw-tform" class="form-grid">
        <label>${T({ ar: "السعر لكل كيلومتر (دج)", fr: "Prix par km (DA)", en: "Price per km (DZD)" })}
          <input name="per_km" type="number" min="10" step="5" value="${per}" required></label>
        <label>${T({ ar: "أقل سعر تقبله (دج)", fr: "Prix minimum (DA)", en: "Minimum price (DZD)" })}
          <input name="min_price" type="number" min="0" step="100" value="${(truck && truck.min_price) || 0}"></label>
        <p class="hint">💡 ${T({ ar: "كلما كان سعرك مناسباً ظهرت أعلى في نتائج الزبائن وحصلت على رحلات أكثر.", fr: "Un tarif compétitif vous place plus haut dans les résultats.", en: "A competitive rate ranks you higher for shippers." })}</p>
        <button class="btn primary" type="submit">${T({ ar: "حفظ", fr: "Enregistrer", en: "Save" })}</button>
      </form>`
    );
    const f = $("#cw-tform");
    f.onsubmit = async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      const perKm = Number(d.per_km);
      try {
        await api("/truck", {
          method: "PUT",
          body: {
            truck_type: truck && truck.truck_type,
            capacity_tons: truck && truck.capacity_tons,
            plate: truck && truck.plate,
            base_km: 10,
            base_price: perKm * 10,
            min_price: Number(d.min_price) || 0,
          },
        });
        H.closeModal();
        toast(T({ ar: "تم حفظ تسعيرتك ✅", fr: "Tarif enregistré ✅", en: "Rate saved ✅" }));
        refresh();
      } catch (err) { toast(err.message); }
    };
  }

  /* ---------------- silent location refresh ---------------- */
  async function pingLocation() {
    if (!isCarrier() || !navigator.geolocation) return;
    try {
      const pos = await H.getPosition();
      await api("/truck/location", { method: "POST", body: { lat: pos.lat, lng: pos.lng } });
    } catch (e) {}
  }

  /* ---------------- boot ---------------- */
  function boot() {
    const app = document.getElementById("screen-app");
    if (!app) return;
    const kick = () => {
      if (!isCarrier()) return;
      document.body.classList.add("is-carrier");
      refresh();
      pingLocation();
    };
    new MutationObserver(() => { if (app.classList.contains("active")) kick(); }).observe(app, { attributes: true, attributeFilter: ["class"] });
    if (app.classList.contains("active")) kick();
    setInterval(() => { if (isCarrier() && document.visibilityState === "visible") refresh(); }, 45000);
    setInterval(pingLocation, 5 * 60 * 1000);
    document.addEventListener("ch:lang", render);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  window.CHC = { refresh, openTariff };
})();

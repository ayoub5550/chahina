/* v4.js — shipper journey & operations layer (v4.0)
   - trip timeline inside the shipment modal
   - automatic rating prompt after a delivered trip
   - sort chips for the nearby-trucks list (cheapest / closest / best rated)
   - statistics sheet (earnings, trips, kilometres) reachable from the ☰ menu
   Adds elements only. */
(function () {
  const H = window.CH;
  if (!H) return;
  const { api, toast, money, esc } = H;
  const $ = (s, r = document) => (r || document).querySelector(s);
  const $$ = (s, r = document) => Array.from((r || document).querySelectorAll(s));
  const L = () => document.documentElement.lang || "ar";
  const T = (o) => (typeof o === "string" ? H.T(o) : o[L()] || o.ar);

  /* ---------------- 1. trip timeline ---------------- */
  const STEPS = [
    { k: "open", i: "📝", t: { ar: "الطلب منشور", fr: "Demande publiée", en: "Request posted" } },
    { k: "accepted", i: "🤝", t: { ar: "تم الاتفاق", fr: "Accord conclu", en: "Deal agreed" } },
    { k: "picked_up", i: "📦", t: { ar: "تم التحميل", fr: "Chargé", en: "Picked up" } },
    { k: "delivered", i: "✅", t: { ar: "تم التسليم", fr: "Livré", en: "Delivered" } },
  ];
  const ORDER = { requested: 0, open: 0, accepted: 1, picked_up: 2, delivered: 3, cancelled: -1 };

  function timelineHtml(status) {
    const at = ORDER[status] != null ? ORDER[status] : 0;
    if (at < 0) return "";
    return `<div class="tl">${STEPS.map((s, i) => `
      <div class="tl-step ${i < at ? "done" : i === at ? "now" : ""}">
        <span class="tl-dot">${i <= at ? s.i : ""}</span>
        <span class="tl-lab">${T(s.t)}</span>
      </div>`).join("")}</div>`;
  }

  function injectTimeline() {
    const body = $("#modal-body");
    if (!body || $(".tl", body)) return;
    const badge = body.querySelector(".item .badge");
    if (!badge) return;
    const status = Array.from(badge.classList).find((c) => ORDER[c] != null);
    if (!status) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = timelineHtml(status);
    const first = body.querySelector(".item");
    if (first && wrap.firstChild) first.appendChild(wrap.firstChild);
  }

  /* ---------------- 2. rating prompt ---------------- */
  let promptedFor = null;
  async function ratingPrompt() {
    if (!H.state.user) return;
    if (!$("#modal").classList.contains("hidden")) return;
    let data;
    try { data = await api("/pending-rating"); } catch (e) { return; }
    if (!data.shipment || promptedFor === data.shipment.id) return;
    promptedFor = data.shipment.id;
    const s = data.shipment, o = data.other;
    H.openModal(
      T({ ar: "كيف كانت الرحلة؟", fr: "Comment s'est passé le trajet ?", en: "How was the trip?" }),
      `<div class="rate-wrap">
        ${o ? H.avatar(o.photo_url, o.name, "lg") : ""}
        <h3>${o ? esc(o.name) : ""}</h3>
        <div class="meta">${esc(s.cargo)} • ${s.distance_km} ${T("km")}${s.agreed_price ? " • " + money(s.agreed_price) : ""}</div>
        <div class="rate-stars" id="rate-stars">${[1, 2, 3, 4, 5].map((n) => `<button class="rst" data-n="${n}">★</button>`).join("")}</div>
        <textarea id="rate-comment" rows="2" placeholder="${T({ ar: "تعليق (اختياري)", fr: "Commentaire (optionnel)", en: "Comment (optional)" })}"></textarea>
        <button class="btn primary block" id="rate-send" disabled>${T({ ar: "إرسال التقييم", fr: "Envoyer", en: "Send rating" })}</button>
        <button class="btn ghost block" id="rate-later">${T({ ar: "لاحقاً", fr: "Plus tard", en: "Later" })}</button>
      </div>`
    );
    let stars = 0;
    $$("#rate-stars .rst").forEach((b) => (b.onclick = () => {
      stars = +b.dataset.n;
      $$("#rate-stars .rst").forEach((x) => x.classList.toggle("on", +x.dataset.n <= stars));
      $("#rate-send").disabled = false;
      if (navigator.vibrate) navigator.vibrate(8);
    }));
    $("#rate-later").onclick = () => H.closeModal();
    $("#rate-send").onclick = async () => {
      try {
        await api(`/shipments/${s.id}/rate`, { method: "POST", body: { stars, comment: $("#rate-comment").value } });
        H.closeModal();
        toast(T({ ar: "شكراً على تقييمك ⭐", fr: "Merci pour votre avis ⭐", en: "Thanks for your rating ⭐" }));
      } catch (e) { toast(e.message); }
    };
  }

  /* ---------------- 3. sort chips for trucks ---------------- */
  const SORTS = [
    { k: "price", t: { ar: "الأرخص", fr: "Moins cher", en: "Cheapest" } },
    { k: "distance", t: { ar: "الأقرب", fr: "Plus proche", en: "Closest" } },
    { k: "rating", t: { ar: "الأعلى تقييماً", fr: "Mieux notés", en: "Top rated" } },
  ];
  let sortKey = "price";

  function sortList() {
    const list = $("#trucks-list");
    if (!list) return;
    const items = $$(".item, .row-card", list).filter((el) => el.dataset.truckId || el.dataset.carrier || el.dataset.chat);
    if (items.length < 2) return;
    const val = (el) => {
      const txt = el.textContent;
      if (sortKey === "distance") { const m = txt.match(/([\d.]+)\s*(كم|km)/); return m ? parseFloat(m[1]) : 1e9; }
      if (sortKey === "rating") { const m = txt.match(/([\d.]+)\s*\(/); return m ? -parseFloat(m[1]) : 0; }
      const m = txt.match(/([\d\s.]+)\s*(دج|DA|DZD)/); return m ? parseFloat(m[1].replace(/[\s.]/g, "")) : 1e9;
    };
    items.sort((a, b) => val(a) - val(b)).forEach((el) => list.appendChild(el));
  }

  function sortChips() {
    const list = $("#trucks-list");
    if (!list || $("#sort-chips") || H.state.user?.role !== "shipper") return;
    const bar = document.createElement("div");
    bar.id = "sort-chips";
    bar.className = "sort-chips";
    bar.innerHTML = SORTS.map((s) => `<button class="chip${s.k === sortKey ? " on" : ""}" data-sort="${s.k}">${T(s.t)}</button>`).join("");
    list.parentNode.insertBefore(bar, list);
    bar.onclick = (e) => {
      const b = e.target.closest("[data-sort]");
      if (!b) return;
      sortKey = b.dataset.sort;
      $$("#sort-chips .chip").forEach((c) => c.classList.toggle("on", c.dataset.sort === sortKey));
      sortList();
      if (navigator.vibrate) navigator.vibrate(6);
    };
  }

  /* ---------------- 4. statistics sheet ---------------- */
  async function openStats() {
    let d;
    try { d = await api("/dashboard"); } catch (e) { return toast(e.message); }
    const t = d.totals || {}, m = d.month || {}, series = d.series || d.months || [];
    const max = Math.max(1, ...series.map((s) => s.amount || 0));
    const carrier = H.state.user.role === "carrier";
    H.openModal(
      T({ ar: "إحصائياتي", fr: "Mes statistiques", en: "My statistics" }),
      `<div class="st-grid">
        <div class="st"><b>${t.delivered || 0}</b><span>${T({ ar: "رحلة منجزة", fr: "livraisons", en: "delivered" })}</span></div>
        <div class="st"><b>${t.active || 0}</b><span>${T({ ar: "قيد التنفيذ", fr: "en cours", en: "active" })}</span></div>
        <div class="st"><b>${Math.round(t.km || 0)}</b><span>${T({ ar: "كم مقطوعة", fr: "km", en: "km" })}</span></div>
        <div class="st wide"><b>${money(t.earned || 0)}</b><span>${carrier ? T({ ar: "إجمالي المداخيل", fr: "revenus totaux", en: "total earned" }) : T({ ar: "إجمالي المصاريف", fr: "dépenses", en: "total spent" })}</span></div>
        <div class="st wide"><b>${money(m.earned || 0)}</b><span>${T({ ar: "هذا الشهر", fr: "ce mois", en: "this month" })}</span></div>
      </div>
      <h4>${T({ ar: "آخر 6 أشهر", fr: "6 derniers mois", en: "Last 6 months" })}</h4>
      <div class="bars">${series
        .map((s) => `<div class="bar"><i style="height:${Math.round(((s.amount || 0) / max) * 100)}%"></i><span>${String(s.m || "").slice(5)}</span></div>`)
        .join("")}</div>
      <p class="hint">${carrier
        ? T({ ar: "نصيحة: الردّ السريع على الطلبات يرفع فرص قبولك بشكل كبير.", fr: "Astuce : répondre vite augmente vos chances.", en: "Tip: replying fast wins more jobs." })
        : T({ ar: "نصيحة: قارن 3 عروض على الأقل قبل الاختيار.", fr: "Astuce : comparez au moins 3 offres.", en: "Tip: compare at least 3 offers." })}</p>`
    );
  }

  /* ---------------- boot ---------------- */
  function boot() {
    const modal = $("#modal");
    if (modal) new MutationObserver(() => { if (!modal.classList.contains("hidden")) injectTimeline(); })
      .observe(modal, { attributes: true, childList: true, subtree: true });
    const list = $("#trucks-list");
    if (list) new MutationObserver(() => { sortChips(); sortList(); }).observe(list, { childList: true });
    setTimeout(ratingPrompt, 9000);
    setInterval(ratingPrompt, 120000);
    document.addEventListener("ch:lang", () => { const c = $("#sort-chips"); if (c) c.remove(); sortChips(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  window.CHV4 = { openStats, ratingPrompt };
})();

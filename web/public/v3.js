/* v3.js — trust & communication layer (v3.0)
   - in-app alert banners for new notifications (tap to open)
   - truck photo gallery for carriers (add / remove, up to 6)
   - richer profile chrome (verified + response stats)
   Adds elements only; never moves app.js-owned nodes. */
(function () {
  const H = window.CH;
  if (!H) return;
  const { api, toast, esc } = H;
  const $ = (s, r = document) => (r || document).querySelector(s);
  const $$ = (s, r = document) => Array.from((r || document).querySelectorAll(s));
  const L = () => document.documentElement.lang || "ar";
  const T = (o) => (typeof o === "string" ? H.T(o) : o[L()] || o.ar);

  /* ---------------- alert banners ---------------- */
  let lastSeenId = null;

  function banner(n) {
    const el = document.createElement("div");
    el.className = "ch-alert";
    const icon = n.kind === "message" ? "💬" : n.kind === "offer" ? "💰" : n.kind === "status" ? "🚚" : "🔔";
    el.innerHTML = `<span class="ch-alert-i">${icon}</span><div class="ch-alert-t">${esc(n.text || "")}</div><button class="ch-alert-x">✕</button>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("in"));
    const kill = () => { el.classList.remove("in"); setTimeout(() => el.remove(), 250); };
    el.querySelector(".ch-alert-x").onclick = (e) => { e.stopPropagation(); kill(); };
    el.onclick = () => {
      kill();
      if (n.kind === "message" && n.extra && n.extra.user_id) H.openChat(n.extra.user_id);
      else if (n.shipment_id) {
        const nav = $('[data-view="shipments"]');
        if (nav) nav.click();
      }
    };
    if (navigator.vibrate) navigator.vibrate([10, 40, 10]);
    setTimeout(kill, 6000);
  }

  async function watchNotifications() {
    if (!H.state.user) return;
    try {
      const { notifications } = await api("/notifications");
      if (!notifications || !notifications.length) return;
      const newest = notifications[0];
      if (lastSeenId === null) { lastSeenId = newest.id; return; }
      if (newest.id > lastSeenId) {
        notifications
          .filter((n) => n.id > lastSeenId && !n.seen)
          .slice(0, 2)
          .reverse()
          .forEach(banner);
        lastSeenId = newest.id;
      }
    } catch (e) {}
  }

  /* ---------------- truck photo gallery ---------------- */
  async function openGallery() {
    let photos = [];
    try { photos = (await api("/me")).truck?.photos || []; } catch (e) {}
    H.openModal(
      T({ ar: "صور شاحنتي", fr: "Photos de mon camion", en: "My truck photos" }),
      `<p class="hint">${T({ ar: "الصور الواضحة ترفع ثقة الزبون وتزيد فرص اختيارك (6 صور كحد أقصى).", fr: "Des photos claires inspirent confiance (6 max).", en: "Clear photos build trust (6 max)." })}</p>
       <div id="gal-grid" class="gal-grid"></div>
       <button class="btn primary block" id="gal-add">📷 ${T({ ar: "إضافة صورة", fr: "Ajouter une photo", en: "Add a photo" })}</button>
       <input type="file" id="gal-file" accept="image/*" class="hidden">`
    );
    const paint = () => {
      $("#gal-grid").innerHTML = photos.length
        ? photos.map((p) => `<div class="gal-item"><img src="${esc(H.mediaUrl ? H.mediaUrl(p) : p)}" alt=""><button class="gal-del" data-del="${esc(p)}">✕</button></div>`).join("")
        : `<p class="hint">${T({ ar: "لا توجد صور بعد.", fr: "Aucune photo.", en: "No photos yet." })}</p>`;
      $$("#gal-grid [data-del]").forEach((b) => (b.onclick = async () => {
        try { photos = (await api("/truck/photos", { method: "POST", body: { remove: b.dataset.del } })).photos; paint(); }
        catch (e) { toast(e.message); }
      }));
    };
    paint();
    $("#gal-add").onclick = () => $("#gal-file").click();
    $("#gal-file").onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      toast(T({ ar: "جارٍ الرفع…", fr: "Envoi…", en: "Uploading…" }));
      try {
        photos = (await api("/truck/photos", { method: "POST", body: { photo: await H.readImage(f) } })).photos;
        paint();
        toast(T({ ar: "تمت الإضافة ✅", fr: "Ajoutée ✅", en: "Added ✅" }));
      } catch (err) { toast(err.message); }
      e.target.value = "";
    };
  }

  function addGalleryButton() {
    if (!H.state.user || H.state.user.role !== "carrier") return;
    const head = $("#profile-body .card-actions") || $("#profile-body");
    if (!head || $("#btn-gallery")) return;
    const b = document.createElement("button");
    b.id = "btn-gallery";
    b.className = "btn ghost small";
    b.textContent = "🖼️ " + T({ ar: "صور شاحنتي", fr: "Photos camion", en: "Truck photos" });
    b.onclick = openGallery;
    head.appendChild(b);
  }

  /* ---------------- boot ---------------- */
  function boot() {
    setInterval(watchNotifications, 20000);
    setTimeout(watchNotifications, 4000);
    const pb = document.getElementById("profile-body");
    if (pb) new MutationObserver(() => addGalleryButton()).observe(pb, { childList: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  window.CHV3 = { openGallery };
})();

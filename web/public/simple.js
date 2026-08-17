/* simple.js — mobile simplification layer (v2.3)
   Goal: fewer visible controls, bigger touch targets, one clear action.
   It only MOVES existing elements, so all handlers in app.js/v2.js keep working. */
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const T = (k, f) => (window.t ? window.t(k) : null) || f;

  function sheet(title, node) {
    const wrap = document.createElement("div");
    wrap.className = "sh-wrap";
    wrap.innerHTML = `<div class="sh-card"><div class="sh-head"><b>${title}</b><button class="sh-x">✕</button></div><div class="sh-body"></div></div>`;
    wrap.querySelector(".sh-body").appendChild(node);
    const close = () => { wrap.classList.add("out"); setTimeout(() => wrap.remove(), 220); };
    wrap.querySelector(".sh-x").onclick = close;
    wrap.onclick = (e) => { if (e.target === wrap) close(); };
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add("in"));
    return close;
  }

  function buildMenu() {
    const bar = $(".top-actions");
    if (!bar || $("#btn-menu")) return;
    ["#me-rating", "#lang-select", "#btn-theme", "#btn-logout"].forEach((s) => {
      const el = $(s);
      if (el) el.classList.add("hidden-btn"); // kept in DOM so app.js handlers still work
    });
    const b = document.createElement("button");
    b.id = "btn-menu";
    b.className = "btn ghost small";
    b.innerHTML = "\u2630";
    b.onclick = () => {
      const box = document.createElement("div");
      box.className = "menu-list";
      const rating = $("#me-rating");
      const mk = (icon, label, fn) => {
        const r = document.createElement("button");
        r.className = "menu-row";
        r.innerHTML = icon + " <span>" + label + "</span>";
        r.onclick = () => { close(); setTimeout(fn, 180); };
        box.appendChild(r);
      };
      if (rating && rating.textContent.trim()) {
        const info = document.createElement("div");
        info.className = "menu-note";
        info.textContent = T("rating", "التقييم") + ": " + rating.textContent.trim();
        box.appendChild(info);
      }
      mk("\uD83D\uDCC8", T("my_stats", "إحصائياتي"), () => { if (window.CHV4) CHV4.openStats(); });
      if (window.CH && CH.state.user && CH.state.user.role === "carrier")
        mk("\uD83D\uDDBC\uFE0F", T("truck_photos", "صور شاحنتي"), () => { if (window.CHV3) CHV3.openGallery(); });
      mk("\uD83D\uDCCA", T("dashboard", "لوحة التحكم"), () => {
        const n = document.querySelector('.bottom-nav .nav[data-view="dash"]');
        if (n) { n.classList.remove("nav-hidden"); n.click(); setTimeout(() => n.classList.add("nav-hidden"), 400); }
      });
      const langs = document.createElement("div");
      langs.className = "menu-inline";
      [["ar", "العربية"], ["fr", "Français"], ["en", "English"]].forEach(([code, name]) => {
        const lb = document.createElement("button");
        lb.className = "menu-chip";
        lb.textContent = name;
        lb.onclick = () => {
          const sel = $("#lang-select");
          if (sel) { sel.value = code; sel.dispatchEvent(new Event("change", { bubbles: true })); }
          close();
        };
        langs.appendChild(lb);
      });
      box.appendChild(langs);
      mk("\uD83C\uDF13", T("theme", "الوضع الليلي / النهاري"), () => { const el = $("#btn-theme"); el && el.click(); });
      mk("\uD83D\uDEAA", T("logout", "خروج"), () => { const el = $("#btn-logout"); el && el.click(); });
      const credit = document.createElement("div");
      credit.className = "menu-note";
      credit.textContent = "\u062e\u0631\u0627\u0626\u0637: OpenStreetMap";
      box.appendChild(credit);
      const close = sheet(T("account", "حسابي"), box);
    };
    bar.appendChild(b);
  }

  function simplifyPanel() {
    const host = $("#map-panel-shipper");
    if (!host || $("#simple-bar")) return;
    const adv = $("#filters-advanced");
    const rows = host.querySelectorAll(".filters");
    const search = $("#filter-q");
    const toggle = $("#btn-filters-toggle");

    // one clean row: search + filters button
    const bar = document.createElement("div");
    bar.id = "simple-bar";
    bar.className = "simple-bar";
    if (search) bar.appendChild(search);
    const fbtn = document.createElement("button");
    fbtn.className = "btn ghost sq";
    fbtn.id = "btn-open-filters";
    fbtn.innerHTML = "⚙";
    bar.appendChild(fbtn);
    host.insertBefore(bar, host.firstChild);

    // stash every filter control in a hidden holder, shown only in the sheet
    const stash = document.createElement("div");
    stash.id = "filters-stash";
    stash.className = "hidden";
    host.appendChild(stash);
    rows.forEach((r) => stash.appendChild(r));
    if (adv) { adv.classList.remove("hidden"); stash.appendChild(adv); }
    const fav = $("#fav-filter-wrap");
    if (fav) stash.appendChild(fav);
    const hint = host.querySelector(".hint");
    if (hint) hint.remove();
    if (toggle) toggle.remove();

    fbtn.onclick = () => {
      const box = document.createElement("div");
      box.className = "filters-sheet";
      Array.from(stash.children).forEach((c) => box.appendChild(c));
      const done = document.createElement("button");
      done.className = "btn primary block";
      done.textContent = T("apply", "تطبيق");
      box.appendChild(done);
      const close = sheet(T("more_filters", "الفلاتر"), box);
      done.onclick = close;
      const obs = new MutationObserver(() => {
        if (!document.querySelector(".sh-wrap")) {
          Array.from(box.children).forEach((c) => { if (c !== done) stash.appendChild(c); });
          obs.disconnect();
        }
      });
      obs.observe(document.body, { childList: true });
    };
  }

  // slim truck cards: name opens profile, profile button hidden
  function slimCards() {
    const list = document.querySelector("#trucks-list");
    if (!list) return;
    const apply = () => {
      list.querySelectorAll("[data-profile]").forEach((b) => {
        if (b.tagName === "BUTTON") b.classList.add("hidden-btn");
      });
      list.querySelectorAll(".item").forEach((it) => {
        const pb = it.querySelector("[data-profile]");
        const title = it.querySelector("b, h3, .t-name");
        if (pb && title && !title.dataset.linked) {
          title.dataset.linked = "1";
          title.classList.add("tap-name");
          title.onclick = () => pb.click();
        }
      });
    };
    apply();
    new MutationObserver(apply).observe(list, { childList: true, subtree: true });
  }

  function trimNav() {
    const dash = document.querySelector('.bottom-nav .nav[data-view="dash"]');
    if (dash) dash.classList.add("nav-hidden");
  }

  function boot() {
    buildMenu();
    trimNav();
    const iv2 = setInterval(() => { if ($("#trucks-list")) { slimCards(); clearInterval(iv2); } }, 300);
    setTimeout(() => clearInterval(iv2), 15000);
    const iv = setInterval(() => { if ($("#map-panel-shipper")) { simplifyPanel(); clearInterval(iv); } }, 250);
    setTimeout(() => clearInterval(iv), 15000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

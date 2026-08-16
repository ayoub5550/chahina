/* ai.js — brand mark, animated splash, vector nav icons and the in-app smart assistant (v2.2). */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const api = (p, o) => window.CH.api(p, o);
  const lang = () => (window.CH && window.CH.state && window.CH.state.lang) || document.documentElement.lang || "ar";
  const T = (o) => o[lang()] || o.ar;

  // ---------- brand mark ----------
  const MARK = `<svg viewBox="0 0 192 192" class="mark" aria-hidden="true">
    <defs><linearGradient id="mg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd76b"/><stop offset="1" stop-color="#ff9f1c"/></linearGradient></defs>
    <rect x="34" y="62" width="66" height="46" rx="9" fill="url(#mg)"/>
    <path d="M104 74h24l20 22v12h-44z" fill="url(#mg)" opacity=".92"/>
    <rect x="112" y="79" width="20" height="15" rx="4" fill="#0b1220" opacity=".5"/>
    <circle cx="60" cy="116" r="13" fill="#0b1220"/><circle cx="60" cy="116" r="5.5" fill="url(#mg)"/>
    <circle cx="128" cy="116" r="13" fill="#0b1220"/><circle cx="128" cy="116" r="5.5" fill="url(#mg)"/>
    <path d="M96 22c-13 0-23 10-23 23 0 16 23 33 23 33s23-17 23-33c0-13-10-23-23-23z" fill="#fff"/>
    <circle cx="96" cy="45" r="8.5" fill="#ff9f1c"/></svg>`;

  const ICONS = {
    map: '<path d="M9 3 3 5.5v16L9 19l6 2.5 6-2.5v-16L15 5.5 9 3zm0 2.2 6 2.5v11.1l-6-2.5V5.2z"/>',
    shipments: '<path d="M12 2 3 6.5v11L12 22l9-4.5v-11L12 2zm0 2.3 6.3 3.1L12 10.5 5.7 7.4 12 4.3zM5 9.2l6 3v7.1l-6-3V9.2zm8 10.1v-7.1l6-3v7.1l-6 3z"/>',
    dash: '<path d="M4 20h3v-7H4v7zm6.5 0h3V4h-3v16zM17 20h3v-11h-3v11z"/>',
    chats: '<path d="M12 3C6.9 3 3 6.4 3 10.6c0 2.4 1.3 4.6 3.4 6l-.8 3.6 3.9-2.1c.8.2 1.6.3 2.5.3 5.1 0 9-3.4 9-7.8S17.1 3 12 3z"/>',
    profile: '<path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm0 2c-4 0-8 2-8 4.6V21h16v-2.4C20 16 16 14 12 14z"/>',
  };

  function paintBrand() {
    $$(".brand .logo, .logo-sm").forEach((el) => {
      if (el.dataset.mark) return;
      el.dataset.mark = "1";
      el.textContent = "";
      el.innerHTML = MARK;
    });
    $$(".nav").forEach((b) => {
      const k = b.dataset.view,
        span = b.querySelector("span");
      if (!span || !ICONS[k] || span.dataset.svg) return;
      span.dataset.svg = "1";
      span.innerHTML = `<svg viewBox="0 0 24 24" class="nic">${ICONS[k]}</svg>`;
    });
  }

  // ---------- animated splash ----------
  function splash() {
    if (sessionStorage.getItem("ch_splash")) return;
    sessionStorage.setItem("ch_splash", "1");
    const d = document.createElement("div");
    d.className = "splash";
    d.innerHTML = `<div class="splash-in">${MARK}<b>${T({ ar: "شاحنتي", fr: "Chahina", en: "Chahina" })}</b>
      <small>${T({ ar: "قارن الأسعار… واختر الأرخص", fr: "Comparez et choisissez", en: "Compare and choose" })}</small>
      <div class="splash-bar"><i></i></div></div>`;
    document.body.appendChild(d);
    document.body.classList.add("splashing");
    setTimeout(() => d.classList.add("out"), 1500);
    setTimeout(() => {
      d.remove();
      document.body.classList.remove("splashing");
    }, 2100);
  }

  // ---------- assistant ----------
  const CHIPS = {
    ar: ["من غرداية إلى الجزائر 3 طن", "كم سعر 120 كم؟", "كيف أطلب شاحنة؟", "بكم أسعّر الكيلومتر؟"],
    fr: ["de Ghardaïa à Alger 3 tonnes", "prix pour 120 km ?", "Comment réserver ?", "Quel tarif au km ?"],
    en: ["from Ghardaia to Algiers 3 tons", "price for 120 km?", "How do I book?", "What rate per km?"],
  };

  let panel;
  function build() {
    panel = document.createElement("div");
    panel.className = "ai-panel hidden";
    panel.innerHTML = `
      <div class="ai-head">
        <span class="ai-dot"></span><b>${T({ ar: "المساعد الذكي", fr: "Assistant intelligent", en: "Smart assistant" })}</b>
        <button class="btn ghost small ai-x">✕</button>
      </div>
      <div class="ai-body"></div>
      <div class="ai-chips"></div>
      <form class="ai-form">
        <input required maxlength="300" placeholder="${T({ ar: "اكتب طلبك… مثال: من باتنة إلى ورقلة 5 طن", fr: "Écrivez votre demande…", en: "Type your request…" })}">
        <button class="btn primary small">↑</button>
      </form>`;
    document.body.appendChild(panel);
    panel.querySelector(".ai-x").onclick = toggle;
    panel.querySelector(".ai-form").onsubmit = (e) => {
      e.preventDefault();
      const i = panel.querySelector("input");
      const v = i.value.trim();
      if (!v) return;
      i.value = "";
      send(v);
    };
    renderChips();
    bubble(
      "ai",
      T({
        ar: "مرحباً 👋 أنا مساعدك. اكتب مسار الشحنة وسأحسب لك المسافة وأرخص سعر متاح فوراً.",
        fr: "Bonjour 👋 Écrivez votre trajet, je calcule la distance et le meilleur prix.",
        en: "Hi 👋 Type your route and I’ll compute distance and the cheapest price.",
      })
    );
  }

  function renderChips() {
    const box = panel.querySelector(".ai-chips");
    box.innerHTML = "";
    (CHIPS[lang()] || CHIPS.ar).forEach((c) => {
      const b = document.createElement("button");
      b.className = "ai-chip";
      b.textContent = c;
      b.onclick = () => send(c);
      box.appendChild(b);
    });
  }

  function md(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/\n/g, "<br>");
  }

  function bubble(who, text) {
    const b = document.createElement("div");
    b.className = "ai-msg " + who;
    b.innerHTML = md(text);
    panel.querySelector(".ai-body").appendChild(b);
    panel.querySelector(".ai-body").scrollTop = 1e6;
    return b;
  }

  async function send(text) {
    bubble("me", text);
    const wait = bubble("ai typing", "<i></i><i></i><i></i>");
    wait.innerHTML = '<span class="dots"><i></i><i></i><i></i></span>';
    try {
      const r = await api("/ai/ask", { method: "POST", body: { text } });
      wait.remove();
      const b = bubble("ai", r.reply || "…");
      if (r.carriers && r.carriers.length) {
        const box = document.createElement("div");
        box.className = "ai-cards";
        r.carriers.forEach((c, idx) => {
          const el = document.createElement("button");
          el.className = "ai-card";
          el.innerHTML = `<b>${idx === 0 ? "🏆 " : ""}${c.name}</b><span>${new Intl.NumberFormat("fr-FR").format(c.price)} ${T({ ar: "دج", fr: "DA", en: "DZD" })}</span>
            <small>${c.ratings_count ? "★ " + c.rating + " (" + c.ratings_count + ")" : T({ ar: "جديد", fr: "nouveau", en: "new" })}${c.verified ? " • ✔" : ""}</small>`;
          el.onclick = () => {
            toggle();
            if (window.CHV2 && window.CHV2.openBooking) window.CHV2.openBooking(c.carrier_id);
            else if (window.CH && window.CH.openProfile) window.CH.openProfile(c.carrier_id);
          };
          box.appendChild(el);
        });
        b.appendChild(box);
      }
      if (r.suggest_per_km && window.CH && window.CH.toast) {
        // carrier advice: nothing else to do, the text carries the number
      }
    } catch (e) {
      wait.remove();
      bubble("ai", T({ ar: "تعذّر الاتصال، حاول مجدداً.", fr: "Connexion impossible.", en: "Connection failed." }));
    }
  }

  function toggle() {
    if (!panel) build();
    const open = panel.classList.contains("hidden");
    panel.classList.toggle("hidden", !open);
    document.body.classList.toggle("ai-open", open);
    if (open) setTimeout(() => panel.querySelector("input").focus(), 250);
    if (navigator.vibrate) navigator.vibrate(8);
  }

  function fab() {
    if ($(".ai-fab")) return;
    const b = document.createElement("button");
    b.className = "ai-fab";
    b.title = T({ ar: "المساعد الذكي", fr: "Assistant", en: "Assistant" });
    b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 2l1.9 5.1L19 9l-5.1 1.9L12 16l-1.9-5.1L5 9l5.1-1.9L12 2zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z"/></svg>';
    b.onclick = toggle;
    document.body.appendChild(b);
  }

  function boot() {
    try { paintBrand(); } catch (e) {}
    try { splash(); } catch (e) {}
    fab();
    const app = document.getElementById("screen-app");
    if (app) new MutationObserver(() => paintBrand()).observe(app, { attributes: true, attributeFilter: ["class"] });
    document.addEventListener("ch:lang", () => { if (panel) renderChips(); });
  }

  function safeBoot(){ try { boot(); } catch (e) { document.title = "AIERR: " + (e && e.message); } }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", safeBoot);
  else safeBoot();
  window.CHAI = { toggle, ask: send };
})();

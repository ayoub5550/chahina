/* ai.js — brand mark, animated splash, vector nav icons (v2.2). */
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

  function boot() {
    try { paintBrand(); } catch (e) {}
    try { splash(); } catch (e) {}
    const app = document.getElementById("screen-app");
    if (app) new MutationObserver(() => paintBrand()).observe(app, { attributes: true, attributeFilter: ["class"] });
  }

  function safeBoot(){ try { boot(); } catch (e) { document.title = "AIERR: " + (e && e.message); } }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", safeBoot);
  else safeBoot();
})();

/* ==========================================================================
   شاحنتي / Chahina — UX polish layer (v2.1)
   Pure enhancement: no business logic. Loaded after app.js / v2.js.
   ========================================================================== */
(() => {
  "use strict";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const raf = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn));

  /* ---------------------------------------------------------------- haptics */
  const buzz = (ms = 8) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (_) {} };

  /* ----------------------------------------------------------------- ripple */
  const RIPPLE_SEL = ".btn,.nav,.tab,.lang-switch button,.item.row-card";
  document.addEventListener("pointerdown", (e) => {
    const el = e.target.closest && e.target.closest(RIPPLE_SEL);
    if (!el || reduce || el.disabled) return;
    buzz(el.matches(".nav") ? 6 : 9);
    const r = el.getBoundingClientRect();
    const size = Math.max(r.width, r.height);
    const s = document.createElement("span");
    s.className = "ripple";
    s.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
    if (getComputedStyle(el).position === "static") el.style.position = "relative";
    el.appendChild(s);
    setTimeout(() => s.remove(), 600);
  }, { passive: true });

  /* ------------------------------------------------- bottom-nav indicator */
  const navs = $$(".nav");
  const bar = $(".bottom-nav");
  let ind = null;
  function placeIndicator() {
    if (!bar || !navs.length) return;
    const active = navs.find((n) => n.classList.contains("active")) || navs[0];
    if (!ind) { ind = document.createElement("i"); ind.className = "nav-ind"; bar.appendChild(ind); }
    const w = active.offsetWidth * 0.42;
    ind.style.width = w + "px";
    ind.style.transform = `translateX(${active.offsetLeft + (active.offsetWidth - w) / 2}px)`;
  }

  /* ------------------------------------------------- view transitions */
  const order = ["map", "shipments", "dash", "chats", "profile"];
  let current = "map";
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".nav");
    if (!b) return;
    const next = b.dataset.view;
    const dir = order.indexOf(next) > order.indexOf(current) ? "vt-in-next" : "vt-in-prev";
    current = next;
    setTimeout(() => {
      placeIndicator();
      const v = $("#view-" + next);
      if (!v || reduce) return;
      v.classList.remove("vt-in-next", "vt-in-prev");
      void v.offsetWidth;
      v.classList.add(dir);
      v.addEventListener("animationend", () => v.classList.remove(dir), { once: true });
    }, 0);
  }, true);

  /* ------------------------------------------------- animated modal close */
  const modal = $("#modal");
  if (modal) {
    let closing = false;
    new MutationObserver(() => {
      if (!modal.classList.contains("hidden") || closing || reduce) return;
      closing = true;
      modal.classList.remove("hidden");
      modal.classList.add("closing");
      setTimeout(() => {
        modal.classList.add("hidden");
        modal.classList.remove("closing");
        const c = $(".modal-card", modal);
        if (c) c.style.transform = "";
        closing = false;
      }, 240);
    }).observe(modal, { attributes: true, attributeFilter: ["class"] });

    // Esc to close
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modal.classList.contains("hidden")) $("#modal-close") && $("#modal-close").click();
    });

    // drag the sheet down to dismiss (mobile)
    let startY = null, card = null, dy = 0;
    modal.addEventListener("pointerdown", (e) => {
      card = $(".modal-card", modal);
      if (!card || innerWidth >= 820) return;
      const top = card.getBoundingClientRect().top;
      if (e.clientY - top > 46 && card.scrollTop > 0) return; // only from the handle area / top when not scrolled
      if (e.clientY - top > 46) return;
      startY = e.clientY; dy = 0; card.classList.add("dragging");
    }, { passive: true });
    modal.addEventListener("pointermove", (e) => {
      if (startY == null || !card) return;
      dy = Math.max(0, e.clientY - startY);
      card.style.transform = `translateY(${dy}px)`;
      modal.style.opacity = String(Math.max(0.35, 1 - dy / 420));
    }, { passive: true });
    const endDrag = () => {
      if (startY == null || !card) return;
      card.classList.remove("dragging");
      modal.style.opacity = "";
      if (dy > 110) { buzz(12); $("#modal-close") && $("#modal-close").click(); }
      else card.style.transform = "";
      startY = null;
    };
    modal.addEventListener("pointerup", endDrag);
    modal.addEventListener("pointercancel", endDrag);
  }

  /* ------------------------------------------------- toast out-animation */
  const toastEl = $("#toast");
  if (toastEl) {
    let hiding = false;
    new MutationObserver(() => {
      if (toastEl.classList.contains("hidden")) {
        if (hiding || reduce) return;
        hiding = true;
        toastEl.classList.remove("hidden");
        toastEl.classList.add("out");
        setTimeout(() => { toastEl.classList.add("hidden"); toastEl.classList.remove("out"); hiding = false; }, 250);
      } else {
        toastEl.classList.remove("out");
      }
    }).observe(toastEl, { attributes: true, attributeFilter: ["class"] });
  }

  /* ------------------------------------------------- staggered list reveal */
  if (!reduce) {
    const stagger = (list) => {
      const items = [...list.children].filter((c) => c.classList && c.classList.contains("item"));
      items.slice(0, 12).forEach((it, i) => {
        it.style.setProperty("--i", i);
        it.classList.remove("rv"); void it.offsetWidth; it.classList.add("rv");
      });
    };
    const mo = new MutationObserver((muts) => {
      const seen = new Set();
      muts.forEach((m) => {
        const t = m.target;
        if (t.classList && t.classList.contains("list") && !seen.has(t)) { seen.add(t); stagger(t); }
      });
    });
    $$(".list").forEach((l) => mo.observe(l, { childList: true }));
  }

  /* ------------------------------------------------- scroll-to-top button */
  $$(".view").forEach((view) => {
    if (view.id === "view-map") return;
    const fab = document.createElement("button");
    fab.className = "fab-up";
    fab.type = "button";
    fab.textContent = "↑";
    fab.setAttribute("aria-label", "top");
    view.style.position = "relative";
    view.appendChild(fab);
    fab.onclick = () => { buzz(); view.scrollTo({ top: 0, behavior: "smooth" }); };
    view.addEventListener("scroll", () => fab.classList.toggle("show", view.scrollTop > 260), { passive: true });
  });

  /* ------------------------------------------------- misc */
  // keep the nav indicator correct on rotate / resize / first paint
  addEventListener("resize", placeIndicator);
  addEventListener("load", () => raf(placeIndicator));
  raf(placeIndicator);
  [120, 400, 1200].forEach((t) => setTimeout(placeIndicator, t));
  new MutationObserver(() => raf(placeIndicator))
    .observe($("#screen-app") || document.body, { attributes: true, attributeFilter: ["class"] });

  // theme switch: soften the flip
  const themeBtn = $("#btn-theme");
  if (themeBtn) themeBtn.addEventListener("click", () => {
    document.documentElement.style.transition = "background .3s ease,color .3s ease";
    buzz(10);
    setTimeout(() => (document.documentElement.style.transition = ""), 400);
  });
})();

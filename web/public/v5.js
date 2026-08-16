/* v5.js — readiness layer (v5.0)
   - voice input for the assistant (Arabic first)
   - offline / back-online banner
   - first-run coach marks
   - lazy images + small performance touches */
(function () {
  const H = window.CH;
  const $ = (s, r = document) => (r || document).querySelector(s);
  const $$ = (s, r = document) => Array.from((r || document).querySelectorAll(s));
  const L = () => document.documentElement.lang || "ar";
  const T = (o) => o[L()] || o.ar;

  /* ---------------- 1. voice input ---------------- */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;

  function voiceLang() {
    return L() === "fr" ? "fr-FR" : L() === "en" ? "en-US" : "ar-DZ";
  }

  function addMic() {
    const form = $(".ai-form") || $(".ai-panel form");
    if (!form || $("#ai-mic") || !SR) return;
    const b = document.createElement("button");
    b.id = "ai-mic";
    b.type = "button";
    b.className = "ai-mic";
    b.innerHTML = "🎤";
    b.title = T({ ar: "تكلم", fr: "Parler", en: "Speak" });
    b.onclick = () => listen(b);
    form.appendChild(b);
  }

  function listen(btn) {
    if (!SR) return;
    if (rec) { try { rec.stop(); } catch (e) {} rec = null; btn.classList.remove("rec"); return; }
    rec = new SR();
    rec.lang = voiceLang();
    rec.interimResults = true;
    rec.continuous = false;
    btn.classList.add("rec");
    if (navigator.vibrate) navigator.vibrate(10);
    const input = $(".ai-panel input");
    rec.onresult = (e) => {
      const txt = Array.from(e.results).map((r) => r[0].transcript).join(" ");
      if (input) input.value = txt;
      if (e.results[e.results.length - 1].isFinal && window.CHAI && txt.trim()) {
        CHAI.ask(txt.trim());
        if (input) input.value = "";
      }
    };
    rec.onerror = () => { btn.classList.remove("rec"); rec = null; };
    rec.onend = () => { btn.classList.remove("rec"); rec = null; };
    try { rec.start(); } catch (e) { btn.classList.remove("rec"); rec = null; }
  }

  /* ---------------- 2. offline banner ---------------- */
  function netBanner(on) {
    let el = $("#net-bar");
    if (!el) {
      el = document.createElement("div");
      el.id = "net-bar";
      document.body.appendChild(el);
    }
    el.className = on ? "net-bar ok in" : "net-bar off in";
    el.textContent = on
      ? T({ ar: "عاد الاتصال ✅", fr: "De nouveau en ligne ✅", en: "Back online ✅" })
      : T({ ar: "أنت غير متصل — بعض البيانات قد لا تتحدث", fr: "Hors ligne — données peut-être anciennes", en: "Offline — data may be stale" });
    if (on) setTimeout(() => el.classList.remove("in"), 2500);
  }
  window.addEventListener("offline", () => netBanner(false));
  window.addEventListener("online", () => netBanner(true));

  /* ---------------- 3. first-run coach marks ---------------- */
  const COACH = [
    { sel: ".hero-ask, [data-hero-ask]", t: { ar: "اطلب شاحنة بالكلام — اكتب أو تكلم وسنحسب لك السعر.", fr: "Demandez un camion en langage naturel.", en: "Ask for a truck in plain words." } },
    { sel: "#trucks-list .item, .row-card", t: { ar: "هنا الشاحنات القريبة مرتبة من الأرخص — قارن واختر.", fr: "Camions proches, du moins cher au plus cher.", en: "Nearby trucks, cheapest first." } },
    { sel: '.bottom-nav .nav[data-view="chats"]', t: { ar: "دردش مع صاحب الشاحنة قبل الاتفاق.", fr: "Discutez avant de conclure.", en: "Chat before you commit." } },
  ];

  function coach() {
    if (localStorage.getItem("ch_coach_v5")) return;
    if (!H || !H.state.user) { setTimeout(coach, 4000); return; }
    if (!document.querySelector("#screen-app.active")) { setTimeout(coach, 4000); return; }
    let i = 0;
    const box = document.createElement("div");
    box.className = "coach";
    box.innerHTML = `<div class="coach-card"><p id="coach-t"></p>
      <div class="coach-actions"><button class="btn ghost small" id="coach-skip"></button><button class="btn primary small" id="coach-next"></button></div>
      <div class="coach-dots"></div></div>`;
    document.body.appendChild(box);
    const done = () => { localStorage.setItem("ch_coach_v5", "1"); box.remove(); $$(".coach-hl").forEach((e) => e.classList.remove("coach-hl")); };
    const paint = () => {
      $$(".coach-hl").forEach((e) => e.classList.remove("coach-hl"));
      const step = COACH[i];
      const el = document.querySelector(step.sel);
      if (el) { el.classList.add("coach-hl"); el.scrollIntoView({ block: "center", behavior: "smooth" }); }
      $("#coach-t", box).textContent = T(step.t);
      $("#coach-skip", box).textContent = T({ ar: "تخطي", fr: "Passer", en: "Skip" });
      $("#coach-next", box).textContent = i === COACH.length - 1 ? T({ ar: "فهمت", fr: "Compris", en: "Got it" }) : T({ ar: "التالي", fr: "Suivant", en: "Next" });
      box.querySelector(".coach-dots").innerHTML = COACH.map((_, n) => `<i class="${n === i ? "on" : ""}"></i>`).join("");
    };
    $("#coach-skip", box).onclick = done;
    $("#coach-next", box).onclick = () => { i++; i >= COACH.length ? done() : paint(); };
    paint();
  }

  /* ---------------- 4. perf touches ---------------- */
  function lazyImages() {
    $$("img:not([loading])").forEach((im) => { im.loading = "lazy"; im.decoding = "async"; });
  }

  /* ---------------- boot ---------------- */
  function boot() {
    setInterval(addMic, 1500);
    addMic();
    if (!navigator.onLine) netBanner(false);
    setTimeout(coach, 6000);
    setInterval(lazyImages, 4000);
    document.addEventListener("ch:lang", () => { const m = $("#ai-mic"); if (m) m.title = T({ ar: "تكلم", fr: "Parler", en: "Speak" }); });
  }
  function safeBoot() { try { boot(); } catch (e) { document.title = "V5ERR: " + (e && e.message); } }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", safeBoot);
  else safeBoot();
  window.CHV5 = { coach: () => { localStorage.removeItem("ch_coach_v5"); coach(); } };
})();

/* شاحنتي / Chahina — v2 features: حجز فوري، طلبات الناقل، أماكن محفوظة، توثيق، تمهيد */
(function () {
  const H = window.CH;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const T = (k, a) => H.T(k, a);
  const api = (p, o) => H.api(p, o);
  const money = (v) => H.money(v);
  const esc = (v) => H.esc(v);

  /* ---------------- helpers ---------------- */
  function km(a, b) {
    const R = 6371, r = (d) => (d * Math.PI) / 180;
    const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(x)) * 10) / 10;
  }

  async function places() {
    try { return (await api("/places")).places; } catch { return []; }
  }

  function placeOptions(list, id) {
    return `<select class="place-pick" data-target="${id}">
      <option value="">${T("saved_places")}…</option>
      ${list.map((p) => `<option value="${p.lat},${p.lng}|${esc(p.address)}">${esc(p.label)}</option>`).join("")}
    </select>`;
  }

  /* ---------------- instant booking ---------------- */
  async function openBooking(carrierId, name) {
    const savedPlaces = await places();
    const types = H.state.types || [];
    H.openModal(
      `⚡ ${T("book_now")} — ${esc(name || "")}`,
      `<form id="form-book" class="form-grid">
        <div class="book-head"><span class="meta">${T("book_hint")}</span></div>
        <label>${T("pickup")}
          <div class="pick-row"><input name="pickup_label" required placeholder="${T("pickup_ph")}"><button type="button" class="btn ghost small" data-pick="pickup">🗺️</button></div>
        </label>
        ${savedPlaces.length ? placeOptions(savedPlaces, "pickup") : ""}
        <label>${T("dropoff")}
          <div class="pick-row"><input name="dropoff_label" required placeholder="${T("dropoff_ph")}"><button type="button" class="btn ghost small" data-pick="dropoff">🗺️</button></div>
        </label>
        ${savedPlaces.length ? placeOptions(savedPlaces, "dropoff") : ""}
        <div class="pricing-row">
          <label>${T("cargo")}<input name="cargo" required placeholder="${T("cargo_ph")}"></label>
          <label>${T("weight")}<input name="weight_tons" type="number" min="0.1" step="0.1" value="1" required></label>
        </div>
        <label>${T("notes")}<input name="notes" placeholder="${T("notes_ph")}"></label>
        <div id="book-quote" class="quote-box">${T("quote_pending")}</div>
        <button class="btn primary block" type="submit">⚡ ${T("send_booking")}</button>
        <p class="tip">${T("book_tip")}</p>
      </form>`
    );

    const coords = { pickup: null, dropoff: null };
    const form = $("#form-book");

    $$("#form-book .place-pick").forEach((sel) => (sel.onchange = () => {
      if (!sel.value) return;
      const [ll, addr] = sel.value.split("|");
      const [lat, lng] = ll.split(",").map(Number);
      coords[sel.dataset.target] = { lat, lng };
      form[sel.dataset.target + "_label"].value = addr;
      quote();
    }));

    $$("#form-book [data-pick]").forEach((btn) => (btn.onclick = async () => {
      const which = btn.dataset.pick;
      const typed = form[which + "_label"].value.trim();
      let start = null;
      if (typed) start = await H.geocode(typed).catch(() => null);
      const p = await H.pickOnMap(start || coords[which] || H.state.me);
      if (!p) return;
      coords[which] = { lat: p.lat, lng: p.lng };
      if (p.label && !typed) form[which + "_label"].value = p.label;
      quote();
    }));

    async function quote() {
      const box = $("#book-quote");
      if (!coords.pickup || !coords.dropoff) { box.textContent = T("quote_pending"); return; }
      const d = km(coords.pickup, coords.dropoff);
      box.innerHTML = `<div class="row"><span>${T("distance")}</span><b>${d} ${T("km")}</b></div><div class="meta">${T("calculating")}</div>`;
      try {
        const q = await api(`/quote?km=${d}&weight_tons=${form.weight_tons.value || 0}`);
        const mine = q.carriers.find((c) => c.carrier_id === carrierId);
        box.innerHTML =
          `<div class="row"><span>${T("distance")}</span><b>${d} ${T("km")}</b></div>` +
          (mine ? `<div class="row"><span>${T("price_this_carrier")}</span><b class="price-tag">${money(mine.price)}</b></div>` : "") +
          (q.cheapest != null ? `<div class="row"><span>${T("cheapest_market")}</span><b>${money(q.cheapest)}</b></div>` : "") +
          (q.average != null ? `<div class="row meta"><span>${T("avg_market")}</span><span>${money(q.average)}</span></div>` : "") +
          (mine && q.cheapest != null && mine.price > q.cheapest
            ? `<div class="warn">${T("cheaper_available")}</div>` : "");
      } catch (e) { box.textContent = e.message; }
    }
    form.weight_tons.oninput = () => { clearTimeout(quote._t); quote._t = setTimeout(quote, 400); };

    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!coords.pickup || !coords.dropoff) return H.toast(T("pick_points_first"));
      const f = Object.fromEntries(new FormData(form));
      const btn = form.querySelector("button[type=submit]");
      btn.disabled = true;
      try {
        const r = await api("/book", {
          method: "POST",
          body: {
            carrier_id: carrierId,
            pickup_label: f.pickup_label, pickup_lat: coords.pickup.lat, pickup_lng: coords.pickup.lng,
            dropoff_label: f.dropoff_label, dropoff_lat: coords.dropoff.lat, dropoff_lng: coords.dropoff.lng,
            cargo: f.cargo, weight_tons: f.weight_tons, notes: f.notes,
          },
        });
        H.closeModal();
        H.toast(T("booking_sent") + " — " + money(r.price));
        H.loadShipments();
      } catch (err) { H.toast(err.message); btn.disabled = false; }
    };
  }

  /* ---------------- carrier: pending direct requests ---------------- */
  async function loadRequests() {
    const host = $("#carrier-requests");
    if (!host || H.state.user?.role !== "carrier") return;
    let requests = [];
    try { requests = (await api("/requests")).requests; } catch { return; }
    host.innerHTML = requests.length
      ? `<div class="panel-head"><b>⚡ ${T("direct_requests")}</b><span class="badge cheap">${requests.length}</span></div>` +
        requests
          .map(
            (r) => `<div class="item req">
              <div class="row"><b>${esc(r.cargo)}</b><b class="price-tag">${money(r.agreed_price)}</b></div>
              <div class="meta">${esc(r.pickup_label)} → ${esc(r.dropoff_label)}</div>
              <div class="meta">${r.weight_tons} ${T("ton")} • ${r.distance_km} ${T("km")}</div>
              <div class="card-actions">
                <button class="btn primary small" data-req-yes="${r.id}">✅ ${T("accept_request")}</button>
                <button class="btn ghost small" data-req-no="${r.id}">${T("decline_request")}</button>
              </div>
            </div>`
          )
          .join("")
      : "";
    $$("#carrier-requests [data-req-yes]").forEach((b) => (b.onclick = () => respond(b.dataset.reqYes, true)));
    $$("#carrier-requests [data-req-no]").forEach((b) => (b.onclick = () => respond(b.dataset.reqNo, false)));
  }

  async function respond(id, accept) {
    try {
      await api(`/shipments/${id}/respond`, { method: "POST", body: { accept } });
      H.toast(accept ? T("request_accepted") : T("request_declined"));
      loadRequests();
      H.loadShipments();
    } catch (e) { H.toast(e.message); }
  }

  /* ---------------- saved places manager ---------------- */
  async function openPlaces() {
    const list = await places();
    H.openModal(
      "📍 " + T("saved_places"),
      `<div id="places-list">${
        list.length
          ? list
              .map(
                (p) => `<div class="item"><div class="row"><b>${esc(p.label)}</b>
                  <button class="btn ghost small" data-del-place="${p.id}">🗑️</button></div>
                  <div class="meta">${esc(p.address)}</div></div>`
              )
              .join("")
          : `<p class="hint">${T("no_places")}</p>`
      }</div>
      <form id="form-place" class="form-grid">
        <label>${T("place_label")}<input name="label" required placeholder="${T("place_label_ph")}"></label>
        <label>${T("address")}<div class="pick-row"><input name="address" required><button type="button" class="btn ghost small" id="place-pick">🗺️</button></div></label>
        <button class="btn primary" type="submit">${T("save")}</button>
      </form>`
    );
    let c = null;
    $("#place-pick").onclick = async () => {
      const typed = $("#form-place [name=address]").value.trim();
      const start = typed ? await H.geocode(typed).catch(() => null) : null;
      const p = await H.pickOnMap(start || H.state.me);
      if (!p) return;
      c = { lat: p.lat, lng: p.lng };
      if (p.label && !typed) $("#form-place [name=address]").value = p.label;
      H.toast(T("point_selected"));
    };
    $$("#modal-body [data-del-place]").forEach((b) => (b.onclick = async () => {
      await api("/places/" + b.dataset.delPlace, { method: "DELETE" });
      openPlaces();
    }));
    $("#form-place").onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      if (!c) {
        const g = await H.geocode(f.address).catch(() => null);
        if (!g) return H.toast(T("pick_points_first"));
        c = g;
      }
      try {
        await api("/places", { method: "POST", body: { ...f, ...c } });
        H.toast(T("saved"));
        openPlaces();
      } catch (err) { H.toast(err.message); }
    };
  }

  /* ---------------- verification ---------------- */
  async function openVerify() {
    H.openModal(
      "✔ " + T("verify_account"),
      `<p class="hint">${T("verify_hint")}</p>
       <div id="verify-pick" class="photo-pick">
         <div class="truck-thumb avatar ph">🪪</div>
         <button type="button" class="btn ghost small">${T("upload_doc")}</button>
         <input type="file" accept="image/*">
       </div>
       <button id="verify-send" class="btn primary block" disabled>${T("send")}</button>`
    );
    let doc = null;
    H.wirePhotoPicker("#verify-pick", (d) => { doc = d; $("#verify-send").disabled = !d; });
    $("#verify-send").onclick = async () => {
      try {
        await api("/verify", { method: "POST", body: { doc } });
        H.closeModal();
        H.toast(T("verify_sent"));
      } catch (e) { H.toast(e.message); }
    };
  }

  /* ---------------- onboarding (first launch) ---------------- */
  function onboarding() {
    if (localStorage.getItem("ch_onboarded")) return;
    const slides = [
      { icon: "🚚", t: "ob1_t", s: "ob1_s" },
      { icon: "💰", t: "ob2_t", s: "ob2_s" },
      { icon: "💬", t: "ob3_t", s: "ob3_s" },
    ];
    const wrap = document.createElement("div");
    wrap.className = "onboard";
    wrap.innerHTML = `<div class="onboard-card">
      ${slides.map((s, i) => `<div class="ob-slide ${i ? "hidden" : ""}" data-i="${i}">
        <div class="ob-icon">${s.icon}</div><h3>${T(s.t)}</h3><p>${T(s.s)}</p></div>`).join("")}
      <div class="ob-dots">${slides.map((_, i) => `<i class="${i ? "" : "on"}"></i>`).join("")}</div>
      <button class="btn primary block" id="ob-next">${T("next")}</button>
      <button class="btn ghost small block" id="ob-skip">${T("skip")}</button>
    </div>`;
    document.body.appendChild(wrap);
    let i = 0;
    const show = () => {
      $$(".ob-slide", wrap).forEach((el) => el.classList.toggle("hidden", +el.dataset.i !== i));
      $$(".ob-dots i", wrap).forEach((el, n) => el.classList.toggle("on", n === i));
      $("#ob-next", wrap).textContent = i === slides.length - 1 ? T("start_now") : T("next");
    };
    $("#ob-next", wrap).onclick = () => {
      if (i === slides.length - 1) return done();
      i++; show();
    };
    $("#ob-skip", wrap).onclick = done;
    function done() { localStorage.setItem("ch_onboarded", "1"); wrap.remove(); }
  }

  /* ---------------- extra filters ---------------- */
  function wireFilters() {
    const host = $("#filters-advanced");
    if (!host) return;
    const run = () => {
      clearTimeout(run._t);
      run._t = setTimeout(() => H.refreshTrucks(), 350);
    };
    host.querySelectorAll("input,select").forEach((el) => {
      el.oninput = run;
      el.onchange = run;
    });
    $("#btn-filters-toggle").onclick = () => host.classList.toggle("hidden");
  }

  /* ---------------- boot ---------------- */
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-book]");
    if (b) { e.stopPropagation(); openBooking(+b.dataset.book, b.dataset.bookname); }
  });

  // onboarding runs on first launch, even before login
  setTimeout(onboarding, 900);

  const started = setInterval(() => {
    if (!H.state.user) return;
    clearInterval(started);
    wireFilters();
    if (H.state.user.role === "carrier") {
      loadRequests();
      setInterval(loadRequests, 30000);
    }
    const pl = $("#btn-places");
    if (pl) pl.onclick = openPlaces;
    const vf = $("#btn-verify");
    if (vf) vf.onclick = openVerify;
  }, 400);

  window.CHV2 = { openBooking, loadRequests, openPlaces, openVerify };
})();

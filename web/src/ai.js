/**
 * المساعد الذكي — Chahina smart assistant.
 *
 * Works fully offline (no external LLM required): it understands a free-text
 * shipping request in Arabic / French / English, resolves the two places with
 * OpenStreetMap geocoding (cached in SQLite), computes the distance and returns
 * a real quote built from live carrier tariffs in the database.
 *
 * If AI_API_KEY is set in .env, the same endpoint additionally rewrites the
 * answer with an LLM for a more natural tone (optional upgrade, never required).
 */
const https = require("https");
const db = require("./db");
const { TRUCK_TYPES } = require("./i18n");
const llm = require("./llm");

// ---------- geocoding (OSM Nominatim + local cache) ----------
db.exec(`CREATE TABLE IF NOT EXISTS geocache (
  q TEXT PRIMARY KEY, lat REAL, lng REAL, label TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "chahina-app/2.2", ...headers }, timeout: 8000 }, (res) => {
      let buf = "";
      res.on("data", (d) => (buf += d));
      res.on("end", () => resolve(buf));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

async function geocode(query) {
  const q = String(query || "").trim();
  if (q.length < 2) return null;
  const key = q.toLowerCase();
  const hit = db.prepare("SELECT * FROM geocache WHERE q=?").get(key);
  if (hit) return hit.lat == null ? null : { lat: hit.lat, lng: hit.lng, label: hit.label };
  let out = null;
  try {
    const url =
      "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=dz&accept-language=ar&q=" +
      encodeURIComponent(q);
    const arr = JSON.parse(await httpGet(url));
    if (Array.isArray(arr) && arr[0]) {
      out = { lat: Number(arr[0].lat), lng: Number(arr[0].lon), label: String(arr[0].display_name).split(",")[0] };
    }
  } catch (_) {
    return null; // network issue: do not cache a negative result
  }
  db.prepare("INSERT OR REPLACE INTO geocache (q, lat, lng, label) VALUES (?,?,?,?)").run(
    key,
    out ? out.lat : null,
    out ? out.lng : null,
    out ? out.label : null
  );
  return out;
}

// ---------- language + parsing ----------
function detectLang(text) {
  if (/[\u0600-\u06FF]/.test(text)) return "ar";
  if (/\b(de|vers|camion|prix|combien|je veux|transport)\b/i.test(text)) return "fr";
  return "en";
}

const FROM_TO = [
  /من\s+(.+?)\s+(?:إلى|الى|ل|نحو)\s+([^\d,،.]+)/i,
  /\bde\s+(.+?)\s+(?:à|a|vers|jusqu'?à)\s+([^\d,.]+)/i,
  /\bfrom\s+(.+?)\s+to\s+([^\d,.]+)/i,
];

function cleanPlace(s) {
  return String(s || "")
    .replace(/\b(wilaya|ولاية|مدينة|ville|city)\b/gi, "")
    .replace(/[«»"'`]/g, "")
    .trim()
    .slice(0, 60);
}

function parseWeight(text) {
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*(?:طن|طنا|tonnes?|tons?|t\b)/i);
  if (m) return Number(m[1].replace(",", "."));
  const kg = text.match(/(\d{2,5})\s*(?:كلغ|كغ|kg|kilos?)/i);
  if (kg) return Number(kg[1]) / 1000;
  return null;
}

function parseKm(text) {
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*(?:كم|كيلو|km)\b/i);
  return m ? Number(m[1].replace(",", ".")) : null;
}

const TYPE_HINTS = {
  refrigerated: /مبرد|فريقو|frigo|refriger|cold/i,
  tanker: /صهريج|citerne|tanker/i,
  tipper: /قلاب|benne|tipper|رمل|حصى|gravier/i,
  car_carrier: /نقل سيارات|porte-voiture|car carrier|سيارة/i,
  moving: /أثاث|اثاث|déménag|demenag|moving|furniture/i,
  large: /كبيرة|semi|remorque|large|30 طن|25 طن/i,
  small: /صغيرة|petit|small|3\.5/i,
};

function parseTruckType(text) {
  for (const [key, re] of Object.entries(TYPE_HINTS)) if (re.test(text)) return key;
  return null;
}

function intentOf(text) {
  if (/سعر|كم يكلف|تكلفة|بشحال|prix|combien|co[uû]t|price|cost|quote/i.test(text)) return "quote";
  if (/شاحنة|ناقل|camion|transporteur|truck|carrier/i.test(text) && /(أقرب|رخيص|أحسن|meilleur|moins cher|best|cheap)/i.test(text))
    return "quote";
  if (/تسعير|كم أضع|أنافس|combien facturer|tarif|pricing|per km|بالكم نحط/i.test(text)) return "pricing_advice";
  if (/كيف|شنو|comment|how|aide|help|مساعدة/i.test(text)) return "help";
  if (FROM_TO.some((re) => re.test(text))) return "quote";
  return "help";
}

// ---------- knowledge base for the help intent ----------
const HELP = {
  ar: [
    ["كيف أطلب شاحنة", "افتح «الخريطة»، قارن الأسعار (الأرخص أولاً)، ثم اضغط «احجز الآن» على الشاحنة التي تناسبك."],
    ["كيف أدفع", "اتفق مع الناقل داخل الدردشة، والدفع يتم عند التسليم أو إلكترونياً عبر Chargily حسب الاتفاق."],
    ["كيف أصبح ناقلاً", "سجّل كـ«صاحب شاحنة»، أضف صور شاحنتك وسعرك لكل كيلومتر، ثم فعّل «متاح» لتظهر في الخريطة."],
    ["كيف أوثّق حسابي", "من «حسابي» ← «توثيق الحساب»، ارفع صورة البطاقة/الرخصة، والحسابات الموثقة تحصل على ثقة أكبر وطلبات أكثر."],
  ],
  fr: [
    ["Commander un camion", "Ouvrez « Carte », comparez les prix (le moins cher en premier), puis « Réserver »."],
    ["Paiement", "Convenez dans le chat : à la livraison ou en ligne via Chargily."],
    ["Devenir transporteur", "Inscrivez-vous comme transporteur, ajoutez photos + tarif au km, puis passez en « disponible »."],
    ["Vérification", "Profil → Vérifier le compte : les comptes vérifiés reçoivent plus de demandes."],
  ],
  en: [
    ["Book a truck", "Open “Map”, compare prices (cheapest first), then tap “Book now”."],
    ["Payment", "Agree in chat: cash on delivery or online via Chargily."],
    ["Become a carrier", "Register as a carrier, add photos + price per km, then switch to “available”."],
    ["Verification", "Profile → Verify account. Verified accounts get more requests."],
  ],
};

// ---------- main entry ----------
function fmt(n) {
  return new Intl.NumberFormat("fr-FR").format(Math.round(n));
}

function haversineKm(a, b, c, d) {
  const R = 6371,
    dLat = ((c - a) * Math.PI) / 180,
    dLng = ((d - b) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 + Math.cos((a * Math.PI) / 180) * Math.cos((c * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/**
 * @param {object} opts { text, user, quote } where quote(km, weight, type) -> quote payload
 */
async function ask({ text, user, quote, history }) {
  const raw = String(text || "").slice(0, 500);
  let lang = detectLang(raw);
  let intent = user && user.role === "carrier" && /سعر|prix|price/i.test(raw) ? "pricing_advice" : intentOf(raw);
  let weight = parseWeight(raw);
  let type = parseTruckType(raw);
  let llmFrom = null, llmTo = null, llmKm = null;

  // real LLM understanding (falls back silently to the rule engine)
  if (llm.enabled()) {
    try {
      const x = await llm.extract(raw);
      if (x) {
        if (x.lang && ["ar", "fr", "en"].includes(x.lang)) lang = x.lang;
        if (x.intent && ["quote", "help", "pricing_advice", "smalltalk"].includes(x.intent)) {
          intent = x.intent === "smalltalk" ? "help" : x.intent;
          // pricing advice is a carrier-only feature; shippers always get a quote
          if (intent === "pricing_advice" && !(user && user.role === "carrier")) intent = "quote";
        }
        if (user && user.role === "carrier" && /تسعير|بالكم|combien facturer|tarif|pricing/i.test(raw)) intent = "pricing_advice";
        if (x.weight_tons && !weight) weight = Number(x.weight_tons) || null;
        if (x.km) llmKm = Number(x.km) || null;
        llmFrom = x.from || null;
        llmTo = x.to || null;
      }
    } catch (e) {
      /* keep rule-based result */
    }
  }

  if (intent === "pricing_advice") return pricingAdvice({ lang, user, type });

  if (intent === "quote") {
    let km = parseKm(raw) || llmKm;
    let from = llmFrom;
    let to = llmTo;
    for (const re of FROM_TO) {
      if (from && to) break;
      const m = raw.match(re);
      if (m) {
        from = cleanPlace(m[1]);
        to = cleanPlace(m[2]);
        break;
      }
    }
    if (km == null && from && to) {
      const [a, b] = await Promise.all([geocode(from), geocode(to)]);
      if (a && b) {
        km = Math.round(haversineKm(a.lat, a.lng, b.lat, b.lng) * 1.25); // road factor
        from = a.label || from;
        to = b.label || to;
      }
    }
    if (km == null) {
      return {
        lang,
        reply: {
          ar: "قل لي المسار من فضلك، مثال: «من غرداية إلى الجزائر العاصمة 3 طن» أو أعطني المسافة بالكيلومتر.",
          fr: "Donnez-moi le trajet, ex. « de Ghardaïa à Alger 3 tonnes », ou la distance en km.",
          en: "Tell me the route, e.g. “from Ghardaia to Algiers 3 tons”, or the distance in km.",
        }[lang],
        chips: true,
      };
    }
    const q = quote(km, weight || 0, type);
    const top = (q.carriers || []).slice(0, 3);
    const kmw = { ar: "كم", fr: "km", en: "km" }[lang];
    const route = from && to ? `${from} ← ${to}` : `${km} ${kmw}`;
    const head = {
      ar: `📍 ${route} ≈ **${km} كم**${weight ? ` • ${weight} طن` : ""}`,
      fr: `📍 ${route} ≈ **${km} km**${weight ? ` • ${weight} t` : ""}`,
      en: `📍 ${route} ≈ **${km} km**${weight ? ` • ${weight} t` : ""}`,
    }[lang];
    // market range: prefer real carrier prices, fall back to the formula
    const ps = (q.carriers || []).map((c) => c.price).sort((a, b) => a - b);
    const median = ps.length ? ps[Math.floor(ps.length / 2)] : null;
    const market = median
      ? { min: Math.round((median * 0.85) / 100) * 100, suggested: median, max: Math.round((median * 1.15) / 100) * 100 }
      : q.market;
    const body = top.length
      ? {
          ar: `أرخص عرض متاح الآن: **${fmt(q.cheapest)} دج** • متوسط العروض ${fmt(q.average)} دج\nالسعر العادل في السوق يتراوح بين ${fmt(market.min)} و ${fmt(market.max)} دج.`,
          fr: `Meilleure offre : **${fmt(q.cheapest)} DA** • moyenne ${fmt(q.average)} DA\nPrix marché : ${fmt(market.min)} – ${fmt(market.max)} DA.`,
          en: `Cheapest offer: **${fmt(q.cheapest)} DZD** • average ${fmt(q.average)} DZD\nMarket range: ${fmt(market.min)} – ${fmt(market.max)} DZD.`,
        }[lang]
      : {
          ar: `لا يوجد ناقل مسجّل بهذه المواصفات الآن. السعر العادل المتوقع: **${fmt(market.suggested)} دج** (بين ${fmt(market.min)} و ${fmt(market.max)}). انشر طلبك وسيصلك عرض.`,
          fr: `Aucun transporteur correspondant pour l’instant. Prix juste estimé : **${fmt(market.suggested)} DA**. Publiez la demande.`,
          en: `No matching carrier right now. Fair price estimate: **${fmt(market.suggested)} DZD**. Post your request.`,
        }[lang];
    return { lang, reply: `${head}\n${body}`, km, weight, truck_type: type, carriers: top, quote: q };
  }

  if (llm.enabled()) {
    try {
      const txt = await llm.answer({ text: raw, lang, role: user && user.role, context: null });
      if (txt && txt.length > 3) return { lang, reply: txt, chips: true };
    } catch (e) {
      /* fall through to canned help */
    }
  }

  const list = HELP[lang].map(([q, a]) => `**${q}؟**\n${a}`.replace("؟", lang === "ar" ? "؟" : "")).join("\n\n");
  return {
    lang,
    reply:
      {
        ar: "أنا مساعدك داخل التطبيق. اسألني عن السعر، أو اكتب مسارك مباشرة:\n\n",
        fr: "Je suis votre assistant. Demandez un prix ou écrivez votre trajet :\n\n",
        en: "I'm your in-app assistant. Ask for a price or type your route:\n\n",
      }[lang] + list,
    chips: true,
  };
}

/** Carrier-side advice: how to price to win more customers. */
function pricingAdvice({ lang, user, type }) {
  const mine = db.prepare("SELECT * FROM trucks WHERE user_id=?").get(user?.id || 0);
  const rows = db
    .prepare("SELECT base_price, base_km, truck_type FROM trucks WHERE base_price IS NOT NULL AND base_km > 0")
    .all()
    .filter((r) => (type || (mine && mine.truck_type) ? r.truck_type === (type || mine.truck_type) : true))
    .map((r) => r.base_price / r.base_km)
    .sort((a, b) => a - b);
  if (!rows.length) {
    return {
      lang,
      reply: {
        ar: "لا توجد بعد أسعار كافية في السوق للمقارنة. ابدأ بسعر بين 80 و 120 دج/كم للشاحنات الصغيرة.",
        fr: "Pas encore assez de tarifs pour comparer. Commencez entre 80 et 120 DA/km.",
        en: "Not enough market data yet. Start between 80 and 120 DZD/km.",
      }[lang],
    };
  }
  const median = rows[Math.floor(rows.length / 2)];
  const cheapest = rows[0];
  const mineRate = mine && mine.base_price && mine.base_km ? mine.base_price / mine.base_km : null;
  const target = Math.round((median * 0.92) / 5) * 5;
  const pos =
    mineRate == null
      ? ""
      : {
          ar: `\nسعرك الحالي: **${fmt(mineRate)} دج/كم** — ${mineRate <= median ? "أنت تحت متوسط السوق ✅ فرصك جيدة." : "أنت فوق متوسط السوق ⚠️ قد تخسر زبائن."}`,
          fr: `\nVotre tarif : **${fmt(mineRate)} DA/km** — ${mineRate <= median ? "sous la médiane ✅" : "au-dessus de la médiane ⚠️"}`,
          en: `\nYour rate: **${fmt(mineRate)} DZD/km** — ${mineRate <= median ? "below median ✅" : "above median ⚠️"}`,
        }[lang];
  return {
    lang,
    reply:
      {
        ar: `📊 تحليل السوق (${rows.length} شاحنة):\nالأرخص **${fmt(cheapest)} دج/كم** • الوسيط **${fmt(median)} دج/كم**${pos}\n\n💡 اقتراحي: ضع **${fmt(target)} دج/كم** — أقل بقليل من الوسيط لتظهر في أعلى نتائج البحث دون خسارة هامش الربح.`,
        fr: `📊 Marché (${rows.length} camions) : min **${fmt(cheapest)} DA/km** • médiane **${fmt(median)} DA/km**${pos}\n\n💡 Conseil : **${fmt(target)} DA/km**.`,
        en: `📊 Market (${rows.length} trucks): min **${fmt(cheapest)} DZD/km** • median **${fmt(median)} DZD/km**${pos}\n\n💡 Suggestion: **${fmt(target)} DZD/km**.`,
      }[lang] || "",
    suggest_per_km: target,
  };
}

module.exports = { ask, geocode, TRUCK_TYPES };

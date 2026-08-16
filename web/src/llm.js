/* llm.js — real LLM backend (NVIDIA NIM, OpenAI-compatible).
   Key comes from env only (NVIDIA_API_KEY); never commit keys. */
const https = require("https");

const HOST = process.env.LLM_HOST || "integrate.api.nvidia.com";
const PATH = process.env.LLM_PATH || "/v1/chat/completions";
const MODEL = process.env.LLM_MODEL || "meta/llama-3.3-70b-instruct";
const KEY = process.env.NVIDIA_API_KEY || process.env.LLM_API_KEY || "";

const enabled = () => !!KEY;

function post(body, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      {
        host: HOST,
        path: PATH,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Content-Length": Buffer.byteLength(data),
          Authorization: `Bearer ${KEY}`,
        },
        timeout: timeoutMs,
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try {
            const j = JSON.parse(buf);
            if (j.error) return reject(new Error(j.error.message || "llm error"));
            resolve(j);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("llm timeout")));
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function chat(messages, opts = {}) {
  if (!enabled()) throw new Error("llm disabled");
  const j = await post(
    {
      model: opts.model || MODEL,
      messages,
      temperature: opts.temperature != null ? opts.temperature : 0.3,
      top_p: 0.9,
      max_tokens: opts.max_tokens || 400,
    },
    opts.timeoutMs
  );
  const c = j.choices && j.choices[0] && j.choices[0].message;
  return (c && c.content ? String(c.content) : "").trim();
}

/* Extract a structured shipping request from free text. Returns null on failure. */
async function extract(text) {
  const sys =
    "You parse freight requests for an Algerian truck-booking app. " +
    'Answer with ONE JSON object only, no prose: {"intent":"quote|help|pricing_advice|smalltalk","from":string|null,"to":string|null,"km":number|null,"weight_tons":number|null,"truck_type":"small|medium|large|refrigerated|flatbed|tank|null","lang":"ar|fr|en"}. ' +
    "from/to are Algerian place names in their original script. km only if the user gave a distance. lang = language of the user message.";
  const out = await chat(
    [
      { role: "system", content: sys },
      { role: "user", content: String(text).slice(0, 500) },
    ],
    { temperature: 0, max_tokens: 200, timeoutMs: 15000 }
  );
  const m = out.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch (e) {
    return null;
  }
}

const APP_FACTS = `التطبيق اسمه "شاحنتي" (Chahina) في الجزائر: صاحب السلعة يقارن أسعار الشاحنات القريبة (صور الشاحنة، السعر لكل كيلومتر، التقييمات) ويختار الأرخص، ثم يحجز ويدردش مع صاحب الشاحنة داخل التطبيق.
الحقائق: التسجيل مجاني بالهاتف؛ الحجز من زر "احجز الآن" على بطاقة الشاحنة؛ الدفع نقداً أو إلكترونياً عبر Chargily؛ الدردشة من تبويب "الرسائل"؛ صاحب الشاحنة يضع صور شاحنته وسعره لكل كم من "حسابي"؛ التقييم بعد انتهاء الشحنة؛ التوثيق يرفع الثقة ويجلب زبائن أكثر؛ الأسعار بالدينار الجزائري.`;

/* Free-form answer about the app (help/smalltalk), in the user's language. */
async function answer({ text, lang, role, context }) {
  const langName = { ar: "العربية", fr: "français", en: "English" }[lang] || "العربية";
  const sys =
    `أنت "المساعد الذكي" داخل تطبيق شاحنتي. ${APP_FACTS}\n` +
    `المستخدم دوره: ${role === "carrier" ? "صاحب شاحنة" : "صاحب سلعة"}.\n` +
    `أجب بلغة المستخدم (${langName}) بأسلوب بسيط ومباشر، جملتين إلى أربع جمل كحد أقصى، بدون قوائم طويلة وبدون اختراع ميزات غير موجودة. ` +
    `إن سأل عن سعر رحلة اطلب منه المسار (من أين إلى أين) والحمولة. لا تخترع كلمات ولا ميزات، واستعمل لغة سليمة وواضحة.`;
  const msgs = [{ role: "system", content: sys }];
  if (context) msgs.push({ role: "system", content: "معطيات حقيقية من التطبيق: " + context });
  msgs.push({ role: "user", content: String(text).slice(0, 500) });
  return chat(msgs, { temperature: 0.4, max_tokens: 300, timeoutMs: 20000 });
}

module.exports = { chat, extract, answer, enabled };

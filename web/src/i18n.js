/** Server-side messages in ar / fr / en. */
const M = {
  login_required: {
    ar: "مطلوب تسجيل الدخول",
    fr: "Connexion requise",
    en: "Login required",
  },
  account_missing: { ar: "الحساب غير موجود", fr: "Compte introuvable", en: "Account not found" },
  session_expired: {
    ar: "جلسة منتهية، سجّل الدخول من جديد",
    fr: "Session expirée, reconnectez-vous",
    en: "Session expired, please log in again",
  },
  forbidden_role: { ar: "غير مصرّح لهذا الدور", fr: "Non autorisé pour ce rôle", en: "Not allowed for this role" },
  forbidden: { ar: "غير مصرّح", fr: "Non autorisé", en: "Not authorized" },
  register_fields: {
    ar: "الاسم ورقم الهاتف وكلمة المرور والدور مطلوبة",
    fr: "Nom, téléphone, mot de passe et rôle sont requis",
    en: "Name, phone, password and role are required",
  },
  bad_role: { ar: "الدور غير صحيح", fr: "Rôle invalide", en: "Invalid role" },
  short_password: {
    ar: "كلمة المرور يجب أن تكون 6 أحرف على الأقل",
    fr: "Le mot de passe doit contenir au moins 6 caractères",
    en: "Password must be at least 6 characters",
  },
  phone_taken: { ar: "رقم الهاتف مسجّل مسبقاً", fr: "Ce numéro est déjà inscrit", en: "Phone already registered" },
  bad_credentials: {
    ar: "رقم الهاتف أو كلمة المرور غير صحيحة",
    fr: "Numéro ou mot de passe incorrect",
    en: "Wrong phone or password",
  },
  truck_fields: {
    ar: "نوع الشاحنة والحمولة مطلوبان",
    fr: "Type de camion et capacité requis",
    en: "Truck type and capacity are required",
  },
  coords_required: { ar: "الإحداثيات مطلوبة", fr: "Coordonnées requises", en: "Coordinates required" },
  register_truck_first: {
    ar: "سجّل بيانات شاحنتك أولاً",
    fr: "Enregistrez d'abord votre camion",
    en: "Register your truck first",
  },
  shipment_missing: { ar: "الشحنة غير موجودة", fr: "Expédition introuvable", en: "Shipment not found" },
  shipment_closed: { ar: "الشحنة لم تعد متاحة", fr: "Expédition non disponible", en: "Shipment no longer available" },
  bad_price: { ar: "أدخل سعراً صحيحاً", fr: "Entrez un prix valide", en: "Enter a valid price" },
  offer_missing: { ar: "العرض غير موجود", fr: "Offre introuvable", en: "Offer not found" },
  carrier_chosen: { ar: "تم اختيار ناقل بالفعل", fr: "Un transporteur a déjà été choisi", en: "A carrier was already chosen" },
  cannot_cancel: {
    ar: "لا يمكن إلغاء شحنة مسلّمة",
    fr: "Impossible d'annuler une expédition livrée",
    en: "Cannot cancel a delivered shipment",
  },
  bad_transition: { ar: "انتقال حالة غير صحيح", fr: "Transition de statut invalide", en: "Invalid status transition" },
  rate_after_delivery: {
    ar: "التقييم متاح بعد التسليم فقط",
    fr: "L'évaluation n'est possible qu'après livraison",
    en: "Rating is only available after delivery",
  },
  bad_stars: { ar: "التقييم من 1 إلى 5", fr: "Note entre 1 et 5", en: "Rating must be 1 to 5" },
  not_found: { ar: "غير موجود", fr: "Introuvable", en: "Not found" },
  field_required: { ar: "الحقل %s مطلوب", fr: "Le champ %s est requis", en: "Field %s is required" },
  pay_not_configured: {
    ar: "الدفع الإلكتروني غير مفعّل على هذا الخادم",
    fr: "Le paiement en ligne n'est pas activé sur ce serveur",
    en: "Online payment is not enabled on this server",
  },
  pay_needs_agreement: {
    ar: "الدفع متاح بعد الاتفاق على السعر",
    fr: "Le paiement est disponible après accord sur le prix",
    en: "Payment is available after a price is agreed",
  },
  already_paid: { ar: "تم الدفع مسبقاً", fr: "Déjà payé", en: "Already paid" },
  pay_failed: {
    ar: "تعذّر إنشاء عملية الدفع، حاول لاحقاً",
    fr: "Impossible de créer le paiement, réessayez",
    en: "Could not create the payment, try again",
  },
  // notification texts
  n_new_offer: {
    ar: "عرض سعر جديد على شحنتك",
    fr: "Nouvelle offre de prix sur votre expédition",
    en: "New price offer on your shipment",
  },
  n_offer_accepted: { ar: "تم قبول عرضك!", fr: "Votre offre a été acceptée !", en: "Your offer was accepted!" },
  n_status: { ar: "تحديث حالة الشحنة", fr: "Mise à jour du statut", en: "Shipment status updated" },
  n_paid: { ar: "تم استلام الدفع", fr: "Paiement reçu", en: "Payment received" },
  bad_image: { ar: "صورة غير صالحة", fr: "Image invalide", en: "Invalid image" },
  empty_message: { ar: "الرسالة فارغة", fr: "Message vide", en: "Empty message" },
  n_new_message: { ar: "رسالة جديدة", fr: "Nouveau message", en: "New message" },
  n_new_shipment: {
    ar: "طلب نقل جديد قريب منك",
    fr: "Nouvelle demande de transport près de vous",
    en: "New shipment request near you",
  },
};

const LANGS = ["ar", "fr", "en"];

function pickLang(req) {
  const q = (req.query && req.query.lang) || req.headers["x-lang"];
  if (LANGS.includes(q)) return q;
  const al = String(req.headers["accept-language"] || "").toLowerCase();
  for (const l of LANGS) if (al.includes(l)) return l;
  return "ar";
}

function t(key, lang = "ar", arg) {
  const entry = M[key];
  const s = entry ? entry[LANGS.includes(lang) ? lang : "ar"] : key;
  return arg !== undefined ? s.replace("%s", arg) : s;
}

/** Truck types are stored as stable keys; labels live in the three languages. */
const TRUCK_TYPES = [
  { key: "small", ar: "شاحنة صغيرة", fr: "Petit camion", en: "Small truck", tons: 3 },
  { key: "medium", ar: "شاحنة متوسطة", fr: "Camion moyen", en: "Medium truck", tons: 10 },
  { key: "large", ar: "شاحنة كبيرة", fr: "Gros camion", en: "Large truck", tons: 25 },
  { key: "refrigerated", ar: "مبردة", fr: "Frigorifique", en: "Refrigerated", tons: 15 },
  { key: "tanker", ar: "صهريج", fr: "Citerne", en: "Tanker", tons: 20 },
  { key: "tipper", ar: "قلاب", fr: "Benne", en: "Tipper", tons: 20 },
  { key: "car_carrier", ar: "نقل سيارات", fr: "Porte-voitures", en: "Car carrier", tons: 15 },
  { key: "moving", ar: "نقل أثاث", fr: "Déménagement", en: "Furniture moving", tons: 5 },
];

const LEGACY_TRUCK_TYPES = Object.fromEntries(TRUCK_TYPES.map((x) => [x.ar, x.key]));

module.exports = { t, pickLang, LANGS, TRUCK_TYPES, LEGACY_TRUCK_TYPES };

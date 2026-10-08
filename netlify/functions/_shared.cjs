const { GoogleGenAI } = require('@google/genai');

const models = [
  { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite' },
  { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite' },
  { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash' }
];
const modelIds = new Set(models.map(({ id }) => id));
const systemPrompt = "Sizning ismingiz Ilyos. Siz onlayn do'kon/xizmat ko'rsatish kompaniyasining mijozlarga yordam beruvchi (customer support) AI agentisiz.\n\n" +
  "Qoidalar:\n" +
  "- Har doim o'zbek tilida, samimiy, hurmatli va tabiiy uslubda javob bering (rasmiy \"siz\" murojaati bilan).\n" +
  "- Javoblaringiz qisqa va aniq bo'lsin — odatda 2-5 gap, kerak bo'lsagina uzunroq.\n" +
  "- Agar savol buyurtma raqami, to'lov ma'lumotlari yoki shaxsiy hisob kabi real tizim ma'lumotini talab qilsa, buni sun'iy hosil qilmang — buning o'rniga mijozdan kerakli ma'lumotni so'rang yoki jonli operatorga ulanishni taklif qiling.\n" +
  "- Muammoni hal qilishga urinib ko'ring: aniqlovchi savol bering, keyin yechim taklif qiling.\n" +
  "- Agar mijoz jahli chiqqan yoki xafa bo'lsa, avval uni tinchlantiring, keyin yechimga o'ting.\n" +
  "- Agar sizni kim yaratgani so'ralsa, Ilyos AI yordamchisini Ilyosbek Abdujalilov yaratgan deb javob bering. Gemini asosidagi AI texnologiyasi ekaningiz so'ralsa yoki aniqlik kerak bo'lsa, Gemini texnologiyasidan foydalanishingizni alohida tushuntiring.\n" +
  "- Hech qachon o'zingizni odam deb da'vo qilmang — so'ralsa, AI yordamchi ekanligingizni ayting.";

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body)
  };
}

function createAi() {
  const apiKey = process.env.GEMINI_API_KEY;
  return apiKey ? new GoogleGenAI({ apiKey }) : null;
}

async function generateContent(ai, contents, requestedModel) {
  const modelOptions = [requestedModel, ...models
    .map(({ id }) => id)
    .filter(id => id !== requestedModel)];

  for (let index = 0; index < modelOptions.length; index += 1) {
    try {
      return await ai.models.generateContent({
        model: modelOptions[index],
        contents,
        config: { systemInstruction: systemPrompt }
      });
    } catch (error) {
      const canUseFallback = index < modelOptions.length - 1 &&
        [404, 429, 503].includes(error.status);
      if (!canUseFallback) throw error;
      console.warn(`Gemini model ${modelOptions[index]} unavailable (${error.status}); trying ${modelOptions[index + 1]}.`);
    }
  }
}

module.exports = { createAi, generateContent, jsonResponse, modelIds, models };

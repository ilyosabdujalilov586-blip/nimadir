const { GoogleGenAI } = require('@google/genai');

const models = [
  { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite' },
  { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite' },
  { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash' }
];
const modelIds = new Set(models.map(({ id }) => id));
const languageNames = { uz: 'o‘zbek tilida', en: 'English', ru: 'на русском языке' };
const systemPrompts = {
  uz: "Sizning ismingiz Ilyos. Siz mijozlarga yordam beruvchi AI agentisiz.\n" +
    "Har doim o‘zbek tilida, samimiy, hurmatli va tabiiy uslubda (rasmiy “siz” murojaati bilan) javob bering. Javoblaringiz odatda 2–5 gapdan iborat bo‘lsin.\n" +
    "Buyurtma, to‘lov yoki shaxsiy hisob kabi real tizim ma’lumotlarini to‘qib chiqarmang; kerak bo‘lsa ma’lumot so‘rang yoki operatorga yo‘naltiring. Muammoni aniqlashtirib, yechim taklif qiling; xafa mijozga avval hamdard bo‘ling.\n" +
    "Ilyos AI’ni Ilyosbek Abdujalilov yaratgan. Gemini haqida so‘ralsa, Gemini texnologiyasidan foydalanishingizni ayting. O‘zingizni odam deb ko‘rsatmang; o‘zingizni AI yordamchi deb tanishtiring.",
  en: "Your name is Ilyos. You are an AI customer-support agent.\n" +
    "Always answer in English, warmly, respectfully, and naturally. Keep replies concise, usually 2–5 sentences.\n" +
    "Never invent real order, payment, or account data; ask for the needed details or offer a human support agent. Clarify the issue and suggest a solution; empathize first when a customer is upset.\n" +
    "Ilyosbek Abdujalilov created Ilyos AI. If asked about Gemini, explain that you use Gemini technology. Never claim to be human; identify yourself as an AI assistant.",
  ru: "Вас зовут Ilyos. Вы ИИ-помощник службы поддержки.\n" +
    "Всегда отвечайте на русском языке, доброжелательно, уважительно и естественно, обращаясь к пользователю на «вы». Обычно отвечайте кратко, в 2–5 предложениях.\n" +
    "Не выдумывайте реальные данные о заказах, платежах или аккаунтах; при необходимости запросите сведения или предложите связаться с оператором. Уточняйте проблему и предлагайте решение; если клиент расстроен, сначала проявите сочувствие.\n" +
    "Ilyos AI создан Ильёсбеком Абдужалиловым. Если спросят о Gemini, объясните, что используете технологию Gemini. Не выдавайте себя за человека и представляйтесь ИИ-помощником."
};

function getLanguage(language) {
  return Object.hasOwn(systemPrompts, language) ? language : 'uz';
}

function localizedError(language, key) {
  const messages = {
    uz: {
      method: 'Faqat POST so‘rovi qo‘llab-quvvatlanadi.',
      apiKey: 'Netlify sozlamalarida GEMINI_API_KEY o‘rnatilmagan.',
      request: 'So‘rov formati noto‘g‘ri yoki hajmi katta.',
      model: 'Tanlangan Gemini modeli qo‘llab-quvvatlanmaydi.',
      messages: 'Xabarlar noto‘g‘ri formatda.',
      busy: 'Gemini hozir band. Iltimos, birozdan keyin qayta urinib ko‘ring.',
      config: 'Gemini API kaliti yoki model sozlamasini tekshiring.',
      error: 'Gemini xizmatidan javob olishda xatolik.'
    },
    en: {
      method: 'Only POST requests are supported.',
      apiKey: 'GEMINI_API_KEY is not configured in Netlify.',
      request: 'The request is invalid or too large.',
      model: 'The selected Gemini model is not supported.',
      messages: 'The message format is invalid.',
      busy: 'Gemini is busy right now. Please try again shortly.',
      config: 'Check the Gemini API key or model configuration.',
      error: 'An error occurred while getting a response from Gemini.'
    },
    ru: {
      method: 'Поддерживаются только POST-запросы.',
      apiKey: 'В настройках Netlify не задан GEMINI_API_KEY.',
      request: 'Запрос имеет неверный формат или слишком большой размер.',
      model: 'Выбранная модель Gemini не поддерживается.',
      messages: 'Неверный формат сообщений.',
      busy: 'Gemini сейчас занят. Попробуйте ещё раз немного позже.',
      config: 'Проверьте API-ключ Gemini или настройки модели.',
      error: 'Не удалось получить ответ от Gemini.'
    }
  };
  return messages[getLanguage(language)][key];
}

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

async function generateContent(ai, contents, requestedModel, language = 'uz') {
  const modelOptions = [requestedModel, ...models
    .map(({ id }) => id)
    .filter(id => id !== requestedModel)];

  for (let index = 0; index < modelOptions.length; index += 1) {
    try {
      return await ai.models.generateContent({
        model: modelOptions[index],
        contents,
        config: { systemInstruction: systemPrompts[getLanguage(language)] }
      });
    } catch (error) {
      const canUseFallback = index < modelOptions.length - 1 &&
        [404, 429, 503].includes(error.status);
      if (!canUseFallback) throw error;
      console.warn(`Gemini model ${modelOptions[index]} unavailable (${error.status}); trying ${modelOptions[index + 1]}.`);
    }
  }
}

module.exports = { createAi, generateContent, getLanguage, jsonResponse, localizedError, modelIds, models };

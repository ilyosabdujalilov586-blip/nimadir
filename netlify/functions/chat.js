const { createAi, generateContent, getLanguage, jsonResponse, localizedError, modelIds } = require('./_shared.cjs');

const defaultModel = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';

exports.handler = async event => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Faqat POST so‘rovi qo‘llab-quvvatlanadi.' });
  }

  const ai = createAi();
  if (!ai) {
    return jsonResponse(503, { error: 'Netlify sozlamalarida GEMINI_API_KEY o‘rnatilmagan.' });
  }

  let body;
  try {
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf8')
      : event.body || '';
    if (Buffer.byteLength(rawBody, 'utf8') > 32_768) {
      return jsonResponse(400, { error: 'So‘rov formati noto‘g‘ri yoki hajmi katta.' });
    }
    body = JSON.parse(rawBody);
  } catch {
    return jsonResponse(400, { error: 'So‘rov formati noto‘g‘ri yoki hajmi katta.' });
  }

  const messages = body?.messages;
  const requestedModel = body?.model || defaultModel;
  const language = getLanguage(body?.language);
  if (typeof requestedModel !== 'string' || !modelIds.has(requestedModel)) {
    return jsonResponse(400, { error: localizedError(language, 'model') });
  }
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 30 ||
      messages.some(message =>
        !message || !['user', 'model'].includes(message.role) ||
        typeof message.text !== 'string' || message.text.length < 1 || message.text.length > 5000
      ) || messages[messages.length - 1].role !== 'user') {
    return jsonResponse(400, { error: localizedError(language, 'messages') });
  }

  try {
    const contents = messages.map(({ role, text }) => ({ role, parts: [{ text }] }));
    const result = await generateContent(ai, contents, requestedModel, language);
    if (!result.text) throw new Error('Gemini returned an empty response');
    return jsonResponse(200, { text: result.text });
  } catch (error) {
    console.error('Gemini request failed:', error);
    const status = [429, 503].includes(error.status) ? 503 : 502;
    const message = status === 503
      ? localizedError(language, 'busy')
      : [400, 401, 403].includes(error.status)
        ? localizedError(language, 'config')
        : localizedError(language, 'error');
    return jsonResponse(status, { error: message });
  }
};

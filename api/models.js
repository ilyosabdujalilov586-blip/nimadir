const { createAi, jsonResponse, modelIds, models } = require('../netlify/functions/_shared.cjs');

const defaultModel = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';

module.exports = (request, response) => {
  if (request.method !== 'GET') {
    const result = jsonResponse(405, { error: 'Faqat GET so‘rovi qo‘llab-quvvatlanadi.' }, { Allow: 'GET' });
    response.statusCode = result.statusCode;
    Object.entries(result.headers).forEach(([name, value]) => response.setHeader(name, value));
    response.end(result.body);
    return;
  }

  const ready = Boolean(createAi());
  const result = jsonResponse(ready ? 200 : 503, {
    models,
    defaultModel: modelIds.has(defaultModel) ? defaultModel : models[0].id,
    error: ready ? undefined : 'Server sozlamalarida GEMINI_API_KEY o‘rnatilmagan.'
  }, { 'Cache-Control': 'no-store' });
  response.statusCode = result.statusCode;
  Object.entries(result.headers).forEach(([name, value]) => response.setHeader(name, value));
  response.end(result.body);
};

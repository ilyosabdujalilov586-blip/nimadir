const { createAi, jsonResponse, modelIds, models } = require('./_shared.cjs');

const defaultModel = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';

exports.handler = async event => {
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { error: 'Faqat GET so‘rovi qo‘llab-quvvatlanadi.' }, { Allow: 'GET' });
  }

  const ready = Boolean(createAi());
  return jsonResponse(ready ? 200 : 503, {
    models,
    defaultModel: modelIds.has(defaultModel) ? defaultModel : models[0].id,
    error: ready ? undefined : 'Server sozlamalarida GEMINI_API_KEY o‘rnatilmagan.'
  }, { 'Cache-Control': 'no-store' });
};

const { createAi, jsonResponse } = require('./_shared.cjs');

exports.handler = async event => {
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { error: 'Faqat GET so‘rovi qo‘llab-quvvatlanadi.' });
  }

  const ready = Boolean(createAi());
  return jsonResponse(ready ? 200 : 503, {
    ready,
    error: ready ? undefined : 'Netlify sozlamalarida GEMINI_API_KEY o‘rnatilmagan.'
  });
};

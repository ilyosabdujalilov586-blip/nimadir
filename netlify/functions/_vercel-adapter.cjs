module.exports = async function runNetlifyHandler(handler, request, response) {
  const headers = Object.fromEntries(
    Object.entries(request.headers || {}).map(([name, value]) => [
      name.toLowerCase(),
      Array.isArray(value) ? value.join(', ') : String(value || '')
    ])
  );
  const body = request.body === undefined
    ? ''
    : typeof request.body === 'string'
      ? request.body
      : JSON.stringify(request.body);

  try {
    const result = await handler({
      httpMethod: request.method,
      headers,
      body,
      isBase64Encoded: false
    });
    response.statusCode = result.statusCode || 500;
    Object.entries(result.headers || {}).forEach(([name, value]) => response.setHeader(name, value));
    response.end(result.body || '');
  } catch (error) {
    console.error('Vercel API function failed:', error);
    response.status(500).json({ error: 'internal_server_error' });
  }
};

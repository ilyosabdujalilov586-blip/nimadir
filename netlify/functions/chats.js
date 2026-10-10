const { jsonResponse } = require('./_shared.cjs');
const { chatKey, getChats, parseBody, readSession, validateChats } = require('./_account-store.cjs');

exports.handler = async event => {
  if (!['GET', 'PUT'].includes(event.httpMethod)) {
    return jsonResponse(405, { error: 'method_not_allowed' }, { Allow: 'GET, PUT' });
  }

  let session;
  try {
    session = await readSession(event);
  } catch (error) {
    console.error('Chat session configuration failed:', error.code);
    return jsonResponse(503, { error: 'auth_not_configured' });
  }
  if (!session) return jsonResponse(401, { error: 'not_authenticated' }, { 'Cache-Control': 'no-store' });

  try {
    const store = getChats();
    const key = chatKey(session.email);
    if (event.httpMethod === 'GET') {
      const saved = await store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
      return jsonResponse(200, {
        chats: saved?.data || [],
        etag: saved?.etag || null
      }, { 'Cache-Control': 'no-store' });
    }

    let body;
    try {
      body = parseBody(event);
    } catch {
      return jsonResponse(400, { error: 'invalid_request' });
    }
    if (!validateChats(body?.chats)) return jsonResponse(400, { error: 'invalid_chats' });

    const current = await store.getMetadata(key, { consistency: 'strong' });
    const expectedEtag = event.headers?.['if-match'] || event.headers?.['If-Match'] || '';
    if ((current?.etag || '') !== expectedEtag) {
      return jsonResponse(409, { error: 'chat_conflict' });
    }

    const options = current?.etag
      ? { onlyIfMatch: current.etag }
      : { onlyIfNew: true };
    const result = await store.setJSON(key, body.chats, options);
    if (!result.modified) return jsonResponse(409, { error: 'chat_conflict' });

    return jsonResponse(200, { etag: result.etag }, { 'Cache-Control': 'no-store' });
  } catch (error) {
    console.error('Account chat storage failed:', error.message);
    return jsonResponse(503, { error: 'chat_storage_unavailable' });
  }
};

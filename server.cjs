const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { createAi, generateContent, getLanguage, localizedError, models } = require('./netlify/functions/_shared.cjs');

const root = __dirname;
require('dotenv').config({ path: path.join(root, '.env') });
const port = 5508;
const model = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const ai = createAi();
const modelIds = new Set(models.map(({ id }) => id));
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8'
};
const publicFiles = new Set([
  '/AI.html', '/aloqa.html', '/home.html', '/index.html', '/language.js',
  '/kutubxona.html', '/main.css', '/main.js', '/main-2.js', '/xizmatlar.html'
]);

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function setApiCorsHeaders(request, response) {
  const origin = request.headers.origin;
  if (!origin) return;

  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return;
  }

  // HTTP va HTTPS localhost/127.0.0.1 portlarini qo'llab-quvvatlash (Go Live uchun)
  if (!['http:', 'https:'].includes(parsedOrigin.protocol) ||
      !['localhost', '127.0.0.1'].includes(parsedOrigin.hostname)) return;

  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Vary', 'Origin');
}

async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 32_768) throw new Error('Request body is too large');
  }
  return JSON.parse(body);
}

async function handleChat(request, response) {
  if (!ai) {
    sendJson(response, 503, { error: 'Serverda GEMINI_API_KEY sozlanmagan.' });
    return;
  }

  let body;
  try {
    body = await readJson(request);
  } catch {
    sendJson(response, 400, { error: 'So‘rov formati noto‘g‘ri yoki hajmi katta.' });
    return;
  }

  const messages = body?.messages;
  const requestedModel = body?.model || model;
  const language = getLanguage(body?.language);
  if (typeof requestedModel !== 'string' || !modelIds.has(requestedModel)) {
    sendJson(response, 400, { error: localizedError(language, 'model') });
    return;
  }

  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 30 ||
      messages.some(message =>
        !message || !['user', 'model'].includes(message.role) ||
        typeof message.text !== 'string' || message.text.length < 1 || message.text.length > 5000
      ) || messages[messages.length - 1].role !== 'user') {
    sendJson(response, 400, { error: localizedError(language, 'messages') });
    return;
  }

  try {
    const contents = messages.map(({ role, text }) => ({ role, parts: [{ text }] }));
    const result = await generateContent(ai, contents, requestedModel, language);
    if (!result.text) throw new Error('Gemini returned an empty response');
    sendJson(response, 200, { text: result.text });
  } catch (error) {
    console.error('Gemini request failed:', error);
    const status = [429, 503].includes(error.status) ? 503 : 502;
    const message = status === 503
      ? localizedError(language, 'busy')
      : [400, 401, 403].includes(error.status)
        ? localizedError(language, 'config')
        : localizedError(language, 'error');
    sendJson(response, status, { error: message });
  }
}

createServer(async (request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  if (pathname.startsWith('/api/')) {
    setApiCorsHeaders(request, response);
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }
  }

  if (pathname === '/api/health' && request.method === 'GET') {
    sendJson(response, ai ? 200 : 503, {
      ready: Boolean(ai),
      error: ai ? undefined : 'Serverda GEMINI_API_KEY sozlanmagan.'
    });
    return;
  }
  if (pathname === '/api/models' && request.method === 'GET') {
    sendJson(response, ai ? 200 : 503, {
      models,
      defaultModel: modelIds.has(model) ? model : models[0].id,
      error: ai ? undefined : 'Serverda GEMINI_API_KEY sozlanmagan.'
    });
    return;
  }
  if (pathname === '/api/chat' && request.method === 'POST') {
    await handleChat(request, response);
    return;
  }
  if (pathname.startsWith('/api/')) {
    sendJson(response, 404, { error: 'API endpoint topilmadi.' });
    return;
  }
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405);
    response.end();
    return;
  }

  if (pathname === '/') {
    response.writeHead(302, { Location: '/AI.html' });
    response.end();
    return;
  }

  const requestedPath = pathname;
  if (!publicFiles.has(requestedPath)) {
    response.writeHead(404);
    response.end();
    return;
  }
  const filePath = path.join(root, requestedPath.slice(1));

  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream'
    });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    console.error('Static file read failed:', error);
    response.writeHead(500);
    response.end('Internal server error');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Ilyos server: http://127.0.0.1:${port}/AI.html`);
  if (!ai) console.warn('GEMINI_API_KEY sozlanmagan; .env fayliga yangi kalit kiriting.');
});

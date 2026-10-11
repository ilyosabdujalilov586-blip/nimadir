const runNetlifyHandler = require('../netlify/functions/_vercel-adapter.cjs');
const { handler } = require('../netlify/functions/chats.js');

module.exports = (request, response) => runNetlifyHandler(handler, request, response);

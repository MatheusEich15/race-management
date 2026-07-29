// ============================================================
// api/socketio.js — Vercel Serverless Function Proxy
// ============================================================
// Proxy transparente Vercel → Fly.io para o protocolo Engine.IO/Socket.IO
// (apenas long-polling). Runtime: Node.js Serverless Function (NÃO Edge).
// ============================================================

const BACKEND_URL = 'https://ultimate-drift-2d.fly.dev';

module.exports.config = {
  api: {
    bodyParser: false,
  },
};

module.exports = async (req, res) => {
  try {
    // Extrai a query string completa (EIO, transport, sid, t...)
    // usando URL parser para garantir preservação fiel
    const urlObj = new URL(req.url, 'http://localhost');
    const queryString = urlObj.search || '';
    const targetUrl = `${BACKEND_URL}/socket.io/${queryString}`;

    // Lê o body cru para requisições POST (handshake/mensagens Engine.IO)
    let body = null;
    if (req.method === 'POST') {
      const buffers = [];
      for await (const chunk of req) {
        buffers.push(chunk);
      }
      body = Buffer.concat(buffers);
    }

    // Copia headers removendo apenas o Host (fetch recalcula automaticamente)
    const headers = { ...req.headers };
    delete headers.host;

    // Proxy para o Fly.io
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: headers,
      body: body,
    });

    // Repassa headers de resposta (exceto content-encoding que pode conflitar)
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() !== 'content-encoding') {
        res.setHeader(key, value);
      }
    });

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    // Lê e repassa o body com Content-Length explícito
    const data = await response.arrayBuffer();
    res.setHeader('Content-Length', data.byteLength);
    res.status(response.status).send(Buffer.from(data));
  } catch (error) {
    console.error('Erro no Proxy Socket.IO:', error);
    res.status(500).json({ error: 'Proxy error', details: error.message });
  }
};

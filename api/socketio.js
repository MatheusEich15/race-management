// ============================================================
// api/socketio.js — Vercel Serverless Function Proxy
// ============================================================
// Proxy transparente Vercel → Fly.io para o protocolo Engine.IO/Socket.IO
// (apenas long-polling). Runtime: Node.js Serverless Function (NÃO Edge).
// Requer Node.js >= 18 no runtime da Vercel (fetch nativo).
// ============================================================

const FLY_BASE_URL = "https://ultimate-drift-2d.fly.dev";
const ALLOWED_ORIGIN = "https://race-management-lovat.vercel.app";

// Desativa o body-parser automático da Vercel: precisamos dos bytes
// crus do payload para não corromper o handshake do Engine.IO.
module.exports.config = {
  api: {
    bodyParser: false,
  },
};

// Headers "hop-by-hop" que nunca devem atravessar o proxy.
// "host" é o mais importante: se repassado, o Fly.io recebe o Host
// da Vercel em vez do seu próprio e pode rejeitar/rotear mal a
// requisição. A correção é remover, não substituir — o fetch()
// recalcula o Host corretamente a partir da targetUrl.
const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "keep-alive",
  "upgrade",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
]);

function buildForwardHeaders(reqHeaders) {
  const headers = {};
  for (const [key, value] of Object.entries(reqHeaders)) {
    if (value === undefined) continue;
    if (HOP_BY_HOP.has(key.toLowerCase())) continue;
    headers[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return headers;
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Fallback defensivo: se por algum motivo a Vercel já tiver
// populado req.body mesmo com bodyParser desativado, reaproveita em
// vez de tentar ler a stream de novo (o que travaria a requisição).
async function getRequestBody(req) {
  if (["GET", "HEAD"].includes(req.method)) return undefined;
  if (req.body !== undefined && req.body !== null && req.body !== "") {
    if (Buffer.isBuffer(req.body)) return req.body;
    if (typeof req.body === "string") return req.body;
    return JSON.stringify(req.body);
  }
  return readRawBody(req);
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || ALLOWED_ORIGIN;

  // Preflight CORS — defensivo. Em same-origin isso normalmente não
  // dispara, mas cobre testes locais/preview em domínio diferente.
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Cookie");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.status(204).end();
    return;
  }

  try {
    // 1. Extrai a query string ORIGINAL e completa (EIO, transport, sid, t...)
    const queryString = req.url.includes("?") ? req.url.split("?")[1] : "";

    // 2. Monta a URL de destino no Fly.io, path fixo /socket.io/ + query completa
    const targetUrl = `${FLY_BASE_URL}/socket.io/${queryString ? `?${queryString}` : ""}`;

    // 3. Corpo cru (necessário nos POSTs do handshake/mensagens Engine.IO)
    const body = await getRequestBody(req);

    // 4. Headers sem os hop-by-hop (Host incluso é removido aqui)
    const forwardHeaders = buildForwardHeaders(req.headers);

    // 5. Requisição upstream para o Fly.io
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: forwardHeaders,
      body,
    });

    // 6. Repassa headers de resposta (exceto hop-by-hop e set-cookie, tratado à parte)
    upstream.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (HOP_BY_HOP.has(lower) || lower === "set-cookie") return;
      res.setHeader(key, value);
    });

    // Set-Cookie precisa de tratamento especial: múltiplos cookies
    // não podem ser concatenados com vírgula (quebra o parsing no browser).
    if (typeof upstream.headers.getSetCookie === "function") {
      const cookies = upstream.headers.getSetCookie();
      if (cookies.length > 0) res.setHeader("set-cookie", cookies);
    }

    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");

    res.status(upstream.status);
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.end(buffer);
  } catch (err) {
    console.error("[socketio-proxy] falha ao contatar o Fly.io:", err);
    res.status(502).json({
      error: "Bad Gateway: proxy não conseguiu contatar o backend Fly.io",
      details: err.message,
    });
  }
};

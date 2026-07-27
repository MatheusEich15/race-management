// ============================================================
// api/socketio.js — Vercel Serverless Function Proxy
// ============================================================
// Proxies Socket.IO polling requests from Vercel edge to the
// Fly.io backend (ultimate-drift-2d.fly.dev).
// This bypasses corporate firewalls that block *.fly.dev directly.
//
// IMPORTANT: Uses CommonJS (module.exports) — NOT ESM export default.
// Vercel treats files as CommonJS unless package.json has "type":"module".
// ============================================================

const BACKEND_URL = 'https://ultimate-drift-2d.fly.dev';

// Vercel config: disable body parser so we can read the raw stream ourselves
module.exports.config = {
    api: {
        bodyParser: false,
        responseLimit: false,
    },
};

module.exports = async (req, res) => {
    // req.url arrives as "/api/socketio?EIO=4&transport=polling&..."
    // We need to forward it as "/socket.io/?EIO=4&transport=polling&..."
    const queryString = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const targetUrl = `${BACKEND_URL}/socket.io/${queryString}`;

    // ── CORS ─────────────────────────────────────────────────
    const origin = req.headers['origin'] || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    // Handle preflight
    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }

    try {
        // ── Read raw body for POST (Socket.IO polling data) ──
        let body = undefined;
        if (req.method === 'POST') {
            body = await new Promise((resolve, reject) => {
                const chunks = [];
                req.on('data', (chunk) => chunks.push(chunk));
                req.on('end', () => resolve(Buffer.concat(chunks)));
                req.on('error', reject);
            });
        }

        // ── Strip Vercel-specific / hop-by-hop headers ───────
        const skipHeaders = new Set([
            'host', 'connection', 'transfer-encoding', 'te',
            'trailers', 'keep-alive', 'upgrade', 'proxy-authorization',
            'proxy-connection', 'x-forwarded-for', 'x-forwarded-proto',
            'x-forwarded-host', 'x-vercel-id', 'x-vercel-deployment-url',
            'x-vercel-forwarded-for', 'x-real-ip',
        ]);

        const forwardHeaders = {};
        for (const [key, value] of Object.entries(req.headers)) {
            if (!skipHeaders.has(key.toLowerCase())) {
                forwardHeaders[key] = value;
            }
        }

        // ── Forward to Fly.io ─────────────────────────────────
        const response = await fetch(targetUrl, {
            method: req.method,
            headers: {
                ...forwardHeaders,
                host: 'ultimate-drift-2d.fly.dev',
                origin: 'https://ultimate-drift-2d.fly.dev',
            },
            body: body || undefined,
            redirect: 'manual',
        });

        // ── Relay response status ─────────────────────────────
        res.status(response.status);

        const skipResponseHeaders = new Set([
            'transfer-encoding', 'connection', 'keep-alive',
            'trailer', 'te', 'upgrade',
        ]);

        for (const [key, value] of response.headers.entries()) {
            if (!skipResponseHeaders.has(key.toLowerCase())) {
                res.setHeader(key, value);
            }
        }

        // ── Relay response body ───────────────────────────────
        const responseBody = await response.arrayBuffer();
        res.end(Buffer.from(responseBody));

    } catch (err) {
        console.error('[socketio-proxy] Error:', err.message);
        res.status(502).json({ error: 'Proxy error', message: err.message });
    }
};

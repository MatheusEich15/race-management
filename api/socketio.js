// ============================================================
// api/socketio.js — Vercel Serverless Function Proxy
// ============================================================
// Proxies Socket.IO polling requests from Vercel edge to the
// Fly.io backend (ultimate-drift-2d.fly.dev).
// This bypasses corporate firewalls that block *.fly.dev directly.
// ============================================================

const BACKEND_URL = 'https://ultimate-drift-2d.fly.dev';

export const config = {
    api: {
        // Disable Vercel's body parser so we can stream the raw body
        bodyParser: false,
        // Allow larger payloads for game state updates
        responseLimit: false,
    },
};

export default async function handler(req, res) {
    // Build the full target URL: /api/socketio → /socket.io/
    // e.g. GET /api/socketio?EIO=4&transport=polling → https://fly.dev/socket.io/?EIO=4&transport=polling
    const queryString = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const targetUrl = `${BACKEND_URL}/socket.io/${queryString}`;

    // Forward the relevant headers, stripping Vercel-specific ones
    const forwardHeaders = {};
    const skipHeaders = new Set([
        'host', 'connection', 'transfer-encoding', 'te',
        'trailers', 'keep-alive', 'upgrade', 'proxy-authorization',
        'proxy-connection', 'x-forwarded-for', 'x-forwarded-proto',
        'x-forwarded-host', 'x-vercel-id', 'x-vercel-deployment-url',
        'x-vercel-forwarded-for', 'x-real-ip',
    ]);

    for (const [key, value] of Object.entries(req.headers)) {
        if (!skipHeaders.has(key.toLowerCase())) {
            forwardHeaders[key] = value;
        }
    }

    // Add CORS headers so the browser accepts responses from Vercel domain
    const origin = req.headers['origin'] || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    // Handle preflight (OPTIONS)
    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }

    try {
        // Read the raw request body for POST requests (Socket.IO polling data)
        let body = undefined;
        if (req.method === 'POST') {
            body = await new Promise((resolve, reject) => {
                const chunks = [];
                req.on('data', (chunk) => chunks.push(chunk));
                req.on('end', () => resolve(Buffer.concat(chunks)));
                req.on('error', reject);
            });
        }

        // Proxy the request to the Fly.io backend
        const response = await fetch(targetUrl, {
            method: req.method,
            headers: {
                ...forwardHeaders,
                host: 'ultimate-drift-2d.fly.dev',
                origin: 'https://ultimate-drift-2d.fly.dev',
            },
            body: body || undefined,
            // Important: do NOT follow redirects automatically
            redirect: 'manual',
        });

        // Forward the response status and headers back to the client
        res.status(response.status);

        const responseHeadersToSkip = new Set([
            'transfer-encoding', 'connection', 'keep-alive',
            'trailer', 'te', 'upgrade',
        ]);

        for (const [key, value] of response.headers.entries()) {
            if (!responseHeadersToSkip.has(key.toLowerCase())) {
                res.setHeader(key, value);
            }
        }

        // Stream the response body back to the client
        const responseBody = await response.arrayBuffer();
        res.end(Buffer.from(responseBody));

    } catch (err) {
        console.error('[socketio-proxy] Error:', err.message);
        res.status(502).json({
            error: 'Proxy error',
            message: err.message,
        });
    }
}

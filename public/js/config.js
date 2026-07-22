// ============================================================
// config.js — Deployment configuration
// ============================================================
// When deploying frontend and server separately:
//   1. Deploy server.js on Render/Railway → get URL (e.g. https://ultimate-drift-xxx.onrender.com)
//   2. Set SERVER_URL below to that URL (use wss:// for HTTPS, ws:// for HTTP)
//   3. Deploy frontend on Vercel
//
// Leave empty ('') to auto-detect (works when frontend+server are on same host)
// ============================================================

export const SERVER_URL = 'wss://ultimate-drift-2d.fly.dev';
// Example: export const SERVER_URL = 'wss://ultimate-drift-xxx.onrender.com';

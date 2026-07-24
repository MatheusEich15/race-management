// ============================================================
// config.js — Deployment configuration
// ============================================================
// ARQUITETURA ATUAL (Rede Corporativa com Firewall):
//
//   Browser → Vercel (race-management-lovat.vercel.app)
//       └─ /socket.io/* → [Vercel Rewrite] → /api/socketio (Serverless Function)
//           └─ [Proxy HTTP] → https://ultimate-drift-2d.fly.dev/socket.io/*
//
// SERVER_URL deve ser '' (vazio) para que o Socket.IO use a mesma
// origem do Vercel. O rewrite do vercel.json encaminha /socket.io/*
// para a Serverless Function que faz o proxy para o Fly.io.
//
// Isso evita que o browser acesse *.fly.dev diretamente (bloqueado pelo firewall).
// ============================================================

export const SERVER_URL = '';
// Exemplo deploy direto (sem proxy): export const SERVER_URL = 'https://ultimate-drift-2d.fly.dev';

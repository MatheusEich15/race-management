// ============================================================
// server.js — Express + Socket.IO server (com Long-Polling Fallback)
// ============================================================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// ---- Socket.IO com suporte a Polling (Proxy Bypass) e WebSocket ----
const io = new Server(server, {
    cors: {
        // Aceita tanto o Vercel (prod) quanto localhost (dev)
        origin: [
            'https://race-management-lovat.vercel.app',
            'http://localhost:3000',
            'http://127.0.0.1:3000',
        ],
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: true,
    },
    transports: ['polling', 'websocket'], // Inicia em polling e faz upgrade se permitido
    allowEIO3: true, // Compatibilidade com clientes mais antigos
});

const PORT = process.env.PORT || 3000;

// ---- CORS (Express) ----
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// ---- No-cache headers ----
app.use((req, res, next) => {
    if (req.path.endsWith('.js')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
    next();
});

// ---- Serve static files ----
app.use(express.static(path.join(__dirname, 'public')));

// ---- Room Management ----
const rooms = new Map();
let nextPlayerId = 1;

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return rooms.has(code) ? generateRoomCode() : code;
}

function broadcastToRoom(room, msg, excludeSocket = null) {
    for (const player of room.players.values()) {
        if (player.socket !== excludeSocket && player.socket.connected) {
            player.socket.emit(msg.type, msg);
        }
    }
}

function removePlayerFromRoom(playerId) {
    for (const [code, room] of rooms) {
        if (room.players.has(playerId)) {
            const player = room.players.get(playerId);
            room.players.delete(playerId);

            broadcastToRoom(room, {
                type: 'player_left',
                slot: player.slot
            });

            // If room is empty, delete it
            if (room.players.size === 0) {
                rooms.delete(code);
                console.log(`Room ${code} deleted (empty)`);
            } else if (player.isHost) {
                // Transfer host to next player
                const newHost = room.players.values().next().value;
                if (newHost) {
                    newHost.isHost = true;
                    room.hostId = newHost.id;
                    broadcastToRoom(room, {
                        type: 'host_transferred',
                        slot: newHost.slot
                    });
                }
            }

            console.log(`Player ${player.name} left room ${code}`);
            return;
        }
    }
}

function getAvailableSlot(room) {
    const usedSlots = new Set();
    for (const p of room.players.values()) {
        usedSlots.add(p.slot);
    }
    for (let s = 0; s < 4; s++) {
        if (!usedSlots.has(s)) return s;
    }
    return -1;
}

function findPlayerRoom(playerId) {
    for (const room of rooms.values()) {
        if (room.players.has(playerId)) return room;
    }
    return null;
}

// ---- Socket.IO Handling ----
io.on('connection', (socket) => {
    const playerId = nextPlayerId++;
    socket._playerId = playerId;

    console.log(`Player connected: #${playerId} via ${socket.conn.transport.name}`);

    // Monitora upgrades de transporte (HTTP Polling -> WebSocket)
    socket.conn.on('upgrade', () => {
        console.log(`Player #${playerId} upgraded to ${socket.conn.transport.name}`);
    });

    // 1. Criar Sala
    socket.on('create_room', (msg = {}) => {
        removePlayerFromRoom(playerId);

        const code = generateRoomCode();
        const slot = 0;
        const room = {
            code,
            hostId: playerId,
            state: 'lobby',
            trackIdx: 0,
            botCount: 0,
            botDifficulty: 'medio',
            players: new Map(),
            finishedPlayers: new Set()
        };

        room.players.set(playerId, {
            id: playerId,
            socket,
            name: msg.playerName || 'Host',
            slot,
            isHost: true
        });

        rooms.set(code, room);

        socket.emit('room_created', {
            type: 'room_created',
            code,
            slot
        });

        console.log(`Room ${code} created by ${msg.playerName || 'Host'}`);
    });

    // 2. Entrar na Sala
    socket.on('join_room', (msg = {}) => {
        const code = msg.code?.toUpperCase();
        const room = rooms.get(code);

        if (!room) {
            socket.emit('error_msg', { type: 'error', message: 'Sala não encontrada' });
            return;
        }

        if (room.state !== 'lobby') {
            socket.emit('error_msg', { type: 'error', message: 'Race already started' });
            return;
        }

        if (room.players.size >= 4) {
            socket.emit('error_msg', { type: 'error', message: 'Sala cheia (máx 4 jogadores)' });
            return;
        }

        removePlayerFromRoom(playerId);

        const slot = getAvailableSlot(room);
        if (slot === -1) {
            socket.emit('error_msg', { type: 'error', message: 'Sem slots disponíveis' });
            return;
        }

        const playerName = msg.playerName || `Jogador ${slot + 1}`;

        room.players.set(playerId, {
            id: playerId,
            socket,
            name: playerName,
            slot,
            isHost: false
        });

        const playerList = [];
        for (const p of room.players.values()) {
            playerList.push({ name: p.name, slot: p.slot, isHost: p.isHost });
        }

        socket.emit('room_joined', {
            type: 'room_joined',
            code,
            slot,
            players: playerList
        });

        broadcastToRoom(room, {
            type: 'player_joined',
            name: playerName,
            slot
        }, socket);

        console.log(`${playerName} joined room ${code} as slot ${slot}`);
    });

    // 3. Sair da Sala
    socket.on('leave_room', () => {
        removePlayerFromRoom(playerId);
    });

    // 4. Configurações do Host
    socket.on('set_config', (msg = {}) => {
        const room = findPlayerRoom(playerId);
        if (!room || room.hostId !== playerId) return;

        if (msg.config) {
            if (msg.config.trackIdx !== undefined) room.trackIdx = msg.config.trackIdx;
            if (msg.config.botCount !== undefined) room.botCount = msg.config.botCount;
            if (msg.config.botDifficulty !== undefined) room.botDifficulty = msg.config.botDifficulty;

            broadcastToRoom(room, {
                type: 'config_updated',
                config: {
                    trackIdx: room.trackIdx,
                    botCount: room.botCount,
                    botDifficulty: room.botDifficulty
                }
            });
        }
    });

    // 5. Iniciar Corrida
    socket.on('start_game', () => {
        const room = findPlayerRoom(playerId);
        if (!room || room.hostId !== playerId) return;

        room.state = 'racing';

        const players = [];
        for (const p of room.players.values()) {
            players.push({ name: p.name, slot: p.slot, isHost: p.isHost });
        }

        broadcastToRoom(room, {
            type: 'game_starting',
            trackIdx: room.trackIdx,
            botCount: room.botCount,
            botDifficulty: room.botDifficulty,
            players
        });

        room.finishedPlayers = new Set();

        setTimeout(() => {
            if (rooms.has(room.code) && room.state === 'racing') {
                broadcastToRoom(room, { type: 'race_go' });
                console.log(`Room ${room.code}: race_go sent!`);
            }
        }, 4000);

        console.log(`Room ${room.code}: race starting (4s countdown)...`);
    });

    // 6. Atualização da Posição do Carro
    socket.on('car_update', (msg = {}) => {
        const room = findPlayerRoom(playerId);
        if (!room || room.state !== 'racing') return;

        const carStates = [];
        if (msg.car) carStates.push(msg.car);
        if (msg.bots) carStates.push(...msg.bots);

        broadcastToRoom(room, {
            type: 'game_state',
            cars: carStates
        }, socket);
    });

    // 7. Corrida Finalizada
    socket.on('race_finished', () => {
        const room = findPlayerRoom(playerId);
        if (!room) return;

        const player = room.players.get(playerId);
        if (!player) return;

        room.finishedPlayers.add(playerId);

        broadcastToRoom(room, {
            type: 'race_winner',
            slot: player.slot,
            name: player.name
        });

        console.log(`Room ${room.code}: ${player.name} finished! (${room.finishedPlayers.size}/${room.players.size})`);

        if (room.finishedPlayers.size >= room.players.size) {
            room.state = 'lobby';
            room.finishedPlayers = new Set();
            broadcastToRoom(room, { type: 'race_ended' });
            console.log(`Room ${room.code}: all finished, back to lobby`);
        } else {
            clearTimeout(room._raceEndTimeout);
            room._raceEndTimeout = setTimeout(() => {
                if (rooms.has(room.code) && room.state === 'racing') {
                    room.state = 'lobby';
                    room.finishedPlayers = new Set();
                    broadcastToRoom(room, { type: 'race_ended' });
                    console.log(`Room ${room.code}: timeout, back to lobby`);
                }
            }, 30000);
        }
    });

    // Desconexão
    socket.on('disconnect', () => {
        removePlayerFromRoom(playerId);
        console.log(`Player disconnected: #${playerId}`);
    });
});

// ---- Start Server ----
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🏎️  Ultimate Drift 2D Server (Socket.IO Ready)`);
    console.log(`   Local:   http://localhost:${PORT}`);
    console.log(`   Network: http://0.0.0.0:${PORT}`);
    console.log(`\n   Pronto para conexões corporativas/proxy!\n`);
});
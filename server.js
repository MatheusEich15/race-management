// ============================================================
// server.js — Express + WebSocket server for multiplayer rooms
// ============================================================

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

// ---- CORS (needed when frontend and server are on different domains) ----
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// ---- No-cache headers for JS files during development ----
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

function broadcastToRoom(room, msg, excludeWs = null) {
    const data = JSON.stringify(msg);
    for (const player of room.players.values()) {
        if (player.ws !== excludeWs && player.ws.readyState === 1) {
            player.ws.send(data);
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

// ---- WebSocket Handling ----
wss.on('connection', (ws) => {
    const playerId = nextPlayerId++;
    ws._playerId = playerId;

    console.log(`Player connected: #${playerId}`);

    ws.on('message', (raw) => {
        let msg;
        try {
            msg = JSON.parse(raw);
        } catch (e) {
            return;
        }

        switch (msg.type) {
            case 'create_room': {
                // Remove from any existing room
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
                    ws,
                    name: msg.playerName || 'Host',
                    slot,
                    isHost: true
                });

                rooms.set(code, room);

                ws.send(JSON.stringify({
                    type: 'room_created',
                    code,
                    slot
                }));

                console.log(`Room ${code} created by ${msg.playerName}`);
                break;
            }

            case 'join_room': {
                const code = msg.code?.toUpperCase();
                const room = rooms.get(code);

                if (!room) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Sala não encontrada' }));
                    return;
                }

                if (room.state !== 'lobby') {
                    ws.send(JSON.stringify({ type: 'error', message: 'Race already started' }));
                    return;
                }

                if (room.players.size >= 4) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Sala cheia (máx 4 jogadores)' }));
                    return;
                }

                // Remove from any existing room
                removePlayerFromRoom(playerId);

                const slot = getAvailableSlot(room);
                if (slot === -1) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Sem slots disponíveis' }));
                    return;
                }

                const playerName = msg.playerName || `Jogador ${slot + 1}`;

                room.players.set(playerId, {
                    id: playerId,
                    ws,
                    name: playerName,
                    slot,
                    isHost: false
                });

                // Send room info to the joining player
                const playerList = [];
                for (const p of room.players.values()) {
                    playerList.push({ name: p.name, slot: p.slot, isHost: p.isHost });
                }

                ws.send(JSON.stringify({
                    type: 'room_joined',
                    code,
                    slot,
                    players: playerList
                }));

                // Notify others
                broadcastToRoom(room, {
                    type: 'player_joined',
                    name: playerName,
                    slot
                }, ws);

                console.log(`${playerName} joined room ${code} as slot ${slot}`);
                break;
            }

            case 'leave_room': {
                removePlayerFromRoom(playerId);
                break;
            }

            case 'set_config': {
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
                break;
            }

            case 'start_game': {
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

                // Reset finished tracking
                room.finishedPlayers = new Set();

                // Synchronized start: send race_go after 4 seconds
                // All clients setup during this time, then start simultaneously
                setTimeout(() => {
                    if (rooms.has(room.code) && room.state === 'racing') {
                        broadcastToRoom(room, { type: 'race_go' });
                        console.log(`Room ${room.code}: race_go sent!`);
                    }
                }, 4000);

                console.log(`Room ${room.code}: race starting (4s countdown)...`);
                break;
            }

            case 'car_update': {
                const room = findPlayerRoom(playerId);
                if (!room || room.state !== 'racing') return;

                // Collect all car states and relay
                const carStates = [msg.car];
                if (msg.bots) carStates.push(...msg.bots);

                broadcastToRoom(room, {
                    type: 'game_state',
                    cars: carStates
                }, ws);
                break;
            }

            case 'race_finished': {
                const room = findPlayerRoom(playerId);
                if (!room) return;

                const player = room.players.get(playerId);
                if (!player) return;

                // Track finished player
                room.finishedPlayers.add(playerId);

                broadcastToRoom(room, {
                    type: 'race_winner',
                    slot: player.slot,
                    name: player.name
                });

                console.log(`Room ${room.code}: ${player.name} finished! (${room.finishedPlayers.size}/${room.players.size})`);

                // Check if all human players have finished
                if (room.finishedPlayers.size >= room.players.size) {
                    room.state = 'lobby';
                    room.finishedPlayers = new Set();
                    broadcastToRoom(room, { type: 'race_ended' });
                    console.log(`Room ${room.code}: all finished, back to lobby`);
                } else {
                    // Fallback: reset to lobby after 30s even if not all finished
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
                break;
            }
        }
    });

    ws.on('close', () => {
        removePlayerFromRoom(playerId);
        console.log(`Player disconnected: #${playerId}`);
    });

    ws.on('error', () => {
        removePlayerFromRoom(playerId);
    });
});

function findPlayerRoom(playerId) {
    for (const room of rooms.values()) {
        if (room.players.has(playerId)) return room;
    }
    return null;
}

// ---- Start Server ----
server.listen(PORT, () => {
    console.log(`\n🏎️  Ultimate Drift 2D Server`);
    console.log(`   Local:   http://localhost:${PORT}`);
    console.log(`   Network: http://<your-ip>:${PORT}`);
    console.log(`\n   Pronto para corridas!\n`);
});

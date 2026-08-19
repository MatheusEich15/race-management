import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Server } from 'socket.io';
import { DriftCar } from './public/js/car.js';
import { BotAI, BOT_CONFIGS } from './public/js/bot.js';
import { handleAllCollisions } from './public/js/physics.js';
import { TRACKS, precomputeBezierPath } from './public/js/tracks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_LAPS = 3;
const MAX_PLAYERS = 4;
const TICK_RATE = 60;
const SNAPSHOT_RATE = 30;
const TICK_MS = 1000 / TICK_RATE;
const SNAPSHOT_EVERY_TICKS = TICK_RATE / SNAPSHOT_RATE;
const COUNTDOWN_MS = 4000;
const RESULTS_TIMEOUT_MS = 20000;
const MAX_INPUT_QUEUE = 240;
const EMPTY_INPUT = Object.freeze({ up: false, down: false, left: false, right: false, nitro: false });

function sanitizeName(value, fallback) {
    const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
    return (name || fallback).slice(0, 20);
}

function sanitizeInput(value) {
    const input = value && typeof value === 'object' ? value : EMPTY_INPUT;
    return {
        up: input.up === true,
        down: input.down === true,
        left: input.left === true,
        right: input.right === true,
        nitro: input.nitro === true,
    };
}

function clampInteger(value, min, max, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export function createGameServer(options = {}) {
    const countdownMs = options.countdownMs ?? COUNTDOWN_MS;
    const resultsTimeoutMs = options.resultsTimeoutMs ?? RESULTS_TIMEOUT_MS;
    const app = express();
    const httpServer = http.createServer(app);
    const allowedOrigins = (process.env.CLIENT_ORIGINS || '')
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean);

    const io = new Server(httpServer, {
        cors: {
            origin: allowedOrigins.length > 0 ? allowedOrigins : true,
            methods: ['GET', 'POST'],
            credentials: true,
        },
        transports: ['websocket', 'polling'],
        pingInterval: 10000,
        pingTimeout: 10000,
        maxHttpBufferSize: 10_000,
    });

    const rooms = new Map();
    let nextPlayerId = 1;
    let previousLoopTime = performance.now();
    let accumulator = 0;

    app.disable('x-powered-by');
    app.get('/health', (_req, res) => {
        res.json({ status: 'ok', rooms: rooms.size, uptime: Math.floor(process.uptime()) });
    });
    app.use((req, res, next) => {
        if (req.path.endsWith('.js')) res.setHeader('Cache-Control', 'no-cache');
        next();
    });
    app.use(express.static(path.join(__dirname, 'public')));

    function generateRoomCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
        for (let attempt = 0; attempt < 1000; attempt++) {
            let code = '';
            for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
            if (!rooms.has(code)) return code;
        }
        throw new Error('Não foi possível gerar um código de sala único');
    }

    function playerList(room) {
        return [...room.players.values()]
            .sort((a, b) => a.slot - b.slot)
            .map(({ name, slot, isHost }) => ({ name, slot, isHost }));
    }

    function getAvailableSlot(room) {
        const used = new Set([...room.players.values()].map(player => player.slot));
        for (let slot = 0; slot < MAX_PLAYERS; slot++) if (!used.has(slot)) return slot;
        return -1;
    }

    function emitRoom(room, event, payload = {}) {
        io.to(room.code).emit(event, { type: event, ...payload });
    }

    function completeRace(room) {
        if (!room || !['countdown', 'racing'].includes(room.state)) return;
        const finishBySlot = new Set(room.finishOrder.map(entry => entry.slot));
        for (const participant of room.participants.values()) {
            if (!finishBySlot.has(participant.slot)) {
                room.finishOrder.push({
                    slot: participant.slot,
                    name: participant.name,
                    time: null,
                    color: participant.car.color,
                });
            }
        }
        room.state = 'lobby';
        room.startAt = 0;
        for (const player of room.players.values()) {
            player.input = EMPTY_INPUT;
            player.inputQueue = [];
        }
        emitRoom(room, 'race_complete', { results: room.finishOrder, players: playerList(room) });
    }

    function removePlayerFromRoom(socket) {
        const code = socket.data.roomCode;
        if (!code) return;
        const room = rooms.get(code);
        socket.data.roomCode = null;
        socket.leave(code);
        if (!room) return;
        const player = room.players.get(socket.data.playerId);
        if (!player) return;

        room.players.delete(player.id);
        room.participants.delete(player.slot);
        emitRoom(room, 'player_left', { slot: player.slot });

        if (room.players.size === 0) {
            rooms.delete(code);
            return;
        }
        if (player.isHost) {
            const newHost = [...room.players.values()].sort((a, b) => a.slot - b.slot)[0];
            newHost.isHost = true;
            room.hostId = newHost.id;
            emitRoom(room, 'host_transferred', { slot: newHost.slot, players: playerList(room) });
        }
        if (room.state === 'racing') {
            const allRemainingFinished = [...room.participants.keys()].every(slot => room.finishedSlots.has(slot));
            if (allRemainingFinished) completeRace(room);
        }
    }

    function initializeRace(room) {
        const track = TRACKS[room.trackIdx];
        room.cachedSegments = precomputeBezierPath(room.trackIdx);
        room.participants = new Map();
        room.botAIs = new Map();
        room.finishedSlots = new Set();
        room.finishOrder = [];
        room.firstFinishAt = 0;
        room.raceStartedAt = 0;
        room.tick = 0;

        for (const player of room.players.values()) {
            const car = new DriftCar(player.slot);
            const start = track.startPositions[player.slot];
            car.reset(start.x, start.y, track.startAngle);
            player.input = EMPTY_INPUT;
            player.inputQueue = [];
            player.lastReceivedInputSeq = 0;
            player.lastProcessedInputSeq = 0;
            room.participants.set(player.slot, { slot: player.slot, name: player.name, isBot: false, player, car });
        }

        const usedSlots = new Set(room.participants.keys());
        const botConfig = BOT_CONFIGS[room.botDifficulty] || BOT_CONFIGS.medio;
        let botsCreated = 0;
        for (let slot = 0; slot < MAX_PLAYERS && botsCreated < room.botCount; slot++) {
            if (usedSlots.has(slot)) continue;
            const car = new DriftCar(slot);
            const start = track.startPositions[slot];
            car.reset(start.x, start.y, track.startAngle);
            car.isBot = true;
            car.maxSpeed = botConfig.maxSpeed;
            const ai = new BotAI(room.botDifficulty);
            ai.findNearestNode(start.x, start.y, room.cachedSegments);
            room.botAIs.set(slot, ai);
            room.participants.set(slot, { slot, name: `BOT ${slot + 1}`, isBot: true, player: null, car });
            botsCreated++;
        }
    }

    function serializeRoom(room) {
        return {
            serverTime: Date.now(),
            tick: room.tick,
            cars: [...room.participants.values()].map(participant => ({
                ...participant.car.serialize(),
                inputSeq: participant.player?.lastProcessedInputSeq || 0,
                finishRank: room.finishOrder.findIndex(entry => entry.slot === participant.slot) + 1,
            })),
        };
    }

    function registerFinish(room, participant) {
        const { car, slot, name } = participant;
        if (!car.finished || room.finishedSlots.has(slot)) return;
        room.finishedSlots.add(slot);
        car.isGhost = true;
        const entry = {
            slot,
            name,
            time: Math.max(0, Date.now() - room.raceStartedAt),
            color: car.color,
        };
        room.finishOrder.push(entry);
        if (!room.firstFinishAt) room.firstFinishAt = Date.now();
        emitRoom(room, 'race_winner', { ...entry, rank: room.finishOrder.length });
    }

    function simulateRoom(room) {
        if (room.state === 'countdown') {
            if (Date.now() < room.startAt) return;
            room.state = 'racing';
            room.raceStartedAt = Date.now();
            emitRoom(room, 'race_go', { serverTime: room.raceStartedAt });
        }
        if (room.state !== 'racing') return;

        room.tick++;
        const trackData = {
            trackIdx: room.trackIdx,
            cachedSegments: room.cachedSegments,
            totalLaps: room.totalLaps,
            effects: false,
        };
        for (const participant of room.participants.values()) {
            if (participant.car.finished) continue;
            let input;
            if (participant.isBot) {
                input = room.botAIs.get(participant.slot).computeInput(participant.car, room.cachedSegments);
            } else {
                const command = participant.player.inputQueue.shift();
                if (command) {
                    participant.player.input = command.input;
                    participant.player.lastProcessedInputSeq = command.seq;
                }
                input = participant.player.input;
            }
            participant.car.update(input, trackData, [], []);
        }
        handleAllCollisions([...room.participants.values()].map(participant => participant.car));
        for (const participant of room.participants.values()) registerFinish(room, participant);

        if (room.tick % SNAPSHOT_EVERY_TICKS === 0) {
            io.to(room.code).volatile.emit('game_state', serializeRoom(room));
        }
        if (room.finishedSlots.size === room.participants.size) {
            completeRace(room);
        } else if (room.firstFinishAt && Date.now() - room.firstFinishAt >= resultsTimeoutMs) {
            completeRace(room);
        }
    }

    function simulationLoop() {
        const now = performance.now();
        accumulator += Math.min(now - previousLoopTime, 250);
        previousLoopTime = now;
        let steps = 0;
        while (accumulator >= TICK_MS && steps < 8) {
            for (const room of rooms.values()) simulateRoom(room);
            accumulator -= TICK_MS;
            steps++;
        }
    }

    const simulationTimer = setInterval(simulationLoop, Math.floor(TICK_MS));

    io.on('connection', socket => {
        const playerId = nextPlayerId++;
        socket.data.playerId = playerId;
        socket.data.roomCode = null;

        socket.on('create_room', (message = {}) => {
            removePlayerFromRoom(socket);
            const code = generateRoomCode();
            const player = {
                id: playerId,
                socket,
                name: sanitizeName(message.playerName, 'Host'),
                slot: 0,
                isHost: true,
                input: EMPTY_INPUT,
                inputQueue: [],
                lastReceivedInputSeq: 0,
                lastProcessedInputSeq: 0,
            };
            const room = {
                code,
                hostId: playerId,
                state: 'lobby',
                trackIdx: 0,
                botCount: 0,
                botDifficulty: 'medio',
                totalLaps: DEFAULT_LAPS,
                players: new Map([[playerId, player]]),
                participants: new Map(),
                botAIs: new Map(),
                finishOrder: [],
                finishedSlots: new Set(),
            };
            rooms.set(code, room);
            socket.join(code);
            socket.data.roomCode = code;
            socket.emit('room_created', { type: 'room_created', code, slot: 0, players: playerList(room) });
        });

        socket.on('join_room', (message = {}) => {
            const code = typeof message.code === 'string' ? message.code.trim().toUpperCase() : '';
            const room = rooms.get(code);
            if (!room) return socket.emit('error_msg', { message: 'Sala não encontrada' });
            if (room.state !== 'lobby') return socket.emit('error_msg', { message: 'A corrida já começou' });
            if (room.players.size >= MAX_PLAYERS) return socket.emit('error_msg', { message: 'Sala cheia (máx. 4 jogadores)' });
            removePlayerFromRoom(socket);
            const slot = getAvailableSlot(room);
            if (slot < 0) return socket.emit('error_msg', { message: 'Não há posições disponíveis' });
            const player = {
                id: playerId,
                socket,
                name: sanitizeName(message.playerName, `Jogador ${slot + 1}`),
                slot,
                isHost: false,
                input: EMPTY_INPUT,
                inputQueue: [],
                lastReceivedInputSeq: 0,
                lastProcessedInputSeq: 0,
            };
            room.players.set(playerId, player);
            socket.join(code);
            socket.data.roomCode = code;
            socket.emit('room_joined', { type: 'room_joined', code, slot, players: playerList(room) });
            socket.to(code).emit('player_joined', { type: 'player_joined', name: player.name, slot });
        });

        socket.on('leave_room', () => removePlayerFromRoom(socket));

        socket.on('set_config', (message = {}) => {
            const room = rooms.get(socket.data.roomCode);
            if (!room || room.state !== 'lobby' || room.hostId !== playerId) return;
            const config = message.config || {};
            room.trackIdx = clampInteger(config.trackIdx, 0, TRACKS.length - 1, room.trackIdx);
            room.botCount = clampInteger(config.botCount, 0, MAX_PLAYERS - room.players.size, room.botCount);
            if (Object.hasOwn(BOT_CONFIGS, config.botDifficulty)) room.botDifficulty = config.botDifficulty;
            emitRoom(room, 'config_updated', {
                config: {
                    trackIdx: room.trackIdx,
                    botCount: room.botCount,
                    botDifficulty: room.botDifficulty,
                    totalLaps: room.totalLaps,
                },
            });
        });

        socket.on('start_game', () => {
            const room = rooms.get(socket.data.roomCode);
            if (!room || room.state !== 'lobby' || room.hostId !== playerId) return;
            room.botCount = Math.min(room.botCount, MAX_PLAYERS - room.players.size);
            initializeRace(room);
            room.state = 'countdown';
            room.startAt = Date.now() + countdownMs;
            emitRoom(room, 'game_starting', {
                trackIdx: room.trackIdx,
                botCount: room.botCount,
                botDifficulty: room.botDifficulty,
                totalLaps: room.totalLaps,
                startAt: room.startAt,
                players: playerList(room),
                participants: [...room.participants.values()].map(({ slot, name, isBot }) => ({ slot, name, isBot })),
            });
        });

        socket.on('player_input', (message = {}) => {
            const room = rooms.get(socket.data.roomCode);
            if (!room || !['countdown', 'racing'].includes(room.state)) return;
            const player = room.players.get(playerId);
            if (!player) return;
            const seq = Number(message.seq);
            if (!Number.isSafeInteger(seq) || seq <= player.lastReceivedInputSeq) return;
            player.lastReceivedInputSeq = seq;
            player.inputQueue.push({ seq, input: sanitizeInput(message.input) });
            if (player.inputQueue.length > MAX_INPUT_QUEUE) player.inputQueue.shift();
        });

        socket.on('time_sync', (clientSentAt, callback) => {
            if (typeof callback === 'function') callback({ clientSentAt, serverTime: Date.now() });
        });

        socket.on('disconnect', () => removePlayerFromRoom(socket));
    });

    async function close() {
        clearInterval(simulationTimer);
        await new Promise(resolve => io.close(resolve));
        if (httpServer.listening) {
            await new Promise((resolve, reject) => httpServer.close(error => error ? reject(error) : resolve()));
        }
    }

    return { app, httpServer, io, rooms, close };
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
    const port = Number.parseInt(process.env.PORT, 10) || 3000;
    const { httpServer } = createGameServer();
    httpServer.listen(port, '0.0.0.0', () => {
        console.log(`Ultimate Drift 2D disponível em http://0.0.0.0:${port}`);
    });
}

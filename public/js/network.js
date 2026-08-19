// ============================================================
// network.js — Socket.IO client for online multiplayer
// ============================================================

import { SERVER_URL } from './config.js';

export class NetworkManager {
    constructor() {
        this.socket = null;
        this.connected = false;
        this.roomCode = null;
        this.mySlot = -1;
        this.isHost = false;
        this.inputSeq = 0;
        this.serverClockOffset = 0;
        this.clockSyncTimer = null;

        // Callbacks set by game.js
        this.onRoomCreated = null;   // (code, slot)
        this.onRoomJoined = null;    // (code, slot, players)
        this.onPlayerJoined = null;  // (name, slot)
        this.onPlayerLeft = null;    // (slot)
        this.onHostTransferred = null; // (slot, players)
        this.onConfigUpdated = null; // (config)
        this.onGameStarting = null;  // (config)
        this.onGameState = null;     // (carStates)
        this.onRaceWinner = null;    // (slot, name)
        this.onRaceEnded = null;     // ()
        this.onRaceComplete = null;  // (results, players)
        this.onRaceGo = null;        // ()
        this.onError = null;         // (message)
        this.onDisconnect = null;    // ()
    }

    /**
     * Returns true only if the Socket.IO client is actually connected.
     */
    get isConnected() {
        return this.socket !== null && this.socket.connected;
    }

    /**
     * Connect to the Socket.IO server.
     * Uses SERVER_URL from config.js if set, otherwise falls back to current domain.
     */
    connect() {
        return new Promise((resolve, reject) => {
            let url = SERVER_URL || window.location.origin;

            // Ajusta URLs legadas ws:// ou wss:// para http:// ou https:// se necessário
            if (url.startsWith('ws://')) url = url.replace('ws://', 'http://');
            if (url.startsWith('wss://')) url = url.replace('wss://', 'https://');

            try {
                this.socket = io(url, {
                    path: '/socket.io',
                    transports: ['websocket', 'polling'],
                    upgrade: true,
                    withCredentials: true,
                    reconnection: true,
                    reconnectionAttempts: Infinity,
                    reconnectionDelay: 1000,
                    timeout: 20000,
                });
            } catch (e) {
                reject(new Error('Falha ao conectar ao servidor'));
                return;
            }

            // Evento de Conexão Bem-Sucedida
            this.socket.on('connect', () => {
                this.connected = true;
                this.syncClock();
                clearInterval(this.clockSyncTimer);
                this.clockSyncTimer = setInterval(() => this.syncClock(), 5000);
                resolve();
            });

            // Erro de Conexão Inicial
            this.socket.on('connect_error', (err) => {
                console.warn('[NetworkManager] connect_error:', err.message);
                if (!this.connected) {
                    reject(new Error(`Erro de conexão: ${err.message}`));
                }
            });

            // Desconexão
            this.socket.on('disconnect', () => {
                this.connected = false;
                this.roomCode = null;
                clearInterval(this.clockSyncTimer);
                this.clockSyncTimer = null;
                if (this.onDisconnect) this.onDisconnect();
            });

            // ============================================================
            // Eventos vindos do Servidor (server.js)
            // ============================================================

            this.socket.on('room_created', (msg) => {
                this.roomCode = msg.code;
                this.mySlot = msg.slot;
                this.isHost = true;
                if (this.onRoomCreated) this.onRoomCreated(msg.code, msg.slot, msg.players);
            });

            this.socket.on('room_joined', (msg) => {
                this.roomCode = msg.code;
                this.mySlot = msg.slot;
                this.isHost = false;
                if (this.onRoomJoined) this.onRoomJoined(msg.code, msg.slot, msg.players);
            });

            this.socket.on('player_joined', (msg) => {
                if (this.onPlayerJoined) this.onPlayerJoined(msg.name, msg.slot);
            });

            this.socket.on('player_left', (msg) => {
                if (this.onPlayerLeft) this.onPlayerLeft(msg.slot);
            });

            this.socket.on('host_transferred', (msg) => {
                if (msg.slot === this.mySlot) {
                    this.isHost = true;
                }
                if (this.onHostTransferred) this.onHostTransferred(msg.slot, msg.players || []);
            });

            this.socket.on('config_updated', (msg) => {
                if (this.onConfigUpdated) this.onConfigUpdated(msg.config);
            });

            this.socket.on('game_starting', (msg) => {
                if (this.onGameStarting) this.onGameStarting(msg);
            });

            this.socket.on('game_state', (msg) => {
                if (this.onGameState) this.onGameState(msg.cars, msg);
            });

            this.socket.on('race_winner', (msg) => {
                if (this.onRaceWinner) this.onRaceWinner(msg);
            });

            this.socket.on('race_ended', () => {
                if (this.onRaceEnded) this.onRaceEnded();
            });

            this.socket.on('race_complete', (msg) => {
                if (this.onRaceComplete) this.onRaceComplete(msg.results || [], msg.players || []);
            });

            this.socket.on('race_go', () => {
                if (this.onRaceGo) this.onRaceGo();
            });

            this.socket.on('error_msg', (msg) => {
                if (this.onError) this.onError(msg.message);
            });
        });
    }

    // ============================================================
    // Envio de Eventos para o Servidor
    // ============================================================

    createRoom(playerName) {
        if (this.socket) this.socket.emit('create_room', { playerName });
    }

    joinRoom(code, playerName) {
        if (this.socket) this.socket.emit('join_room', { code: code.toUpperCase(), playerName });
    }

    leaveRoom() {
        if (this.socket) this.socket.emit('leave_room');
        this.roomCode = null;
        this.mySlot = -1;
        this.isHost = false;
    }

    setConfig(config) {
        if (this.socket) this.socket.emit('set_config', { config });
    }

    startGame() {
        if (this.socket) this.socket.emit('start_game');
    }

    sendInput(input) {
        if (!this.socket?.connected) return 0;
        this.inputSeq++;
        this.socket.volatile.emit('player_input', { seq: this.inputSeq, input });
        return this.inputSeq;
    }

    syncClock() {
        if (!this.socket?.connected) return;
        const clientSentAt = Date.now();
        this.socket.emit('time_sync', clientSentAt, response => {
            if (!response || response.clientSentAt !== clientSentAt) return;
            const clientReceivedAt = Date.now();
            const midpoint = (clientSentAt + clientReceivedAt) / 2;
            const sample = response.serverTime - midpoint;
            this.serverClockOffset = this.serverClockOffset === 0
                ? sample
                : this.serverClockOffset * 0.8 + sample * 0.2;
        });
    }

    snapshotAgeTicks(serverTime) {
        if (!Number.isFinite(serverTime)) return 0;
        const ageMs = Date.now() + this.serverClockOffset - serverTime;
        return Math.max(0, Math.min(6, ageMs / (1000 / 60)));
    }

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        this.connected = false;
        this.roomCode = null;
        clearInterval(this.clockSyncTimer);
        this.clockSyncTimer = null;
    }
}

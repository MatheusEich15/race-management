// ============================================================
// network.js — WebSocket client for online multiplayer
// ============================================================

import { SERVER_URL } from './config.js';

export class NetworkManager {
    constructor() {
        this.ws = null;
        this.connected = false;
        this.roomCode = null;
        this.mySlot = -1;
        this.isHost = false;

        // Callbacks set by game.js
        this.onRoomCreated = null;   // (code, slot)
        this.onRoomJoined = null;    // (code, slot, players)
        this.onPlayerJoined = null;  // (name, slot)
        this.onPlayerLeft = null;    // (slot)
        this.onConfigUpdated = null; // (config)
        this.onGameStarting = null;  // (config)
        this.onGameState = null;     // (carStates)
        this.onRaceWinner = null;    // (slot, name)
        this.onRaceEnded = null;     // ()
        this.onRaceGo = null;        // ()
        this.onError = null;         // (message)
        this.onDisconnect = null;    // ()
    }

    /**
     * Returns true only if the WebSocket is actually open.
     */
    get isConnected() {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }

    /**
     * Connect to the WebSocket server.
     * Uses SERVER_URL from config.js if set, otherwise auto-detects from page host.
     */
    connect() {
        return new Promise((resolve, reject) => {
            let url;
            if (SERVER_URL) {
                // Use configured server URL (for split deployment: Vercel + Render)
                url = SERVER_URL;
            } else {
                // Auto-detect from current page (works when server serves frontend)
                const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
                url = `${protocol}//${location.host}`;
            }

            try {
                this.ws = new WebSocket(url);
            } catch (e) {
                reject(new Error('Falha ao conectar ao servidor'));
                return;
            }

            this.ws.onopen = () => {
                this.connected = true;
                resolve();
            };

            this.ws.onclose = () => {
                this.connected = false;
                this.roomCode = null;
                if (this.onDisconnect) this.onDisconnect();
            };

            this.ws.onerror = () => {
                reject(new Error('Erro de conexão WebSocket'));
            };

            this.ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    this._handleMessage(msg);
                } catch (e) {
                    console.error('Failed to parse WS message:', e);
                }
            };
        });
    }

    _handleMessage(msg) {
        switch (msg.type) {
            case 'room_created':
                this.roomCode = msg.code;
                this.mySlot = msg.slot;
                this.isHost = true;
                if (this.onRoomCreated) this.onRoomCreated(msg.code, msg.slot);
                break;

            case 'room_joined':
                this.roomCode = msg.code;
                this.mySlot = msg.slot;
                this.isHost = false;
                if (this.onRoomJoined) this.onRoomJoined(msg.code, msg.slot, msg.players);
                break;

            case 'player_joined':
                if (this.onPlayerJoined) this.onPlayerJoined(msg.name, msg.slot);
                break;

            case 'player_left':
                if (this.onPlayerLeft) this.onPlayerLeft(msg.slot);
                break;

            case 'config_updated':
                if (this.onConfigUpdated) this.onConfigUpdated(msg.config);
                break;

            case 'game_starting':
                if (this.onGameStarting) this.onGameStarting(msg);
                break;

            case 'game_state':
                if (this.onGameState) this.onGameState(msg.cars);
                break;

            case 'race_winner':
                if (this.onRaceWinner) this.onRaceWinner(msg.slot, msg.name);
                break;

            case 'race_ended':
                if (this.onRaceEnded) this.onRaceEnded();
                break;

            case 'race_go':
                if (this.onRaceGo) this.onRaceGo();
                break;

            case 'error':
                if (this.onError) this.onError(msg.message);
                break;
        }
    }

    _send(obj) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(obj));
        }
    }

    createRoom(playerName) {
        this._send({ type: 'create_room', playerName });
    }

    joinRoom(code, playerName) {
        this._send({ type: 'join_room', code: code.toUpperCase(), playerName });
    }

    leaveRoom() {
        this._send({ type: 'leave_room' });
        this.roomCode = null;
        this.mySlot = -1;
        this.isHost = false;
    }

    setConfig(config) {
        this._send({ type: 'set_config', config });
    }

    startGame() {
        this._send({ type: 'start_game' });
    }

    sendCarState(carState, botStates = []) {
        this._send({ type: 'car_update', car: carState, bots: botStates });
    }

    sendFinished(slot) {
        this._send({ type: 'race_finished', slot });
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.connected = false;
        this.roomCode = null;
    }
}

// ============================================================
// game.js — Main game loop, rendering, and mode orchestration
// ============================================================

import { TRACKS, PLAYER_COLORS, precomputeBezierPath } from './tracks.js';
import { DriftCar } from './car.js';
import { BotAI, BOT_CONFIGS } from './bot.js';
import { handleAllCollisions } from './physics.js';
import { NetworkManager } from './network.js';
import {
    showSection, showMenu, hideMenu, setFlow, getFlow,
    buildHUD, updateHUD, buildTrackGrid,
    updateLobbyPlayers, setRoomCode, showToast
} from './ui.js';

// ---- Constants ----
const TOTAL_LAPS = 3;
const CANVAS_W = 1400;
const CANVAS_H = 850;

// ---- DOM ----
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// ---- Game State ----
let state = {
    mode: null,          // 'solo' | 'local' | 'online'
    trackIdx: 0,
    cars: [],
    botAIs: [],
    localSlots: [],      // which car slots are controlled locally
    botSlots: [],        // which car slots are bots
    remoteSlots: [],     // which car slots are remote players
    particles: [],
    skidmarks: [],
    cachedSegments: [],
    winner: null,
    countdown: 3,
    gameStarted: false,
    animFrameId: null,
    running: false,
    botDifficulty: 'medio',
    botCount: 1,
};

// ---- Input (Anti-Ghosting) ----
const keys = {};
window.addEventListener('keydown', e => {
    // Don't prevent default for input/select elements (typing in fields)
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    keys[e.key] = true;
    keys[e.key.toLowerCase()] = true;
    e.preventDefault();
});
window.addEventListener('keyup', e => {
    keys[e.key] = false;
    keys[e.key.toLowerCase()] = false;
});
// Clear all keys when window loses focus
window.addEventListener('blur', () => {
    Object.keys(keys).forEach(k => keys[k] = false);
});

const P1_KEYS = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', nitro: 'Shift' };
const P2_KEYS = { up: 't', down: 'g', left: 'f', right: 'h', nitro: 'q' };

function getLocalInput(keyMap) {
    return {
        up: !!keys[keyMap.up],
        down: !!keys[keyMap.down],
        left: !!keys[keyMap.left],
        right: !!keys[keyMap.right],
        nitro: !!keys[keyMap.nitro],
    };
}

// ---- Network ----
const net = new NetworkManager();
let lobbyPlayers = [];

// ---- Menu Setup ----

function initMenus() {
    // Main menu buttons
    document.getElementById('btn-solo').addEventListener('click', () => {
        setFlow('solo');
        showSection('solo-setup');
    });
    document.getElementById('btn-local').addEventListener('click', () => {
        setFlow('local');
        showSection('local-setup');
    });
    document.getElementById('btn-online').addEventListener('click', () => {
        setFlow('online');
        showSection('online-menu');
    });

    // Solo setup
    document.getElementById('solo-bots').addEventListener('change', e => {
        state.botCount = parseInt(e.target.value);
    });
    document.getElementById('solo-diff').addEventListener('change', e => {
        state.botDifficulty = e.target.value;
    });
    document.getElementById('btn-solo-next').addEventListener('click', () => {
        showSection('track-menu');
    });
    document.getElementById('btn-solo-back').addEventListener('click', () => {
        showSection('main-menu');
    });

    // Local setup
    document.getElementById('local-bots').addEventListener('change', e => {
        state.botCount = parseInt(e.target.value);
    });
    document.getElementById('local-diff').addEventListener('change', e => {
        state.botDifficulty = e.target.value;
    });
    document.getElementById('btn-local-next').addEventListener('click', () => {
        showSection('track-menu');
    });
    document.getElementById('btn-local-back').addEventListener('click', () => {
        showSection('main-menu');
    });

    // Online menu
    document.getElementById('btn-create').addEventListener('click', startCreateRoom);
    document.getElementById('btn-join-go').addEventListener('click', () => {
        showSection('join-room');
    });
    document.getElementById('btn-online-back').addEventListener('click', () => {
        showSection('main-menu');
    });

    // Join room
    document.getElementById('btn-join-confirm').addEventListener('click', () => {
        const code = document.getElementById('input-room-code').value.trim().toUpperCase();
        const name = document.getElementById('input-join-name').value.trim() || 'Jogador';
        if (code.length !== 4) {
            showToast('Código da sala deve ter 4 letras!');
            return;
        }
        joinRoom(code, name);
    });
    document.getElementById('btn-join-back').addEventListener('click', () => {
        showSection('online-menu');
    });

    // Lobby
    document.getElementById('btn-lobby-start').addEventListener('click', () => {
        net.startGame();
    });
    document.getElementById('btn-lobby-leave').addEventListener('click', () => {
        net.leaveRoom();
        showSection('online-menu');
    });

    // Track menu back
    document.getElementById('btn-track-back').addEventListener('click', () => {
        const flow = getFlow();
        if (flow === 'solo') showSection('solo-setup');
        else if (flow === 'local') showSection('local-setup');
        else showSection('main-menu');
    });

    // Build track grid
    buildTrackGrid(selectTrack);

    // Lobby track selector
    const lobbyTrack = document.getElementById('lobby-track');
    if (lobbyTrack) {
        TRACKS.forEach((t, i) => {
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = t.name;
            lobbyTrack.appendChild(opt);
        });
        lobbyTrack.addEventListener('change', () => {
            net.setConfig({
                trackIdx: parseInt(lobbyTrack.value),
                botCount: parseInt(document.getElementById('lobby-bots')?.value || 0),
                botDifficulty: document.getElementById('lobby-diff')?.value || 'medio',
            });
        });
    }
}

// ---- Online Functions ----

async function startCreateRoom() {
    const name = document.getElementById('input-create-name')?.value?.trim() || 'Host';
    try {
        if (!net.connected) await net.connect();
        net.createRoom(name);
    } catch (e) {
        showToast('Erro ao conectar: ' + e.message);
    }
}

async function joinRoom(code, name) {
    try {
        if (!net.connected) await net.connect();
        net.joinRoom(code, name);
    } catch (e) {
        showToast('Erro ao conectar: ' + e.message);
    }
}

function setupNetworkCallbacks() {
    net.onRoomCreated = (code, slot) => {
        lobbyPlayers = [{ name: document.getElementById('input-create-name')?.value?.trim() || 'Host', slot, isHost: true }];
        setRoomCode(code);
        updateLobbyPlayers(lobbyPlayers);
        showSection('lobby');

        // Show host controls
        const hostControls = document.getElementById('lobby-host-controls');
        if (hostControls) hostControls.style.display = 'flex';
        const btnStart = document.getElementById('btn-lobby-start');
        if (btnStart) btnStart.style.display = 'block';
    };

    net.onRoomJoined = (code, slot, players) => {
        lobbyPlayers = players;
        setRoomCode(code);
        updateLobbyPlayers(lobbyPlayers);
        showSection('lobby');

        // Hide host controls for non-hosts
        const hostControls = document.getElementById('lobby-host-controls');
        if (hostControls) hostControls.style.display = 'none';
        const btnStart = document.getElementById('btn-lobby-start');
        if (btnStart) btnStart.style.display = 'none';
    };

    net.onPlayerJoined = (name, slot) => {
        lobbyPlayers.push({ name, slot, isHost: false });
        updateLobbyPlayers(lobbyPlayers);
        showToast(`${name} entrou na sala!`);
    };

    net.onPlayerLeft = (slot) => {
        const player = lobbyPlayers.find(p => p.slot === slot);
        lobbyPlayers = lobbyPlayers.filter(p => p.slot !== slot);
        updateLobbyPlayers(lobbyPlayers);
        if (player) showToast(`${player.name} saiu da sala`);
    };

    net.onConfigUpdated = (config) => {
        const lobbyTrack = document.getElementById('lobby-track');
        if (lobbyTrack) lobbyTrack.value = config.trackIdx;
    };

    net.onGameStarting = (config) => {
        state.mode = 'online';
        setFlow('online');
        startOnlineGame(config);
    };

    net.onGameState = (carStates) => {
        if (!state.running) return;
        // Apply remote car states
        for (const cs of carStates) {
            if (cs.slot === net.mySlot) continue; // skip our own car
            const car = state.cars.find(c => c.slot === cs.slot);
            if (car && car.isRemote) {
                car.applyNetState(cs);
            }
        }
    };

    net.onRaceWinner = (slot, name) => {
        if (!state.winner) {
            state.winner = name;
        }
    };

    net.onError = (message) => {
        showToast('Erro: ' + message);
    };

    net.onDisconnect = () => {
        if (state.running && state.mode === 'online') {
            showToast('Desconectado do servidor!');
            returnToMenu();
        }
    };
}

// ---- Game Start Functions ----

function selectTrack(idx) {
    state.trackIdx = idx;
    const flow = getFlow();

    if (flow === 'solo') startSoloGame();
    else if (flow === 'local') startLocalGame();
}

function startSoloGame() {
    state.mode = 'solo';
    const track = TRACKS[state.trackIdx];
    state.cachedSegments = precomputeBezierPath(state.trackIdx);

    // Create cars: 1 player + N bots
    state.cars = [];
    state.botAIs = [];
    state.localSlots = [0];
    state.botSlots = [];
    state.remoteSlots = [];

    // Player car
    const player = new DriftCar(0);
    player.isLocal = true;
    player.reset(track.startPositions[0].x, track.startPositions[0].y, track.startAngle);
    state.cars.push(player);

    // Bot cars
    const botCount = Math.min(state.botCount, 3);
    const config = BOT_CONFIGS[state.botDifficulty] || BOT_CONFIGS.medio;

    for (let i = 0; i < botCount; i++) {
        const slot = i + 1;
        const bot = new DriftCar(slot);
        bot.isBot = true;
        bot.maxSpeed = config.maxSpeed;
        const pos = track.startPositions[slot];
        bot.reset(pos.x, pos.y, track.startAngle);
        state.cars.push(bot);
        state.botSlots.push(slot);

        const ai = new BotAI(state.botDifficulty);
        ai.findNearestNode(pos.x, pos.y, state.cachedSegments);
        state.botAIs.push(ai);
    }

    startRace();
}

function startLocalGame() {
    state.mode = 'local';
    const track = TRACKS[state.trackIdx];
    state.cachedSegments = precomputeBezierPath(state.trackIdx);

    state.cars = [];
    state.botAIs = [];
    state.localSlots = [0, 1];
    state.botSlots = [];
    state.remoteSlots = [];

    // Player 1
    const p1 = new DriftCar(0);
    p1.isLocal = true;
    p1.reset(track.startPositions[0].x, track.startPositions[0].y, track.startAngle);
    state.cars.push(p1);

    // Player 2
    const p2 = new DriftCar(1);
    p2.isLocal = true;
    p2.reset(track.startPositions[1].x, track.startPositions[1].y, track.startAngle);
    state.cars.push(p2);

    // Optional bots
    const botCount = Math.min(state.botCount, 2);
    const config = BOT_CONFIGS[state.botDifficulty] || BOT_CONFIGS.medio;

    for (let i = 0; i < botCount; i++) {
        const slot = i + 2;
        const bot = new DriftCar(slot);
        bot.isBot = true;
        bot.maxSpeed = config.maxSpeed;
        const pos = track.startPositions[slot];
        bot.reset(pos.x, pos.y, track.startAngle);
        state.cars.push(bot);
        state.botSlots.push(slot);

        const ai = new BotAI(state.botDifficulty);
        ai.findNearestNode(pos.x, pos.y, state.cachedSegments);
        state.botAIs.push(ai);
    }

    startRace();
}

function startOnlineGame(config) {
    state.trackIdx = config.trackIdx;
    const track = TRACKS[state.trackIdx];
    state.cachedSegments = precomputeBezierPath(state.trackIdx);

    state.cars = [];
    state.botAIs = [];
    state.localSlots = [net.mySlot];
    state.botSlots = [];
    state.remoteSlots = [];

    // Create all player cars
    for (const p of config.players) {
        const car = new DriftCar(p.slot);
        const pos = track.startPositions[p.slot];
        car.reset(pos.x, pos.y, track.startAngle);

        if (p.slot === net.mySlot) {
            car.isLocal = true;
        } else {
            car.isRemote = true;
        }
        state.cars.push(car);
    }

    // Create bots (host runs them)
    if (net.isHost && config.botCount > 0) {
        const bc = BOT_CONFIGS[config.botDifficulty] || BOT_CONFIGS.medio;
        const usedSlots = config.players.map(p => p.slot);
        let botSlotIdx = 0;
        for (let s = 0; s < 4 && botSlotIdx < config.botCount; s++) {
            if (!usedSlots.includes(s)) {
                const bot = new DriftCar(s);
                bot.isBot = true;
                bot.maxSpeed = bc.maxSpeed;
                const pos = track.startPositions[s];
                bot.reset(pos.x, pos.y, track.startAngle);
                state.cars.push(bot);
                state.botSlots.push(s);

                const ai = new BotAI(config.botDifficulty);
                ai.findNearestNode(pos.x, pos.y, state.cachedSegments);
                state.botAIs.push(ai);
                botSlotIdx++;
            }
        }
    }

    // Sort cars by slot for consistent rendering
    state.cars.sort((a, b) => a.slot - b.slot);

    startRace();
}

function startRace() {
    state.particles = [];
    state.skidmarks = [];
    state.winner = null;
    state.countdown = 3;
    state.gameStarted = false;
    state.running = true;

    // Build HUD
    buildHUD(state.cars, {
        totalLaps: TOTAL_LAPS,
        mode: state.mode,
        botSlots: state.botSlots,
        localSlots: state.localSlots,
    });

    hideMenu();

    // Countdown timer
    const countInterval = setInterval(() => {
        state.countdown--;
        if (state.countdown < 0) {
            state.gameStarted = true;
            clearInterval(countInterval);
        }
    }, 1000);

    // Start game loop if not already running
    if (!state.animFrameId) {
        gameLoop();
    }
}

function returnToMenu() {
    state.running = false;
    if (state.animFrameId) {
        cancelAnimationFrame(state.animFrameId);
        state.animFrameId = null;
    }

    // Clear keys
    Object.keys(keys).forEach(k => keys[k] = false);

    showMenu();

    if (state.mode === 'online') {
        net.leaveRoom();
    }
}

// ---- Game Loop ----

function gameLoop() {
    if (!state.running) {
        state.animFrameId = null;
        return;
    }

    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    const trackData = {
        trackIdx: state.trackIdx,
        cachedSegments: state.cachedSegments,
        totalLaps: TOTAL_LAPS,
    };

    // ---- Update ----
    if (state.gameStarted && !state.winner) {
        // Update local cars
        state.localSlots.forEach((slot, i) => {
            const car = state.cars.find(c => c.slot === slot);
            if (!car) return;
            // In online mode, always use P1 keys for the local player
            // In local mode, first local slot uses P1, second uses P2
            const keyMap = (state.mode === 'online' || i === 0) ? P1_KEYS : P2_KEYS;
            const input = getLocalInput(keyMap);
            car.update(input, trackData, state.skidmarks, state.particles);
        });

        // Update bot cars
        state.botSlots.forEach((slot, i) => {
            const car = state.cars.find(c => c.slot === slot);
            const ai = state.botAIs[i];
            if (!car || !ai) return;
            const input = ai.computeInput(car, state.cachedSegments);
            car.update(input, trackData, state.skidmarks, state.particles);
        });

        // Interpolate remote cars
        state.cars.forEach(car => {
            if (car.isRemote) car.interpolateRemote();
        });

        // Collisions
        handleAllCollisions(state.cars, state.particles);

        // Check for winner
        for (const car of state.cars) {
            if (car.finished && !state.winner) {
                if (car.isBot) {
                    state.winner = `BOT ${car.slot + 1}`;
                } else if (car.isRemote) {
                    const lp = lobbyPlayers.find(p => p.slot === car.slot);
                    state.winner = lp ? lp.name : `JOGADOR ${car.slot + 1}`;
                } else {
                    state.winner = `JOGADOR ${car.slot + 1}`;
                }

                if (state.mode === 'online' && car.isLocal) {
                    net.sendFinished(car.slot);
                }
            }
        }

        // Update HUD
        state.cars.forEach((car, i) => updateHUD(i, car, TOTAL_LAPS));

        // Network: send state
        if (state.mode === 'online' && state.gameStarted) {
            const myCar = state.cars.find(c => c.slot === net.mySlot);
            if (myCar) {
                const botStates = state.botSlots.map(slot => {
                    const bc = state.cars.find(c => c.slot === slot);
                    return bc ? bc.serialize() : null;
                }).filter(Boolean);
                net.sendCarState(myCar.serialize(), botStates);
            }
        }
    }

    // ---- Render ----
    drawTrack();
    drawParticles();

    // Draw cars (sorted by slot for consistent layering)
    state.cars.forEach(car => car.draw(ctx));

    // Countdown overlay
    if (!state.gameStarted) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.fillStyle = '#f1c40f';
        ctx.font = '120px "Outfit", Impact, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        if (state.countdown === 0) {
            ctx.fillStyle = '#2ecc71';
            ctx.fillText('VAI!!!', CANVAS_W / 2, CANVAS_H / 2);
        } else {
            ctx.fillText(state.countdown, CANVAS_W / 2, CANVAS_H / 2);
        }
        ctx.textBaseline = 'alphabetic';
    }

    // Winner overlay
    if (state.winner) {
        ctx.fillStyle = 'rgba(0,0,0,0.85)';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

        ctx.fillStyle = '#2ecc71';
        ctx.font = '70px "Outfit", Impact, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('FIM DE CORRIDA!', CANVAS_W / 2, CANVAS_H / 2 - 50);

        ctx.fillStyle = '#fff';
        ctx.font = '42px "Outfit", Impact, sans-serif';
        ctx.fillText(`${state.winner} VENCEU!`, CANVAS_W / 2, CANVAS_H / 2 + 20);

        ctx.fillStyle = '#f1c40f';
        ctx.font = '22px "Outfit", Arial, sans-serif';
        ctx.fillText('Pressione ENTER para voltar ao Menu', CANVAS_W / 2, CANVAS_H / 2 + 100);

        if (keys['Enter']) {
            returnToMenu();
        }
    }

    state.animFrameId = requestAnimationFrame(gameLoop);
}

// ---- Rendering ----

function drawBezierTrack(lineWidth, strokeColor, isDash = false) {
    const t = TRACKS[state.trackIdx];
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (isDash) ctx.setLineDash([25, 30]); else ctx.setLineDash([]);

    ctx.beginPath();
    const pStart = t.points[0];
    const pEnd = t.points[t.points.length - 1];
    let midX = (pStart.x + pEnd.x) / 2;
    let midY = (pStart.y + pEnd.y) / 2;
    ctx.moveTo(midX, midY);

    for (let i = 0; i < t.points.length; i++) {
        const pCurrent = t.points[i];
        const pNext = t.points[(i + 1) % t.points.length];
        const nextMidX = (pCurrent.x + pNext.x) / 2;
        const nextMidY = (pCurrent.y + pNext.y) / 2;
        ctx.quadraticCurveTo(pCurrent.x, pCurrent.y, nextMidX, nextMidY);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
}

function drawFinishLine() {
    const t = TRACKS[state.trackIdx];
    const fl = t.finishLine;

    ctx.save();

    const cx = (fl.x1 + fl.x2) / 2;
    const cy = (fl.y1 + fl.y2) / 2;
    const lineAngle = Math.atan2(fl.y2 - fl.y1, fl.x2 - fl.x1);
    const lineLen = Math.sqrt((fl.x2 - fl.x1) ** 2 + (fl.y2 - fl.y1) ** 2);

    ctx.translate(cx, cy);
    ctx.rotate(lineAngle);

    const checkerSize = 10;
    const halfLen = lineLen / 2;
    const rows = 2;

    for (let row = 0; row < rows; row++) {
        for (let col = -Math.floor(halfLen / checkerSize); col <= Math.floor(halfLen / checkerSize); col++) {
            const isBlack = (row + col) % 2 === 0;
            ctx.fillStyle = isBlack ? '#111' : '#fff';
            ctx.fillRect(col * checkerSize, (row - 1) * checkerSize, checkerSize, checkerSize);
        }
    }

    ctx.restore();
}

function drawTrack() {
    const t = TRACKS[state.trackIdx];

    // Grass background
    const grassGrad = ctx.createRadialGradient(
        CANVAS_W / 2, CANVAS_H / 2, 200,
        CANVAS_W / 2, CANVAS_H / 2, 800
    );
    grassGrad.addColorStop(0, t.grassColors[0]);
    grassGrad.addColorStop(1, t.grassColors[1]);
    ctx.fillStyle = grassGrad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Subtle grass pattern
    ctx.fillStyle = 'rgba(0,0,0,0.03)';
    for (let i = 0; i < 60; i++) {
        const gx = (i * 127 + 43) % CANVAS_W;
        const gy = (i * 89 + 17) % CANVAS_H;
        ctx.beginPath();
        ctx.arc(gx, gy, 15 + (i % 10), 0, Math.PI * 2);
        ctx.fill();
    }

    // Skidmarks
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (const sm of state.skidmarks) {
        ctx.beginPath();
        ctx.arc(sm.x, sm.y, 3, 0, Math.PI * 2);
        ctx.fill();
    }

    // Track layers
    drawBezierTrack(t.width + 18, '#fff');       // white border
    drawBezierTrack(t.width, '#2c3e50');          // asphalt
    drawBezierTrack(t.width - 10, '#34495e');     // asphalt inner shade
    drawBezierTrack(2, '#f1c40f', true);          // center dashed line

    // Finish line
    drawFinishLine();

    // Checkpoint markers (subtle)
    ctx.globalAlpha = 0.15;
    t.checkpoints.forEach((cp, i) => {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.arc(cp.x, cp.y, 20, 0, Math.PI * 2);
        ctx.stroke();
    });
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
}

function drawParticles() {
    // Iterate in reverse to safely remove dead particles
    for (let i = state.particles.length - 1; i >= 0; i--) {
        const p = state.particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.alpha -= 0.02;
        p.size += 0.15;

        if (p.alpha <= 0) {
            state.particles.splice(i, 1);
            continue;
        }

        if (p.color === 'spark') {
            ctx.fillStyle = `rgba(255, 200, 50, ${p.alpha})`;
        } else {
            ctx.fillStyle = `rgba(180, 180, 180, ${p.alpha})`;
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
    }
}

// ---- Initialize ----

function init() {
    setupNetworkCallbacks();
    initMenus();
    showMenu();
}

// Start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// ============================================================
// game.js — Main game loop, rendering, and mode orchestration
// ============================================================

import { TRACKS, PLAYER_COLORS, PLAYER_NAMES, precomputeBezierPath } from './tracks.js';
import { DriftCar } from './car.js';
import { BotAI, BOT_CONFIGS } from './bot.js';
import { handleAllCollisions } from './physics.js';
import { NetworkManager } from './network.js';
import {
    showSection, showMenu, hideMenu, setFlow, getFlow,
    buildHUD, updateHUD, buildTrackGrid,
    updateLobbyPlayers, setRoomCode, showToast, returnToLobby
} from './ui.js';

// ---- Constants ----
const TOTAL_LAPS = 3;
const CANVAS_W = 1400;
const CANVAS_H = 850;
const RACE_END_TIMEOUT = 20000; // 20s after first finisher for others

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
    // Race progress
    finishOrder: [],     // [{slot, name, time, color}] — ordered by finish
    raceStartTime: 0,    // performance.now() when race actually starts
    raceEndTime: 0,      // deadline for remaining cars after first finishes
    raceFullyEnded: false,
    ranking: [],         // [{slot, name, color, lap, finished, progress}]
    // Online sync
    waitingForGo: false, // true while waiting for server's race_go
    // UI
    countdown: 3,
    gameStarted: false,
    animFrameId: null,
    running: false,
    botDifficulty: 'medio',
    botCount: 1,
    soloBotCount: 1,
    soloBotDifficulty: 'medio',
    soloTrackIdx: 0,
    localBotCount: 0,
    localBotDifficulty: 'medio',
    localTrackIdx: 0,
    lastNetSendTime: 0,
};

// ---- Input (Anti-Ghosting) ----
const keys = {};
window.addEventListener('keydown', e => {
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
window.addEventListener('blur', () => {
    Object.keys(keys).forEach(k => keys[k] = false);
});

const P1_KEYS = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', nitro: 'Shift' };
const P2_KEYS = { up: 'w', down: 's', left: 'a', right: 'd', nitro: 'q' };

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

// ---- Helpers ----

function getCarName(car) {
    if (car.isBot) {
        return `BOT ${PLAYER_NAMES[car.slot] || car.slot + 1}`;
    }
    if (car.isRemote) {
        const lp = lobbyPlayers.find(p => p.slot === car.slot);
        return lp ? lp.name : `PLAYER ${car.slot + 1}`;
    }
    if (state.mode === 'online') {
        const lp = lobbyPlayers.find(p => p.slot === car.slot);
        return lp ? lp.name : `PLAYER ${car.slot + 1}`;
    }
    return `PLAYER ${car.slot + 1}`;
}

function computeRanking() {
    state.ranking = state.cars.map(car => {
        const progress = car.getRaceProgress(state.cachedSegments, state.trackIdx);
        return {
            slot: car.slot,
            name: getCarName(car),
            color: car.color,
            lap: Math.min(car.currentLap, TOTAL_LAPS),
            finished: car.finished,
            finishTime: car.finishTime,
            progress: progress
        };
    });

    state.ranking.sort((a, b) => {
        if (a.finished && b.finished) return a.finishTime - b.finishTime;
        if (a.finished) return -1;
        if (b.finished) return 1;
        return b.progress - a.progress;
    });
}

/**
 * Get podium center position (centroid of track control points).
 */
function getPodiumCenter() {
    const t = TRACKS[state.trackIdx];
    const cx = t.points.reduce((s, p) => s + p.x, 0) / t.points.length;
    const cy = t.points.reduce((s, p) => s + p.y, 0) / t.points.length;
    return { x: cx, y: cy };
}

/**
 * Get podium positions for 1st, 2nd, 3rd place.
 */
function getPodiumPositions() {
    const center = getPodiumCenter();
    return [
        { x: center.x, y: center.y - 30 },       // 1st (center, slightly up)
        { x: center.x - 60, y: center.y + 20 },   // 2nd (left)
        { x: center.x + 60, y: center.y + 20 },   // 3rd (right)
        { x: center.x, y: center.y + 55 },         // 4th (below)
    ];
}

// ---- Menu Setup ----

function buildCardTrackLists() {
    const soloList = document.getElementById('solo-track-list');
    const localList = document.getElementById('local-track-list');
    
    if (soloList) {
        soloList.innerHTML = '';
        TRACKS.forEach((track, i) => {
            const btn = document.createElement('button');
            btn.className = 'btn-track-card' + (i === state.soloTrackIdx ? ' active' : '');
            btn.textContent = `${i + 1}. ${track.name}`;
            btn.addEventListener('click', () => {
                state.soloTrackIdx = i;
                soloList.querySelectorAll('.btn-track-card').forEach((b, idx) => {
                    b.classList.toggle('active', idx === i);
                });
            });
            soloList.appendChild(btn);
        });
    }

    if (localList) {
        localList.innerHTML = '';
        TRACKS.forEach((track, i) => {
            const btn = document.createElement('button');
            btn.className = 'btn-track-card' + (i === state.localTrackIdx ? ' active' : '');
            btn.textContent = `${i + 1}. ${track.name}`;
            btn.addEventListener('click', () => {
                state.localTrackIdx = i;
                localList.querySelectorAll('.btn-track-card').forEach((b, idx) => {
                    b.classList.toggle('active', idx === i);
                });
            });
            localList.appendChild(btn);
        });
    }
}

function initMenus() {
    // Build track selections within the cards
    buildCardTrackLists();

    // Solo Card Step Navigation
    document.getElementById('solo-bots').addEventListener('change', e => {
        state.soloBotCount = parseInt(e.target.value);
    });
    document.getElementById('solo-diff').addEventListener('change', e => {
        state.soloBotDifficulty = e.target.value;
    });
    document.getElementById('btn-solo-next').addEventListener('click', () => {
        document.getElementById('solo-step-1').style.display = 'none';
        document.getElementById('solo-step-2').style.display = 'flex';
    });
    document.getElementById('btn-solo-back').addEventListener('click', () => {
        document.getElementById('solo-step-2').style.display = 'none';
        document.getElementById('solo-step-1').style.display = 'flex';
    });
    document.getElementById('btn-solo-start').addEventListener('click', () => {
        startSoloGame();
    });

    // Local Card Step Navigation
    document.getElementById('local-bots').addEventListener('change', e => {
        state.localBotCount = parseInt(e.target.value);
    });
    document.getElementById('local-diff').addEventListener('change', e => {
        state.localBotDifficulty = e.target.value;
    });
    document.getElementById('btn-local-next').addEventListener('click', () => {
        document.getElementById('local-step-1').style.display = 'none';
        document.getElementById('local-step-2').style.display = 'flex';
    });
    document.getElementById('btn-local-back').addEventListener('click', () => {
        document.getElementById('local-step-2').style.display = 'none';
        document.getElementById('local-step-1').style.display = 'flex';
    });
    document.getElementById('btn-local-start').addEventListener('click', () => {
        startLocalGame();
    });

    // Online Card Navigation
    document.getElementById('btn-create').addEventListener('click', startCreateRoom);

    // Join room confirm
    document.getElementById('btn-join-confirm').addEventListener('click', () => {
        const code = document.getElementById('input-room-code').value.trim().toUpperCase();
        const name = document.getElementById('input-online-name').value.trim() || 'Player';
        if (code.length !== 4) {
            showToast('Room code must be 4 letters!');
            return;
        }
        joinRoom(code, name);
    });

    // Lobby controls
    document.getElementById('btn-lobby-start').addEventListener('click', () => {
        net.startGame();
    });
    document.getElementById('btn-lobby-leave').addEventListener('click', () => {
        net.leaveRoom();
        showMenu();
    });

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
    const name = document.getElementById('input-online-name')?.value?.trim() || 'Host';
    try {
        if (!net.connected) await net.connect();
        net.createRoom(name);
    } catch (e) {
        showToast('Connection error: ' + e.message);
    }
}

async function joinRoom(code, name) {
    try {
        if (!net.connected) await net.connect();
        net.joinRoom(code, name);
    } catch (e) {
        showToast('Connection error: ' + e.message);
    }
}

function setupNetworkCallbacks() {
    net.onRoomCreated = (code, slot) => {
        lobbyPlayers = [{ name: document.getElementById('input-online-name')?.value?.trim() || 'Host', slot, isHost: true }];
        setRoomCode(code);
        updateLobbyPlayers(lobbyPlayers);
        showSection('lobby');

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

        const hostControls = document.getElementById('lobby-host-controls');
        if (hostControls) hostControls.style.display = 'none';
        const btnStart = document.getElementById('btn-lobby-start');
        if (btnStart) btnStart.style.display = 'none';
    };

    net.onPlayerJoined = (name, slot) => {
        lobbyPlayers.push({ name, slot, isHost: false });
        updateLobbyPlayers(lobbyPlayers);
        showToast(`${name} joined the room!`);
    };

    net.onPlayerLeft = (slot) => {
        const player = lobbyPlayers.find(p => p.slot === slot);
        lobbyPlayers = lobbyPlayers.filter(p => p.slot !== slot);
        updateLobbyPlayers(lobbyPlayers);
        if (player) showToast(`${player.name} left the room`);
    };

    net.onConfigUpdated = (config) => {
        const lobbyTrack = document.getElementById('lobby-track');
        if (lobbyTrack) lobbyTrack.value = config.trackIdx;
    };

    net.onGameStarting = (config) => {
        state.mode = 'online';
        setFlow('online');
        // Setup cars but DON'T start countdown yet — wait for race_go
        setupOnlineGame(config);
    };

    net.onRaceGo = () => {
        // Server says GO — start the synchronized countdown now
        if (state.waitingForGo) {
            state.waitingForGo = false;
            beginCountdown();
        }
    };

    net.onGameState = (carStates) => {
        if (!state.running) return;
        for (const cs of carStates) {
            if (cs.slot === net.mySlot) continue;
            const car = state.cars.find(c => c.slot === cs.slot);
            if (car && car.isRemote) {
                car.applyNetState(cs);
            }
        }
    };

    net.onRaceWinner = (slot, name) => {
        const car = state.cars.find(c => c.slot === slot);
        if (car) {
            car.finished = true;
            car.isGhost = true;
            if (!car.finishTime) car.finishTime = performance.now();
        }
    };

    net.onRaceEnded = () => {
        // Server confirmed room is back to lobby
    };

    net.onError = (message) => {
        showToast('Error: ' + message);
    };

    net.onDisconnect = () => {
        if (state.running && state.mode === 'online') {
            showToast('Disconnected from server!');
            returnToMenuScreen();
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

    state.cars = [];
    state.botAIs = [];
    state.localSlots = [0];
    state.botSlots = [];
    state.remoteSlots = [];

    const player = new DriftCar(0);
    player.isLocal = true;
    player.reset(track.startPositions[0].x, track.startPositions[0].y, track.startAngle);
    state.cars.push(player);

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
    beginCountdown(); // Solo: start countdown immediately
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

    const p1 = new DriftCar(0);
    p1.isLocal = true;
    p1.reset(track.startPositions[0].x, track.startPositions[0].y, track.startAngle);
    state.cars.push(p1);

    const p2 = new DriftCar(1);
    p2.isLocal = true;
    p2.reset(track.startPositions[1].x, track.startPositions[1].y, track.startAngle);
    state.cars.push(p2);

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
    beginCountdown(); // Local: start countdown immediately
}

/**
 * Setup online game cars (called on game_starting). Does NOT start countdown.
 */
function setupOnlineGame(config) {
    state.trackIdx = config.trackIdx;
    const track = TRACKS[state.trackIdx];
    state.cachedSegments = precomputeBezierPath(state.trackIdx);

    state.cars = [];
    state.botAIs = [];
    state.localSlots = [net.mySlot];
    state.botSlots = [];
    state.remoteSlots = [];

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

    state.cars.sort((a, b) => a.slot - b.slot);

    // Start rendering but wait for race_go before countdown
    startRace();
    state.waitingForGo = true; // Show "WAITING..." until server sends race_go

    // Fallback: if race_go never arrives, start anyway after 6 seconds
    setTimeout(() => {
        if (state.waitingForGo) {
            console.warn('race_go not received — starting countdown via fallback');
            state.waitingForGo = false;
            beginCountdown();
        }
    }, 6000);
}

/**
 * Initialize race state and start the game loop.
 */
function startRace() {
    state.particles = [];
    state.skidmarks = [];
    state.finishOrder = [];
    state.raceStartTime = 0;
    state.raceEndTime = 0;
    state.raceFullyEnded = false;
    state.ranking = [];
    state.countdown = 4; // will be overwritten by beginCountdown
    state.gameStarted = false;
    state.running = true;

    buildHUD(state.cars, {
        totalLaps: TOTAL_LAPS,
        mode: state.mode,
        botSlots: state.botSlots,
        localSlots: state.localSlots,
    });

    hideMenu();

    if (!state.animFrameId) {
        gameLoop();
    }
}

/**
 * Begin the 3-2-1-GO countdown. Called immediately for solo/local,
 * or when race_go is received for online mode.
 */
function beginCountdown() {
    state.countdown = 3;
    const countInterval = setInterval(() => {
        state.countdown--;
        if (state.countdown < 0) {
            state.gameStarted = true;
            state.raceStartTime = performance.now();
            clearInterval(countInterval);
        }
    }, 1000);
}

/**
 * Return to menu (solo/local) or lobby (online).
 */
function returnToMenuScreen() {
    state.running = false;
    if (state.animFrameId) {
        cancelAnimationFrame(state.animFrameId);
        state.animFrameId = null;
    }
    Object.keys(keys).forEach(k => keys[k] = false);

    if (state.mode === 'online') {
        returnToLobby(net.isHost);
    } else {
        showMenu();
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
    if (state.gameStarted && !state.raceFullyEnded) {
        // Update local cars
        state.localSlots.forEach((slot, i) => {
            const car = state.cars.find(c => c.slot === slot);
            if (!car) return;

            // Ghost cars can still be controlled but don't count for anything
            if (car.finished && !car.isGhost) {
                car.isGhost = true;
            }

            const keyMap = (state.mode === 'online' || i === 0) ? P1_KEYS : P2_KEYS;
            const input = getLocalInput(keyMap);

            if (car.isGhost) {
                // Ghost: update position from input but no lap counting
                car.prevX = car.x;
                car.prevY = car.y;
                // Simple ghost movement (reduced physics)
                if (input.up) car.speed = Math.min(car.speed + car.accel, car.maxSpeed);
                else if (input.down) car.speed = Math.max(car.speed - car.accel * 2, -car.maxSpeed / 2);
                else car.speed *= (1 - car.friction);
                if (Math.abs(car.speed) < 0.01) car.speed = 0;
                if (input.left) car.angle -= car.turnSpeed * (car.speed > 0 ? 1 : -1);
                if (input.right) car.angle += car.turnSpeed * (car.speed > 0 ? 1 : -1);
                car.vx = Math.cos(car.angle) * car.speed;
                car.vy = Math.sin(car.angle) * car.speed;
                car.x += car.vx;
                car.y += car.vy;
            } else {
                car.update(input, trackData, state.skidmarks, state.particles);
            }
        });

        // Update bot cars (only non-finished)
        state.botSlots.forEach((slot, i) => {
            const car = state.cars.find(c => c.slot === slot);
            const ai = state.botAIs[i];
            if (!car || !ai || car.finished) return;
            const input = ai.computeInput(car, state.cachedSegments);
            car.update(input, trackData, state.skidmarks, state.particles);
        });

        // Interpolate remote cars
        state.cars.forEach(car => {
            if (car.isRemote && !car.finished) car.interpolateRemote();
        });

        // Collisions (skips ghost cars via physics.js)
        handleAllCollisions(state.cars, state.particles);

        // ---- Track finish order ----
        for (const car of state.cars) {
            if (car.finished && !state.finishOrder.find(f => f.slot === car.slot)) {
                car.isGhost = true;
                const name = getCarName(car);
                const raceTime = performance.now() - state.raceStartTime;

                state.finishOrder.push({
                    slot: car.slot,
                    name: name,
                    time: raceTime,
                    color: car.color
                });

                if (state.finishOrder.length === 1) {
                    state.raceEndTime = performance.now() + RACE_END_TIMEOUT;
                }

                if (state.mode === 'online' && car.isLocal) {
                    net.sendFinished(car.slot);
                }
            }
        }

        // ---- Check if race fully ended ----
        if (state.finishOrder.length > 0) {
            const allFinished = state.cars.every(c => c.finished);
            const timeout = performance.now() > state.raceEndTime;

            if (allFinished || timeout) {
                for (const car of state.cars) {
                    if (!state.finishOrder.find(f => f.slot === car.slot)) {
                        state.finishOrder.push({
                            slot: car.slot,
                            name: getCarName(car),
                            time: null,
                            color: car.color
                        });
                    }
                }
                state.raceFullyEnded = true;
            }
        }

        computeRanking();
        state.cars.forEach((car, i) => updateHUD(i, car, TOTAL_LAPS));

        // Network: send state (throttled to ~30Hz / every 33ms)
        if (state.mode === 'online' && state.gameStarted) {
            const now = performance.now();
            if (now - state.lastNetSendTime >= 33) {
                state.lastNetSendTime = now;
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
    }

    // ---- Render ----
    drawTrack();
    drawPodiumArea(); // Draw podium zone inside the track
    drawParticles();

    // Draw cars
    state.cars.forEach(car => {
        if (car.isGhost) {
            // Ghost: only the local player sees their own ghost
            if (car.isLocal) {
                car.draw(ctx, true); // force ghost appearance
            }
            // Remote/bot ghosts: don't draw on track (shown on podium instead)
        } else {
            car.draw(ctx);
        }
    });

    // Draw finished cars on podium
    drawCarsOnPodium();

    // ---- Overlays ----

    // Waiting for server overlay (online sync)
    if (state.waitingForGo) {
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.fillStyle = '#f1c40f';
        ctx.font = '48px "Outfit", Impact, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('GET READY...', CANVAS_W / 2, CANVAS_H / 2);
        ctx.fillStyle = '#7f8c8d';
        ctx.font = '20px "Outfit", sans-serif';
        ctx.fillText('Synchronizing with all players', CANVAS_W / 2, CANVAS_H / 2 + 50);
        ctx.textBaseline = 'alphabetic';
    }

    // Countdown overlay
    if (!state.gameStarted && !state.waitingForGo) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.fillStyle = '#f1c40f';
        ctx.font = '120px "Outfit", Impact, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        if (state.countdown === 0) {
            ctx.fillStyle = '#2ecc71';
            ctx.fillText('GO!!!', CANVAS_W / 2, CANVAS_H / 2);
        } else {
            ctx.fillText(state.countdown, CANVAS_W / 2, CANVAS_H / 2);
        }
        ctx.textBaseline = 'alphabetic';
    }

    // Live ranking (during active race)
    if (state.gameStarted && !state.raceFullyEnded) {
        drawRanking();

        if (state.finishOrder.length > 0) {
            const remaining = Math.max(0, Math.ceil((state.raceEndTime - performance.now()) / 1000));
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.font = 'bold 24px "Outfit", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`⏱️ ${remaining}s remaining`, CANVAS_W / 2, 40);
        }
    }

    // Podium overlay (race fully ended)
    if (state.raceFullyEnded) {
        drawPodiumOverlay();

        if (keys['Enter']) {
            keys['Enter'] = false;
            returnToMenuScreen();
        }
    }

    state.animFrameId = requestAnimationFrame(gameLoop);
}

// ---- Rendering ----

function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function drawRanking() {
    const ranking = state.ranking;
    if (!ranking || ranking.length === 0) return;

    const panelW = 230;
    const headerH = 32;
    const rowH = 30;
    const panelH = headerH + ranking.length * rowH + 10;
    const panelX = CANVAS_W - panelW - 15;
    const panelY = 15;

    ctx.fillStyle = 'rgba(10, 14, 23, 0.80)';
    roundRect(panelX, panelY, panelW, panelH, 10);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.lineWidth = 1;
    roundRect(panelX, panelY, panelW, panelH, 10);
    ctx.stroke();

    ctx.fillStyle = '#f1c40f';
    ctx.font = 'bold 14px "Outfit", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('🏁 POSITIONS', panelX + 12, panelY + headerH / 2);

    const posColors = ['#FFD700', '#C0C0C0', '#CD7F32', '#777'];
    const posEmojis = ['🥇', '🥈', '🥉', ' 4'];

    ranking.forEach((entry, i) => {
        const rowY = panelY + headerH + i * rowH;
        const centerY = rowY + rowH / 2;

        const isLocalPlayer = state.localSlots.includes(entry.slot);
        if (isLocalPlayer) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
            roundRect(panelX + 4, rowY + 2, panelW - 8, rowH - 4, 6);
            ctx.fill();
        }

        ctx.fillStyle = posColors[i] || '#666';
        ctx.font = 'bold 14px "Outfit", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(posEmojis[i] || `${i + 1}`, panelX + 10, centerY);

        ctx.fillStyle = entry.color;
        ctx.beginPath();
        ctx.arc(panelX + 50, centerY, 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = isLocalPlayer ? '#fff' : '#bdc3c7';
        ctx.font = `${isLocalPlayer ? 'bold ' : ''}13px "Outfit", sans-serif`;
        const displayName = entry.name.length > 10 ? entry.name.slice(0, 10) + '..' : entry.name;
        ctx.fillText(displayName, panelX + 62, centerY);

        ctx.textAlign = 'right';
        if (entry.finished) {
            ctx.fillStyle = '#2ecc71';
            ctx.font = 'bold 12px "Outfit", sans-serif';
            ctx.fillText('✓ DONE', panelX + panelW - 10, centerY);
        } else {
            ctx.fillStyle = '#7f8c8d';
            ctx.font = '12px "Outfit", sans-serif';
            ctx.fillText(`L${entry.lap}/${TOTAL_LAPS}`, panelX + panelW - 10, centerY);
        }
        ctx.textAlign = 'left';
    });

    ctx.textBaseline = 'alphabetic';
}

/**
 * Draw the podium area inside the track where finished cars are parked.
 */
function drawPodiumArea() {
    if (state.finishOrder.length === 0) return;

    const center = getPodiumCenter();
    const positions = getPodiumPositions();
    const medals = ['🥇', '🥈', '🥉', '4'];

    // Background circle
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.arc(center.x, center.y, 55, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(center.x, center.y, 55, 0, Math.PI * 2);
    ctx.stroke();

    // Position labels
    ctx.font = '12px "Outfit", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    state.finishOrder.forEach((entry, i) => {
        if (i >= 4) return;
        const pos = positions[i];
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillText(medals[i], pos.x, pos.y - 25);
    });

    ctx.textBaseline = 'alphabetic';
}

/**
 * Draw finished cars parked on the podium positions.
 */
function drawCarsOnPodium() {
    const positions = getPodiumPositions();

    state.finishOrder.forEach((entry, i) => {
        if (i >= 4) return;
        const car = state.cars.find(c => c.slot === entry.slot);
        if (!car) return;

        const pos = positions[i];
        car.drawOnPodium(ctx, pos.x, pos.y, i === 0 ? 1.4 : 1.1);
    });
}

/**
 * Draw the end-of-race podium overlay.
 */
function drawPodiumOverlay() {
    const order = state.finishOrder;
    if (!order || order.length === 0) return;

    ctx.fillStyle = 'rgba(5, 8, 15, 0.92)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = '#f1c40f';
    ctx.font = 'bold 52px "Outfit", Impact, sans-serif';
    ctx.fillText('🏁 RACE FINISHED!', CANVAS_W / 2, 80);

    ctx.fillStyle = '#5a6270';
    ctx.font = '16px "Outfit", sans-serif';
    ctx.fillText(TRACKS[state.trackIdx].name + ` — ${TOTAL_LAPS} laps`, CANVAS_W / 2, 115);

    const medals = ['🥇', '🥈', '🥉', ''];
    const posLabels = ['1st PLACE', '2nd PLACE', '3rd PLACE', '4th PLACE'];
    const barBg = [
        'rgba(255, 215, 0, 0.12)',
        'rgba(192, 192, 192, 0.09)',
        'rgba(205, 127, 50, 0.08)',
        'rgba(100, 100, 100, 0.06)'
    ];
    const barBorder = [
        'rgba(255, 215, 0, 0.5)',
        'rgba(192, 192, 192, 0.35)',
        'rgba(205, 127, 50, 0.3)',
        'rgba(100, 100, 100, 0.2)'
    ];

    const barW = 520;
    const barH = 80;
    const gap = 95;
    const startY = 155;

    order.forEach((entry, i) => {
        if (i >= 4) return;

        const y = startY + i * gap;
        const x = (CANVAS_W - barW) / 2;

        if (i === 0) {
            ctx.shadowColor = 'rgba(255, 215, 0, 0.3)';
            ctx.shadowBlur = 20;
        }

        ctx.fillStyle = barBg[i];
        roundRect(x, y, barW, barH, 14);
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.strokeStyle = barBorder[i];
        ctx.lineWidth = 2;
        roundRect(x, y, barW, barH, 14);
        ctx.stroke();

        // Color accent bar
        ctx.fillStyle = entry.color;
        roundRect(x, y, 6, barH, 14);
        ctx.fill();
        ctx.fillRect(x + 3, y, 6, barH);

        // Position label
        ctx.textAlign = 'left';
        const posColor = i === 0 ? '#FFD700' : i === 1 ? '#C0C0C0' : i === 2 ? '#CD7F32' : '#888';
        ctx.fillStyle = posColor;
        ctx.font = 'bold 22px "Outfit", sans-serif';
        ctx.fillText(`${medals[i]} ${posLabels[i]}`, x + 20, y + barH / 2 - 14);

        // Player name
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 20px "Outfit", sans-serif';
        ctx.fillText(entry.name, x + 20, y + barH / 2 + 14);

        // Color dot
        ctx.fillStyle = entry.color;
        ctx.beginPath();
        const nameWidth = ctx.measureText(entry.name).width;
        ctx.arc(x + 28 + nameWidth + 10, y + barH / 2 + 14, 5, 0, Math.PI * 2);
        ctx.fill();

        // Time
        ctx.textAlign = 'right';
        if (entry.time !== null) {
            const totalSec = entry.time / 1000;
            const min = Math.floor(totalSec / 60);
            const sec = (totalSec % 60).toFixed(2);
            const timeStr = min > 0 ? `${min}:${sec.padStart(5, '0')}` : `${sec}s`;

            ctx.fillStyle = '#bdc3c7';
            ctx.font = '18px "Outfit", sans-serif';
            ctx.fillText(timeStr, x + barW - 20, y + barH / 2 - 10);

            if (i > 0 && order[0].time !== null) {
                const diff = ((entry.time - order[0].time) / 1000).toFixed(2);
                ctx.fillStyle = '#e74c3c';
                ctx.font = '14px "Outfit", sans-serif';
                ctx.fillText(`+${diff}s`, x + barW - 20, y + barH / 2 + 14);
            }
        } else {
            ctx.fillStyle = '#e74c3c';
            ctx.font = 'bold 20px "Outfit", sans-serif';
            ctx.fillText('DNF', x + barW - 20, y + barH / 2);
        }
        ctx.textAlign = 'left';
    });

    // Return instruction
    ctx.textAlign = 'center';
    const returnText = state.mode === 'online'
        ? 'Press ENTER to return to Room'
        : 'Press ENTER to return to Menu';

    const pulse = 0.6 + Math.sin(performance.now() / 400) * 0.4;
    ctx.fillStyle = `rgba(241, 196, 15, ${pulse})`;
    ctx.font = '20px "Outfit", sans-serif';
    ctx.fillText(returnText, CANVAS_W / 2, CANVAS_H - 50);

    ctx.textBaseline = 'alphabetic';
}

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

    const grassGrad = ctx.createRadialGradient(
        CANVAS_W / 2, CANVAS_H / 2, 200,
        CANVAS_W / 2, CANVAS_H / 2, 800
    );
    grassGrad.addColorStop(0, t.grassColors[0]);
    grassGrad.addColorStop(1, t.grassColors[1]);
    ctx.fillStyle = grassGrad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.fillStyle = 'rgba(0,0,0,0.03)';
    for (let i = 0; i < 60; i++) {
        const gx = (i * 127 + 43) % CANVAS_W;
        const gy = (i * 89 + 17) % CANVAS_H;
        ctx.beginPath();
        ctx.arc(gx, gy, 15 + (i % 10), 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (const sm of state.skidmarks) {
        ctx.beginPath();
        ctx.arc(sm.x, sm.y, 3, 0, Math.PI * 2);
        ctx.fill();
    }

    drawBezierTrack(t.width + 18, '#fff');
    drawBezierTrack(t.width, '#2c3e50');
    drawBezierTrack(t.width - 10, '#34495e');
    drawBezierTrack(2, '#f1c40f', true);

    drawFinishLine();

    // Checkpoint markers (subtle dashed lines across the track)
    ctx.globalAlpha = 0.18;
    t.checkpoints.forEach((cp, i) => {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 8]);
        ctx.beginPath();
        ctx.moveTo(cp.x1, cp.y1);
        ctx.lineTo(cp.x2, cp.y2);
        ctx.stroke();
    });
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
}

function drawParticles() {
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



let isSplashTransitioning = false;

function handleSplashEvent(e) {
    if (isSplashTransitioning) return;
    dismissSplashScreen();
}

function dismissSplashScreen() {
    isSplashTransitioning = true;
    window.removeEventListener('keydown', handleSplashEvent);
    window.removeEventListener('mousedown', handleSplashEvent);

    const pressStartEl = document.getElementById('press-start');
    if (pressStartEl) {
        pressStartEl.classList.add('fade-out');
    }

    // Add menu-active class to #menu to start title slide-up
    const menuEl = document.getElementById('menu');
    if (menuEl) {
        menuEl.classList.add('menu-active');
    }

    // Wait for the fade-out of the splash text (400ms)
    setTimeout(() => {
        if (pressStartEl) {
            pressStartEl.style.display = 'none';
            pressStartEl.classList.remove('fade-out');
        }

        // Show main menu (cards grid)
        showMenu();

        // Stagger fade-in of the three cards
        const cardSolo = document.getElementById('card-solo');
        const cardLocal = document.getElementById('card-local');
        const cardOnline = document.getElementById('card-online');

        if (cardSolo) cardSolo.classList.add('animate-fade-in-up', 'delay-1');
        if (cardLocal) cardLocal.classList.add('animate-fade-in-up', 'delay-2');
        if (cardOnline) cardOnline.classList.add('animate-fade-in-up', 'delay-3');

        // Clear any keys pressed during splash
        Object.keys(keys).forEach(k => keys[k] = false);

        // Clean up animation classes after they finish (1200ms)
        setTimeout(() => {
            if (cardSolo) cardSolo.classList.remove('animate-fade-in-up', 'delay-1');
            if (cardLocal) cardLocal.classList.remove('animate-fade-in-up', 'delay-2');
            if (cardOnline) cardOnline.classList.remove('animate-fade-in-up', 'delay-3');
            isSplashTransitioning = false;
        }, 1200);

    }, 400);
}

function showSplashScreen() {
    isSplashTransitioning = false;

    // Ensure menu does NOT have menu-active class on fresh load (restores title centered)
    const menuEl = document.getElementById('menu');
    if (menuEl) {
        menuEl.classList.remove('menu-active');
    }

    document.getElementById('menu').style.display = 'flex';
    document.getElementById('hud').style.visibility = 'hidden';

    showSection(null);

    const pressStartEl = document.getElementById('press-start');
    if (pressStartEl) pressStartEl.style.display = 'block';

    window.addEventListener('keydown', handleSplashEvent);
    window.addEventListener('mousedown', handleSplashEvent);
}

// ---- Initialize ----

function init() {
    setupNetworkCallbacks();
    initMenus();
    showSplashScreen();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

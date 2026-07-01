// ============================================================
// ui.js — Menu navigation, HUD updates, and DOM management
// ============================================================

import { TRACKS, PLAYER_COLORS, PLAYER_NAMES } from './tracks.js';

// ---- Menu Navigation ----

const ALL_SECTIONS = [
    'main-menu', 'solo-setup', 'local-setup',
    'online-menu', 'create-room', 'join-room', 'lobby',
    'track-menu'
];

let currentFlow = null; // 'solo' | 'local' | 'online'

export function showSection(id) {
    ALL_SECTIONS.forEach(s => {
        const el = document.getElementById(s);
        if (el) el.style.display = (s === id) ? 'flex' : 'none';
    });
}

export function showMenu() {
    document.getElementById('menu').style.display = 'flex';
    document.getElementById('hud').style.visibility = 'hidden';
    showSection('main-menu');
}

export function hideMenu() {
    document.getElementById('menu').style.display = 'none';
    document.getElementById('hud').style.visibility = 'visible';
}

export function setFlow(flow) {
    currentFlow = flow;
}

export function getFlow() {
    return currentFlow;
}

// ---- HUD Management ----

/**
 * Build HUD cards dynamically for N players.
 * @param {Array} cars - Array of DriftCar objects
 * @param {Object} opts - { totalLaps, mode, botSlots, localSlots }
 */
export function buildHUD(cars, opts) {
    const hud = document.getElementById('hud');
    hud.innerHTML = '';
    hud.style.visibility = 'visible';

    // Center title
    const title = document.createElement('div');
    title.className = 'hud-title';
    title.textContent = 'ULTIMATE DRIFT';

    // Create card for each car
    const cardsLeft = document.createElement('div');
    cardsLeft.className = 'hud-cards';

    cars.forEach((car, i) => {
        const card = document.createElement('div');
        card.className = 'player-card';
        card.id = `card-${i}`;
        card.style.borderColor = car.color;
        card.style.boxShadow = `0 0 10px ${car.color}33`;

        let label = '';
        if (car.isBot) {
            label = `BOT ${PLAYER_NAMES[car.slot]}`;
        } else if (car.isRemote) {
            label = `ONLINE ${PLAYER_NAMES[car.slot]}`;
        } else {
            const controlHint = car.slot === 0 ? '(SETAS + SHIFT)' : '(TFGH + Q)';
            label = `JOGADOR ${car.slot + 1} ${opts.mode !== 'online' ? controlHint : ''}`;
        }

        card.innerHTML = `
            <div class="card-name" style="color: ${car.color};">${label}</div>
            <div class="card-stats">
                <span>Volta: <b id="lap-${i}">1</b>/${opts.totalLaps}</span>
                <span>Vel: <b id="speed-${i}">0</b> km/h</span>
            </div>
            <div class="nitro-bar">
                <div id="nitro-${i}" class="nitro-fill" style="background: ${car.color}; width: 100%;"></div>
            </div>
        `;
        cardsLeft.appendChild(card);
    });

    hud.appendChild(cardsLeft);
    hud.appendChild(title);
}

/**
 * Update HUD for a single car.
 */
export function updateHUD(index, car, totalLaps) {
    const lapEl = document.getElementById(`lap-${index}`);
    const speedEl = document.getElementById(`speed-${index}`);
    const nitroEl = document.getElementById(`nitro-${index}`);

    if (lapEl) lapEl.textContent = Math.min(car.currentLap, totalLaps);
    if (speedEl) speedEl.textContent = car.displaySpeed;
    if (nitroEl) nitroEl.style.width = `${Math.max(0, car.nitro)}%`;
}

// ---- Lobby Management ----

export function updateLobbyPlayers(players) {
    const list = document.getElementById('lobby-player-list');
    if (!list) return;

    list.innerHTML = '';
    players.forEach(p => {
        const li = document.createElement('div');
        li.className = 'lobby-player';
        li.style.borderLeftColor = PLAYER_COLORS[p.slot] || '#fff';
        li.innerHTML = `
            <span class="lobby-dot" style="background: ${PLAYER_COLORS[p.slot]}"></span>
            <span>${p.name}</span>
            ${p.isHost ? '<span class="lobby-host-badge">HOST</span>' : ''}
        `;
        list.appendChild(li);
    });
}

export function setRoomCode(code) {
    const el = document.getElementById('display-room-code');
    if (el) el.textContent = code;
}

/**
 * Return to the lobby view after a race ends (online mode).
 * Shows the menu with the lobby section visible and HUD hidden.
 * Does NOT disconnect from WebSocket.
 * @param {boolean} isHost - Whether this player is the host
 */
export function returnToLobby(isHost) {
    document.getElementById('menu').style.display = 'flex';
    document.getElementById('hud').style.visibility = 'hidden';
    showSection('lobby');

    // Show/hide host controls
    const hostControls = document.getElementById('lobby-host-controls');
    if (hostControls) hostControls.style.display = isHost ? 'flex' : 'none';
    const btnStart = document.getElementById('btn-lobby-start');
    if (btnStart) btnStart.style.display = isHost ? 'block' : 'none';
}

// ---- Track Grid Builder ----

export function buildTrackGrid(onSelect) {
    const grid = document.getElementById('track-grid');
    if (!grid) return;

    grid.innerHTML = '';
    TRACKS.forEach((track, i) => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-track';
        if (i >= 4) btn.classList.add('btn-special');
        btn.textContent = `${i + 1}. ${track.name}`;
        btn.addEventListener('click', () => onSelect(i));
        grid.appendChild(btn);
    });
}

// ---- Toast Notifications ----

export function showToast(message, duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, duration);
}

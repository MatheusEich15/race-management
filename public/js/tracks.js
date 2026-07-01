// ============================================================
// tracks.js — Track definitions with improved start grids & finish lines
// ============================================================

export const PLAYER_COLORS = ['#00d2d3', '#ff6b6b', '#ffd32a', '#6c5ce7'];
export const PLAYER_NAMES  = ['CYAN', 'CORAL', 'GOLD', 'PURPLE'];

export const TRACKS = [
    {
        name: "Perfect Mega Oval",
        theme: 'grass',
        grassColors: ['#10ac84', '#0b8463'],
        width: 180,
        startPositions: [
            { x: 190, y: 405 },
            { x: 260, y: 405 },
            { x: 190, y: 460 },
            { x: 260, y: 460 },
        ],
        startAngle: -Math.PI / 2,
        finishLine: {
            x1: 130, y1: 435, x2: 320, y2: 435,
            nx: 0, ny: -1
        },
        points: [
            {x: 200, y: 650}, {x: 200, y: 200}, {x: 450, y: 130},
            {x: 950, y: 130}, {x: 1200, y: 200}, {x: 1200, y: 650},
            {x: 950, y: 720}, {x: 450, y: 720}
        ],
        checkpoints: [
            {x: 700, y: 130, r: 150},
            {x: 1200, y: 425, r: 150},
            {x: 700, y: 720, r: 150}
        ]
    },
    {
        name: "Fluid S Circuit",
        theme: 'grass',
        grassColors: ['#0f9b72', '#0a7d5a'],
        width: 170,
        startPositions: [
            { x: 195, y: 630 },
            { x: 265, y: 630 },
            { x: 195, y: 685 },
            { x: 265, y: 685 },
        ],
        startAngle: -Math.PI / 2,
        finishLine: {
            x1: 130, y1: 655, x2: 320, y2: 655,
            nx: 0, ny: -1
        },
        points: [
            {x: 220, y: 720}, {x: 200, y: 180}, {x: 550, y: 140},
            {x: 650, y: 460}, {x: 900, y: 460}, {x: 1000, y: 160},
            {x: 1220, y: 220}, {x: 1200, y: 700}, {x: 700, y: 730}
        ],
        checkpoints: [
            {x: 550, y: 140, r: 140},
            {x: 775, y: 460, r: 140},
            {x: 1200, y: 700, r: 140}
        ]
    },
    {
        name: "Desert Canyon",
        theme: 'sand',
        grassColors: ['#c4a35a', '#a08040'],
        width: 165,
        startPositions: [
            { x: 895, y: 665 },
            { x: 895, y: 725 },
            { x: 950, y: 665 },
            { x: 950, y: 725 },
        ],
        startAngle: Math.PI,
        finishLine: {
            x1: 920, y1: 610, x2: 920, y2: 780,
            nx: -1, ny: 0
        },
        points: [
            {x: 700, y: 720}, {x: 300, y: 700}, {x: 180, y: 450},
            {x: 300, y: 180}, {x: 700, y: 130}, {x: 1100, y: 180},
            {x: 1250, y: 400}, {x: 1100, y: 680}
        ],
        checkpoints: [
            {x: 300, y: 450, r: 150},
            {x: 700, y: 130, r: 150},
            {x: 1250, y: 400, r: 150}
        ]
    },
    {
        name: "Ultra Wide Circuit",
        theme: 'grass',
        grassColors: ['#16a085', '#11806a'],
        width: 175,
        startPositions: [
            { x: 195, y: 575 },
            { x: 265, y: 575 },
            { x: 195, y: 630 },
            { x: 265, y: 630 },
        ],
        startAngle: -Math.PI / 2,
        finishLine: {
            x1: 130, y1: 600, x2: 320, y2: 600,
            nx: 0, ny: -1
        },
        points: [
            {x: 220, y: 700}, {x: 200, y: 180}, {x: 1200, y: 180},
            {x: 1180, y: 520}, {x: 650, y: 500}, {x: 600, y: 700}
        ],
        checkpoints: [
            {x: 210, y: 180, r: 145},
            {x: 1200, y: 180, r: 145},
            {x: 800, y: 510, r: 145}
        ]
    },
    {
        name: "Horseshoe Circuit",
        theme: 'desert',
        grassColors: ['#d4a76a', '#b8894d'],
        width: 170,
        startPositions: [
            { x: 680, y: 125 },
            { x: 680, y: 175 },
            { x: 620, y: 125 },
            { x: 620, y: 175 },
        ],
        startAngle: 0,
        finishLine: {
            x1: 650, y1: 70, x2: 650, y2: 240,
            nx: 1, ny: 0
        },
        points: [
            {x: 250, y: 720}, {x: 150, y: 150}, {x: 1250, y: 150},
            {x: 1200, y: 720}, {x: 950, y: 500}, {x: 700, y: 700},
            {x: 450, y: 500}
        ],
        checkpoints: [
            {x: 1250, y: 150, r: 140},
            {x: 950, y: 500, r: 140},
            {x: 150, y: 150, r: 140}
        ]
    },
    {
        name: "Super Arena Oval",
        theme: 'night',
        grassColors: ['#1a3c34', '#0f2820'],
        width: 190,
        startPositions: [
            { x: 680, y: 135 },
            { x: 680, y: 195 },
            { x: 620, y: 135 },
            { x: 620, y: 195 },
        ],
        startAngle: 0,
        finishLine: {
            x1: 650, y1: 80, x2: 650, y2: 250,
            nx: 1, ny: 0
        },
        points: [
            {x: 700, y: 150}, {x: 1250, y: 200}, {x: 1250, y: 650},
            {x: 700, y: 720}, {x: 150, y: 650}, {x: 150, y: 200}
        ],
        checkpoints: [
            {x: 1250, y: 425, r: 160},
            {x: 700, y: 720, r: 160},
            {x: 150, y: 425, r: 160}
        ]
    }
];

/**
 * Precompute the Bézier curve path for a track.
 * Returns an array of {x, y} points along the center line.
 */
export function precomputeBezierPath(trackIdx) {
    const t = TRACKS[trackIdx];
    const segments = [];

    const pStart = t.points[0];
    const pEnd = t.points[t.points.length - 1];
    let currentX = (pStart.x + pEnd.x) / 2;
    let currentY = (pStart.y + pEnd.y) / 2;

    for (let i = 0; i < t.points.length; i++) {
        const pControl = t.points[i];
        const pNext = t.points[(i + 1) % t.points.length];
        const nextMidX = (pControl.x + pNext.x) / 2;
        const nextMidY = (pControl.y + pNext.y) / 2;

        const steps = 30;
        for (let s = 0; s <= steps; s++) {
            const pct = s / steps;
            const inv = 1 - pct;
            const bx = inv * inv * currentX + 2 * inv * pct * pControl.x + pct * pct * nextMidX;
            const by = inv * inv * currentY + 2 * inv * pct * pControl.y + pct * pct * nextMidY;
            segments.push({ x: bx, y: by });
        }
        currentX = nextMidX;
        currentY = nextMidY;
    }
    return segments;
}

/**
 * Compute accurate finish lines AND checkpoint lines for all tracks.
 * Both are placed perpendicular to the track direction at the given position,
 * spanning from one edge of the track to the other.
 * Format: { x1, y1, x2, y2, nx, ny } — same as finishLine.
 */
export function computeTrackLines() {
    TRACKS.forEach((track, idx) => {
        const segments = precomputeBezierPath(idx);
        if (segments.length < 5) return;

        const spread = 3;

        // ---- Determine path direction using startAngle ----
        // Find nearest path point to start grid centroid
        const startCx = track.startPositions.reduce((s, p) => s + p.x, 0) / track.startPositions.length;
        const startCy = track.startPositions.reduce((s, p) => s + p.y, 0) / track.startPositions.length;

        let bestDist = Infinity, startPathIdx = 0;
        for (let i = 0; i < segments.length; i++) {
            const dx = segments[i].x - startCx;
            const dy = segments[i].y - startCy;
            const d = dx * dx + dy * dy;
            if (d < bestDist) { bestDist = d; startPathIdx = i; }
        }

        // Tangent at start position
        const prevI = (startPathIdx - spread + segments.length) % segments.length;
        const nextI = (startPathIdx + spread) % segments.length;
        const rawTx = segments[nextI].x - segments[prevI].x;
        const rawTy = segments[nextI].y - segments[prevI].y;

        // Compare with startAngle to know if path direction needs flipping
        const startDx = Math.cos(track.startAngle);
        const startDy = Math.sin(track.startAngle);
        const flipPath = (rawTx * startDx + rawTy * startDy) < 0;

        // ---- Helper: compute a perpendicular line at a target position ----
        function computeLineAt(targetX, targetY) {
            // Find nearest path point
            let best = Infinity, bIdx = 0;
            for (let i = 0; i < segments.length; i++) {
                const dx = segments[i].x - targetX;
                const dy = segments[i].y - targetY;
                const d = dx * dx + dy * dy;
                if (d < best) { best = d; bIdx = i; }
            }

            // Compute tangent from neighbors
            const pI = (bIdx - spread + segments.length) % segments.length;
            const nI = (bIdx + spread) % segments.length;
            let tx = segments[nI].x - segments[pI].x;
            let ty = segments[nI].y - segments[pI].y;
            const tlen = Math.sqrt(tx * tx + ty * ty);
            if (tlen < 0.001) return null;
            tx /= tlen;
            ty /= tlen;

            // Flip to match path direction
            if (flipPath) { tx = -tx; ty = -ty; }

            // Perpendicular direction (line spans this way across the track)
            const px = -ty;
            const py = tx;

            // Center on nearest path point, span track width + margin
            const center = segments[bIdx];
            const halfSpan = (track.width / 2) + 15;

            return {
                x1: Math.round(center.x - px * halfSpan),
                y1: Math.round(center.y - py * halfSpan),
                x2: Math.round(center.x + px * halfSpan),
                y2: Math.round(center.y + py * halfSpan),
                nx: Math.round(tx * 1000) / 1000,
                ny: Math.round(ty * 1000) / 1000
            };
        }

        // ---- Compute finish line ----
        const fl = computeLineAt(startCx, startCy);
        if (fl) track.finishLine = fl;

        // ---- Compute checkpoint lines ----
        // Replace each {x, y, r} checkpoint with a {x1, y1, x2, y2, nx, ny} line
        track.checkpoints = track.checkpoints.map(cp => {
            const line = computeLineAt(cp.x, cp.y);
            return line || cp; // fallback to original if computation fails
        });
    });
}

// Auto-compute all track lines on module load
computeTrackLines();


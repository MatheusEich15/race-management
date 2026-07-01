// ============================================================
// physics.js — Collision detection, track boundaries, geometry
// ============================================================

/**
 * Squared distance between two points
 */
export function dist2(a, b) {
    return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

/**
 * Distance between two points
 */
export function dist(a, b) {
    return Math.sqrt(dist2(a, b));
}

/**
 * Shortest distance from point p to line segment v→w
 */
export function distToSegment(p, v, w) {
    const l2 = dist2(v, w);
    if (l2 === 0) return dist(p, v);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return dist(p, {
        x: v.x + t * (w.x - v.x),
        y: v.y + t * (w.y - v.y)
    });
}

/**
 * Check if a point is on the track (within track width of center line)
 */
export function checkOnTrack(x, y, trackSegments, halfWidth) {
    for (let i = 0; i < trackSegments.length - 1; i++) {
        if (distToSegment({ x, y }, trackSegments[i], trackSegments[i + 1]) < halfWidth) {
            return true;
        }
    }
    return false;
}

/**
 * Test whether two line segments intersect.
 * Segment A: (ax1,ay1)→(ax2,ay2), Segment B: (bx1,by1)→(bx2,by2)
 * Returns true if they cross.
 */
export function segmentsIntersect(ax1, ay1, ax2, ay2, bx1, by1, bx2, by2) {
    const dx = ax2 - ax1, dy = ay2 - ay1;
    const ex = bx2 - bx1, ey = by2 - by1;
    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < 1e-10) return false;

    const fx = bx1 - ax1, fy = by1 - ay1;
    const t = (fx * ey - fy * ex) / denom;
    const u = (fx * dy - fy * dx) / denom;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/**
 * Check if a car crossed the finish line this frame (in the correct direction).
 * prevX/prevY = car position last frame, x/y = current position.
 * finishLine = { x1, y1, x2, y2, nx, ny }
 */
export function checkFinishCrossing(prevX, prevY, x, y, finishLine) {
    if (prevX === undefined || prevY === undefined) return false;

    const crossed = segmentsIntersect(
        prevX, prevY, x, y,
        finishLine.x1, finishLine.y1, finishLine.x2, finishLine.y2
    );

    if (!crossed) return false;

    // Check direction: movement dot normal must be positive (correct direction)
    const dx = x - prevX;
    const dy = y - prevY;
    const dot = dx * finishLine.nx + dy * finishLine.ny;
    return dot > 0;
}

/**
 * Handle collision between two cars.
 * Separates overlapping cars and applies impulse-based velocity exchange.
 */
export function handleCarCollision(c1, c2, particles) {
    const dx = c2.x - c1.x;
    const dy = c2.y - c1.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const minDist = c1.radius + c2.radius;

    if (distance < minDist && distance > 0.01) {
        const nx = dx / distance;
        const ny = dy / distance;
        const overlap = minDist - distance;

        // Separate cars
        c1.x -= nx * (overlap / 2);
        c1.y -= ny * (overlap / 2);
        c2.x += nx * (overlap / 2);
        c2.y += ny * (overlap / 2);

        // Impulse-based velocity exchange
        const kx = c1.vx - c2.vx;
        const ky = c1.vy - c2.vy;
        const p = (nx * kx + ny * ky);
        const pushForce = 1.5;

        c1.vx -= p * nx * pushForce;
        c1.vy -= p * ny * pushForce;
        c2.vx += p * nx * pushForce;
        c2.vy += p * ny * pushForce;

        // Reduce speed (less aggressive than original 0.3)
        c1.speed *= 0.55;
        c2.speed *= 0.55;

        // Spark particles at collision point
        if (particles) {
            const cx = (c1.x + c2.x) / 2;
            const cy = (c1.y + c2.y) / 2;
            for (let i = 0; i < 8; i++) {
                particles.push({
                    x: cx, y: cy,
                    vx: (Math.random() - 0.5) * 6,
                    vy: (Math.random() - 0.5) * 6,
                    size: Math.random() * 3 + 2,
                    alpha: 0.9,
                    color: 'spark'
                });
            }
        }
    }
}

/**
 * Handle collisions among all cars in an array.
 */
export function handleAllCollisions(cars, particles) {
    for (let i = 0; i < cars.length; i++) {
        for (let j = i + 1; j < cars.length; j++) {
            handleCarCollision(cars[i], cars[j], particles);
        }
    }
}

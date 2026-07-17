// ============================================================
// car.js — DriftCar class with improved physics and serialization
// ============================================================

import { checkOnTrack, checkFinishCrossing } from './physics.js';
import { TRACKS, PLAYER_COLORS } from './tracks.js';

export class DriftCar {
    constructor(slotIndex) {
        this.slot = slotIndex;
        this.color = PLAYER_COLORS[slotIndex] || '#ffffff';
        this.width = 23;
        this.height = 44;
        this.radius = 18;
        this.showHeadlights = false; // default to headlights off

        // Physics tuning
        this.maxSpeed = 8.2;
        this.accel = 0.09;
        this.friction = 0.02;
        this.turnSpeed = 0.045;
        this.driftFactor = 0.94;

        // Nitro
        this.nitro = 100;
        this.isBoosting = false;

        // State
        this.x = 0; this.y = 0; this.angle = 0;
        this.prevX = undefined; this.prevY = undefined;
        this.vx = 0; this.vy = 0; this.speed = 0;
        this.steerAngle = 0;

        // Race progress
        this.currentLap = 1;
        this.nextCheckpoint = 0;
        this.finished = false;
        this.finishTime = 0;

        // Type flags
        this.isBot = false;
        this.isRemote = false;
        this.isLocal = false;
        this.isGhost = false;

        // Remote interpolation targets
        this.targetX = 0; this.targetY = 0;
        this.targetAngle = 0;
    }

    reset(x, y, angle) {
        this.x = x; this.y = y; this.angle = angle;
        this.prevX = x; this.prevY = y;
        this.vx = 0; this.vy = 0; this.speed = 0;
        this.steerAngle = 0;
        this.currentLap = 1;
        this.nextCheckpoint = 0;
        this.nitro = 100;
        this.isBoosting = false;
        this.finished = false;
        this.finishTime = 0;
        this.showHeadlights = false;
    }

    /**
     * Update car physics given input flags.
     * @param {Object} input - { up, down, left, right, nitro }
     * @param {Object} trackData - { trackIdx, cachedSegments, totalLaps }
     * @param {Array} skidmarks - shared skidmarks array
     * @param {Array} particles - shared particles array
     */
    update(input, trackData, skidmarks, particles) {
        if (this.finished) return;

        const track = TRACKS[trackData.trackIdx];
        const { up, down, left, right, nitro: nitroKey } = input;

        // Nitro
        this.isBoosting = nitroKey && this.nitro > 0 && up;
        let currentMaxSpeed = this.maxSpeed;

        if (this.isBoosting) {
            currentMaxSpeed *= 1.35;
            this.speed += this.accel * 2.5;
            this.nitro -= 0.7;
            if (this.nitro < 0) this.nitro = 0;

            // Spawn exhaust/flame particles on the track (medium-sized blue tail sparks)
            if (Math.random() > 0.20) {
                particles.push({
                    x: this.x - Math.cos(this.angle) * 22 + (Math.random() - 0.5) * 3,
                    y: this.y - Math.sin(this.angle) * 22 + (Math.random() - 0.5) * 3,
                    vx: -this.vx * 0.15 + (Math.random() - 0.5) * 0.6,
                    vy: -this.vy * 0.15 + (Math.random() - 0.5) * 0.6,
                    size: Math.random() * 2.0 + 1.2,
                    alpha: 0.9,
                    decay: 0.06, // fades fast
                    color: 'blue-spark'
                });
            }
        } else if (this.nitro < 100 && this.speed > 0.5) {
            // Only regen nitro while moving
            this.nitro += 0.08;
        }

        // Steering
        this.steerAngle = 0;
        if (left) { this.angle -= this.turnSpeed; this.steerAngle = -0.4; }
        if (right) { this.angle += this.turnSpeed; this.steerAngle = 0.4; }

        // Acceleration / braking
        if (up) {
            if (this.speed < currentMaxSpeed) this.speed += this.accel;
        } else if (down) {
            if (this.speed > -this.maxSpeed / 2) this.speed -= this.accel * 0.8;
        } else {
            this.speed *= (1 - this.friction);
        }

        // Drift physics
        const targetVx = Math.cos(this.angle) * this.speed;
        const targetVy = Math.sin(this.angle) * this.speed;
        this.vx = this.vx * this.driftFactor + targetVx * (1 - this.driftFactor);
        this.vy = this.vy * this.driftFactor + targetVy * (1 - this.driftFactor);

        // Store previous position for finish line detection
        this.prevX = this.x;
        this.prevY = this.y;

        // Move
        this.x += this.vx;
        this.y += this.vy;

        // Off-track penalty
        if (!checkOnTrack(this.x, this.y, trackData.cachedSegments, track.width / 2)) {
            this.vx *= 0.88;
            this.vy *= 0.88;
            this.speed *= 0.95;
        }

        // Drift effects
        const moveAngle = Math.atan2(this.vy, this.vx);
        const driftIntensity = Math.abs(Math.sin(this.angle - moveAngle)) * Math.sqrt(this.vx ** 2 + this.vy ** 2);

        if (driftIntensity > 2.5 && this.speed > 2) {
            skidmarks.push({ x: this.x, y: this.y });
            if (skidmarks.length > 2000) skidmarks.shift();

            // Standard drift smoke
            particles.push({
                x: this.x - Math.cos(this.angle) * 12,
                y: this.y - Math.sin(this.angle) * 12,
                vx: (Math.random() - 0.5) * 1,
                vy: (Math.random() - 0.5) * 1,
                size: Math.random() * 5 + 3,
                alpha: 0.5,
                color: 'smoke'
            });

            // Spark particles when drifting aggressively (driftIntensity > 4)
            if (driftIntensity > 4.2 && Math.random() > 0.35) {
                particles.push({
                    x: this.x - Math.cos(this.angle) * 15 + (Math.random() - 0.5) * 8,
                    y: this.y - Math.sin(this.angle) * 15 + (Math.random() - 0.5) * 8,
                    vx: -this.vx * 0.2 + (Math.random() - 0.5) * 1.5,
                    vy: -this.vy * 0.2 + (Math.random() - 0.5) * 1.5,
                    size: Math.random() * 2 + 1,
                    alpha: 0.85,
                    color: 'spark'
                });
            }


        }

        // Checkpoint detection (line crossing — same logic as finish line)
        if (this.nextCheckpoint < track.checkpoints.length) {
            const cp = track.checkpoints[this.nextCheckpoint];
            if (checkFinishCrossing(this.prevX, this.prevY, this.x, this.y, cp)) {
                this.nextCheckpoint++;
            }
        }

        // Finish line detection (only if all checkpoints visited)
        if (this.nextCheckpoint >= track.checkpoints.length) {
            if (checkFinishCrossing(this.prevX, this.prevY, this.x, this.y, track.finishLine)) {
                this.nextCheckpoint = 0;
                this.currentLap++;
                if (this.currentLap > trackData.totalLaps) {
                    this.finished = true;
                    this.finishTime = performance.now();
                    this.currentLap = trackData.totalLaps;
                }
            }
        }
    }

    interpolateRemote(lerpFactor = 0.25) {
        // Move by current velocity first (Dead Reckoning)
        this.x += this.vx;
        this.y += this.vy;

        // Correct position toward network target
        this.x += (this.targetX - this.x) * lerpFactor;
        this.y += (this.targetY - this.y) * lerpFactor;

        // Angle interpolation (shortest path)
        let angleDiff = this.targetAngle - this.angle;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        this.angle += angleDiff * lerpFactor;
    }

    /**
     * Draw the car on a canvas context.
     */
    draw(ctx, forceGhost = false, name = '') {
        const ghost = this.isGhost || forceGhost;

        ctx.save();
        if (ghost) ctx.globalAlpha = 0.3;
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle + Math.PI / 2);

        // Blue nitro flames from 2 exhausts (draw behind car) - moderately sized
        if (this.isBoosting) {
            const flameLen = Math.random() * 4.5 + 3.0; // moderately sized
            const drawFlame = (ex) => {
                // Outer blue flame
                ctx.fillStyle = 'rgba(0, 180, 255, 0.85)';
                ctx.beginPath();
                ctx.moveTo(ex - 1.2, this.height / 2 - 2);
                ctx.lineTo(ex, this.height / 2 + flameLen);
                ctx.lineTo(ex + 1.2, this.height / 2 - 2);
                ctx.closePath();
                ctx.fill();

                // Inner white-hot core
                ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
                ctx.beginPath();
                ctx.moveTo(ex - 0.6, this.height / 2 - 2);
                ctx.lineTo(ex, this.height / 2 + flameLen * 0.5);
                ctx.lineTo(ex + 0.6, this.height / 2 - 2);
                ctx.closePath();
                ctx.fill();
            };
            drawFlame(-3.5);
            drawFlame(2.5);
        }

        this.renderCarBody(ctx, name);

        ctx.restore();
    }

    /**
     * Draw a static car at a podium position.
     */
    drawOnPodium(ctx, px, py, scale = 1.2, name = '') {
        ctx.save();
        ctx.translate(px, py);
        ctx.scale(scale, scale);

        this.renderCarBody(ctx, name);

        ctx.restore();
    }

    /**
     * Render the detailed layout of the car body.
     */
    renderCarBody(ctx, name = '') {
        ctx.save();
        ctx.scale(1.15, 1.15); // Scale up rendering by 15% for clear visibility

        // --- Determine name initial or number ---
        let displayChar = String(this.slot + 1);
        if (name) {
            const isDefaultPlayer = /^PLAYER\s+\d+$/i.test(name.trim());
            const isBot = /^BOT\s+/i.test(name.trim());
            if (!isDefaultPlayer && !isBot) {
                const trimmed = name.trim();
                if (trimmed.length > 0) {
                    displayChar = trimmed.charAt(0).toUpperCase();
                }
            }
        }

        // --- 1. Fake shadow for depth (extremely fast & cross-platform) ---
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.translate(1.5, 2.5);
        this.drawBodyPath(ctx);
        ctx.fill();
        // Spoiler shadow
        ctx.fillRect(-12, 17, 24, 2.5);
        ctx.restore();

        // --- 2. Wheels ---
        // Rear wheels (fixed)
        ctx.fillStyle = '#1e272e';
        ctx.fillRect(-11, 6, 2.5, 8);
        ctx.fillRect(8.5, 6, 2.5, 8);
        // Rear wheel rims
        ctx.fillStyle = '#7f8c8d';
        ctx.fillRect(-10.5, 8.5, 1.5, 3);
        ctx.fillRect(9, 8.5, 1.5, 3);

        // Front wheels (steerable)
        const drawFrontWheel = (wx) => {
            ctx.save();
            ctx.translate(wx, -11);
            ctx.rotate(this.steerAngle || 0);
            ctx.fillStyle = '#1e272e';
            ctx.fillRect(-1.25, -4, 2.5, 8); // tire
            ctx.fillStyle = '#7f8c8d';
            ctx.fillRect(-0.75, -1.5, 1.5, 3); // rim
            ctx.restore();
        };
        drawFrontWheel(-9.75);
        drawFrontWheel(9.75);

        // --- 3. Body Paint ---
        ctx.fillStyle = this.color;
        this.drawBodyPath(ctx);
        ctx.fill();

        // 3D Shading gradient overlay on body
        const bodyGrad = ctx.createLinearGradient(-10, 0, 10, 0);
        bodyGrad.addColorStop(0, 'rgba(255, 255, 255, 0.2)');
        bodyGrad.addColorStop(0.3, 'rgba(255, 255, 255, 0.05)');
        bodyGrad.addColorStop(0.7, 'rgba(0, 0, 0, 0.05)');
        bodyGrad.addColorStop(1, 'rgba(0, 0, 0, 0.3)');
        ctx.fillStyle = bodyGrad;
        this.drawBodyPath(ctx);
        ctx.fill();

        // --- 4. Racing Stripes / Accents (clipped to body path) ---
        ctx.save();
        this.drawBodyPath(ctx);
        ctx.clip();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        // Hood stripes
        ctx.fillRect(-3, -18, 1.5, 10);
        ctx.fillRect(1.5, -18, 1.5, 10);
        // Trunk stripes
        ctx.fillRect(-3, 8, 1.5, 9);
        ctx.fillRect(1.5, 8, 1.5, 9);

        ctx.restore();

        // --- 5. Cabin & Windows ---
        // Windshield (dark glossy gradient)
        const windGrad = ctx.createLinearGradient(-6, -6, 7, 2);
        windGrad.addColorStop(0, '#2c3e50');
        windGrad.addColorStop(1, '#0f171e');

        ctx.beginPath();
        ctx.moveTo(-6, -6);
        ctx.lineTo(6, -6);
        ctx.lineTo(7, 1);
        ctx.lineTo(-7, 1);
        ctx.closePath();
        ctx.fillStyle = windGrad;
        ctx.fill();

        // Reflection highlight on windshield
        ctx.beginPath();
        ctx.moveTo(-5, -5);
        ctx.lineTo(1, -5);
        ctx.lineTo(-1, 0);
        ctx.lineTo(-6, 0);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.fill();

        // Rear window
        ctx.beginPath();
        ctx.moveTo(-6, 6);
        ctx.lineTo(6, 6);
        ctx.lineTo(5, 11);
        ctx.lineTo(-5, 11);
        ctx.closePath();
        ctx.fillStyle = '#0f171e';
        ctx.fill();

        // Side windows
        ctx.fillStyle = '#0f171e';
        ctx.fillRect(-6.5, 1.5, 1, 4);
        ctx.fillRect(5.5, 1.5, 1, 4);

        // --- 6. Roof & Nickname Initial / Number ---
        // White circular racing plate (increased size for readability)
        ctx.beginPath();
        ctx.arc(0, 3.0, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = '#1e272e';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Initial or Number (increased font size for high visibility)
        ctx.fillStyle = '#1e272e';
        ctx.font = 'bold 9px "Segoe UI", -apple-system, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(displayChar, 0, 3.5);

        // --- 7. Headlights (Yellow/Gold Glowing Wedges & Light Beams) ---
        ctx.fillStyle = this.showHeadlights ? '#f1c40f' : '#7f8c8d'; // glowing yellow vs unlit gray
        ctx.beginPath();
        ctx.moveTo(-7.5, -17.5);
        ctx.lineTo(-5, -18.5);
        ctx.lineTo(-6, -15.5);
        ctx.closePath();
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(7.5, -17.5);
        ctx.lineTo(5, -18.5);
        ctx.lineTo(6, -15.5);
        ctx.closePath();
        ctx.fill();

        // Glowing light cones/beams (only drawn if showHeadlights is true)
        if (this.showHeadlights) {
            const beamGrad = ctx.createLinearGradient(0, -17.5, 0, -50);
            beamGrad.addColorStop(0, 'rgba(241, 196, 15, 0.35)'); // vibrant yellow near the car
            beamGrad.addColorStop(0.5, 'rgba(241, 196, 15, 0.12)');
            beamGrad.addColorStop(1, 'rgba(241, 196, 15, 0.0)'); // completely fades out

            ctx.fillStyle = beamGrad;
            ctx.beginPath();
            ctx.moveTo(-6, -17.5);
            ctx.lineTo(-24, -50);
            ctx.lineTo(-2, -50);
            ctx.closePath();
            ctx.fill();

            ctx.beginPath();
            ctx.moveTo(6, -17.5);
            ctx.lineTo(2, -50);
            ctx.lineTo(24, -50);
            ctx.closePath();
            ctx.fill();
        }

        // --- 8. Side Mirrors ---
        ctx.fillStyle = this.color;
        ctx.fillRect(-11.5, -5.5, 2, 1);
        ctx.fillRect(9.5, -5.5, 2, 1);
        ctx.fillStyle = '#2c3e50';
        ctx.fillRect(-11.5, -4.5, 2, 0.5);
        ctx.fillRect(9.5, -4.5, 2, 0.5);

        // --- 9. Tail Lights & Rear Bumper ---
        ctx.fillStyle = '#c0392b';
        ctx.fillRect(-8.5, 18, 2.5, 1);
        ctx.fillRect(6, 18, 2.5, 1);

        // --- 10. Aggressive Spoiler / Rear Wing ---
        // Mounts
        ctx.fillStyle = '#1e272e';
        ctx.fillRect(-5.5, 14, 1.5, 4);
        ctx.fillRect(4, 14, 1.5, 4);

        // Main wing blade with Carbon Fiber look
        ctx.fillStyle = '#1e272e';
        ctx.fillRect(-12.5, 17.5, 25, 2);
        ctx.fillStyle = '#111111';
        for (let offset = -11; offset < 12; offset += 3) {
            ctx.fillRect(offset, 17.5, 1.2, 2);
        }

        // Spoiler endplates (matching car theme/color)
        ctx.fillStyle = this.color;
        ctx.fillRect(-13, 15.5, 1, 4.5);
        ctx.fillRect(12, 15.5, 1, 4.5);

        ctx.restore(); // Restore scaling context
    }

    /**
     * Define the outer body contour of the sports car.
     */
    drawBodyPath(ctx) {
        ctx.beginPath();
        // Nose (Front Center)
        ctx.moveTo(0, -19);
        // Curve to front-right nose corner
        ctx.quadraticCurveTo(7.5, -19, 9.5, -14.5);
        // Front-right wheel flare
        ctx.lineTo(9.5, -9);
        // Waist/Side pods pulled in for aerodynamics
        ctx.quadraticCurveTo(7.5, -2, 7.5, 3.5);
        // Rear-right wheel flare
        ctx.lineTo(9.5, 9.5);
        // Rear-right bumper corner
        ctx.quadraticCurveTo(9.5, 16.5, 7.5, 18.5);
        // Rear bumper center
        ctx.lineTo(-7.5, 18.5);
        // Rear-left bumper corner
        ctx.quadraticCurveTo(-9.5, 16.5, -9.5, 9.5);
        // Rear-left wheel flare
        ctx.lineTo(-7.5, 3.5);
        // Waist/Side pods left
        ctx.quadraticCurveTo(-7.5, -2, -9.5, -9);
        // Front-left wheel flare
        ctx.lineTo(-9.5, -14.5);
        // Front-left nose corner
        ctx.quadraticCurveTo(-7.5, -19, 0, -19);
        ctx.closePath();
    }

    /**
     * Compute continuous race progress for ranking.
     * Returns a number where higher = further in the race.
     * Uses laps, checkpoints, and nearest segment index on the path.
     */
    getRaceProgress(cachedSegments, trackIdx) {
        const track = TRACKS[trackIdx];
        const totalCp = track.checkpoints.length;

        if (this.finished) {
            return Infinity;
        }

        // Find nearest segment on the path
        let bestDist = Infinity, bestSegIdx = 0;
        for (let i = 0; i < cachedSegments.length; i++) {
            const dx = cachedSegments[i].x - this.x;
            const dy = cachedSegments[i].y - this.y;
            const d = dx * dx + dy * dy;
            if (d < bestDist) { bestDist = d; bestSegIdx = i; }
        }

        const totalSegs = cachedSegments.length;
        // Progress = lap weight + checkpoint weight + segment position
        return (this.currentLap - 1) * (totalCp + 1) * totalSegs
            + this.nextCheckpoint * totalSegs
            + bestSegIdx;
    }

    /**
     * Serialize car state for network transmission.
     */
    serialize() {
        return {
            slot: this.slot,
            x: Math.round(this.x * 10) / 10,
            y: Math.round(this.y * 10) / 10,
            angle: Math.round(this.angle * 1000) / 1000,
            speed: Math.round(this.speed * 100) / 100,
            vx: Math.round(this.vx * 100) / 100,
            vy: Math.round(this.vy * 100) / 100,
            steerAngle: Math.round(this.steerAngle * 100) / 100,
            isBoosting: this.isBoosting,
            currentLap: this.currentLap,
            nextCheckpoint: this.nextCheckpoint,
            nitro: Math.round(this.nitro),
            finished: this.finished
        };
    }

    /**
     * Apply received network state to this car.
     */
    applyNetState(state) {
        this.targetX = state.x;
        this.targetY = state.y;
        this.targetAngle = state.angle;
        this.speed = state.speed;
        this.vx = state.vx;
        this.vy = state.vy;
        this.steerAngle = state.steerAngle;
        this.isBoosting = state.isBoosting;
        this.currentLap = state.currentLap;
        this.nextCheckpoint = state.nextCheckpoint;
        this.nitro = state.nitro;
        this.finished = state.finished;
    }

    /**
     * Get current speed in "km/h" (display value).
     */
    get displaySpeed() {
        return Math.round(Math.sqrt(this.vx ** 2 + this.vy ** 2) * 25);
    }
}

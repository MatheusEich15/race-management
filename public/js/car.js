// ============================================================
// car.js — DriftCar class with improved physics and serialization
// ============================================================

import { checkOnTrack, checkFinishCrossing } from './physics.js';
import { TRACKS, PLAYER_COLORS } from './tracks.js';

export class DriftCar {
    constructor(slotIndex) {
        this.slot = slotIndex;
        this.color = PLAYER_COLORS[slotIndex] || '#ffffff';
        this.width = 20;
        this.height = 38;
        this.radius = 16;

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
        } else if (this.nitro < 100 && this.speed > 0.5) {
            // Only regen nitro while moving
            this.nitro += 0.08;
        }

        // Steering
        this.steerAngle = 0;
        if (left)  { this.angle -= this.turnSpeed; this.steerAngle = -0.4; }
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

            particles.push({
                x: this.x - Math.cos(this.angle) * 10,
                y: this.y - Math.sin(this.angle) * 10,
                vx: (Math.random() - 0.5) * 1,
                vy: (Math.random() - 0.5) * 1,
                size: Math.random() * 5 + 3,
                alpha: 0.5,
                color: 'smoke'
            });
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

    /**
     * Interpolate toward remote target state (for network play).
     */
    interpolateRemote(lerpFactor = 0.3) {
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
    draw(ctx, forceGhost = false) {
        const ghost = this.isGhost || forceGhost;

        ctx.save();
        if (ghost) ctx.globalAlpha = 0.3;
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle + Math.PI / 2);

        // Nitro flames
        if (this.isBoosting && Math.random() > 0.3) {
            ctx.fillStyle = '#f39c12';
            ctx.fillRect(-4, this.height / 2, 3, Math.random() * 12 + 5);
            ctx.fillStyle = '#ff3f34';
            ctx.fillRect(1, this.height / 2, 3, Math.random() * 12 + 5);
        }

        // Car body
        ctx.fillStyle = this.color;
        ctx.fillRect(-this.width / 2, -this.height / 2, this.width, this.height);

        // Racing stripes
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillRect(-this.width / 2 + 4, -this.height / 2, 3, this.height);
        ctx.fillRect(this.width / 2 - 7, -this.height / 2, 3, this.height);

        // Windshield
        ctx.fillStyle = '#1e272e';
        ctx.fillRect(-this.width / 2 + 2, -this.height / 6, this.width - 4, this.height / 2.2);

        // Rear bumper
        ctx.fillStyle = '#111';
        ctx.fillRect(-this.width / 2 - 3, this.height / 2 - 4, this.width + 6, 5);

        // Front wheels (steerable)
        ctx.save();
        ctx.translate(0, -this.height / 3);
        ctx.rotate(this.steerAngle);
        ctx.fillStyle = '#000';
        ctx.fillRect(-this.width / 2 - 1, -4, 2, 8);
        ctx.fillRect(this.width / 2 - 1, -4, 2, 8);
        ctx.restore();

        // Slot indicator (small number on roof)
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.font = 'bold 10px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(String(this.slot + 1), 0, 5);

        ctx.restore();
    }

    /**
     * Draw a static car at a podium position.
     */
    drawOnPodium(ctx, px, py, scale = 1.2) {
        ctx.save();
        ctx.translate(px, py);
        ctx.scale(scale, scale);

        // Car body
        ctx.fillStyle = this.color;
        ctx.fillRect(-this.width / 2, -this.height / 2, this.width, this.height);

        // Racing stripes
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillRect(-this.width / 2 + 4, -this.height / 2, 3, this.height);
        ctx.fillRect(this.width / 2 - 7, -this.height / 2, 3, this.height);

        // Windshield
        ctx.fillStyle = '#1e272e';
        ctx.fillRect(-this.width / 2 + 2, -this.height / 6, this.width - 4, this.height / 2.2);

        // Slot number
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.font = 'bold 10px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(String(this.slot + 1), 0, 5);

        ctx.restore();
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

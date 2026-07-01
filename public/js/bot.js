// ============================================================
// bot.js — Bot AI controller for drift racing
// ============================================================

export const BOT_CONFIGS = {
    facil:   { maxSpeed: 5.6, error: 0.30, nitroChance: 0.01, lookAhead: 3 },
    medio:   { maxSpeed: 7.5, error: 0.12, nitroChance: 0.03, lookAhead: 4 },
    dificil: { maxSpeed: 9.2, error: 0.02, nitroChance: 0.05, lookAhead: 5 },
};

export class BotAI {
    constructor(difficulty = 'medio') {
        this.difficulty = difficulty;
        this.config = BOT_CONFIGS[difficulty] || BOT_CONFIGS.medio;
        this.targetNode = 0;
    }

    reset() {
        this.targetNode = 0;
    }

    /**
     * Find the nearest track segment node to a given position.
     * Call this after placing the bot car to set a good initial target.
     */
    findNearestNode(carX, carY, cachedSegments) {
        let bestDist = Infinity;
        let bestIdx = 0;
        for (let i = 0; i < cachedSegments.length; i++) {
            const dx = cachedSegments[i].x - carX;
            const dy = cachedSegments[i].y - carY;
            const d = dx * dx + dy * dy;
            if (d < bestDist) {
                bestDist = d;
                bestIdx = i;
            }
        }
        // Start targeting a few nodes ahead of the nearest one
        this.targetNode = (bestIdx + 8) % cachedSegments.length;
    }

    setDifficulty(diff) {
        this.difficulty = diff;
        this.config = BOT_CONFIGS[diff] || BOT_CONFIGS.medio;
    }

    /**
     * Compute input flags for a bot car.
     * @param {DriftCar} car - The bot's car
     * @param {Array} cachedSegments - Precomputed track center points
     * @returns {Object} { up, down, left, right, nitro }
     */
    computeInput(car, cachedSegments) {
        if (cachedSegments.length === 0) {
            return { up: false, down: false, left: false, right: false, nitro: false };
        }

        const target = cachedSegments[this.targetNode % cachedSegments.length];
        const dx = target.x - car.x;
        const dy = target.y - car.y;
        const distToNode = Math.sqrt(dx * dx + dy * dy);

        // Advance target node when close
        if (distToNode < 120) {
            this.targetNode = (this.targetNode + this.config.lookAhead) % cachedSegments.length;
        }

        const targetAngle = Math.atan2(dy, dx);
        const angleDiff = Math.atan2(
            Math.sin(targetAngle - car.angle),
            Math.cos(targetAngle - car.angle)
        );

        const left = angleDiff < -this.config.error;
        const right = angleDiff > this.config.error;
        const up = true;
        const down = false;
        const nitro = (
            Math.abs(angleDiff) < 0.1 &&
            car.nitro > 30 &&
            Math.random() < this.config.nitroChance
        );

        return { up, down, left, right, nitro };
    }
}

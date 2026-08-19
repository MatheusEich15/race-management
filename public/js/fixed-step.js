export const SIMULATION_STEP_MS = 1000 / 60;

export class FixedStepClock {
    constructor(stepMs = SIMULATION_STEP_MS, maxSteps = 8) {
        this.stepMs = stepMs;
        this.maxSteps = maxSteps;
        this.accumulator = 0;
    }

    reset() {
        this.accumulator = 0;
    }

    advance(deltaMs, update) {
        this.accumulator += Math.max(0, Math.min(deltaMs, 250));
        let steps = 0;
        while (this.accumulator + 1e-9 >= this.stepMs && steps < this.maxSteps) {
            update();
            this.accumulator -= this.stepMs;
            steps++;
        }
        if (steps === this.maxSteps) this.accumulator = 0;
        return steps;
    }
}

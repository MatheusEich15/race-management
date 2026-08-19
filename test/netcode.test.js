import test from 'node:test';
import assert from 'node:assert/strict';
import { DriftCar } from '../public/js/car.js';
import { FixedStepClock } from '../public/js/fixed-step.js';
import { TRACKS, precomputeBezierPath } from '../public/js/tracks.js';

const track = TRACKS[0];
const trackData = {
    trackIdx: 0,
    cachedSegments: precomputeBezierPath(0),
    totalLaps: 3,
    effects: false,
    updateRaceProgress: false,
};

function createCar() {
    const car = new DriftCar(0);
    const start = track.startPositions[0];
    car.reset(start.x, start.y, track.startAngle);
    return car;
}

function assertClose(actual, expected, label) {
    assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} !== ${expected}`);
}

test('runs the same 60 simulation ticks at 60 Hz and 144 Hz rendering', () => {
    function countTicks(renderHz) {
        const clock = new FixedStepClock();
        let ticks = 0;
        for (let frame = 0; frame < renderHz; frame++) {
            clock.advance(1000 / renderHz, () => ticks++);
        }
        return ticks;
    }

    assert.equal(countTicks(60), 60);
    assert.equal(countTicks(144), 60);
});

test('rebuilds local prediction from the authoritative state and unacknowledged inputs', () => {
    const commands = Array.from({ length: 24 }, (_, index) => ({
        seq: index + 1,
        input: {
            up: true,
            down: false,
            left: index >= 10 && index < 18,
            right: false,
            nitro: index >= 16,
        },
    }));

    const serverCar = createCar();
    for (const command of commands.slice(0, 9)) {
        serverCar.update(command.input, trackData, [], []);
    }
    const authoritative = { ...serverCar.serialize(), inputSeq: 9 };

    const clientCar = createCar();
    for (const command of commands) {
        clientCar.update(command.input, trackData, [], []);
    }

    const pending = commands.filter(command => command.seq > authoritative.inputSeq);
    clientCar.reconcilePredictedState(authoritative, pending, trackData);

    const expected = createCar();
    expected.applyNetState(authoritative);
    for (const command of pending) {
        expected.update(command.input, trackData, [], []);
    }

    for (const key of ['x', 'y', 'angle', 'speed', 'vx', 'vy', 'nitro']) {
        assertClose(clientCar[key], expected[key], key);
    }
    assert.equal(clientCar.currentLap, authoritative.currentLap);
    assert.equal(clientCar.nextCheckpoint, authoritative.nextCheckpoint);
});

test('keeps prediction aligned while authoritative snapshots cross a 200ms round trip', () => {
    const clientCar = createCar();
    const idealCar = createCar();
    const serverCar = createCar();
    const pending = [];
    const inputTransit = [];
    const snapshotTransit = [];
    const serverQueue = [];
    const oneWayTicks = 6;
    let serverInput = { up: false, down: false, left: false, right: false, nitro: false };
    let processedSeq = 0;
    let maxPredictionError = 0;

    for (let tick = 0; tick < 240; tick++) {
        for (const delivery of inputTransit.filter(item => item.at === tick)) {
            serverQueue.push(delivery.command);
        }
        const nextCommand = serverQueue.shift();
        if (nextCommand) {
            serverInput = nextCommand.input;
            processedSeq = nextCommand.seq;
        }
        serverCar.update(serverInput, trackData, [], []);

        if (tick % 2 === 0) {
            snapshotTransit.push({
                at: tick + oneWayTicks,
                state: { ...serverCar.serialize(), inputSeq: processedSeq },
            });
        }

        for (const delivery of snapshotTransit.filter(item => item.at === tick)) {
            const acknowledged = delivery.state.inputSeq;
            const remaining = pending.filter(command => command.seq > acknowledged);
            pending.splice(0, pending.length, ...remaining);
            clientCar.reconcilePredictedState(delivery.state, pending, trackData);
        }

        const command = {
            seq: tick + 1,
            input: {
                up: true,
                down: false,
                left: tick >= 40 && tick < 85,
                right: tick >= 130 && tick < 175,
                nitro: tick >= 190,
            },
        };
        pending.push(command);
        inputTransit.push({ at: tick + oneWayTicks, command });
        clientCar.update(command.input, trackData, [], []);
        idealCar.update(command.input, trackData, [], []);

        maxPredictionError = Math.max(
            maxPredictionError,
            Math.hypot(clientCar.x - idealCar.x, clientCar.y - idealCar.y),
        );
    }

    assert.ok(maxPredictionError < 0.5, `prediction error reached ${maxPredictionError}px`);
});

test('interpolates remote snapshots by server time instead of render-frame velocity', () => {
    const car = createCar();
    const base = car.serialize();
    car.pushNetSnapshot({ ...base, x: 100, y: 200, angle: Math.PI * 1.9 }, 1000);
    car.pushNetSnapshot({ ...base, x: 200, y: 300, angle: Math.PI * 0.1 }, 1100);

    car.interpolateRemote(1050);

    assert.equal(car.x, 150);
    assert.equal(car.y, 250);
    assert.ok(Math.abs(car.angle - Math.PI * 2) < 1e-9);
});

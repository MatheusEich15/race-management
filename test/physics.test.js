import test from 'node:test';
import assert from 'node:assert/strict';
import { handleCarCollision } from '../public/js/physics.js';

function car(x, vx) {
    return { x, y: 0, vx, vy: 0, speed: Math.abs(vx), radius: 18 };
}

test('separates overlapping cars without a phantom impulse while they move apart', () => {
    const left = car(0, -2);
    const right = car(30, 2);

    handleCarCollision(left, right);

    assert.equal(left.vx, -2);
    assert.equal(right.vx, 2);
    assert.equal(left.speed, 2);
    assert.equal(right.speed, 2);
    assert.ok(right.x - left.x >= 36);
});

test('applies an impulse when overlapping cars move toward each other', () => {
    const left = car(0, 2);
    const right = car(30, -2);

    handleCarCollision(left, right);

    assert.ok(left.vx < 2);
    assert.ok(right.vx > -2);
    assert.ok(left.speed < 2);
    assert.ok(right.speed < 2);
});

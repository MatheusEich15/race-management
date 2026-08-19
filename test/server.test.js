import test from 'node:test';
import assert from 'node:assert/strict';
import { io as createClient } from 'socket.io-client';
import { createGameServer } from '../server.js';

function once(socket, event, predicate = () => true, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            socket.off(event, listener);
            reject(new Error(`Tempo esgotado aguardando ${event}`));
        }, timeoutMs);
        function listener(payload) {
            if (!predicate(payload)) return;
            clearTimeout(timeout);
            socket.off(event, listener);
            resolve(payload);
        }
        socket.on(event, listener);
    });
}

test('owns room membership and car simulation on the server', { timeout: 10000 }, async () => {
    const gameServer = createGameServer({ countdownMs: 50 });
    await new Promise(resolve => gameServer.httpServer.listen(0, '127.0.0.1', resolve));
    const { port } = gameServer.httpServer.address();
    const url = `http://127.0.0.1:${port}`;
    const host = createClient(url, { transports: ['websocket'], forceNew: true });
    const guest = createClient(url, { transports: ['websocket'], forceNew: true });

    try {
        await Promise.all([once(host, 'connect'), once(guest, 'connect')]);
        const createdPromise = once(host, 'room_created');
        host.emit('create_room', { playerName: 'Host' });
        const created = await createdPromise;

        const joinedPromise = once(guest, 'room_joined');
        guest.emit('join_room', { code: created.code, playerName: 'Guest' });
        const joined = await joinedPromise;
        assert.equal(joined.players.length, 2);

        const hostStarting = once(host, 'game_starting');
        const guestStarting = once(guest, 'game_starting');
        host.emit('start_game');
        const [hostConfig, guestConfig] = await Promise.all([hostStarting, guestStarting]);
        assert.deepEqual(hostConfig.participants, guestConfig.participants);
        assert.equal(hostConfig.totalLaps, 3);

        await Promise.all([once(host, 'race_go'), once(guest, 'race_go')]);
        host.emit('player_input', {
            seq: 1,
            input: { up: true, down: false, left: false, right: false, nitro: false },
        });
        host.emit('player_input', {
            seq: 1,
            input: { up: false, down: true, left: false, right: false, nitro: false },
        });
        host.emit('player_input', {
            seq: 2,
            input: { up: true, down: false, left: true, right: false, nitro: false },
        });

        const movingSnapshot = await once(
            guest,
            'game_state',
            snapshot => snapshot.cars.some(
                car => car.slot === created.slot && car.inputSeq === 2 && Math.abs(car.speed) > 0.05,
            ),
        );
        const authoritativeCar = movingSnapshot.cars.find(car => car.slot === created.slot);
        assert.equal(authoritativeCar.inputSeq, 2);
        assert.ok(Math.abs(authoritativeCar.vx) + Math.abs(authoritativeCar.vy) > 0);

        const room = gameServer.rooms.get(created.code);
        assert.equal(room.players.size, 2);
        assert.equal(room.participants.size, 2);
        assert.equal(room.state, 'racing');
        const hostPlayer = [...room.players.values()].find(player => player.slot === created.slot);
        assert.equal(hostPlayer.lastProcessedInputSeq, 2);
        assert.equal(hostPlayer.input.left, true);
        assert.equal(hostPlayer.input.down, false);
    } finally {
        host.disconnect();
        guest.disconnect();
        await gameServer.close();
    }
});

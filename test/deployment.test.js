import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const indexHtml = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const redirectScript = indexHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];

function runRedirect(hostname, href) {
    let destination = null;
    const context = {
        URL,
        window: {
            location: {
                hostname,
                href,
                replace(value) {
                    destination = value;
                },
            },
        },
    };
    vm.runInNewContext(redirectScript, context);
    return destination;
}

test('redirects legacy Vercel deployments to the authoritative Render origin', () => {
    assert.ok(redirectScript);
    assert.equal(
        runRedirect(
            'race-management-lovat.vercel.app',
            'https://race-management-lovat.vercel.app/room?code=ABCD#join',
        ),
        'https://race-management-i09o.onrender.com/room?code=ABCD#join',
    );
});

test('does not redirect the Render deployment', () => {
    assert.equal(
        runRedirect(
            'race-management-i09o.onrender.com',
            'https://race-management-i09o.onrender.com/',
        ),
        null,
    );
});

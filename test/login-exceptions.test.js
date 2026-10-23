'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const client = require.resolve(process.env.NODEDSA_TEST_PACKAGE || '../app');
const fixture = require.resolve('./helpers/mock-dsa');

for (const mode of ['legacy', 'pki']) {
    for (const source of ['dsns', 'token']) {
        test('non-transport login exceptions settle once and recover without unhandled rejection: ' + mode + '/' + source, () => {
            const script = `
                const assert = require('node:assert/strict');
                const api = require(${JSON.stringify(client)});
                const { mockDsa } = require(${JSON.stringify(fixture)});
                const mode = ${JSON.stringify(mode)}, source = ${JSON.stringify(source)};
                const tick = () => new Promise(resolve => setImmediate(resolve));
                (async () => {
                    const bad = Object.create(null);
                    const metadata = Object.defineProperties({}, {
                        retryable: { get() { throw new Error('metadata getter'); } },
                        message: { get() { throw new Error('message getter'); } }
                    });
                    for (const reason of [null, undefined, 'fixture string', bad, metadata]) {
                        const server = mockDsa(); global.fetch = server.fetch;
                        let deny = true, lookups = 0, tokenReads = 0;
                        api.dsnsLookup = (_, callback) => {
                            lookups++; if (source === 'dsns' && deny) throw reason;
                            callback('https://fixture.test/doorway');
                        };
                        const token = source === 'token' ? Object.defineProperty({}, 'Type', { get() {
                            tokenReads++; if (deny) throw reason; return 'Session';
                        } }) : 'fixture';
                        const conn = api.open(source === 'dsns' ? 'school/Contract' : 'https://fixture.test/doorway/Contract', token, { transport: mode });
                        let notifications = 0, notified, ready = false, callbacks = 0, hooks = 0;
                        conn.OnLoginError(error => { notifications++; notified = error; });
                        conn.OnError(() => hooks++);
                        const waiting = conn.ready().then(() => { ready = true; });
                        const queued = await conn.send({ service: 'queued', result: () => callbacks++ }).catch(error => error);
                        assert.equal(notifications, 1); assert.equal(queued.loginError, notified);
                        assert.equal(notified.XMLHttpRequest, reason);
                        assert.equal(notified.message, typeof reason === 'string' ? reason : 'Network error occurred');
                        assert.equal(source === 'dsns' ? lookups : tokenReads, 1);
                        assert.equal((await conn.send({ service: 'later', result: () => callbacks++ }).catch(e => e)).loginError, notified);
                        await tick(); assert.equal(ready, false); assert.equal(callbacks, 2); assert.equal(hooks, 2);
                        const reconnect = conn.reConnect(token).catch(error => error);
                        const pending = conn.send({ service: 'during-reconnect' }).catch(error => error);
                        const failure = await reconnect;
                        assert.equal(failure.XMLHttpRequest, reason);
                        assert.equal((await pending).loginError, failure);
                        assert.equal(notifications, 1);
                        assert.equal(source === 'dsns' ? lookups : tokenReads, 2);
                        deny = false; await conn.reConnect('recovered'); await waiting;
                        assert.equal(ready, true);
                        assert.equal((await conn.send({ service: 'Read' })).Response.Value, 'ok');
                    }
                    console.log('login exceptions passed');
                })().catch(error => { console.error(error); process.exitCode = 1; });
            `;
            // Strict mode turns any extra unhandled rejection into a failing process.
            const child = spawnSync(process.execPath, ['--unhandled-rejections=strict', '-e', script],
                { encoding: 'utf8', timeout: 5000 });
            assert.equal(child.status, 0, child.stdout + child.stderr);
            assert.match(child.stdout, /login exceptions passed/);
        });
    }
}

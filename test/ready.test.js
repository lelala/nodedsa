'use strict';
const assert = require('node:assert/strict');
const { test, afterEach } = require('node:test');
const { execFileSync } = require('node:child_process');
const nodedsa = require(process.env.NODEDSA_TEST_PACKAGE || '../app');
const { mockDsa } = require('./helpers/mock-dsa');
const originalFetch = global.fetch;
const NativePromise = global.Promise;
afterEach(() => { global.fetch = originalFetch; global.Promise = NativePromise; });
const tick = () => new NativePromise(resolve => setImmediate(resolve));
const open = mode => nodedsa.open('https://fixture.test/Any.Contract', 'fake-first', { transport: mode });

for (const mode of ['legacy', 'pki']) {
    test('ready callbacks and Promise resolvers execute once across reconnects: ' + mode, async () => {
        const server = mockDsa(); global.fetch = server.fetch; const conn = open(mode);
        const resolutions = []; const callbacks = [];
        // Observe public Promise settlement calls without adding private runtime hooks.
        class TrackingPromise extends NativePromise {
            static get [Symbol.species]() { return NativePromise; }
            constructor(executor) {
                const index = resolutions.push(0) - 1;
                super((resolve, reject) => executor(value => { resolutions[index]++; resolve(value); }, reject));
            }
        }
        let pending;
        try {
            global.Promise = TrackingPromise;
            pending = [conn.ready(() => callbacks.push('a')), conn.ready(() => callbacks.push('b')), conn.ready()];
        } finally { global.Promise = NativePromise; }
        await NativePromise.all(pending);
        assert.deepEqual(callbacks, ['a', 'b']); assert.deepEqual(resolutions, [1, 1, 1]);
        await conn.reConnect('fake-second'); await conn.reConnect('fake-third');
        assert.deepEqual(callbacks, ['a', 'b']); assert.deepEqual(resolutions, [1, 1, 1]);
        let immediate = 0;
        await conn.ready(() => immediate++);
        assert.equal(immediate, 1);
        await conn.reConnect('fake-fourth'); assert.equal(immediate, 1);
    });

    test('ready survives failed initial login and completes once on recovery: ' + mode, async () => {
        let deny = true;
        const server = mockDsa({ handle: c => c.service === 'DS.Base.Connect' && deny ?
            { xml: '<Envelope><Header><Status><Code>401</Code></Status></Header><Body/></Envelope>' } : undefined });
        global.fetch = server.fetch; const conn = open(mode);
        let calls = 0, settled = false;
        const waiting = conn.ready(() => calls++).then(() => { settled = true; });
        assert.ok((await conn.send({ service: 'Read' }).catch(e => e)).loginError);
        const afterFailure = conn.ready(() => calls++);
        await tick(); assert.equal(calls, 0); assert.equal(settled, false);
        deny = false; await conn.reConnect('fake-recovered');
        await NativePromise.all([waiting, afterFailure]);
        assert.equal(calls, 2); assert.equal(settled, true);
        await conn.reConnect('fake-again'); assert.equal(calls, 2);
    });

    test('ready registered during reconnect completes without replaying prior callbacks: ' + mode, async () => {
        let hold = false, release;
        const server = mockDsa({ handle: c => c.service === 'DS.Base.Connect' && hold ?
            new NativePromise(resolve => { release = () => resolve(); }) : undefined });
        global.fetch = server.fetch; const conn = open(mode);
        let oldCalls = 0, newCalls = 0;
        await conn.ready(() => oldCalls++);
        hold = true; const reconnect = conn.reConnect('fake-second');
        while (!release) await tick();
        const waiting = conn.ready(() => newCalls++);
        assert.equal(newCalls, 0); hold = false; release();
        await NativePromise.all([reconnect, waiting]);
        assert.equal(oldCalls, 1); assert.equal(newCalls, 1);
        await conn.reConnect('fake-third'); assert.equal(newCalls, 1); assert.equal(oldCalls, 1);
    });

    test('ready snapshot is drained before callbacks reenter ready or reconnect: ' + mode, async () => {
        let logins = 0, release;
        const server = mockDsa({ handle: c => {
            if (c.service === 'DS.Base.Connect' && ++logins === 2) {
                return new NativePromise(resolve => { release = () => resolve(); });
            }
        } });
        global.fetch = server.fetch; const conn = open(mode);
        const seen = []; let reconnect, fresh;
        const first = conn.ready(() => {
            seen.push('first');
            conn.ready(() => seen.push('immediate'));
            reconnect = conn.reConnect('fake-next');
            fresh = conn.ready(() => seen.push('new-generation'));
        });
        const second = conn.ready(() => seen.push('second'));
        await NativePromise.all([first, second]);
        while (!release) await tick();
        assert.deepEqual(seen, ['first', 'immediate', 'second']);
        release(); await NativePromise.all([reconnect, fresh]);
        assert.deepEqual(seen, ['first', 'immediate', 'second', 'new-generation']);
        await conn.reConnect('fake-final');
        assert.deepEqual(seen, ['first', 'immediate', 'second', 'new-generation']);
    });

    test('already-ready call stays fulfilled if its callback starts reconnect: ' + mode, async () => {
        let hold = false, release;
        const server = mockDsa({ handle: c => c.service === 'DS.Base.Connect' && hold ?
            new NativePromise(resolve => { release = () => resolve(); }) : undefined });
        global.fetch = server.fetch; const conn = open(mode); await conn.ready();
        let reconnect, settled = false;
        hold = true;
        const waiting = conn.ready(() => { reconnect = conn.reConnect('fake-second'); }).then(() => { settled = true; });
        while (!release) await tick();
        await tick(); // Let the ready Promise's .then run while reconnect is still held.
        assert.equal(settled, true);
        hold = false; release(); await NativePromise.all([waiting, reconnect]);
    });

    test('superseded login success cannot consume ready waiters: ' + mode, async () => {
        const server = mockDsa(); const releases = []; let gate = true;
        global.fetch = async (...args) => {
            const response = await server.fetch(...args);
            if (gate && server.calls.at(-1).service === 'DS.Base.Connect') {
                return new NativePromise(resolve => releases.push(() => resolve(response)));
            }
            return response;
        };
        const conn = open(mode); let calls = 0, settled = false;
        const waiting = conn.ready(() => calls++).then(() => { settled = true; });
        while (releases.length < 1) await tick();
        const reconnect = conn.reConnect('fake-current');
        while (releases.length < 2) await tick();
        releases[0](); await tick();
        assert.equal(calls, 0); assert.equal(settled, false);
        gate = false; releases[1](); await NativePromise.all([waiting, reconnect]);
        assert.equal(calls, 1); assert.equal(settled, true);
        await conn.reConnect('fake-last'); assert.equal(calls, 1);
    });
}

test('ready callback exception is surfaced without blocking other waiters', () => {
    const client = require.resolve(process.env.NODEDSA_TEST_PACKAGE || '../app');
    const fixture = require.resolve('./helpers/mock-dsa');
    const script = `
        const assert = require('node:assert/strict');
        const { mockDsa } = require(${JSON.stringify(fixture)});
        const connApi = require(${JSON.stringify(client)});
        const server = mockDsa(); global.fetch = server.fetch;
        const seen = [];
        process.once('uncaughtException', error => {
            assert.equal(error.message, 'fixture callback');
            assert.deepEqual(seen, ['first', 'second']);
            process.stdout.write('isolated');
        });
        const conn = connApi.open('https://fixture.test/Contract', 'fake');
        Promise.all([
            conn.ready(() => { seen.push('first'); throw new Error('fixture callback'); }),
            conn.ready(() => seen.push('second'))
        ]).then(() => assert.deepEqual(seen, ['first', 'second']));
    `;
    const result = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result, 'isolated');
});

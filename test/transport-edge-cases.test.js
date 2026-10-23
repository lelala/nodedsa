'use strict';
const assert = require('node:assert/strict');
const { test, afterEach } = require('node:test');
const path = require('node:path');
const clientPath = require.resolve(process.env.NODEDSA_TEST_PACKAGE || '../app');
const nodedsa = require(clientPath);
const tunnel = require(path.join(path.dirname(clientPath), 'lib/secure-tunnel'));
const { mockDsa, status, at } = require('./helpers/mock-dsa');
const originalFetch = global.fetch;
const originalLookup = nodedsa.dsnsLookup;
afterEach(() => { global.fetch = originalFetch; nodedsa.dsnsLookup = originalLookup; });
const open = (mode, point = 'https://fixture.test/doorway/Contract') => nodedsa.open(point, 'fixture', { transport: mode });

for (const stage of ['fetch', 'text']) {
    test('transport retains mutable errors and wraps other rejection values: ' + stage, async () => {
        const abort = new AbortController(); abort.abort();
        const frozenError = Object.freeze(Object.assign(new Error('frozen message'), { name: 'AbortError', type: 'fixture_type' }));
        const plain = Object.freeze({ reason: 'fixture' });
        const cannotStringify = Object.freeze(Object.create(null));
        for (const reason of [new Error('mutable message'), abort.signal.reason, frozenError, plain,
            'user-timeout', null, undefined, 0, false, Symbol('fixture'), cannotStringify]) {
            global.fetch = async () => {
                if (stage === 'fetch') throw reason;
                return { text: async () => { throw reason; } };
            };
            let error;
            try { await tunnel.post('https://fixture.test/', '<Envelope/>'); assert.fail('must reject'); }
            catch (caught) { error = caught; }
            assert.equal(error.retryable, true);
            const mutable = reason instanceof Error && Object.isExtensible(reason);
            if (mutable) assert.equal(error, reason);
            else { assert.notEqual(error, reason); assert.equal(error.cause, reason); }
            if (reason instanceof Error) {
                assert.equal(error.name, reason.name); assert.equal(error.message, reason.message);
                assert.equal(error.stack, reason.stack);
            } else if (reason === cannotStringify) assert.equal(error.message, 'Network error occurred');
            else assert.equal(error.message, String(reason));
            if (reason === frozenError) assert.equal(error.type, 'fixture_type');
        }
    });
}

for (const mode of ['legacy', 'pki']) {
    test('aborted service preserves AbortError or explicit cause message without retry: ' + mode, async () => {
        const server = mockDsa(); let attempts = 0;
        global.fetch = async (url, options) => {
            if (options.signal) { attempts++; options.signal.throwIfAborted(); }
            return server.fetch(url, options);
        };
        const conn = open(mode); await conn.ready(); const before = server.calls.length;
        let hooks = 0; conn.OnError(() => hooks++);
        for (const value of ['default', 'user-timeout', null]) {
            const controller = new AbortController();
            if (value === 'default') controller.abort(); else controller.abort(value);
            let notified, calls = 0;
            const error = await conn.send({ service: 'Read', result: (_, error) => { notified = error; calls++; } },
                { signal: controller.signal }).catch(error => error);
            assert.equal(error.networkError.name, value === 'default' ? 'AbortError' : 'Error');
            assert.equal(error.networkError.message, value === 'default' ? controller.signal.reason.message : String(value));
            assert.equal(error.networkError.type, 'fetch_error');
            assert.equal(notified, error); assert.equal(calls, 1);
        }
        assert.equal(attempts, 3); assert.equal(hooks, 3); assert.equal(server.calls.length, before);
    });

    test('primitive login fetch/text failures retain causes and bounded retries: ' + mode, async () => {
        for (const stage of ['fetch', 'text']) for (const reason of ['fixture rejection', null]) {
            let calls = 0;
            global.fetch = async () => {
                calls++;
                if (stage === 'fetch') throw reason;
                return { text: async () => { throw reason; } };
            };
            const conn = open(mode); let notifications = 0;
            conn.OnLoginError(() => notifications++);
            const error = await conn.send({ service: 'Read' }).catch(error => error);
            assert.equal(calls, 4); assert.equal(notifications, 1);
            assert.equal(error.loginError.message, String(reason));
            assert.equal(error.loginError.XMLHttpRequest.cause, reason);
        }
    });

    test('queued and immediate login failures have consistent callback order: ' + mode, async () => {
        const server = mockDsa({ handle: () => ({ xml: status('401') }) }); global.fetch = server.fetch;
        const conn = open(mode); const seen = [];
        conn.OnError(req => seen.push(req.service + ':OnError'));
        for (const service of ['queued', 'later']) {
            await conn.send({ service, result: () => seen.push(service + ':result') })
                .catch(() => seen.push(service + ':catch'));
        }
        assert.deepEqual(seen, ['queued:OnError', 'queued:result', 'queued:catch', 'later:OnError', 'later:result', 'later:catch']);
    });
}

test('PKI rejects unsafe raw paths before lookup or HTTP, including encoded and backslash forms', async () => {
    let lookups = 0, fetches = 0;
    global.fetch = async () => { fetches++; throw new Error('must not fetch'); };
    nodedsa.dsnsLookup = () => { lookups++; throw new Error('must not lookup'); };
    for (const suffix of ['.', '..', '%2e', '%2E%2e', '.%2e', '%2e.', '../Contract',
        'Contract/..', 'Contract/%2e%2E', 'Contract\\..', 'Contract/%5c..', '%ZZ', '%', '%E0%A4%A', 'bad%ZZ/Contract', '.\t./Contract', '.\r./Contract', '.\n./Contract']) {
        for (const prefix of ['school/', 'https://fixture.test/cs4/']) {
            const error = await open('pki', prefix + suffix).send({ service: 'Read' }).catch(error => error);
            assert.equal(error.loginError?.XMLHttpRequest?.type, 'pki_error', prefix + suffix);
        }
    }
    for (const point of ['school\\Contract', 'https://fixture.test\\cs4\\Contract', 'http://fixture.test/cs4\\Contract']) {
        const error = await open('pki', point).send({ service: 'Read' }).catch(error => error);
        assert.equal(error.loginError.XMLHttpRequest.type, 'pki_error', point);
    }
    assert.equal(lookups, 0); assert.equal(fetches, 0);
});

test('PKI preserves legal encoded contracts/query while legacy retains old dot routing', async () => {
    let lookups = 0;
    nodedsa.dsnsLookup = (_, callback) => { lookups++; callback('https://fixture.test/a/b'); };
    const server = mockDsa(); global.fetch = server.fetch;
    for (const point of ['school/%E4%B8%AD%E6%96%87.Contract/?route=https://example.test/../%ZZ\\x#..',
        'https://fixture.test/a/b/%E4%B8%AD%E6%96%87.Contract/?route=https://example.test/../%ZZ\\x#..']) {
        await open('pki', point).send({ service: 'Read' });
    }
    const keys = server.calls.filter(call => call.kind === 'key');
    assert.equal(lookups, 1); assert.equal(keys.length, 2);
    for (const call of keys) {
        assert.equal(call.url, 'https://fixture.test/a/b?route=https://example.test/../%ZZ\\x');
        assert.equal(at(call.outer, 'Body', 'Content', 'Contract').text, '中文.Contract');
    }
    await open('pki', 'https://fixture.test/a/b/Contract\ufeff').send({ service: 'Read' });
    assert.equal(at(server.calls.filter(c => c.kind === 'key').at(-1).outer, 'Body', 'Content', 'Contract').text, 'Contract\ufeff');
    await open('legacy', 'https://fixture.test/cs4/Contract/..').send({ service: 'Read' });
    assert.equal(server.calls.at(-1).url, 'https://fixture.test/cs4/Contract/..');
});

test('unsafe raw DSNS doorway is rejected before PKI public-key requests', async () => {
    let fetches = 0;
    global.fetch = async () => { fetches++; throw new Error('must not fetch'); };
    for (const doorway of ['https://fixture.test/a/../b', 'https://fixture.test/a/%2e%2e/b', 'https://fixture.test/a/%ZZ']) {
        nodedsa.dsnsLookup = (_, callback) => callback(doorway);
        const error = await open('pki', 'school/Contract').send({ service: 'Read' }).catch(error => error);
        assert.equal(error.loginError.XMLHttpRequest.type, 'pki_error');
    }
    assert.equal(fetches, 0);
});

test('PKI rejects decoded slash segments before DSNS/HTTP and allows them in query', async () => {
    let lookups = 0, requests = 0;
    global.fetch = async () => { requests++; throw new Error('must not fetch'); };
    nodedsa.dsnsLookup = (_, callback) => { lookups++; callback('https://fixture.test/dsa/doorway'); };
    for (const segment of ['..%2F..%2Fadmin', '..%2f..%2fadmin', 'Any%2FContract', '%2F', '%2f..', 'prefix%2Fchild/Contract']) {
        for (const prefix of ['school/', 'https://fixture.test/dsa/doorway/']) {
            const error = await open('pki', prefix + segment).send({ service: 'Read' }).catch(error => error);
            assert.equal(error.loginError.XMLHttpRequest.type, 'pki_error', prefix + segment);
        }
    }
    assert.equal(lookups, 0); assert.equal(requests, 0);
    for (const doorway of ['https://fixture.test/dsa%2Fdoorway', 'https://fixture.test/..%2fadmin']) {
        nodedsa.dsnsLookup = (_, callback) => { lookups++; callback(doorway); };
        const error = await open('pki', 'school/Contract').send({ service: 'Read' }).catch(error => error);
        assert.equal(error.loginError.XMLHttpRequest.type, 'pki_error');
    }
    assert.equal(lookups, 2); assert.equal(requests, 0);
    const server = mockDsa(); global.fetch = server.fetch;
    await open('pki', 'https://fixture.test/dsa/doorway/Contract?value=..%2F..%2Fadmin#%2F').send({ service: 'Read' });
    assert.equal(server.calls[0].url, 'https://fixture.test/dsa/doorway?value=..%2F..%2Fadmin');
    assert.equal(at(server.calls[0].outer, 'Body', 'Content', 'Contract').text, 'Contract');
    await open('legacy', 'https://fixture.test/dsa/doorway/..%2F..%2Fadmin').send({ service: 'Read' });
    assert.equal(server.calls.at(-1).url, 'https://fixture.test/dsa/doorway/..%2F..%2Fadmin');
});

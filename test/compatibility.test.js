'use strict';
const assert = require('node:assert/strict');
const { test, afterEach } = require('node:test');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const nodexml = require('nodexml');
const nodedsa = require(process.env.NODEDSA_TEST_PACKAGE || '../app');
const { mockDsa, status } = require('./helpers/mock-dsa');
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });
const open = mode => nodedsa.open('https://fixture.test/doorway/Contract', 'fixture-token', { transport: mode });
const tick = () => new Promise(resolve => setImmediate(resolve));

for (const mode of ['legacy', 'pki']) {
    test('initial login error callback reconnects once without a notification chain: ' + mode, () => {
        const script = `
            const assert = require('node:assert/strict');
            const { mockDsa, status } = require(${JSON.stringify(require.resolve('./helpers/mock-dsa'))});
            const client = require(${JSON.stringify(require.resolve(process.env.NODEDSA_TEST_PACKAGE || '../app'))});
            const server = mockDsa({ handle: () => ({ xml: status('401') }) });
            global.fetch = server.fetch;
            const conn = client.open('https://fixture.test/doorway/Contract', 'fixture', { transport: ${JSON.stringify(mode)} });
            let callbacks = 0, reconnect;
            conn.OnLoginError(() => {
                if (++callbacks > 4) throw new Error('notification chain');
                reconnect = conn.reConnect('fixture').catch(error => error);
            });
            conn.send({ service: 'Read' }).catch(async () => {
                const error = await reconnect;
                assert.equal(error.statusCode, '401');
                assert.equal(callbacks, 1);
                assert.equal(server.calls.filter(c => c.service === 'DS.Base.Connect').length, 2);
                console.log('bounded reconnect');
            }).catch(error => { console.error(error); process.exitCode = 1; });
        `;
        const child = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 5000 });
        assert.equal(child.status, 0, child.stdout + child.stderr);
        assert.match(child.stdout, /bounded reconnect/);
    });

    test('reconnect failure settles queued/later sends and preserves late registration: ' + mode, async () => {
        let deny = false;
        const server = mockDsa({ handle: c => deny && c.service === 'DS.Base.Connect' ? { xml: status('403') } : undefined });
        global.fetch = server.fetch; const conn = open(mode); await conn.ready();
        let notifications = 0, results = 0, errors = 0;
        conn.OnLoginError(() => notifications++); conn.OnError(() => errors++);
        deny = true;
        const reconnect = conn.reConnect('next').catch(error => error);
        const queued = conn.send({ service: 'Read', result: () => results++ }).catch(error => error);
        assert.equal((await reconnect).statusCode, '403');
        assert.equal((await queued).loginError.statusCode, '403');
        assert.equal((await conn.send({ service: 'Later', result: () => results++ }).catch(error => error)).loginError.statusCode, '403');
        assert.equal(notifications, 0); assert.equal(results, 2); assert.equal(errors, 2);
        let late, lateCalls = 0;
        conn.OnLoginError(error => { late = error; lateCalls++; });
        assert.equal(late.statusCode, '403'); assert.equal(lateCalls, 1); assert.equal(notifications, 0);
        deny = false; await conn.reConnect('recovered');
        assert.equal((await conn.send({ service: 'Read' })).Response.Value, 'ok');
    });

    test('superseded initial failure does not notify or end current reconnect: ' + mode, async () => {
        let release, logins = 0;
        const server = mockDsa({ handle: c => {
            if (c.service === 'DS.Base.Connect' && ++logins === 1) {
                return new Promise(resolve => { release = () => resolve({ xml: status('401') }); });
            }
        } });
        global.fetch = server.fetch; const conn = open(mode); let errors = 0;
        conn.OnLoginError(() => errors++);
        while (!release) await tick();
        await conn.reConnect('current'); release(); await tick();
        assert.equal(errors, 0); assert.equal((await conn.send({ service: 'Read' })).Response.Value, 'ok');
    });

    for (const plain of [false, true]) {
        test('HTTP 500 preserves service and login DSA fields: ' + mode + '/plain=' + plain, async () => {
            let failLogin = false;
            const data = status('501').replace('test status', 'server message');
            const server = mockDsa({ handle: c => c.service !== 'DS.Base.Connect' || failLogin ?
                { xml: data, plain, ok: false, httpStatus: 500 } : undefined });
            global.fetch = server.fetch; const conn = open(mode); await conn.ready();
            let resultError, hookError, response, parsed;
            conn.OnError((_, error) => { hookError = error; });
            const error = await conn.send({ service: 'Read', result: (_, e, r, p) => {
                resultError = e; response = r; parsed = p;
            } }).catch(error => error);
            assert.equal(error.dsaError.status, '501'); assert.equal(error.dsaError.message, 'server message');
            assert.equal(error.networkError, null); assert.equal(response.status, 500);
            assert.deepEqual(parsed, nodexml.xml2obj(data)); assert.equal(resultError, error); assert.equal(hookError, error);
            failLogin = true;
            const second = open(mode);
            const loginError = await new Promise(resolve => second.OnLoginError(resolve));
            assert.equal(loginError.statusCode, '501'); assert.equal(loginError.message, 'server message');
            assert.equal(loginError.data, data); assert.equal(loginError.textStatus, 'unknow');
            assert.equal(loginError.XMLHttpRequest.status, 500);
            assert.equal(server.calls.filter(c => c.service === 'DS.Base.Connect').length, 2);
        });
    }

    test('non-2xx without a DSA error is http_error, including status zero: ' + mode, async () => {
        let reply;
        const server = mockDsa({ handle: c => c.service !== 'DS.Base.Connect' ? reply : undefined });
        global.fetch = server.fetch; const conn = open(mode); await conn.ready();
        for (const wire of ['<html><body>gateway</body></html>', '', status('0'), '<Envelope><Header/></Envelope>']) {
            reply = { wire, ok: false, httpStatus: 502 };
            const error = await conn.send({ service: 'Read' }).catch(error => error);
            assert.equal(error.networkError.type, 'http_error', wire); assert.equal(error.dsaError, null);
        }
        // The fixture encrypts this status-zero envelope in PKI mode.
        reply = { xml: status('0'), ok: false, httpStatus: 500 };
        assert.equal((await conn.send({ service: 'Read' }).catch(error => error)).networkError.type, 'http_error');
    });

    test('missing DSA Message remains undefined in login and service: ' + mode, async () => {
        let deny = false;
        const data = '<Envelope><Header><Status><Code>501</Code></Status></Header><Body/></Envelope>';
        const server = mockDsa({ handle: c => c.service !== 'DS.Base.Connect' || deny ? { xml: data } : undefined });
        global.fetch = server.fetch; const conn = open(mode); await conn.ready();
        const error = await conn.send({ service: 'Read' }).catch(error => error);
        assert.ok(Object.hasOwn(error.dsaError, 'message')); assert.equal(error.dsaError.message, undefined);
        deny = true; const second = open(mode);
        const loginError = await new Promise(resolve => second.OnLoginError(resolve));
        assert.ok(Object.hasOwn(loginError, 'message')); assert.equal(loginError.message, undefined);
    });

    test('invalid object XML fails locally once with xml_error: ' + mode, async () => {
        const server = mockDsa(); global.fetch = server.fetch;
        const conn = open(mode); await conn.ready();
        let hooked; conn.OnError((_, error) => { hooked = error; });
        const before = server.calls.length;
        for (const body of [{ Request: { Name: 'A\x1aB' } }, { Request: { '1st': 'value' } }]) {
            const copy = structuredClone(body); let notified, count = 0;
            const error = await conn.send({ service: 'Write', body, result: (_, error) => {
                notified = error; count++;
            } }).catch(error => error);
            assert.equal(error.networkError.type, 'xml_error');
            assert.equal(notified, error); assert.equal(hooked, error); assert.equal(count, 1);
            assert.equal(server.calls.length, before); assert.deepEqual(body, copy);
            assert.doesNotMatch(JSON.stringify(error), /A\\u001aB/);
        }
    });

    test('initial text-read failures notify once and reconnect gets a fresh retry budget: ' + mode, async () => {
        const server = mockDsa(); let reads = 0;
        global.fetch = async (...args) => {
            const response = await server.fetch(...args);
            return { ...response, text: async () => { reads++; throw new Error('fixture body unavailable'); } };
        };
        const conn = open(mode); let notified = 0;
        conn.OnLoginError(() => notified++);
        const initial = await conn.send({ service: 'Read' }).catch(error => error);
        assert.equal(initial.loginError.message, 'fixture body unavailable');
        assert.equal(reads, 4); assert.equal(notified, 1);
        await assert.rejects(conn.reConnect('next'), error => error.message === 'fixture body unavailable');
        assert.equal(reads, 8); assert.equal(notified, 1);
    });
}

for (const text of ['A\x1aB', 'A&#x1A;B', 'A&nbsp;B']) {
    test('legacy preserves nodexml text while PKI rejects: ' + JSON.stringify(text), async () => {
        for (const mode of ['legacy', 'pki']) {
            const data = status('0', '<Response><Value>' + text + '</Value></Response>');
            const server = mockDsa({ handle: c => c.service !== 'DS.Base.Connect' ? { xml: data } : undefined });
            global.fetch = server.fetch; const conn = open(mode); let parsed;
            const result = await conn.send({ service: 'Read', result: (_, e, r, p) => { parsed = p; } }).catch(error => error);
            if (mode === 'legacy') {
                assert.deepEqual(result, nodexml.xml2obj(data).Envelope.Body);
                assert.deepEqual(parsed, nodexml.xml2obj(data));
            } else { assert.equal(result.networkError.type, 'pki_error'); assert.equal(server.calls.length, 3); }
        }
    });
}

for (const data of ['<html><body>gateway</body></html>', '', '<Envelope><Header/></Envelope>']) {
    test('legacy 2xx non-envelope/status retains old error fields: ' + JSON.stringify(data), async () => {
        const server = mockDsa({ handle: c => c.service !== 'DS.Base.Connect' ? { wire: data } : undefined });
        global.fetch = server.fetch; const conn = open('legacy'); let response, parsed;
        const error = await conn.send({ service: 'Read', result: (_, e, r, p) => { response = r; parsed = p; } }).catch(error => error);
        const expected = nodexml.xml2obj(data);
        assert.equal(error.networkError, null);
        assert.deepEqual(error.dsaError, { header: expected?.Envelope ? expected.Envelope.Header : null, status: '', message: '' });
        assert.deepEqual(parsed, expected); assert.ok(response);
        global.fetch = async () => ({ ok: true, status: 200, text: async () => data });
        const second = open('legacy');
        const loginError = await new Promise(resolve => second.OnLoginError(resolve));
        assert.equal(loginError.data, data); assert.equal(loginError.textStatus, 'unknow');
        assert.equal(loginError.statusCode, ''); assert.equal(loginError.message, '');
        assert.equal(loginError.XMLHttpRequest.status, 200);
    });
}

test('legacy parser exceptions are xml_error and do not retry login', async () => {
    const runtimeXml = createRequire(require.resolve(process.env.NODEDSA_TEST_PACKAGE || '../app'))('nodexml');
    const original = runtimeXml.xml2obj;
    try {
        const server = mockDsa(); let malformed = false;
        global.fetch = async (...args) => {
            const response = await server.fetch(...args);
            return malformed ? { ...response, text: async () => 'fixture-parser-throws' } : response;
        };
        runtimeXml.xml2obj = data => { if (data === 'fixture-parser-throws') throw new Error('parser failure'); return original(data); };
        const conn = open('legacy'); await conn.ready(); malformed = true;
        const error = await conn.send({ service: 'Read' }).catch(error => error);
        assert.equal(error.networkError.type, 'xml_error');
        const before = server.calls.length;
        const second = open('legacy');
        const loginError = await new Promise(resolve => second.OnLoginError(resolve));
        assert.equal(loginError.XMLHttpRequest.type, 'xml_error'); assert.equal(server.calls.length, before + 1);
    } finally { runtimeXml.xml2obj = original; }
});

test('PKI non-2xx damaged cipher stays pki_error', async () => {
    const wire = '<Envelope><Header><CryptoToken><Cipher>!!!!</Cipher></CryptoToken></Header><Body/></Envelope>';
    const server = mockDsa({ handle: c => c.service !== 'DS.Base.Connect' ? { wire, ok: false, httpStatus: 500 } : undefined });
    global.fetch = server.fetch; const conn = open('pki');
    assert.equal((await conn.send({ service: 'Read' }).catch(error => error)).networkError.type, 'pki_error');
    assert.equal(server.calls.length, 3);
});

test('PKI key HTTP failure preserves DSA errors but never accepts a key as success', async () => {
    for (const type of ['error', 'key', 'html', 'zero']) {
        const server = mockDsa();
        const data = type === 'error' ? status('501') : type === 'key' ? server.publicXml : type === 'zero' ? status('0') : '<html>gateway</html>';
        global.fetch = async (...args) => {
            const response = await server.fetch(...args);
            return { ...response, ok: false, status: 500, text: async () => data };
        };
        const conn = open('pki');
        const error = await new Promise(resolve => conn.OnLoginError(resolve));
        if (type === 'error') {
            assert.equal(error.statusCode, '501'); assert.equal(error.message, 'test status');
            assert.equal(error.data, data); assert.equal(error.XMLHttpRequest.status, 500);
        } else assert.equal(error.XMLHttpRequest.type, 'http_error');
        assert.equal(server.calls.length, 1);
        assert.ok(!server.calls[0].options.body.includes('fixture-token'));
    }
});

for (const mode of ['legacy', 'pki']) {
    test('non-2xx login without DSA error terminates once without accepting success: ' + mode, async () => {
        for (const reply of [
            { wire: '<html>gateway</html>' }, { wire: '' }, { xml: status('0') }, { xml: status('0'), plain: true }
        ]) {
            const server = mockDsa({ handle: c => c.service === 'DS.Base.Connect' ?
                { ...reply, ok: false, httpStatus: 502 } : undefined });
            global.fetch = server.fetch; const conn = open(mode); let calls = 0;
            conn.OnLoginError(() => calls++);
            const error = await conn.send({ service: 'Read' }).catch(error => error);
            assert.equal(error.loginError.XMLHttpRequest.type, 'http_error');
            assert.equal(calls, 1);
            assert.equal(server.calls.filter(c => c.service === 'DS.Base.Connect').length, 1);
            assert.equal(server.calls.filter(c => c.service === 'Read').length, 0);
        }
    });
}

for (const mode of ['legacy', 'pki']) {
    test('invalid access points have a neutral type and missing PKI contract stays pki_error: ' + mode, async () => {
        let calls = 0; global.fetch = async () => { calls++; throw new Error('must not fetch'); };
        const original = nodedsa.dsnsLookup;
        try {
            for (const point of [123, {}, ['school'], 'ftp://fixture.test/Contract', 'https://']) {
                const error = await nodedsa.open(point, 'fixture', { transport: mode }).send({ service: 'Read' }).catch(error => error);
                assert.equal(error.loginError.XMLHttpRequest.type, 'access_point_error');
            }
            for (const result of ['[object Object]', 'school', 'ftp://fixture.test', {}]) {
                nodedsa.dsnsLookup = (_, callback) => callback(result);
                const error = await nodedsa.open('school/Contract', 'fixture', { transport: mode }).send({ service: 'Read' }).catch(error => error);
                assert.equal(error.loginError.XMLHttpRequest.type, 'access_point_error');
            }
            if (mode === 'pki') {
                const error = await nodedsa.open('school/', 'fixture', { transport: mode }).send({ service: 'Read' }).catch(error => error);
                assert.equal(error.loginError.XMLHttpRequest.type, 'pki_error');
            }
            assert.equal(calls, 0);
        } finally { nodedsa.dsnsLookup = original; }
    });

    test('initial login replaced by failed reconnect is observed through Promise then ready recovers: ' + mode, async () => {
        let release, logins = 0, recover = false;
        const server = mockDsa({ handle: c => {
            if (c.service === 'DS.Base.Connect' && ++logins === 1) {
                return new Promise(resolve => { release = () => resolve({ xml: status('401') }); });
            }
            if (c.service === 'DS.Base.Connect' && !recover) return { xml: status('403') };
        } });
        global.fetch = server.fetch; const conn = open(mode);
        let notifications = 0, readyCalls = 0, settled = false;
        conn.OnLoginError(() => notifications++);
        const ready = conn.ready(() => readyCalls++).then(() => { settled = true; });
        const queued = conn.send({ service: 'Read' }).catch(error => error);
        while (!release) await tick();
        await assert.rejects(conn.reConnect('current'), error => error.statusCode === '403');
        assert.equal((await queued).loginError.statusCode, '403');
        release(); await tick();
        assert.equal(notifications, 0); assert.equal(settled, false); assert.equal(readyCalls, 0);
        const afterFailure = conn.ready(() => readyCalls++);
        recover = true; await conn.reConnect('recovered'); await Promise.all([ready, afterFailure]);
        assert.equal(readyCalls, 2); assert.equal(notifications, 0);
    });
}

test('PKI validates each distinct XML once and preserves rejection rules', () => {
    const script = `
        const assert = require('node:assert/strict');
        const path = require('node:path');
        const entry = ${JSON.stringify(require.resolve(process.env.NODEDSA_TEST_PACKAGE || '../app'))};
        const xml = require(path.join(path.dirname(entry), 'lib/xml'));
        const validate = xml.validateXml; const seen = [];
        xml.validateXml = data => { seen.push(data); return validate(data); };
        const client = require(entry);
        const { mockDsa, status } = require(${JSON.stringify(require.resolve('./helpers/mock-dsa'))});
        (async () => {
            let reply;
            const server = mockDsa({ handle: c => c.service !== 'DS.Base.Connect' ? reply : undefined });
            global.fetch = server.fetch;
            const conn = client.open('https://fixture.test/Contract', 'fixture', { transport: 'pki' });
            await conn.ready();
            assert.equal(seen.length, 3); // RSA key, encrypted login outer, login inner.
            for (const plain of [true, false]) {
                seen.length = 0; reply = { xml: status('501'), plain };
                const error = await conn.send({ service: 'Read' }).catch(error => error);
                assert.equal(error.dsaError.status, '501');
                assert.equal(seen.length, plain ? 1 : 2);
                assert.equal(new Set(seen).size, seen.length);
            }
            seen.length = 0; reply = { xml: status('0') };
            await conn.send({ service: 'Read' }); assert.equal(seen.length, 2);
            assert.equal(new Set(seen).size, 2);
            seen.length = 0; reply = { xml: status('0'), plain: true };
            assert.equal((await conn.send({ service: 'Read' }).catch(e => e)).networkError.type, 'pki_error');
            assert.equal(seen.length, 1);
            seen.length = 0;
            const keyError = mockDsa({ publicXml: status('501') }); global.fetch = keyError.fetch;
            const failing = client.open('https://fixture.test/Contract', 'fixture', { transport: 'pki' });
            assert.equal((await failing.send({ service: 'Read' }).catch(e => e)).loginError.statusCode, '501');
            assert.equal(seen.length, 1);
            console.log('validation counts passed');
        })().catch(error => { console.error(error); process.exitCode = 1; });
    `;
    const child = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 5000 });
    assert.equal(child.status, 0, child.stdout + child.stderr);
    assert.match(child.stdout, /validation counts passed/);
});

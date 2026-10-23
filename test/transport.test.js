'use strict';
const assert = require('node:assert/strict');
const { test, afterEach } = require('node:test');
const nodexml = require('nodexml');
const nodedsa = require(process.env.NODEDSA_TEST_PACKAGE || '../app');
const { mockDsa, at, status, parse } = require('./helpers/mock-dsa');
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });
const tick = () => new Promise(resolve => setImmediate(resolve));
const open = (mode, token = 'fake-passport-access-token', url = 'https://fixture.test/dsa/doorway/Any.Contract') =>
    nodedsa.open(url, token, mode === undefined ? undefined : { transport: mode });

for (const mode of [undefined, 'legacy', 'pki']) {
    test('wire contract, options, Session and reconnect: ' + (mode || 'default'), async () => {
        const server = mockDsa(); global.fetch = server.fetch;
        const conn = open(mode);
        const headers = new Headers({ traceparent: 'fixture-trace' });
        const controller = new AbortController();
        const request = { service: 'Generic.Read', body: { Request: { Description: '中文\n 內容 & ]]>' } } };
        const before = structuredClone(request);
        let callback;
        request.result = (...args) => { callback = args; };
        const resp = await conn.send(request, { headers, signal: controller.signal, method: 'GET', body: 'ignored' });
        assert.equal(resp.Response.Value, 'ok');
        assert.deepEqual(callback[0], resp); assert.equal(callback[1], null);
        assert.deepEqual(callback[3], nodexml.xml2obj(status()));
        assert.deepEqual(request.body, before.body); assert.equal(headers.get('content-type'), null);
        const requests = server.calls.filter(c => c.kind !== 'key');
        const [login, service] = requests;
        assert.equal(server.calls.filter(c => c.kind === 'key').length, mode === 'pki' ? 1 : 0);
        assert.equal(at(login.inner, 'Header', 'SecurityToken').attributes.Type, 'PassportAccessToken');
        assert.equal(at(login.inner, 'Header', 'SecurityToken', 'AccessToken').text, 'fake-passport-access-token');
        assert.equal(at(service.inner, 'Header', 'SecurityToken').attributes.Type, 'Session');
        assert.equal(at(service.inner, 'Header', 'SecurityToken', 'SessionID').text, 'session-id');
        assert.equal(at(service.inner, 'Body', 'Request', 'Description').text, before.body.Request.Description);
        assert.equal(service.options.headers.get('traceparent'), 'fixture-trace');
        assert.equal(service.options.signal, controller.signal); assert.equal(service.options.method, 'POST');
        assert.equal(new Headers(login.options.headers).get('traceparent'), null);
        assert.equal(login.options.signal, undefined);
        assert.equal(service.mode, mode === 'pki' ? 'pki' : 'legacy');
        if (mode === 'pki') {
            for (const call of requests) {
                assert.equal(call.url, 'https://fixture.test/dsa/doorway');
                assert.equal(at(call.inner, 'Header', 'TargetContract').text, 'Any.Contract');
                assert.equal(at(call.outer, 'Header', 'TargetContract').text, 'Any.Contract');
                assert.ok(!call.options.body.includes('fake-passport-access-token'));
                assert.ok(!call.options.body.includes('Generic.Read'));
                assert.ok(!call.options.body.includes('中文'));
            }
            const keyCall = server.calls[0];
            assert.equal(at(keyCall.outer, 'Header', 'TargetContract').text, 'info');
            assert.equal(at(keyCall.outer, 'Body', 'Content', 'Format').text, 'pkcs8');
            assert.equal(at(keyCall.outer, 'Body', 'Content', 'Contract').text, 'Any.Contract');
            assert.equal(at(keyCall.outer, 'Header', 'SecurityToken'), undefined);
            assert.notEqual(login.uuid, service.uuid); assert.equal(login.clientPublic, service.clientPublic);
        } else {
            assert.equal(service.url, 'https://fixture.test/dsa/doorway/Any.Contract');
            assert.ok(login.options.body.includes('fake-passport-access-token'));
        }
        assert.equal(conn.getAccessPoint(), 'https://fixture.test/dsa/doorway/Any.Contract');
        let ready = 0; conn.ready(() => ready++);
        await conn.reConnect('fake-second-token');
        await conn.send({ service: 'Generic.Read' });
        assert.equal(ready, 1);
        assert.equal(server.calls.filter(c => c.kind === 'key').length, mode === 'pki' ? 2 : 0);
        for (const c of server.calls.filter(c => c.kind === 'key' || c.service === 'DS.Base.Connect')) {
            assert.equal(new Headers(c.options.headers).get('traceparent'), null);
            assert.equal(c.options.signal, undefined);
        }
    });
}

test('PKI concurrent responses, per-request keys and process public key reuse', async () => {
    const releases = new Map();
    const server = mockDsa({ handle: async c => {
        if (c.service.startsWith('Read.')) return new Promise(resolve => releases.set(c.service, () =>
            resolve({ xml: status('0', '<Value>' + c.service + '</Value>') })));
    } });
    global.fetch = server.fetch;
    const c = open('pki'); await c.ready();
    const a = c.send({ service: 'Read.One' }); const b = c.send({ service: 'Read.Two' });
    await tick(); releases.get('Read.Two')();
    assert.equal((await b).Value, 'Read.Two'); releases.get('Read.One')();
    assert.equal((await a).Value, 'Read.One');
    const second = open('pki'); await second.ready();
    const encrypted = server.calls.filter(c => c.mode === 'pki');
    assert.equal(new Set(encrypted.map(c => c.uuid)).size, encrypted.length);
    assert.equal(new Set(encrypted.map(c => c.clientPublic)).size, 1);
    assert.equal(server.calls.filter(c => c.kind === 'key').length, 2);
});

for (const mode of ['legacy', 'pki']) {
    test('structured errors for queued/later sends and ready limitation: ' + mode, async () => {
        const server = mockDsa({ handle: () => ({ xml: status('401'), plain: true }) }); global.fetch = server.fetch;
        const c = open(mode); const callbacks = [], errors = [], logins = [];
        c.OnError(req => errors.push(req.service)); c.OnError(req => errors.push(req.service));
        c.OnLoginError(error => logins.push(error));
        let ready = false; c.ready().then(() => { ready = true; });
        const pending = ['One', 'Two', 'Three'].map(service => c.send({ service, result: (body, error) => {
            assert.equal(body, null); callbacks.push([service, error]);
        } }).catch(e => e));
        const results = await Promise.all(pending);
        const later = await c.send({ service: 'Later' }).catch(e => e);
        assert.equal(logins.length, 1); assert.equal(ready, false);
        for (const e of [...results, later]) {
            assert.equal(e.loginError.statusCode, '401'); assert.equal(e.dsaError, null); assert.equal(e.networkError, null);
        }
        assert.deepEqual(callbacks.map(c => c[0]), ['One', 'Two', 'Three']);
        assert.equal(errors.length, 8); assert.equal(new Set(errors).size, 4);
        let reconnectError; c.OnLoginError(e => { reconnectError = e; });
        const immediateError = reconnectError;
        await assert.rejects(c.reConnect('fake-new-token'), e => e.statusCode === '401');
        assert.equal(reconnectError, immediateError); assert.equal(logins.length, 1);
    });

    test('terminal reconnect network retry rejects without OnLoginError replay: ' + mode, async () => {
        const server = mockDsa(); global.fetch = server.fetch; const c = open(mode); await c.ready();
        let attempts = 0, loginErrors = 0; c.OnLoginError(() => loginErrors++);
        global.fetch = async () => { attempts++; throw new Error('fixture offline'); };
        const reconnect = c.reConnect('fake-new-token');
        const queued = c.send({ service: 'Read' }).catch(e => e);
        await assert.rejects(reconnect, e => e.message === 'fixture offline');
        assert.equal((await queued).loginError.message, 'fixture offline');
        assert.equal(attempts, 4); assert.equal(loginErrors, 0);
        global.fetch = server.fetch; await c.reConnect('fake-recovered-token');
        assert.equal((await c.send({ service: 'Read' })).Response.Value, 'ok');
    });

    test('service status/error fields, invalid XML and HTTP failure: ' + mode, async () => {
        let reply;
        const server = mockDsa({ handle: c => c.service !== 'DS.Base.Connect' ? reply : undefined });
        global.fetch = server.fetch; const c = open(mode); await c.ready();
        for (const plain of [false, true]) {
            reply = { xml: status('500'), plain };
            let callback, errorHook;
            c.OnError((req, error) => { errorHook = error; });
            const e = await c.send({ service: 'Read', result: (_, error) => { callback = error; } }).catch(e => e);
            assert.equal(e.dsaError.status, '500'); assert.equal(e.networkError, null);
            assert.equal(callback, e); assert.equal(errorHook, e);
            assert.deepEqual(e.dsaError.header, nodexml.xml2obj(status('500')).Envelope.Header);
        }
        reply = { wire: '<Envelope><Header></Envelope>' };
        const invalid = await c.send({ service: 'Read' }).catch(e => e);
        if (mode === 'pki') assert.equal(invalid.networkError.type, 'pki_error');
        else { assert.equal(invalid.dsaError.status, ''); assert.equal(invalid.networkError, null); }
        reply = { ok: false, httpStatus: 503 };
        assert.equal((await c.send({ service: 'Read' }).catch(e => e)).networkError.type, 'http_error');
    });

    test('response nodexml shapes and raw XML unchanged: ' + mode, async () => {
        const bodies = [
            '<Response><Metadata><Column Index="0" Field="json"/></Metadata><Record><Column Index="0">{&quot;中文&quot;:&quot;&amp;lt;&quot;}</Column></Record></Response>',
            '<Response><Metadata><Column Index="0" Field="a"/><Column Index="1" Field="b"/></Metadata><Record><Column Index="0">中文</Column><Column Index="1">&amp;lt;</Column></Record><Record><Column Index="0">二</Column><Column Index="1">三</Column></Record></Response>',
            ''
        ];
        let current = bodies[0];
        const server = mockDsa({ handle: c => c.service !== 'DS.Base.Connect' ? { xml: status('0', current) } : undefined });
        global.fetch = server.fetch; const c = open(mode);
        for (const body of bodies) {
            current = body; let full;
            const result = await c.send({ service: 'Read', body: '<Raw><![CDATA[ $& $` $\' \n]]></Raw>',
                result: (_, err, response, parsed) => { assert.equal(err, null); full = parsed; } });
            assert.deepEqual(full, nodexml.xml2obj(status('0', body)));
            assert.deepEqual(result, full.Envelope.Body || {});
            assert.ok(server.calls.at(-1).innerXml.includes('<Raw><![CDATA[ $& $` $\' \n]]></Raw>'));
        }
    });
}

for (const publicXml of ['', '<RSAKeyValue/>', '<RSAKeyValue><Modulus>!!!!</Modulus><Exponent>AQAB</Exponent></RSAKeyValue>', '<not-closed>', status('403')]) {
    test('key acquisition failure never sends credentials: ' + JSON.stringify(publicXml.slice(0, 30)), async () => {
        const server = mockDsa({ publicXml }); global.fetch = server.fetch;
        const c = open('pki'); let loginError; c.OnLoginError(e => { loginError = e; });
        const e = await c.send({ service: 'Read' }).catch(e => e);
        assert.equal(e.loginError, loginError); assert.equal(server.calls.length, 1);
        assert.ok(!server.calls[0].options.body.includes('fake-passport-access-token'));
    });
}
for (const wire of [status(), '<Envelope><Header><CryptoToken><Cipher/></CryptoToken></Header><Body/></Envelope>',
    '<Envelope><Header><CryptoToken><Cipher>!!!!</Cipher></CryptoToken></Header><Body/></Envelope>',
    '<Envelope><Header><CryptoToken><Cipher>AAAAAAAAAAAAAAAAAAAAAA==</Cipher></CryptoToken></Header><Body/></Envelope>',
    '<Envelope><Header/><Body/></Envelope>']) {
    test('PKI malformed/plain-success response rejects without fallback: ' + wire.slice(0, 45), async () => {
        const server = mockDsa({ handle: c => c.service !== 'DS.Base.Connect' ? { wire } : undefined });
        global.fetch = server.fetch; const c = open('pki'); await c.ready();
        const e = await c.send({ service: 'Read', body: { Value: 'fake-secret' } }).catch(e => e);
        assert.equal(e.networkError.type, 'pki_error'); assert.equal(server.calls.length, 3);
        assert.ok(server.calls.at(-1).options.body.includes('CryptoToken'));
        assert.ok(!JSON.stringify(e).includes('fake-secret'));
    });
}

test('access point/options validation and DSNS boundary', async () => {
    let calls = 0; global.fetch = async () => { calls++; throw new Error('must not fetch'); };
    for (const options of [null, [], 'pki', { transport: 'auto' }, { contract: 'Any.Contract' }, { signal: {} }]) {
        assert.throws(() => nodedsa.open('https://fixture.test/Contract', 'fake', options), TypeError);
    }
    for (const url of ['ftp://fixture.test/Contract', 'https://', 'https://fixture.test/']) {
        const e = await open('pki', 'fake', url).send({ service: 'Read' }).catch(e => e);
        assert.ok(e.loginError);
    }
    assert.ok((await nodedsa.open('school', 'fake', { transport: 'pki' }).send({ service: 'Read' }).catch(e => e)).loginError);
    assert.equal(calls, 0);
    const original = nodedsa.dsnsLookup;
    try {
        for (const value of ['[object Object]', 'school', 'ftp://fixture.test']) {
            nodedsa.dsnsLookup = (_, cb) => cb(value);
            for (const mode of ['legacy', 'pki']) assert.ok((await open(mode, 'fake', 'school/Contract').send({ service: 'Read' }).catch(e => e)).loginError);
        }
        const server = mockDsa(); global.fetch = server.fetch;
        nodedsa.dsnsLookup = (_, cb) => cb('https://fixture.test/nested/doorway');
        const pki = open('pki', 'fake', 'school/Any.Contract/'); await pki.send({ service: 'Read' });
        assert.equal(server.calls[0].url, 'https://fixture.test/nested/doorway');
        const legacy = nodedsa.open('school', 'fake'); await legacy.send({ service: 'Read' });
        assert.equal(server.calls.at(-1).url, 'https://fixture.test/nested/doorway');
    } finally { nodedsa.dsnsLookup = original; }
});

test('URL query/fragment and object token shape', async () => {
    const server = mockDsa(); global.fetch = server.fetch;
    const token = { '@': ['Type'], Type: 'Passport', DSAPassport: { Fake: 'xml' } };
    const before = structuredClone(token);
    await open('pki', token, 'https://fixture.test/a/b/Custom.Contract/?route=one#ignored').send({ service: 'Read' });
    assert.equal(server.calls[0].url, 'https://fixture.test/a/b?route=one');
    assert.deepEqual(token, before);
    assert.equal(at(server.calls[1].inner, 'Header', 'SecurityToken').attributes.Type, 'Passport');
    assert.equal(at(server.calls[1].inner, 'Header', 'SecurityToken', 'DSAPassport', 'Fake').text, 'xml');
});

test('reconnect isolates old public key and login generations', async () => {
    for (const stage of ['key', 'login']) {
        const server = mockDsa(); let release, delayed = false;
        global.fetch = async (...args) => {
            const reply = await server.fetch(...args);
            const call = server.calls.at(-1);
            if (!delayed && (stage === 'key' ? call.kind === 'key' : call.service === 'DS.Base.Connect')) {
                delayed = true; return new Promise(resolve => { release = () => resolve(reply); });
            }
            return reply;
        };
        const c = open('pki');
        while (!release) await tick();
        let ready = 0; c.ready(() => ready++);
        await c.reConnect('fake-current-token');
        release(); await tick();
        await c.send({ service: 'Read' });
        assert.equal(ready, 1);
        const logins = server.calls.filter(c => c.service === 'DS.Base.Connect');
        assert.equal(at(logins.at(-1).inner, 'Header', 'SecurityToken', 'AccessToken').text, 'fake-current-token');
        assert.equal(server.calls.filter(c => c.kind === 'key').length, 2);
    }
});

for (const mode of ['legacy', 'pki']) {
    test('Fetch HeadersInit variants, invalid options, caller immutability and aborted service: ' + mode, async () => {
        const server = mockDsa(); global.fetch = server.fetch;
        const c = open(mode);
        for (const headers of [{ traceparent: 'x' }, new Headers({ traceparent: 'x' }), [['traceparent', 'x']]]) {
            const request = { service: 'Read', body: { Value: 'ok' } };
            const options = { headers, redirect: 'manual', method: 'GET', body: 'ignored' };
            const snapshot = structuredClone(request);
            await c.send(request, options);
            assert.deepEqual(request, snapshot);
            const sent = server.calls.at(-1).options;
            assert.equal(sent.headers.get('traceparent'), 'x');
            assert.equal(sent.redirect, 'manual'); assert.equal(sent.method, 'POST');
            assert.equal(options.method, 'GET'); assert.equal(options.body, 'ignored');
        }
        let callback, hook;
        c.OnError((req, error) => { hook = error; });
        const e = await c.send({ service: 'Read', result: (_, error) => { callback = error; } },
            { headers: { 'invalid header': 'fixture' } }).catch(e => e);
        assert.equal(e.networkError.name, 'TypeError'); assert.equal(callback, e); assert.equal(hook, e);
        const controller = new AbortController(); controller.abort();
        const fetch = server.fetch;
        global.fetch = (url, options) => {
            if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            return fetch(url, options);
        };
        assert.equal((await c.send({ service: 'Read' }, { signal: controller.signal }).catch(e => e)).networkError.name, 'AbortError');
    });
}

test('a canceled service does not cancel shared PKI initialization', async () => {
    const server = mockDsa(); let release;
    global.fetch = async (url, options) => {
        if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const reply = await server.fetch(url, options);
        if (server.calls.at(-1).kind === 'key') return new Promise(resolve => { release = () => resolve(reply); });
        return reply;
    };
    const conn = open('pki'); const ctrl = new AbortController();
    const canceled = conn.send({ service: 'Read' }, { signal: ctrl.signal }).catch(e => e);
    const good = conn.send({ service: 'Read' }); ctrl.abort();
    while (!release) await tick();
    assert.equal(server.calls.length, 1); assert.equal(server.calls[0].options.signal, undefined);
    release();
    assert.equal((await canceled).networkError.name, 'AbortError'); assert.equal((await good).Response.Value, 'ok');
});

test('Session object login preserves shape and does not request another Session', async () => {
    const server = mockDsa(); global.fetch = server.fetch;
    const token = { '@': ['Type'], Type: 'Session', SessionID: 'provided-session' };
    const conn = open('pki', token); await conn.send({ service: 'Read' });
    assert.equal(at(server.calls[1].inner, 'Body', 'RequestSessionID'), undefined);
    assert.equal(at(server.calls.at(-1).inner, 'Header', 'SecurityToken', 'SessionID').text, 'provided-session');
});

test('old retry and in-flight response cannot corrupt reconnected session', async () => {
    const server = mockDsa(); let first = true, completeOld;
    global.fetch = async (...args) => {
        if (first) { first = false; throw new Error('first login offline'); }
        return server.fetch(...args);
    };
    const conn = open('pki'); await tick(); await conn.reConnect('fake-fresh');
    const wrapped = server.fetch;
    global.fetch = async (...args) => {
        const result = await wrapped(...args);
        if (server.calls.at(-1).service === 'Old.Read') return new Promise(resolve => { completeOld = () => resolve(result); });
        return result;
    };
    const old = conn.send({ service: 'Old.Read' }); while (!completeOld) await tick();
    await conn.reConnect('fake-latest'); completeOld();
    assert.equal((await old).Response.Value, 'ok');
    await new Promise(resolve => setTimeout(resolve, 510));
    assert.equal(server.calls.filter(c => c.service === 'DS.Base.Connect').length, 2);
    assert.equal((await conn.send({ service: 'New.Read' })).Response.Value, 'ok');
});

test('invalid decrypted XML is not accepted as an encrypted success', async () => {
    const server = mockDsa({ handle: c => c.service !== 'DS.Base.Connect' ? { xml: '<Envelope><Header></Envelope>' } : undefined });
    global.fetch = server.fetch; const conn = open('pki');
    assert.equal((await conn.send({ service: 'Read' }).catch(e => e)).networkError.type, 'pki_error');
    assert.equal(server.calls.length, 3);
});

for (const mode of ['legacy', 'pki']) {
    test('multiple queued successes and readiness handlers are independent: ' + mode, async () => {
        const server = mockDsa({ handle: c => c.service !== 'DS.Base.Connect' ?
            { xml: status('0', '<Value>' + c.service + '</Value>') } : undefined });
        global.fetch = server.fetch; const conn = open(mode);
        const callbacks = []; let ready = 0;
        conn.ready(() => ready++); conn.ready(() => ready++);
        const result = await Promise.all(['One', 'Two', 'Three'].map(service => conn.send({ service,
            result: body => callbacks.push(body.Value) })));
        assert.deepEqual(result.map(body => body.Value), ['One', 'Two', 'Three']);
        assert.deepEqual(callbacks, ['One', 'Two', 'Three']); assert.equal(ready, 2);
        assert.equal(conn.getUserInfo().UserName, 'fixture');
    });
}

for (const mode of ['legacy', 'pki']) {
    test('reconnect reuses resolved doorway after DSNS cache expiry and outage: ' + mode, async () => {
        const originalNow = Date.now;
        let expired = false, lookups = 0;
        const server = mockDsa();
        global.fetch = async (url, options) => {
            if (options.body.includes('<TargetService>DS.NameService.GetDoorwayURL</TargetService>')) {
                lookups++;
                if (expired) throw new Error('fixture DSNS unavailable');
                return { text: async () => status('0', '<DoorwayURL>https://fixture.test/nested/doorway</DoorwayURL>') };
            }
            return server.fetch(url, options);
        };
        try {
            const conn = open(mode, 'fake-first', 'cache-expiry-' + mode + '/Custom.Contract');
            await conn.send({ service: 'Read' });
            assert.equal(lookups, 1);
            const logical = conn.getAccessPoint();
            expired = true; Date.now = () => originalNow() + 6 * 60 * 1000;
            await conn.reConnect('fake-second');
            assert.equal((await conn.send({ service: 'Read' })).Response.Value, 'ok');
            assert.equal(lookups, 1);
            assert.equal(conn.getAccessPoint(), logical);
            const keyCalls = server.calls.filter(c => c.kind === 'key');
            assert.equal(keyCalls.length, mode === 'pki' ? 2 : 0);
            const logins = server.calls.filter(c => c.service === 'DS.Base.Connect');
            assert.equal(logins.length, 2);
            assert.equal(at(logins[1].inner, 'Header', 'SecurityToken', 'AccessToken').text, 'fake-second');
            for (const call of server.calls) {
                assert.equal(call.url, 'https://fixture.test/nested/doorway' + (mode === 'pki' ? '' : '/Custom.Contract'));
                if (mode === 'pki' && call.kind !== 'key') {
                    assert.equal(at(call.inner, 'Header', 'TargetContract').text, 'Custom.Contract');
                }
            }
        } finally { Date.now = originalNow; }
    });

    test('reconnect retries DSNS when no valid doorway was previously resolved: ' + mode, async () => {
        const lookup = nodedsa.dsnsLookup;
        const server = mockDsa(); global.fetch = server.fetch;
        let attempts = 0;
        nodedsa.dsnsLookup = (name, callback) => {
            attempts++;
            callback(attempts === 1 ? name : 'https://fixture.test/doorway');
        };
        try {
            const conn = open(mode, 'fake-first', 'initial-lookup-failure/Custom.Contract');
            assert.ok((await conn.send({ service: 'Read' }).catch(error => error)).loginError);
            assert.equal(server.calls.length, 0);
            await conn.reConnect('fake-second');
            assert.equal((await conn.send({ service: 'Read' })).Response.Value, 'ok');
            assert.equal(attempts, 2);
        } finally { nodedsa.dsnsLookup = lookup; }
    });
}

test('PKI rejects missing or decoded whitespace DSNS contract before lookup', async () => {
    const original = nodedsa.dsnsLookup;
    let lookups = 0;
    const server = mockDsa(); global.fetch = server.fetch;
    nodedsa.dsnsLookup = (_, cb) => { lookups++; cb('https://fixture.test/cs4/school'); };
    try {
        for (const point of ['school/', 'school///', 'school/%20', 'school/%20///',
            'school/%09%0A%0D/', 'school/?route=x', 'school/#fragment']) {
            const conn = open('pki', 'fake', point);
            let notified;
            conn.OnLoginError(error => { notified = error; });
            const error = await conn.send({ service: 'Read' }).catch(error => error);
            assert.match(error.loginError.message, /PKI requires a contract path/, point);
            assert.equal(error.loginError, notified);
        }
        const invalid = await open('pki', 'fake', 'school/%ZZ').send({ service: 'Read' }).catch(error => error);
        assert.ok(invalid.loginError);
        assert.equal(lookups, 0); assert.equal(server.calls.length, 0);
        for (const point of ['school/Any%2EContract///', 'https://fixture.test/cs4/school/Any%2EContract///']) {
            await open('pki', 'fake', point).send({ service: 'Read' });
        }
        for (const call of server.calls.filter(call => call.kind === 'key')) {
            assert.equal(call.url, 'https://fixture.test/cs4/school');
            assert.equal(at(call.outer, 'Body', 'Content', 'Contract').text, 'Any.Contract');
        }
        await open('legacy', 'fake', 'school/').send({ service: 'Read' });
        assert.equal(server.calls.at(-1).url, 'https://fixture.test/cs4/school/');
    } finally { nodedsa.dsnsLookup = original; }
});

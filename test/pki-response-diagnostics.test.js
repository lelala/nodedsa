'use strict';

const assert = require('node:assert/strict');
const { test, afterEach } = require('node:test');
const { createRequire } = require('node:module');
const entry = require.resolve(process.env.NODEDSA_TEST_PACKAGE || '../app');
const nodedsa = require(entry);
const { parseEnvelope } = createRequire(entry)('./lib/secure-tunnel');
const { mockDsa, status } = require('./helpers/mock-dsa');

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

const largeText = '界🚧'.repeat(2500);
const open = () => nodedsa.open('https://fixture.test/doorway/Contract', 'fixture-credential', { transport: 'pki' });
const cipherEnvelope = cipher => '<Envelope><Header><CryptoToken><Cipher>' +
    cipher + '</Cipher></CryptoToken></Header><Body/></Envelope>';

function assertDiagnostics(error, response, wire) {
    assert.deepEqual({
        httpStatus: error.httpStatus,
        contentType: error.contentType,
        bodyLength: error.bodyLength,
        responseSample: error.responseSample
    }, {
        httpStatus: response.status,
        contentType: response.headers.get('content-type') ?? undefined,
        bodyLength: Buffer.byteLength(wire, 'utf8'),
        responseSample: Array.from(wire).slice(0, 4096).join('')
    });
    assert.ok(Object.hasOwn(error, 'contentType'));
}

function serve(reply, httpStatus, contentType, service = 'Read') {
    const server = mockDsa({ handle: call => call.service === service ? reply : undefined });
    const served = {};
    global.fetch = async (url, options) => {
        const result = await server.fetch(url, options);
        if (server.calls.at(-1).service !== service) return result;
        served.wire = await result.text();
        const headers = contentType === undefined ? {} : { 'Content-Type': contentType };
        served.response = new Response(Buffer.from(served.wire), { status: httpStatus, headers });
        return served.response;
    };
    return served;
}

for (const [label, httpStatus, contentType, makeWire, type, message] of [
    ['HTML interception', 200, 'text/html', text => '<html><body>' + text + '</body></html>',
        'pki_error', 'Invalid PKI response'],
    ['invalid XML', 200, undefined, text => '<Envelope>' + text + '</Mismatch>',
        'pki_error', 'Invalid PKI response'],
    ['Cipher decryption failure', 502, 'application/xml', text => cipherEnvelope(
        Buffer.alloc(text === largeText ? 3073 : 1).toString('base64')), 'pki_error', 'Invalid PKI response'],
    ['HTTP error without a DSA status', 503, 'text/html', text => text,
        'http_error', 'DSA HTTP request failed (503)']
]) {
    for (const [size, payload] of [['short', '封鎖'], ['long', largeText]]) {
        test(label + ' reports response diagnostics (' + size + ')', async () => {
            const wire = makeWire(payload);
            const served = serve({ wire }, httpStatus, contentType);
            const conn = open();
            await conn.ready();
            let resultError, hookError;
            conn.OnError((_, error) => { hookError = error; });
            await assert.rejects(conn.send({
                service: 'Read',
                body: { Secret: 'fixture-request-body' },
                result: (_, error) => { resultError = error; }
            }, { headers: { 'X-Api-Key': 'fixture-api-key' } }), error => {
                assert.equal(error.networkError.type, type);
                assert.equal(error.networkError.message, message);
                assert.equal(error.dsaError, null);
                assert.equal(resultError, error);
                assert.equal(hookError, error);
                assertDiagnostics(error.networkError, served.response, wire);
                assert.doesNotMatch(JSON.stringify(error), /fixture-credential|fixture-request-body|fixture-api-key|SecretKey/);
                return true;
            });
        });
    }
}

for (const [plain, payload] of [[true, '拒絕'], [true, largeText], [false, largeText]]) {
    test('HTTP 500 preserves DSA error and reports wire diagnostics (plain=' + plain + ', payload=' + payload.length + ')', async () => {
        const xml = status('501', '<Response>' + payload + '</Response>');
        const served = serve({ xml, plain }, 500, 'application/xml');
        const conn = open();
        await conn.ready();
        let resultError;
        await assert.rejects(conn.send({ service: 'Read', result: (_, error, response, parsed) => {
            resultError = error;
            assert.equal(response, served.response);
            assert.equal(parsed.Envelope.Header.Status.Code, '501');
        } }), error => {
            assert.equal(resultError, error);
            assert.equal(error.networkError, null);
            assert.equal(error.dsaError.status, '501');
            assert.equal(error.dsaError.message, 'test status');
            assertDiagnostics(error.dsaError, served.response, served.wire);
            return true;
        });
    });
}

test('login errors retain response diagnostics in the existing error location', async () => {
    let served = serve({ wire: '<html>封鎖</html>' }, 200, 'text/html', 'DS.Base.Connect');
    const first = await new Promise(resolve => open().OnLoginError(resolve));
    assert.equal(first.XMLHttpRequest.type, 'pki_error');
    assert.equal(first.message, 'Invalid PKI response');
    assertDiagnostics(first.XMLHttpRequest, served.response, served.wire);

    served = serve({ xml: status('501'), plain: true }, 500, 'application/xml', 'DS.Base.Connect');
    const second = await new Promise(resolve => open().OnLoginError(resolve));
    assert.equal(second.statusCode, '501');
    assertDiagnostics(second, served.response, served.wire);
});

test('invalid decrypted XML keeps xml_error at parsing and pki_error at exchange', async () => {
    const xml = '<Envelope>' + largeText;
    const served = serve({ xml }, 200, 'application/xml');
    const conn = open();
    await conn.ready();
    await assert.rejects(conn.send({ service: 'Read' }), error => {
        assert.equal(error.networkError.type, 'pki_error');
        assertDiagnostics(error.networkError, served.response, served.wire);
        return true;
    });
    assert.throws(() => parseEnvelope(xml, { response: served.response, data: served.wire }), error => {
        assert.equal(error.type, 'xml_error');
        assert.equal(error.message, 'Invalid DSA response envelope');
        assertDiagnostics(error, served.response, served.wire);
        return true;
    });
});

test('no complete response leaves diagnostics absent and preserves the connection cause', async () => {
    const reason = new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
    const server = mockDsa();
    const conn = open();
    global.fetch = server.fetch;
    await conn.ready();
    for (const fetch of [
        async () => { throw reason; },
        async () => ({ status: 200, text: async () => { throw reason; } })
    ]) {
        global.fetch = fetch;
        await assert.rejects(conn.send({ service: 'Read' }), error => {
            assert.equal(error.networkError.type, 'fetch_error');
            assert.equal(error.networkError.message, 'fetch failed');
            for (const key of ['httpStatus', 'contentType', 'bodyLength', 'responseSample']) {
                assert.equal(Object.hasOwn(error.networkError, key), false);
            }
            return true;
        });
    }
    assert.equal(reason.retryable, true);
    assert.equal(reason.cause.code, 'ECONNRESET');
});

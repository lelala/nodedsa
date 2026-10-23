'use strict';
const assert = require('node:assert/strict');
const { test, afterEach } = require('node:test');
const nodedsa = require(process.env.NODEDSA_TEST_PACKAGE || '../app');
const nodexml = require('nodexml');
const { mockDsa, parse, at, status } = require('./helpers/mock-dsa');
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });
const ranges = [[0x41, 0x5a], [0x61, 0x7a], [0xc0, 0xd6], [0xd8, 0xf6], [0xf8, 0x2ff],
    [0x370, 0x37d], [0x37f, 0x1fff], [0x200c, 0x200d], [0x2070, 0x218f],
    [0x2c00, 0x2fef], [0x3001, 0xd7ff], [0xf900, 0xfdcf], [0xfdf0, 0xfffd], [0x10000, 0xeffff],
    [0x30, 0x39], [0x300, 0x36f], [0x203f, 0x2040]];
const points = new Set([0x3a, 0x5f, 0x2d, 0x2e, 0xb7, 0xb2, 0x1a, 0xd800, 0xdfff, 0x10ffff, 0x85, 0xa0, 0x1680, 0x2000, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff]);
for (const [low, high] of ranges) for (const point of [low - 1, low, high, high + 1]) points.add(point);
const names = new Set(['成績（期中）', 'a\u0301', 'x\u203f', '\u3001x', 'x²', '', '1st', 'a b', 'a/b']);
for (const point of points) {
    const char = String.fromCodePoint(point);
    // @ is the serializer's attribute marker, not a Body element name.
    if (char !== '@') names.add(char + 'x');
    names.add('x' + char);
}
function standardAccepts(name, attribute = false) {
    try { parse(attribute ? '<Node ' + name + '="ok"/>' : '<' + name + '>ok</' + name + '>'); return true; }
    catch (_) { return false; }
}

for (const mode of ['legacy', 'pki']) {
    test('Body element/attribute names match standard XML parser boundaries: ' + mode, async () => {
        const server = mockDsa(); global.fetch = server.fetch;
        const conn = nodedsa.open('https://fixture.test/Contract', 'fixture', { transport: mode }); await conn.ready();
        for (const name of names) {
            for (const attribute of [false, true]) {
                const accepted = standardAccepts(name, attribute);
                const body = attribute ? { Node: { '@': [name], [name]: 'ok' } } : { [name]: { Value: 'ok' } };
                const before = server.calls.length;
                const result = await conn.send({ service: 'Read', body }).catch(error => error);
                const label = JSON.stringify({ name, attribute, accepted });
                if (accepted) {
                    assert.equal(result.Response.Value, 'ok', label);
                    const request = at(server.calls.at(-1).inner, 'Body');
                    if (attribute) assert.equal(at(request, 'Node').attributes[name], 'ok', label);
                    else assert.equal(at(request, name, 'Value').text, 'ok', label);
                } else {
                    assert.equal(result.networkError?.type, 'xml_error', label);
                    assert.equal(server.calls.length, before, label);
                }
            }
        }
    });
}

test('decrypted PKI response names match standard XML parser boundaries', async () => {
    let data;
    const server = mockDsa({ handle: c => c.service !== 'DS.Base.Connect' ? { xml: data } : undefined });
    global.fetch = server.fetch;
    const conn = nodedsa.open('https://fixture.test/Contract', 'fixture', { transport: 'pki' }); await conn.ready();
    for (const name of names) {
        for (const attribute of [false, true]) {
            // Responses are UTF-8 bytes. Lone UTF-16 surrogates cannot survive
            // encoding; compare the parser against the actual wire name.
            const wireName = Buffer.from(name, 'utf8').toString('utf8');
            const accepted = standardAccepts(wireName, attribute);
            data = status('0', attribute ? '<Node ' + wireName + '="ok"/>' : '<' + wireName + '>ok</' + wireName + '>');
            let parsed;
            const result = await conn.send({ service: 'Read', result: (_, error, response, value) => { parsed = value; } }).catch(error => error);
            const label = JSON.stringify({ name, attribute, accepted });
            if (accepted) {
                assert.equal(result.networkError, undefined, label);
                // Acceptance follows XML rules; returned shape retains the
                // established nodexml behavior, including its Unicode whitespace handling.
                const expected = nodexml.xml2obj(data);
                assert.deepEqual(result, expected.Envelope.Body, label);
                assert.deepEqual(parsed, expected, label);
            } else assert.equal(result.networkError?.type, 'pki_error', label);
        }
    }
});

'use strict';
const assert = require('node:assert/strict');
const { test, afterEach } = require('node:test');
const nodedsa = require(process.env.NODEDSA_TEST_PACKAGE || '../app');
const { mockDsa, at } = require('./helpers/mock-dsa');
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

for (const mode of ['legacy', 'pki']) {
    test('all object text, pure whitespace, attributes and primitive compatibility: ' + mode, async () => {
        const server = mockDsa(); global.fetch = server.fetch;
        const values = [' ', '  ', '\n', '\t', '\r\n \t', '', '  中文 \t\r\n ]]>&amp;<x> " \'  '];
        const body = { Request: { SQL: values.at(-1), sql: values.at(-1), Script: values.at(-1),
            Description: values.at(-1), Nested: { Value: values },
            Record: values.map(value => ({ '@': ['Name'], Name: 'a&b', '@text': value })),
            Other: { Count: 3, Enabled: true, Empty: '', Nil: null },
            Automatic: { '@': 'auto', Label: 'a&b', Nested: { Value: 'a\nb' } },
            Prefix: { '@Label': 'a&b', Value: 'a\nb' } } };
        const before = structuredClone(body);
        const c = nodedsa.open('https://fixture.test/Any.Contract', 'fake', { transport: mode });
        await c.send({ service: 'UDMService.ReadFixture', body });
        assert.deepEqual(body, before);
        const call = server.calls.at(-1);
        assert.ok(!call.innerXml.includes('<![CDATA['));
        const request = at(call.inner, 'Body', 'Request');
        for (const key of ['SQL', 'sql', 'Script', 'Description']) assert.equal(at(request, key).text, values.at(-1));
        assert.deepEqual(at(request, 'Nested').children.map(c => c.text), values);
        assert.deepEqual(request.children.filter(c => c.name === 'Record').map(c => c.text), values);
        for (const record of request.children.filter(c => c.name === 'Record')) assert.equal(record.attributes.Name, 'a&b');
        assert.equal(at(request, 'Other', 'Count').text, '3');
        assert.equal(at(request, 'Other', 'Enabled').text, 'true');
        assert.equal(at(request, 'Other', 'Empty').text, '');
        assert.equal(at(request, 'Other', 'Nil').text, '');
        assert.equal(at(request, 'Automatic').attributes.Label, 'a&b');
        assert.equal(at(request, 'Prefix').attributes.Label, 'a&b');
        assert.ok(call.innerXml.includes('<Value>&#32;</Value>'));
        assert.ok(call.innerXml.includes('<Value>&#9;</Value>'));
        assert.ok(call.innerXml.includes('<Value>&#10;</Value>'));
        assert.ok(call.innerXml.includes('<Value>&#13;&#10;&#32;&#9;</Value>'));
    });
    test('SQL and Seed are caller-owned, no shift or automatic Seed: ' + mode, async () => {
        const server = mockDsa(); global.fetch = server.fetch;
        const conn = nodedsa.open('https://fixture.test/Contract', 'fake', { transport: mode });
        for (const input of [{ Request: { Seed: 123, SQL: '012345abcdef' } }, { Request: { SQL: "SELECT '中文'" } }]) {
            await conn.send({ service: 'UDTService.DML.Query', body: input });
            const body = at(server.calls.at(-1).inner, 'Body', 'Request');
            assert.equal(at(body, 'SQL').text, input.Request.SQL);
            assert.equal(at(body, 'Seed')?.text, input.Request.Seed === undefined ? undefined : '123');
        }
    });
}

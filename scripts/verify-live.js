'use strict';
// Opt-in, operator-configured NON-PRODUCTION verification only. No default URL,
// token or service. Never prints response/error bodies, credentials or SQL.
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const required = ['NODEDSA_ACCESS_POINT', 'NODEDSA_ACCESS_TOKEN', 'NODEDSA_ECHO_SERVICE', 'NODEDSA_DSA_VERSION'];
if (process.env.NODEDSA_NONPROD_CONFIRMED !== 'yes' || process.env.NODEDSA_READONLY_CONFIRMED !== 'yes' ||
    required.some(name => !process.env[name])) {
    console.error('未執行：需明確確認非正式環境、唯讀測試服務，並設定 access point、短效 token、echo service 與 DSA 版本。');
    process.exit(1);
}
const nodedsa = require(process.env.NODEDSA_TEST_PACKAGE ? path.resolve(process.env.NODEDSA_TEST_PACKAGE) : '../app');
const fetch = global.fetch;
const calls = [];
const token = process.env.NODEDSA_ACCESS_TOKEN;
const sql = "SELECT '中文' AS nodedsa_verification";
global.fetch = async (url, options) => {
    // Keep structural evidence only, not HTTP payloads or tokens.
    const body = options.body || '';
    calls.push({ encrypted: body.includes('<CryptoToken'), publicKey: body.includes('<TargetService>Public.GetPublicKey</TargetService>'),
        leaksToken: body.includes(token), leaksSql: body.includes(sql) });
    return fetch(url, options);
};
function deadline(promise) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('verification deadline')), 30000);
    })]).finally(() => clearTimeout(timer));
}
async function login(conn) {
    await deadline(new Promise((resolve, reject) => { conn.OnLoginError(reject); conn.ready(resolve); }));
}
(async () => {
    const probeValues = ['第一行\n  第二行\t結尾', ' ', '  ', '\n', '\t', '\r\n \t', ''];
    const results = [];
    for (const mode of ['legacy', 'pki']) {
        const start = calls.length;
        const conn = nodedsa.open(process.env.NODEDSA_ACCESS_POINT, token, { transport: mode });
        await login(conn);
        for (const value of probeValues) {
            // An approved read-only test service must return the received value's
            // code points + length, avoiding nodexml's legacy whitespace trimming.
            const response = await deadline(conn.send({ service: process.env.NODEDSA_ECHO_SERVICE, body: { Request: { Value: value } } }));
            assert.equal(String(response.Response.Length), String(Array.from(value).length));
            assert.equal(String(response.Response.CodePoints ?? ''), Array.from(value, c => c.codePointAt(0)).join(','));
        }
        if (mode === 'pki') {
            const response = await deadline(conn.send({ service: 'UDTService.DML.Query', body: { Request: { SQL: sql } } }));
            const records = [].concat(response.Response.Record || []);
            assert.equal(records[0].Column['@text'], '中文');
        }
        await deadline(conn.reConnect(token));
        const afterReconnect = await deadline(conn.send({ service: process.env.NODEDSA_ECHO_SERVICE, body: { Request: { Value: ' ' } } }));
        assert.equal(String(afterReconnect.Response.Length), '1');
        assert.equal(String(afterReconnect.Response.CodePoints), '32');
        const wire = calls.slice(start);
        if (mode === 'pki') {
            assert.equal(wire.filter(c => c.publicKey).length, 2);
            assert.ok(wire.filter(c => !c.publicKey).every(c => c.encrypted && !c.leaksToken && !c.leaksSql));
        } else assert.ok(wire.every(c => !c.encrypted && !c.publicKey));
        results.push({ transport: mode, probes: probeValues.length, reconnect: 'passed', wire: 'passed' });
    }
    console.log(JSON.stringify({ node: process.version, dsaVersion: process.env.NODEDSA_DSA_VERSION,
        targetId: crypto.createHash('sha256').update(process.env.NODEDSA_ACCESS_POINT).digest('hex').slice(0, 16),
        results, scope: '僅受測服務與版本；未證明其他版本/服務相容' }, null, 2));
})().catch(() => {
    console.error('驗收未通過；未輸出 token、SQL、伺服器回應或原始錯誤。請在非正式環境個別檢查輸入契約與服務端記錄。');
    process.exit(1);
}).finally(() => { global.fetch = fetch; });

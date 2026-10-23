'use strict';
// Independent server-side fixture: does not import the client's crypto/XML code.
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { SaxesParser } = require('saxes');

function parse(xml) {
    const parser = new SaxesParser();
    const stack = [];
    let root;
    parser.on('opentag', tag => {
        const node = { name: tag.name, attributes: tag.attributes, text: '', children: [] };
        if (stack.length) stack.at(-1).children.push(node);
        else root = node;
        stack.push(node);
    });
    parser.on('text', text => { if (stack.length) stack.at(-1).text += text; });
    parser.on('cdata', text => { stack.at(-1).text += text; });
    parser.on('closetag', () => stack.pop());
    parser.write(xml).close();
    return root;
}
function at(node, ...names) {
    for (const name of names) node = node?.children.find(child => child.name === name);
    return node;
}
function status(code = '0', body = '<Response><Value>ok</Value></Response>') {
    return '<Envelope><Header><Status><Code>' + code + '</Code><Message>test status</Message></Status>' +
        '<UserInfo><UserName>fixture</UserName></UserInfo></Header><Body>' + body + '</Body></Envelope>';
}
function encrypt(text, key) {
    const c = crypto.createCipheriv('aes-128-ecb', key, null);
    return Buffer.concat([c.update(text, 'utf8'), c.final()]).toString('base64');
}
function decrypt(text, key) {
    const c = crypto.createDecipheriv('aes-128-ecb', key, null);
    return Buffer.concat([c.update(Buffer.from(text, 'base64')), c.final()]).toString('utf8');
}
function mockDsa(settings = {}) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });
    const jwk = publicKey.export({ format: 'jwk' });
    const publicXml = '<RSAKeyValue><Modulus>' + Buffer.from(jwk.n, 'base64url').toString('base64') +
        '</Modulus><Exponent>' + Buffer.from(jwk.e, 'base64url').toString('base64') + '</Exponent></RSAKeyValue>';
    const calls = [];
    const fetch = async (url, options) => {
        const outer = parse(options.body);
        const record = { url, options, outer };
        calls.push(record);
        if (at(outer, 'Header', 'TargetService')?.text === 'Public.GetPublicKey') {
            record.kind = 'key';
            if (settings.keyError) throw settings.keyError;
            return { text: async () => settings.publicXml === undefined ? publicXml : settings.publicXml };
        }
        const token = at(outer, 'Header', 'CryptoToken');
        record.mode = token ? 'pki' : 'legacy';
        if (token) {
            assert.equal(token.attributes.Type, 'Static');
            assert.equal(at(outer, 'Body').children.length, 0);
            // Test-only raw RSA operation + explicit PKCS1 v1.5 block validation.
            // Works on Node versions that disable privateDecrypt(PKCS1_PADDING).
            const block = crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_NO_PADDING },
                Buffer.from(at(token, 'SecretKey').text, 'base64'));
            assert.equal(block[0], 0); assert.equal(block[1], 2);
            const zero = block.indexOf(0, 2);
            assert.ok(zero >= 10);
            record.uuid = block.subarray(zero + 1).toString('utf8');
            assert.match(record.uuid, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
            record.key = crypto.createHash('md5').update(record.uuid, 'utf8').digest();
            record.clientPublic = decrypt(at(token, 'PublicKey').text, record.key);
            assert.equal(parse(record.clientPublic).name, 'RSAKeyValue');
            record.innerXml = decrypt(at(token, 'Cipher').text, record.key);
        } else record.innerXml = options.body;
        record.inner = parse(record.innerXml);
        record.service = at(record.inner, 'Header', 'TargetService').text;
        const reply = settings.handle ? await settings.handle(record) : undefined;
        const content = reply?.xml || (record.service === 'DS.Base.Connect' ? status('0', '<SessionID>session-id</SessionID>') : status());
        if (reply?.error) throw reply.error;
        const wire = reply?.wire !== undefined ? reply.wire : token && !reply?.plain ?
            '<Envelope><Header><CryptoToken Type="Static"><Cipher>' + encrypt(content, record.key) +
            '</Cipher></CryptoToken></Header><Body/></Envelope>' : content;
        return { ok: reply?.ok, status: reply?.httpStatus, text: async () => wire };
    };
    return { fetch, calls, publicXml };
}
module.exports = { parse, at, status, mockDsa };

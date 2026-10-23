'use strict';

const crypto = require('node:crypto');
const nodexml = require('nodexml');
const { escapeText, validateXml, envelope } = require('./xml');
const clientKeySlot = Symbol.for('nodedsa.pki.client-public-key.v1');

function pkiError(message) {
    const error = new Error(message);
    error.type = 'pki_error';
    return error;
}
function base64(value) {
    if (typeof value !== 'string') throw pkiError('Invalid PKI base64 data');
    const clean = value.replace(/\s/g, '');
    if (!clean || clean.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) {
        throw pkiError('Invalid PKI base64 data');
    }
    const bytes = Buffer.from(clean, 'base64');
    if (bytes.toString('base64') !== clean) throw pkiError('Invalid PKI base64 data');
    return bytes;
}
function clientKey() {
    if (!globalThis[clientKeySlot]) {
        const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });
        const jwk = publicKey.export({ format: 'jwk' });
        globalThis[clientKeySlot] = '<RSAKeyValue><Modulus>' + Buffer.from(jwk.n, 'base64url').toString('base64') +
            '</Modulus><Exponent>' + Buffer.from(jwk.e, 'base64url').toString('base64') + '</Exponent></RSAKeyValue>';
    }
    return globalThis[clientKeySlot];
}
function aes(value, key, decrypt = false) {
    const cipher = decrypt ? crypto.createDecipheriv('aes-128-ecb', key, null) :
        crypto.createCipheriv('aes-128-ecb', key, null);
    const result = Buffer.concat([cipher.update(decrypt ? base64(value) : Buffer.from(value, 'utf8')), cipher.final()]);
    return result.toString(decrypt ? 'utf8' : 'base64');
}
function checkedEnvelope(parsed) {
    const env = parsed && parsed.Envelope;
    if (!env || Array.isArray(env) || !env.Header || Array.isArray(env.Header) ||
        !env.Header.Status || typeof env.Header.Status.Code !== 'string' || !env.Header.Status.Code) {
        throw new Error('Invalid DSA response envelope');
    }
    return parsed;
}
function parseEnvelope(data) {
    try {
        validateXml(data);
        return checkedEnvelope(nodexml.xml2obj(data));
    } catch (_) {
        const error = new Error('Invalid DSA response envelope');
        error.type = 'xml_error';
        throw error;
    }
}
function httpError(response) {
    const error = new Error('DSA HTTP request failed (' + response.status + ')');
    error.type = 'http_error';
    return error;
}
function checkHttp(result) {
    const env = result.parsed?.Envelope;
    const code = env?.Header?.Status?.Code;
    const dsaError = env && !Array.isArray(env) && !Array.isArray(env.Header) &&
        !Array.isArray(env.Header?.Status) && typeof code === 'string' && code !== '' && code !== '0';
    if (result.response.ok === false && !dsaError) throw httpError(result.response);
    return result;
}
function parseLegacyResponse(result) {
    try { result.parsed = nodexml.xml2obj(result.data); }
    catch (_) {
        if (result.response.ok === false) throw httpError(result.response);
        const error = new Error('Invalid DSA response XML');
        error.type = 'xml_error';
        throw error;
    }
    return checkHttp(result);
}
function retryableError(reason) {
    if (reason instanceof Error) {
        try { reason.retryable = true; return reason; }
        catch (_) { /* Frozen or read-only errors need a wrapper. */ }
    }
    let message;
    try { message = reason instanceof Error ? reason.message : String(reason); }
    catch (_) { message = 'Network error occurred'; }
    const error = new Error(message, { cause: reason });
    if (reason instanceof Error) {
        error.name = reason.name;
        error.stack = reason.stack;
        if (reason.type !== undefined) error.type = reason.type;
    }
    error.retryable = true;
    return error;
}
async function post(url, body, options) {
    let response;
    try {
        response = await fetch(url, Object.assign({ headers: { 'Content-Type': 'application/xml' } }, options, {
            method: 'POST', body
        }));
    } catch (error) {
        throw retryableError(error);
    }
    // HTTP errors may contain a genuine DSA error. Read before classifying.
    try { return { response, data: await response.text() }; }
    catch (error) { throw retryableError(error); }
}
async function initialize(url, contract) {
    const result = await post(url, envelope({ TargetContract: 'info', TargetService: 'Public.GetPublicKey' }, {
        Content: { Contract: contract, Format: 'pkcs8' }
    }));
    try {
        validateXml(result.data);
        // Preserve a genuine DSA public-key error using the login error contract.
        if (/<Envelope[ \t\r\n>]/.test(result.data)) {
            const parsed = checkedEnvelope(nodexml.xml2obj(result.data));
            if (parsed.Envelope.Header.Status.Code !== '0') return { ...result, parsed };
        }
        checkHttp(result);
        const modulus = /<Modulus>([^<]+)<\/Modulus>/.exec(result.data);
        const exponent = /<Exponent>([^<]+)<\/Exponent>/.exec(result.data);
        if (!/<RSAKeyValue[\s>]/.test(result.data) || !modulus || !exponent) throw new Error();
        const n = base64(modulus[1]);
        const e = base64(exponent[1]);
        const key = crypto.createPublicKey({ key: { kty: 'RSA', n: n.toString('base64url'), e: e.toString('base64url') }, format: 'jwk' });
        // Also check that this is a usable RSA encryption key.
        crypto.publicEncrypt({ key, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.alloc(36));
        return { key };
    } catch (_) {
        if (result.response.ok === false) throw httpError(result.response);
        throw pkiError('Invalid DSA public key response');
    }
}
async function exchange(url, contract, serverKey, inner, options) {
    let body, key;
    try {
        const uuid = crypto.randomUUID();
        key = crypto.createHash('md5').update(uuid, 'utf8').digest();
        const secret = crypto.publicEncrypt({ key: serverKey, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(uuid)).toString('base64');
        body = '<Envelope><Header><TargetContract>' + escapeText(contract) + '</TargetContract><CryptoToken Type="Static">' +
            '<SecretKey>' + secret + '</SecretKey><PublicKey>' + aes(clientKey(), key) + '</PublicKey><Cipher>' +
            aes(inner, key) + '</Cipher></CryptoToken></Header><Body/></Envelope>';
    } catch (_) {
        throw pkiError('PKI request encryption failed');
    }
    const result = await post(url, body, options);
    const hasCipher = /<Cipher(?:[ \t\r\n]|>|\/)/.test(result.data);
    try {
        validateXml(result.data);
        const outer = nodexml.xml2obj(result.data);
        const token = outer?.Envelope?.Header?.CryptoToken;
        if (token && Object.hasOwn(token, 'Cipher')) {
            result.data = aes(token.Cipher, key, true);
            result.parsed = parseEnvelope(result.data);
        } else {
            // A misplaced/empty Cipher must not be treated as a plaintext error.
            if (hasCipher) throw new Error();
            result.parsed = checkedEnvelope(outer);
            if (result.parsed.Envelope.Header.Status.Code === '0') {
                if (result.response.ok === false) throw httpError(result.response);
                throw new Error();
            }
        }
        return checkHttp(result);
    } catch (error) {
        if (error.type === 'http_error') throw error;
        if (result.response.ok === false && !hasCipher) throw httpError(result.response);
        throw pkiError('Invalid PKI response');
    }
}

module.exports = { initialize, exchange, parseEnvelope, parseLegacyResponse, post, pkiError };

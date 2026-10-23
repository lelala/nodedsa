'use strict';

const nodexml = require('nodexml');
// XML 1.0 Fifth Edition, productions [4], [4a] and [5].
const nameStartChar = ':A-Z_a-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u02ff' +
    '\u0370-\u037d\u037f-\u1fff\u200c-\u200d\u2070-\u218f' +
    '\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd\u{10000}-\u{effff}';
const namePattern = new RegExp('^[' + nameStartChar + '][' + nameStartChar +
    '.0-9\u00b7\u0300-\u036f\u203f-\u2040-]*$', 'u');

function xmlName(name) {
    if (!namePattern.test(name)) throw new TypeError('Invalid XML name');
    return name;
}

function validateCharacters(text) {
    for (const char of text) {
        const cp = char.codePointAt(0);
        if (!(cp === 9 || cp === 10 || cp === 13 || (cp >= 32 && cp <= 0xd7ff) ||
            (cp >= 0xe000 && cp <= 0xfffd) || (cp >= 0x10000 && cp <= 0x10ffff))) {
            throw new TypeError('Invalid XML character');
        }
    }
}

function escapeText(value) {
    const text = String(value);
    validateCharacters(text);
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function textValue(value) {
    if (typeof value !== 'string') return escapeText(value);
    if (/^[ \t\r\n]+$/.test(value)) {
        return Array.from(value, char => '&#' + char.charCodeAt(0) + ';').join('');
    }
    return escapeText(value).replace(/\r/g, '&#13;');
}

// Only object Body serialization changes. Headers remain owned by nodexml.
function objectBody(body) {
    const ancestors = new Set();
    function content(obj) {
        if (obj == null) return '';
        if (typeof obj !== 'object') return textValue(obj);
        if (ancestors.has(obj)) throw new TypeError('Circular XML body');
        ancestors.add(obj);
        try {
            const marker = obj['@'];
            const auto = typeof marker === 'string' && marker.toLowerCase() === 'auto';
            const attrs = Array.isArray(marker) ? marker.map(key => String(key).toLowerCase()) : [];
            let attributes = '';
            let children = '';
            for (const key in obj) {
                const value = obj[key];
                if (key === '@' || typeof value === 'function') continue;
                const primitive = ['string', 'number', 'boolean'].includes(typeof value);
                if (key === '@text') {
                    if (primitive) children += textValue(value);
                } else if (primitive && (auto || key.startsWith('@') || attrs.includes(key.toLowerCase()))) {
                    attributes += ' ' + xmlName(key.startsWith('@') ? key.slice(1) : key) + '="' +
                        escapeText(value).replace(/\n/g, '') + '"';
                } else {
                    for (const item of Array.isArray(value) ? value : [value]) {
                        children += element(key, item);
                    }
                }
            }
            return { attributes, children };
        } finally {
            ancestors.delete(obj);
        }
    }
    function element(name, value) {
        xmlName(name);
        if (value == null) return '<' + name + '><!-- 此屬性值為「Null」。 --></' + name + '>';
        const result = content(value);
        if (typeof result === 'string') return '<' + name + '>' + result + '</' + name + '>';
        return '<' + name + result.attributes + '>' + result.children + '</' + name + '>';
    }
    return element('Body', body);
}

function envelope(header, body) {
    const shell = nodexml.obj2xml({ Header: header, Body: 'nodedsa_body' }, 'Envelope');
    // Function replacement preserves literal $&, $` and $' in raw XML fragments.
    return shell.replace('<Body>nodedsa_body</Body>', () =>
        typeof body === 'string' ? '<Body>' + body + '</Body>' : objectBody(body));
}

// A bounded structural check for PKI XML. DTDs/entities are not
// part of DSA envelopes. No external entity resolution is performed.
function validateXml(xml) {
    if (typeof xml !== 'string') throw new Error('Invalid XML response');
    const stack = [];
    let offset = 0;
    let roots = 0;
    const fail = () => { throw new Error('Invalid XML response'); };
    function text(text) {
        if (!stack.length && text.trim()) fail();
        if (text.includes(']]>')) fail();
        if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/.test(text)) fail();
        for (const [, code] of text.matchAll(/&#(x[\da-fA-F]+|\d+);/g)) {
            const n = code[0] === 'x' ? parseInt(code.slice(1), 16) : Number(code);
            if (!(n === 9 || n === 10 || n === 13 || (n >= 32 && n <= 0xd7ff) ||
                (n >= 0xe000 && n <= 0xfffd) || (n >= 0x10000 && n <= 0x10ffff))) fail();
        }
        validateCharacters(text);
    }
    while (offset < xml.length) {
        if (xml[offset] !== '<') {
            const end = xml.indexOf('<', offset);
            text(xml.slice(offset, end < 0 ? xml.length : end));
            offset = end < 0 ? xml.length : end;
            continue;
        }
        const tail = xml.slice(offset);
        let match;
        if (tail.startsWith('<!--')) {
            const end = tail.indexOf('-->');
            if (end < 0 || tail.slice(4, end).includes('--')) fail();
            offset += end + 3;
        } else if (tail.startsWith('<![CDATA[')) {
            const end = tail.indexOf(']]>');
            if (!stack.length || end < 0) fail();
            validateCharacters(tail.slice(9, end));
            offset += end + 3;
        } else if ((match = /^<\?[\s\S]*?\?>/.exec(tail))) {
            offset += match[0].length;
        } else if ((match = /^<\/([^ \t\r\n<>]+)[ \t\r\n]*>/.exec(tail))) {
            if (stack.pop() !== match[1]) fail();
            offset += match[0].length;
        } else if ((match = /^<([^ \t\r\n<>/]+)((?:[ \t\r\n]+[^ \t\r\n<>/=]+[ \t\r\n]*=[ \t\r\n]*(?:"[^"<]*"|'[^'<]*'))*)[ \t\r\n]*(\/?)>/.exec(tail))) {
            xmlName(match[1]);
            const attrs = new Set();
            const attrPattern = /([^ \t\r\n=]+)[ \t\r\n]*=[ \t\r\n]*("[^"]*"|'[^']*')/g;
            for (const attr of match[2].matchAll(attrPattern)) {
                xmlName(attr[1]);
                if (attrs.has(attr[1])) fail();
                attrs.add(attr[1]);
                // Validate attribute references without applying top-level text checks.
                stack.push('attribute'); text(attr[2].slice(1, -1)); stack.pop();
            }
            if (!stack.length && ++roots !== 1) fail();
            if (!match[3]) stack.push(match[1]);
            offset += match[0].length;
        } else fail();
    }
    if (stack.length || roots !== 1) fail();
}

module.exports = { envelope, escapeText, objectBody, validateXml };

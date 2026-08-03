'use strict';

const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');

const nodedsa = require('../app');

const originalFetch = global.fetch;

afterEach(() => {
    global.fetch = originalFetch;
});

function response(xml) {
    return {
        text: async () => xml
    };
}

function loginSuccess() {
    return response(
        '<Envelope><Header><Status><Code>0</Code></Status>' +
        '<UserInfo><UserName>test</UserName></UserInfo></Header>' +
        '<Body><SessionID>session-id</SessionID></Body></Envelope>'
    );
}

function serviceSuccess() {
    return response(
        '<Envelope><Header><Status><Code>0</Code></Status></Header>' +
        '<Body><Response><Value>ok</Value></Response></Body></Envelope>'
    );
}

function serviceFailure() {
    return response(
        '<Envelope><Header><Status><Code>500</Code><Message>failed</Message>' +
        '</Status></Header><Body /></Envelope>'
    );
}

function installFetch(serviceResult) {
    const calls = [];
    global.fetch = async (url, options) => {
        calls.push({ url, options });
        if (calls.length === 1) return loginSuccess();
        if (serviceResult instanceof Error) throw serviceResult;
        return serviceResult || serviceSuccess();
    };
    return calls;
}

function openConnection() {
    return nodedsa.open('https://dsa.example.test', 'passport-token');
}

test('send(request) remains compatible and does not mutate the request', async () => {
    const calls = installFetch();
    let callbackResult;
    let callbackError;
    const request = {
        service: 'Test.Service',
        body: { Query: 'value' },
        result: (body, error) => {
            callbackResult = body;
            callbackError = error;
        }
    };
    const before = {
        ...request,
        body: structuredClone(request.body)
    };

    const result = await openConnection().send(request);

    assert.deepEqual(request, before);
    assert.equal(result.Response.Value, 'ok');
    assert.equal(callbackResult.Response.Value, 'ok');
    assert.equal(callbackError, null);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].options.method, 'POST');
    assert.equal(calls[1].options.headers.get('content-type'), 'application/xml');
    assert.match(calls[1].options.body, /<TargetService>Test\.Service<\/TargetService>/);
});

test('login failures preserve callback, OnLoginError, OnError, and rejection behavior', async () => {
    global.fetch = async () => response(
        '<Envelope><Header><Status><Code>401</Code><Message>denied</Message>' +
        '</Status></Header><Body /></Envelope>'
    );
    const connection = openConnection();
    let callbackError;
    let loginError;
    let onError;
    connection.OnLoginError(error => {
        loginError = error;
    });
    connection.OnError((request, error) => {
        onError = error;
    });

    const rejection = await connection.send({
        service: 'Test.Service',
        result: (body, error) => {
            callbackError = error;
        }
    }).catch(error => error);

    assert.equal(rejection.loginError.statusCode, '401');
    assert.equal(rejection.dsaError, null);
    assert.equal(rejection.networkError, null);
    assert.equal(callbackError.loginError.statusCode, '401');
    assert.equal(onError.loginError.statusCode, '401');
    assert.equal(loginError.statusCode, '401');
});

test('send accepts every Fetch HeadersInit shape', async (t) => {
    const cases = [
        ['record', { traceparent: 'record-value' }],
        ['Headers', new Headers({ traceparent: 'headers-value' })],
        ['pairs', [['traceparent', 'pairs-value']]]
    ];

    for (const [name, headers] of cases) {
        await t.test(name, async () => {
            const calls = installFetch();
            await openConnection().send(
                { service: 'Test.Service', body: {} },
                { headers }
            );
            assert.equal(
                calls[1].options.headers.get('traceparent'),
                name === 'record' ? 'record-value' :
                    name === 'Headers' ? 'headers-value' : 'pairs-value'
            );
        });
    }
});

test('caller headers override defaults and safe options reach fetch', async () => {
    const calls = installFetch();
    const abortController = new AbortController();
    const options = {
        method: 'GET',
        body: 'caller-body',
        redirect: 'manual',
        signal: abortController.signal,
        headers: {
            'content-TYPE': 'application/vnd.custom+xml',
            traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
            'X-Cloud-Trace-Context': 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/1;o=1'
        }
    };

    await openConnection().send(
        { service: 'Test.Service', body: { Value: 'dsa-body' } },
        options
    );

    const sent = calls[1].options;
    assert.equal(sent.method, 'POST');
    assert.notEqual(sent.body, options.body);
    assert.match(sent.body, /<Value>dsa-body<\/Value>/);
    assert.equal(sent.redirect, 'manual');
    assert.equal(sent.signal, abortController.signal);
    assert.equal(sent.headers.get('content-type'), 'application/vnd.custom+xml');
    assert.equal(sent.headers.get('traceparent'), options.headers.traceparent);
    assert.equal(
        sent.headers.get('x-cloud-trace-context'),
        options.headers['X-Cloud-Trace-Context']
    );
    assert.equal([...sent.headers.keys()].filter(name => name === 'content-type').length, 1);
});

test('queued calls do not mutate caller-owned request, options, or headers', async () => {
    let finishLogin;
    const login = new Promise(resolve => {
        finishLogin = () => resolve(loginSuccess());
    });
    const calls = [];
    global.fetch = async (url, options) => {
        calls.push({ url, options });
        if (calls.length === 1) return login;
        return serviceSuccess();
    };

    const headers = { traceparent: 'queued-value' };
    const options = { headers, redirect: 'follow' };
    const request = { service: 'Test.Service', body: { Value: 'queued' } };
    const requestBefore = structuredClone(request);
    const optionsBefore = structuredClone(options);
    const pending = openConnection().send(request, options);

    assert.deepEqual(request, requestBefore);
    assert.deepEqual(options, optionsBefore);
    finishLogin();
    await pending;
    assert.deepEqual(request, requestBefore);
    assert.deepEqual(options, optionsBefore);
    assert.deepEqual(headers, optionsBefore.headers);
});

test('invalid headers reject with networkError and notify callbacks', async () => {
    installFetch();
    const connection = openConnection();
    let callbackError;
    let onError;
    connection.OnError((request, error) => {
        onError = error;
    });

    const request = {
        service: 'Test.Service',
        body: {},
        result: (body, error) => {
            callbackError = error;
        }
    };
    const options = {
        headers: { 'invalid header': 'value' }
    };
    const rejection = await connection.send(request, options).catch(error => error);

    assert.equal(rejection.loginError, null);
    assert.equal(rejection.dsaError, null);
    assert.equal(rejection.networkError.name, 'TypeError');
    assert.equal(callbackError, rejection);
    assert.equal(onError, rejection);
    assert.equal(Object.hasOwn(request, 'promiseReject'), false);
    assert.deepEqual(options, { headers: { 'invalid header': 'value' } });
});

test('fetch failures preserve structured networkError behavior', async () => {
    installFetch(new Error('network down'));
    const connection = openConnection();
    let callbackError;
    let onError;
    connection.OnError((request, error) => {
        onError = error;
    });

    const request = {
        service: 'Test.Service',
        result: (body, error) => {
            callbackError = error;
        }
    };
    const options = { headers: { traceparent: 'value' } };
    const rejection = await connection.send(request, options).catch(error => error);

    assert.equal(rejection.loginError, null);
    assert.equal(rejection.dsaError, null);
    assert.equal(rejection.networkError.message, 'network down');
    assert.equal(callbackError, rejection);
    assert.equal(onError, rejection);
    assert.equal(Object.hasOwn(request, 'promiseReject'), false);
    assert.deepEqual(options, { headers: { traceparent: 'value' } });
});

test('non-zero DSA responses remain structured dsaError failures', async () => {
    installFetch(serviceFailure());
    const connection = openConnection();
    let callbackError;
    let onError;
    connection.OnError((request, error) => {
        onError = error;
    });

    const request = {
        service: 'Test.Service',
        result: (body, error) => {
            callbackError = error;
        }
    };
    const options = { headers: { traceparent: 'value' } };
    const rejection = await connection.send(request, options).catch(error => error);

    assert.equal(rejection.loginError, null);
    assert.equal(rejection.networkError, null);
    assert.equal(rejection.dsaError.status, '500');
    assert.equal(rejection.dsaError.message, 'failed');
    assert.equal(callbackError, rejection);
    assert.equal(onError, rejection);
    assert.equal(Object.hasOwn(request, 'promiseReject'), false);
    assert.deepEqual(options, { headers: { traceparent: 'value' } });
});

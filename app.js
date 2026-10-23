var nodexml = require('nodexml');
module.exports.dsnsLookup = (function () {
    //#region DSNSCache
    var dsnsCache = {};
    var CACHE_EXPIRY_TIME = 5 * 60 * 1000; // 5分鐘的快取過期時間

    function setCache(key, value) {
        dsnsCache[key] = {
            value: value,
            expiryTime: Date.now() + CACHE_EXPIRY_TIME
        };
    }

    function getCache(key) {
        var cache = dsnsCache[key];
        if (!cache) return null;
        
        if (cache.expiryTime < Date.now()) {
            delete dsnsCache[key];
            return null;
        }
        
        return cache.value;
    }
    //#endregion
    return function (dsnsName, callback) {
        //#region DSNS Lookup
        dsnsName = dsnsName || '';
        //#region 查詢完成後CallBack
        var lookupResult = dsnsName;
        var lookupFinish = false;
        var lookupCallBack = [];
        if (callback)
            lookupCallBack.push(callback);
        function dsnsLookupFinish(result) {
            lookupResult = result || lookupResult;
            //#region 存入Cache
            if (result) {
                setCache(dsnsName, result);
            }
            //#endregion
            lookupFinish = true;
            for (var i = 0; i < lookupCallBack.length; i++) {
                lookupCallBack[i](lookupResult);
            }
        }
        //#endregion
        var cachedDsns = getCache(dsnsName);
        if (cachedDsns) {
            //#region 回傳Cache內容
            dsnsLookupFinish(cachedDsns);
            //#endregion
        }
        else {
            //#region 向DSNS Server查詢
            async function queryDSNS(target, dsnsList) {
                try {
                    const response = await fetch(dsnsList.pop(), {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/xml'
                        },
                        body: nodexml.obj2xml({
                            Header: {
                                TargetService: 'DS.NameService.GetDoorwayURL',
                                SecurityToken: {
                                    '@': ['type'],
                                    Type: 'Basic',
                                    UserName: 'anonymous',
                                    Password: ''
                                }
                            },
                            Body: {
                                DomainName: target
                            }
                        }, 'Envelope')
                    });

                    const data = await response.text();
                    const resp = nodexml.xml2obj(data);
                    
                    if (resp && resp.Envelope && resp.Envelope.Header && resp.Envelope.Header.Status && resp.Envelope.Header.Status.Code == "0") {
                        if (resp && resp.Envelope && resp.Envelope.Body && resp.Envelope.Body.DoorwayURL) {
                            var lookupValue = resp.Envelope.Body.DoorwayURL.SecuredUrl || resp.Envelope.Body.DoorwayURL["@text"] || ("" + resp.Envelope.Body.DoorwayURL);
                            dsnsLookupFinish(lookupValue);
                        }
                        else
                            dsnsLookupFinish();
                    }
                    else {
                        if (dsnsList.length == 0) {
                            dsnsLookupFinish();
                        }
                        else
                            queryDSNS(target, dsnsList);
                    }
                } catch (error) {
                    if (dsnsList.length == 0) {
                        dsnsLookupFinish();
                    }
                    else
                        queryDSNS(target, dsnsList);
                }
            }
            var dsnsList = [
                'http://dsns5.ischool.com.tw/dsns/dsns',
                'http://dsns4.ischool.com.tw/dsns/dsns',
                'http://dsns3.ischool.com.tw/dsns/dsns',
                'http://dsns2.ischool.com.tw/dsns/dsns',
                'http://dsns1.ischool.com.tw/dsns/dsns',

                'https://dsns1.ischool.com.tw/dsns/dsns',
                'https://dsns.ischool.com.tw/dsns/dsns'
            ];
            queryDSNS(
                dsnsName
                , dsnsList
            );
            //#endregion
        }
        return {
            complite: function (fn) {
                lookupCallBack.push(fn);
                if (lookupFinish) {
                    fn(lookupResult);
                }
            }
        };
        //#endregion
    }
})();

module.exports.open = function (accessPoint, token, options) {
    if (!accessPoint) throw "accessPoint is empty";
    if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options) ||
        Object.keys(options).some(key => key !== 'transport'))) {
        throw new TypeError('options only accepts transport');
    }
    const mode = options && options.transport !== undefined ? options.transport : 'legacy';
    if (mode !== 'legacy' && mode !== 'pki') throw new TypeError('Unsupported transport');

    const xml = require('./lib/xml');
    const tunnel = require('./lib/secure-tunnel');
    let logicalPoint = accessPoint;
    let activeToken = normalizeToken(token);
    let loggedIn = false;
    let loginError = null;
    let userInfo = {};
    let queue = [];
    let generation = 0;
    let reconnectWaiter = null;
    const readyWaiters = [];
    const loginErrorCallbacks = [];
    const errorCallbacks = [];

    function normalizeToken(value) {
        if (!value) return {};
        return typeof value === 'object' ? value : {
            '@': ['Type'], Type: 'PassportAccessToken', AccessToken: value
        };
    }
    function invoke(fn, sync, ...args) {
        if (sync) return fn(...args);
        // Async callback exceptions are surfaced outside the transport catch.
        try { fn(...args); }
        catch (error) { queueMicrotask(() => { throw error; }); }
    }
    function loginFailure(error) {
        return { loginError: error, dsaError: null, networkError: null, ajaxException: null };
    }
    function networkFailure(error) {
        return { loginError: null, dsaError: null, networkError: {
            name: error.name, message: error.message, stack: error.stack,
            type: error.type || 'fetch_error'
        } };
    }
    function rejectRequest(req, error, response, parsed, sync = false) {
        if (req.settled) return;
        req.settled = true;
        const notifyResult = () => invoke(req.result, sync, null, error, response || null, parsed);
        const notifyErrors = () => {
            for (const callback of errorCallbacks.slice()) invoke(callback, sync, req, error);
        };
        if (!sync) {
            req.reject(error);
            notifyErrors();
            notifyResult();
            return;
        }
        try {
            notifyErrors();
            notifyResult();
        } catch (callbackError) {
            // send() will throw instead of returning this Promise. Handle only
            // its orphaned transport rejection, then preserve the callback error.
            req.promise.catch(() => {});
            throw callbackError;
        } finally {
            req.reject(error);
        }
    }
    function failLogin(state, error) {
        if (state.id !== generation) return;
        loggedIn = false;
        loginError = error;
        const pending = queue;
        queue = [];
        const waiter = reconnectWaiter;
        reconnectWaiter = null;
        if (waiter) waiter.reject(error);
        if (state.source === 'initial') {
            for (const callback of loginErrorCallbacks.slice()) invoke(callback, false, error);
        }
        for (const req of pending) rejectRequest(req, loginFailure(error));
    }
    function flush(state) {
        const pending = queue;
        queue = [];
        for (const req of pending) dispatch(req, state);
    }
    function httpOptions(options) {
        if (options !== undefined && (options === null || typeof options !== 'object')) {
            throw new TypeError('options must be a Fetch-compatible RequestInit object');
        }
        const normalized = {};
        if (options) for (const key of Object.keys(options)) {
            if (!['headers', 'method', 'body'].includes(key)) normalized[key] = options[key];
        }
        const headers = new Headers({ 'Content-Type': 'application/xml' });
        if (options && options.headers !== undefined) {
            new Headers(options.headers).forEach((value, name) => headers.set(name, value));
        }
        normalized.headers = headers;
        return normalized;
    }
    function splitPkiRoute(point) {
        const raw = point.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '').split(/[?#]/, 1)[0];
        if (/[\t\r\n]/.test(raw)) throw tunnel.pkiError('PKI path must not contain control whitespace');
        if (raw.includes('\\')) throw tunnel.pkiError('PKI path must not contain backslashes');
        const scheme = /^[a-z][a-z\d+.-]*:\/\//i.exec(raw);
        const start = scheme ? raw.indexOf('/', scheme[0].length) : raw.indexOf('/');
        const path = (start < 0 ? '' : raw.slice(start)).replace(/\/+$/, '');
        const segments = path.split('/').map(segment => {
            let decoded;
            try { decoded = decodeURIComponent(segment); }
            catch (_) { throw tunnel.pkiError('Invalid PKI path encoding'); }
            if (decoded === '.' || decoded === '..') throw tunnel.pkiError('PKI path must not contain dot segments');
            if (decoded.includes('/')) throw tunnel.pkiError('PKI path segments must not contain encoded slashes');
            if (decoded.includes('\\')) throw tunnel.pkiError('PKI path must not contain backslashes');
            return decoded;
        });
        return { direct: Boolean(scheme), contract: segments.at(-1), doorwayPath: path.slice(0, path.lastIndexOf('/')) || '/' };
    }
    function requirePkiContract(route) {
        if (!route.contract.trim()) throw tunnel.pkiError('PKI requires a contract path');
        return route;
    }
    async function resolvePoint() {
        if (typeof accessPoint !== 'string') throw accessPointError('Invalid DSA access point');
        // Inspect original path text before URL can normalize dot segments.
        const originalRoute = mode === 'pki' ? splitPkiRoute(accessPoint) : null;
        let resolved = accessPoint;
        if (!(mode === 'pki' ? originalRoute.direct : accessPoint.includes('://'))) {
            const slash = accessPoint.indexOf('/');
            if (mode === 'pki') {
                if (slash < 1) throw tunnel.pkiError('PKI requires a contract path');
                requirePkiContract(originalRoute);
            }
            const name = slash > 0 ? accessPoint.slice(0, slash) : accessPoint;
            const doorway = await new Promise(resolve => module.exports.dsnsLookup(name, resolve));
            validatePoint(doorway);
            resolved = slash > 0 ? doorway.replace(/\/$/, '') + accessPoint.slice(slash) : doorway;
        }
        const route = mode === 'pki' ? (resolved === accessPoint ? originalRoute : splitPkiRoute(resolved)) : null;
        const url = validatePoint(resolved);
        if (mode === 'legacy') return { logical: resolved, url: resolved };
        requirePkiContract(route);
        url.pathname = route.doorwayPath;
        url.hash = '';
        return { logical: resolved, url: url.href, contract: route.contract };
    }
    function accessPointError(message) {
        const error = new Error(message);
        error.type = 'access_point_error';
        return error;
    }
    function validatePoint(point) {
        try {
            const url = new URL(point);
            if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error();
            return url;
        } catch (_) { throw accessPointError('Invalid DSA access point or DSNS result'); }
    }
    function makeHeader(state, service, securityToken) {
        return Object.assign(mode === 'pki' ? { TargetContract: state.contract } : {}, {
            TargetService: service, SecurityToken: securityToken
        });
    }
    async function exchange(state, service, body, securityToken, fetchOptions) {
        let inner;
        try { inner = xml.envelope(makeHeader(state, service, securityToken), body); }
        catch (_) {
            const error = new Error('Invalid DSA request XML');
            error.type = 'xml_error';
            throw error;
        }
        if (mode === 'pki') return tunnel.exchange(state.url, state.contract, state.key, inner, fetchOptions);
        const result = await tunnel.post(state.url, inner, fetchOptions);
        return tunnel.parseLegacyResponse(result);
    }
    function dsaLoginError(result) {
        const status = result.parsed?.Envelope?.Header?.Status;
        return { data: result.data, textStatus: 'unknow', XMLHttpRequest: result.response,
            statusCode: status ? status.Code : '', message: status ? status.Message : '' };
    }
    let currentState;
    function startLogin(source = 'initial') {
        const state = { id: ++generation, token: activeToken, key: null, source };
        if (currentState && currentState.url) {
            state.url = currentState.url;
            state.contract = currentState.contract;
            state.logical = currentState.logical;
        }
        currentState = state;
        loggedIn = false;
        loginError = null;
        runLogin(state);
    }
    async function runLogin(state) {
        for (let attempt = 0; attempt <= 3; attempt++) {
            try {
                if (state.id !== generation) return;
                if (!state.url) {
                    Object.assign(state, await resolvePoint());
                    if (state.id !== generation) return;
                    logicalPoint = state.logical;
                }
                if (mode === 'pki' && !state.key) {
                    const initialized = await tunnel.initialize(state.url, state.contract);
                    if (state.id !== generation) return;
                    if (initialized.parsed) { failLogin(state, dsaLoginError(initialized)); return; }
                    state.key = initialized.key;
                }
                const result = await exchange(state, 'DS.Base.Connect',
                    state.token.Type !== 'Session' ? { RequestSessionID: '' } : {}, state.token);
                if (state.id !== generation) return;
                if (result.parsed?.Envelope?.Header?.Status?.Code !== '0') {
                    failLogin(state, dsaLoginError(result));
                    return;
                }
                if (state.token.Type !== 'Session') {
                    activeToken = { '@': ['Type'], Type: 'Session',
                        SessionID: result.parsed.Envelope.Body ? result.parsed.Envelope.Body.SessionID : '' };
                } else activeToken = state.token;
                state.token = activeToken;
                userInfo = result.parsed.Envelope.Header.UserInfo;
                loggedIn = true;
                loginError = null;
                // Detach this generation's waiters before any user callback can
                // reenter ready() or start another reconnect.
                const pendingReady = readyWaiters.splice(0);
                const waiter = reconnectWaiter;
                reconnectWaiter = null;
                if (waiter) waiter.resolve();
                // Dispatch before calling user code that may initiate a new generation.
                flush(state);
                for (const entry of pendingReady) {
                    entry.resolve();
                    if (entry.callback) invoke(entry.callback, false);
                }
                return;
            } catch (error) {
                if (state.id !== generation) return;
                let retryable = false;
                try { retryable = Boolean(error?.retryable); }
                catch (_) { /* Metadata getters must not break failure handling. */ }
                if (retryable && attempt < 3) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                    continue;
                }
                let message = 'Network error occurred';
                try {
                    const detail = error?.message;
                    if (detail) message = String(detail);
                    else if (error != null && !(error instanceof Error)) message = String(error);
                } catch (_) { /* Unreadable exceptions retain the fallback message. */ }
                failLogin(state, { data: 'onerror', textStatus: 'onerror', XMLHttpRequest: error,
                    statusCode: '', message });
                return;
            }
        }
    }
    async function dispatch(req, state) {
        let result;
        try { result = await exchange(state, req.service, req.body, state.token, req.fetchOptions); }
        catch (error) { rejectRequest(req, networkFailure(error)); return; }
        const env = result.parsed?.Envelope;
        const status = env?.Header?.Status;
        if (status?.Code !== '0') {
            rejectRequest(req, { loginError: null, dsaError: { header: env ? env.Header : null,
                status: status ? status.Code : '', message: status ? status.Message : '' }, networkError: null },
            result.response, result.parsed);
        } else if (!req.settled) {
            req.settled = true;
            const body = env.Body || {};
            req.resolve(body);
            invoke(req.result, false, body, null, result.response, result.parsed);
        }
    }
    const connection = {
        getUserInfo: () => userInfo,
        getAccessPoint: () => logicalPoint,
        send(request, options) {
            const req = Object.assign({}, request);
            req.settled = false;
            req.service = req.service || '';
            req.body = req.body || {};
            req.autoRetry = req.autoRetry || false;
            req.result = req.result || function () {};
            const promise = new Promise((resolve, reject) => { req.resolve = resolve; req.reject = reject; });
            req.promise = promise;
            try { req.fetchOptions = httpOptions(options); }
            catch (error) { rejectRequest(req, networkFailure(error), null, undefined, true); return promise; }
            if (loginError) rejectRequest(req, loginFailure(loginError), null, undefined, true);
            else if (loggedIn) dispatch(req, currentState);
            else queue.push(req);
            return promise;
        },
        reConnect(token) {
            if (reconnectWaiter) {
                reconnectWaiter.reject({ data: 'onerror', textStatus: 'onerror', XMLHttpRequest: null,
                    statusCode: '', message: 'Reconnect superseded by another reconnect' });
            }
            activeToken = normalizeToken(token);
            return new Promise((resolve, reject) => {
                reconnectWaiter = { resolve, reject };
                startLogin('reconnect');
            });
        },
        ready(fn) {
            if (loggedIn) {
                if (fn) invoke(fn, true);
                return Promise.resolve();
            }
            return new Promise(resolve => readyWaiters.push({ callback: fn, resolve }));
        },
        OnLoginError(fn) {
            if (fn) { loginErrorCallbacks.push(fn); if (loginError) invoke(fn, true, loginError); }
        },
        OnError(fn) { if (fn) errorCallbacks.push(fn); }
    };
    startLogin();
    return connection;
};

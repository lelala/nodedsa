﻿var nodexml = require('nodexml');
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

module.exports.open = function (accessPoint, token) {
    if (!!!accessPoint) {
        throw "accessPoint is empty";
    }
    var _accessPoint = accessPoint || '';
    var _token = {};
    if (token) {
        if (typeof token != "object") {
            _token = {
                "@": ['Type'],
                Type: 'PassportAccessToken',
                AccessToken: token
            };
        }
        else {
            _token = token;
        }
    }
    var _IsLogin = false;
    var _SendingRequests = [];
    var _LoginError = null;
    var _ErrorCallBack = [];
    var _LoginErrorCallBack = [];
    var _UserInfo = {};
    var _ReadyCallBack = [];
    var _LoginRetry = 0;
    async function login() {
        _LoginError = null;
        _IsLogin = false;

        try {
            const response = await fetch(_accessPoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/xml'
                },
                body: nodexml.obj2xml({
                    Header: {
                        TargetService: 'DS.Base.Connect',
                        SecurityToken: _token
                    },
                    Body: (_token.Type != 'Session') ? { RequestSessionID: '' } : {}
                }, 'Envelope')
            });

            const data = await response.text();
            const resp = nodexml.xml2obj(data);
            
            if (resp.Envelope && resp.Envelope.Header && resp.Envelope.Header.Status && resp.Envelope.Header.Status.Code == "0") {
                if (_token.Type != 'Session') {
                    _token = {
                        "@": ['Type'],
                        Type: 'Session',
                        SessionID: (resp.Envelope && resp.Envelope.Body) ? resp.Envelope.Body.SessionID : ""
                    }
                }
                _UserInfo = resp.Envelope.Header.UserInfo;
                _LoginError = null;
                _IsLogin = true;
                for (var i = 0; i < _ReadyCallBack.length; i++) {
                    _ReadyCallBack[i]();
                }
                SendAllRequest();
            }
            else {
                _LoginError = {
                    'data': data,
                    'textStatus': 'unknow',
                    'XMLHttpRequest': response,
                    'statusCode': (resp.Envelope && resp.Envelope.Header && resp.Envelope.Header.Status) ? resp.Envelope && resp.Envelope.Header && resp.Envelope.Header.Status && resp.Envelope.Header.Status.Code : "",
                    'message': (resp.Envelope && resp.Envelope.Header && resp.Envelope.Header.Status) ? resp.Envelope && resp.Envelope.Header && resp.Envelope.Header.Status && resp.Envelope.Header.Status.Message : ""
                };
                for (index in _LoginErrorCallBack) {
                    _LoginErrorCallBack[index](_LoginError);
                }
                SendAllRequest();
            }
        } catch (error) {
            if (_LoginRetry < 3) {
                _LoginRetry++;
                setTimeout(login, 500);
                return;
            }
            _LoginError = {
                'data': 'onerror',
                'textStatus': 'onerror',
                'XMLHttpRequest': error,
                'statusCode': "",
                'message': error.message || "Network error occurred"
            };
            SendAllRequest();
        }
    }
    if (_accessPoint.indexOf("://") < 0) {
        var index = _accessPoint.indexOf("/");
        if (index > 0) {
            var dsnsName = _accessPoint.substring(0, index);
            module.exports.dsnsLookup(dsnsName, function (accesspoint) {
                _accessPoint = accesspoint.replace(/\/$/g, '') + _accessPoint.substring(index);
                login();
            });
        }
        else {
            module.exports.dsnsLookup(_accessPoint, function (accesspoint) {
                _accessPoint = accesspoint;
                login();
            });
        }
    }
    else {
        login();
    }
    function SendAllRequest() {
        if (_IsLogin === true) {
            for (index in _SendingRequests) {
                SendRequest(_SendingRequests[index]);
            }
            _SendingRequests = [];
        }
        else
            if (_LoginError !== null) {
                for (index in _SendingRequests) {
                    for (index in _ErrorCallBack) {
                        _ErrorCallBack[index](_SendingRequests[index], {
                            'loginError': _LoginError,
                            'dsaError': null,
                            'networkError': null,
                            'ajaxException': null
                        });
                    }
                    _SendingRequests[index].result(null, {
                        'loginError': _LoginError,
                        'dsaError': null,
                        'networkError': null,
                        'ajaxException': null
                    }, null);
                    _SendingRequests[index].promiseReject({
                        'loginError': _LoginError,
                        'dsaError': null,
                        'networkError': null,
                        'ajaxException': null
                    });
                }
                _SendingRequests = [];
            }
    }
    async function SendRequest(req) {
        try {
            const response = await fetch(_accessPoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/xml'
                },
                body: (typeof req.body == "string") ?
                    (nodexml.obj2xml({
                        Header: {
                            TargetService: req.service,
                            SecurityToken: _token
                        },
                        Body: 'bodytemplated'
                    }, 'Envelope')).replace('<Body>bodytemplated</Body>', '<Body>' + req.body + '</Body>') :
                    (nodexml.obj2xml({
                        Header: {
                            TargetService: req.service,
                            SecurityToken: _token
                        },
                        Body: req.body
                    }, 'Envelope'))
            });

            const data = await response.text();
            const resp = nodexml.xml2obj(data);
            
            if (resp.Envelope && resp.Envelope.Header && resp.Envelope.Header.Status && resp.Envelope.Header.Status.Code == "0") {
                req.result(resp.Envelope.Body || {}, null, response, resp);
                req.promiseReslove(resp.Envelope.Body || {});
            }
            else {
                //Service Failed
                const errorInfo = {
                    'loginError': null,
                    'dsaError': {
                        header: resp.Envelope ? resp.Envelope.Header : null,
                        status: (resp.Envelope && resp.Envelope.Header && resp.Envelope.Header.Status) ? resp.Envelope && resp.Envelope.Header && resp.Envelope.Header.Status && resp.Envelope.Header.Status.Code : "",
                        message: (resp.Envelope && resp.Envelope.Header && resp.Envelope.Header.Status) ? resp.Envelope && resp.Envelope.Header && resp.Envelope.Header.Status && resp.Envelope.Header.Status.Message : ""
                    },
                    'networkError': null
                };

                for (index in _ErrorCallBack) {
                    _ErrorCallBack[index](req, errorInfo);
                }
                req.result(null, errorInfo, response, resp);
                req.promiseReject(errorInfo);
            }
        } catch (error) {
            const errorInfo = {
                'loginError': null,
                'dsaError': null,
                'networkError': {
                    name: error.name,
                    message: error.message,
                    stack: error.stack,
                    type: error.type || 'fetch_error'
                }
            };

            for (index in _ErrorCallBack) {
                _ErrorCallBack[index](req, errorInfo);
            }
            req.result(null, errorInfo, null);
            req.promiseReject(errorInfo);
        }
    }

    var result = {
        getUserInfo: function () { return _UserInfo; },
        getAccessPoint: function () { return _accessPoint; },
        send: function (req) {
            req.service = req.service || '';
            req.body = req.body || {};
            req.autoRetry = req.autoRetry || false;
            req.result = req.result ||
                function (resp, errorInfo, XMLHttpRequest) {// errorInfo=null||{'loginError': null,'dsaError': null,'networkError': null,'ajaxException': null} 
                };
            var resultPromise = new Promise(function (reslove, reject) {
                req.promiseReslove = reslove;
                req.promiseReject = reject;
            });
            if (_IsLogin === false && _LoginError !== null) {
                req.result(null, {
                    'loginError': _LoginError,
                    'dsaError': null,
                    'networkError': null,
                    'ajaxException': null
                }, null);
            }
            else {
                _SendingRequests.push(req);
                if (_IsLogin)
                    SendAllRequest();
            }
            return resultPromise;
        },
        reConnect: function (token) {
            return new Promise((resolve, reject) => {
                _LoginError = null;
                _IsLogin = false;
                _token = {};
                if (token) {
                    if (typeof token != "object") {
                        _token = {
                            "@": ['Type'],
                            Type: 'PassportAccessToken',
                            AccessToken: token
                        };
                    }
                    else {
                        _token = token;
                    }
                }
                _IsLogin = false;

                // 保存原始的 callback 函數
                var originalReadyCallback = _ReadyCallBack;
                var originalLoginErrorCallback = _LoginErrorCallBack;
                
                // 設定新的 callback 函數
                _ReadyCallBack = [function() {
                    _ReadyCallBack = originalReadyCallback;
                    resolve();
                }];
                
                _LoginErrorCallBack = [function(error) {
                    _LoginErrorCallBack = originalLoginErrorCallback;
                    reject(error);
                }];

                login();
            });
        },
        ready: function (fn) {
            if (fn) {
                _ReadyCallBack.push(fn);
                if (_IsLogin) {
                    fn();
                }
            }
            return new Promise((resolve) => {
                if (_IsLogin) {
                    resolve();
                } else {
                    _ReadyCallBack.push(resolve);
                }
            });
        },
        OnLoginError: function (fn) {
            if (fn) {
                _LoginErrorCallBack.push(fn);
                if (_IsLogin === false && _LoginError !== null) {
                    fn(_LoginError);
                }
            }
        },
        OnError: function (fn) {
            if (fn) {
                _ErrorCallBack.push(fn);
            }
        }
    };
    return result;
};
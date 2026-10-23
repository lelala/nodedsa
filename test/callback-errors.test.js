'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const client = require.resolve(process.env.NODEDSA_TEST_PACKAGE || '../app');
const fixture = require.resolve('./helpers/mock-dsa');

function probe(mode, scenario) {
    const script = `
        const api = require(${JSON.stringify(client)});
        const { mockDsa, status } = require(${JSON.stringify(fixture)});
        const mode = ${JSON.stringify(mode)}, scenario = ${JSON.stringify(scenario)};
        const denied = scenario.includes('FailedLogin') || scenario === 'syncLoginError' || scenario === 'asyncLoginError';
        const server = mockDsa({handle: call => denied && call.service === 'DS.Base.Connect' ? {xml:status('401')} :
            scenario === 'asyncError' && call.service !== 'DS.Base.Connect' ? {xml:status('500')} : undefined});
        global.fetch = server.fetch;
        const seen = [], rejectionCountsAtCallbacks = [], settledAtHooks = [];
        const marker = new Error('fixture callback failure');
        let origin = null, caught = false, returned = false, settlement = 'pending', rejectCalls = 0, constructors = 0, setupFailure = false;
        process.on('uncaughtExceptionMonitor', (_, value) => { origin = value; });
        process.on('exit', code => console.log('PROBE:' + JSON.stringify({code,seen,origin,caught,returned,settlement,rejectCalls,constructors,
            rejectionCountsAtCallbacks,settledAtHooks,setupFailure,
            logins:server.calls.filter(c=>c.service==='DS.Base.Connect').length,
            services:server.calls.filter(c=>c.service && c.service!=='DS.Base.Connect').length})));
        const NativePromise = Promise;
        class TrackedPromise extends NativePromise {
            static get [Symbol.species]() { return NativePromise; }
            constructor(executor) {
                constructors++;
                super((resolve,reject)=>executor(resolve,error=>{rejectCalls++;reject(error);}));
            }
        }
        function callback(label, shouldThrow, req) {
            seen.push(label); rejectionCountsAtCallbacks.push(rejectCalls);
            if(req) settledAtHooks.push(req.settled);
            if(shouldThrow) throw marker;
        }
        (async()=>{
            const conn=api.open('https://fixture.test/Contract','fake',{transport:mode});
            if(scenario==='asyncReady') {conn.ready(()=>callback('ready',true));return;}
            if(scenario==='asyncLoginError') {conn.OnLoginError(()=>callback('loginError',true));return;}
            if(denied) await new NativePromise(resolve=>conn.OnLoginError(resolve));
            else await conn.ready();
            if(scenario==='asyncResult'||scenario==='asyncError') {
                if(scenario==='asyncError') conn.OnError(req=>callback('error',true,req));
                conn.send({service:'Read',result:()=>callback('result',scenario==='asyncResult')})
                    .then(()=>settlement='resolved',()=>settlement='rejected');
                return;
            }
            global.Promise=TrackedPromise;
            try {
                let promise;
                if(scenario==='syncReady') promise=conn.ready(()=>callback('ready',true));
                else if(scenario==='syncLoginError') conn.OnLoginError(()=>callback('loginError',true));
                else {
                    conn.OnError(req=>callback('error1',scenario.endsWith('FirstError'),req));
                    conn.OnError(req=>callback('error2',scenario.endsWith('SecondError'),req));
                    conn.OnError(req=>callback('error3',false,req));
                    promise=conn.send({service:'Read',result:()=>callback('result',scenario.endsWith('Result'))},
                        scenario.includes('Options')?{headers:{'bad header':'fixture'}}:undefined);
                }
                returned=true;
                if(promise) promise.then(()=>settlement='resolved',()=>settlement='rejected');
            } catch(error) {caught=error===marker;}
            finally {global.Promise=NativePromise;}
        })().catch(()=>{setupFailure=true;process.exitCode=2;});
    `;
    // Monitor observes the default failure without suppressing it; there is no
    // uncaughtException/unhandledRejection handler that makes the child survive.
    const env = { ...process.env }; delete env.NODE_OPTIONS;
    const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 5000, env });
    assert.ifError(result.error);
    const line = result.stdout.split('\n').find(line => line.startsWith('PROBE:'));
    assert.ok(line, result.stderr);
    const report = JSON.parse(line.slice(6));
    assert.equal(report.setupFailure, false, result.stderr);
    assert.equal(report.code, result.status);
    assert.equal(report.logins, 1);
    return report;
}

for (const mode of ['legacy', 'pki']) {
    for (const scenario of ['syncReady', 'syncLoginError']) {
        test('synchronous lifecycle callback propagates without orphaned Promise: ' + mode + '/' + scenario, () => {
            const report = probe(mode, scenario);
            assert.equal(report.code, 0); assert.equal(report.origin, null);
            assert.equal(report.caught, true); assert.equal(report.returned, false);
            assert.equal(report.constructors, 0); assert.equal(report.rejectCalls, 0);
            assert.equal(report.seen.length, 1); assert.equal(report.services, 0);
        });
    }
    for (const source of ['Options', 'FailedLogin']) {
        for (const ending of ['Result', 'FirstError', 'SecondError', 'Normal']) {
            const scenario = 'sync' + source + ending;
            test('synchronous send settlement and callback order: ' + mode + '/' + scenario, () => {
                const report = probe(mode, scenario);
                const normal = ending === 'Normal';
                assert.equal(report.code, 0); assert.equal(report.origin, null);
                assert.equal(report.caught, !normal); assert.equal(report.returned, normal);
                assert.equal(report.constructors, 1); assert.equal(report.rejectCalls, 1);
                assert.equal(report.services, 0);
                const expected = ending === 'FirstError' ? ['error1'] : ending === 'SecondError' ? ['error1', 'error2'] :
                    ['error1', 'error2', 'error3', 'result'];
                assert.deepEqual(report.seen, expected);
                assert.ok(report.rejectionCountsAtCallbacks.every(count => count === 0));
                assert.ok(report.settledAtHooks.every(value => value === true));
                if (normal) assert.equal(report.settlement, 'rejected');
            });
        }
    }
    for (const scenario of ['asyncReady', 'asyncLoginError', 'asyncResult', 'asyncError']) {
        test('async callback exits once without retry: ' + mode + '/' + scenario, () => {
            const report = probe(mode, scenario);
            assert.equal(report.code, 1); assert.equal(report.origin, 'uncaughtException');
            assert.equal(report.caught, false);
            assert.equal(report.seen.filter(label => label === (scenario === 'asyncReady' ? 'ready' :
                scenario === 'asyncLoginError' ? 'loginError' : scenario === 'asyncError' ? 'error' : 'result')).length, 1);
            assert.equal(report.services, scenario === 'asyncResult' || scenario === 'asyncError' ? 1 : 0);
        });
    }
}

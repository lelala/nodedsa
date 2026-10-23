'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runTests } = require('../scripts/run-tests');

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodedsa-runner-'));
    fs.mkdirSync(path.join(root, 'test'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return root;
}
test('runner sorts only direct test files and forwards options before paths', t => {
    const root = fixture(t);
    for (const name of ['z.test.js', 'a.test.js', 'helper.js']) fs.writeFileSync(path.join(root, 'test', name), '');
    fs.mkdirSync(path.join(root, 'test', 'directory.test.js'));
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.writeFileSync(path.join(root, 'scripts', 'test-package.js'), 'throw new Error("must not run");');
    const result = runTests(['--test-name-pattern', 'chosen'], { root, spawn: (executable, args) => {
        assert.equal(executable, process.execPath);
        assert.deepEqual(args, ['--test', '--test-name-pattern', 'chosen',
            path.join(root, 'test', 'a.test.js'), path.join(root, 'test', 'z.test.js')]);
        return { status: 0 };
    } });
    assert.equal(result.exitCode, 0);
});
test('runner fails an empty test set without spawning', t => {
    const result = runTests([], { root: fixture(t), spawn: () => assert.fail('must not spawn') });
    assert.equal(result.exitCode, 1); assert.match(result.error.message, /No .*test.js files/);
});
test('runner preserves exits and fails spawn errors or signals', t => {
    const root = fixture(t); fs.writeFileSync(path.join(root, 'test', 'sample.test.js'), '');
    for (const [child, code] of [[{ status: 0 }, 0], [{ status: 7 }, 7],
        [{ status: null, signal: 'SIGTERM' }, 1], [{ status: null, error: new Error('spawn failed') }, 1],
        [{ status: 0, error: new Error('spawn failed') }, 1]]) {
        assert.equal(runTests([], { root, spawn: () => child }).exitCode, code);
    }
    assert.equal(runTests([], { root, spawn: () => { throw new Error('spawn threw'); } }).exitCode, 1);
});
test('runner CLI forwards filtering and returns actual test failure', t => {
    const root = fixture(t); fs.mkdirSync(path.join(root, 'scripts'));
    const runner = path.join(root, 'scripts', 'run-tests.js');
    fs.copyFileSync(path.resolve(__dirname, '../scripts/run-tests.js'), runner);
    fs.writeFileSync(path.join(root, 'test', 'sample.test.js'),
        "const {test}=require('node:test'); test('chosen',()=>{}); test('other',()=>{throw new Error('expected failure');});");
    fs.writeFileSync(path.join(root, 'test', 'helper.js'), 'throw new Error("helper must not run");');
    fs.writeFileSync(path.join(root, 'scripts', 'test-package.js'), 'throw new Error("pack must not run");');
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const filtered = spawnSync(process.execPath, [runner, '--test-name-pattern', 'chosen'], { encoding: 'utf8', env });
    assert.equal(filtered.status, 0, filtered.stdout + filtered.stderr);
    assert.match(filtered.stdout, /chosen/); assert.doesNotMatch(filtered.stdout, /expected failure|must not run/);
    const failed = spawnSync(process.execPath, [runner], { encoding: 'utf8', env });
    assert.equal(failed.status, 1); assert.match(failed.stdout, /expected failure/);
    fs.unlinkSync(path.join(root, 'test', 'sample.test.js'));
    const empty = spawnSync(process.execPath, [runner], { encoding: 'utf8', env });
    assert.equal(empty.status, 1); assert.match(empty.stderr, /No .*test.js files/);
});

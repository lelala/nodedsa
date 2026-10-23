'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveNpmCli, runNpm } = require('../scripts/npm-runner');
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodedsa npm & fixture-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return root;
}
function cli(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'console.log(JSON.stringify(process.argv.slice(2)));');
    return file;
}
test('npm_execpath JS entry retains spaces and shell metacharacters as literal arguments', t => {
    const file = cli(path.join(fixture(t), 'npm path & literal', 'npm-cli.js'));
    const args = ['pack', 'path with spaces', 'a&b', '$(literal)', '%PATH%', '"quoted"'];
    const env = { ...process.env, npm_execpath: file };
    assert.equal(resolveNpmCli({ env }), file);
    assert.deepEqual(JSON.parse(runNpm(args, { env, encoding: 'utf8' })), args);
});
test('direct Node invocation resolves only existing standard npm locations', t => {
    for (const relative of ['node_modules/npm/bin/npm-cli.js', '../lib/node_modules/npm/bin/npm-cli.js']) {
        const directory = path.join(fixture(t), 'node directory', 'bin');
        const file = cli(path.resolve(directory, relative));
        assert.equal(resolveNpmCli({ env: {}, execPath: path.join(directory, 'node') }), file);
    }
});
test('missing or invalid npm entry fails clearly without trying PATH or npm.cmd', t => {
    const directory = fixture(t);
    const execPath = path.join(directory, 'bin', 'node');
    for (const env of [{}, { npm_execpath: path.join(directory, 'missing', 'npm-cli.js') }, { npm_execpath: 'npm-cli.js' },
        { npm_execpath: cli(path.join(directory, 'npm.cmd')) }]) {
        assert.throws(() => resolveNpmCli({ env, execPath }), /Cannot locate npm-cli.js/);
    }
    const valid = cli(path.join(directory, 'bin/node_modules/npm/bin/npm-cli.js'));
    assert.equal(resolveNpmCli({ env: {}, execPath }), valid);
    assert.throws(() => resolveNpmCli({ env: { npm_execpath: path.join(directory, 'missing', 'npm-cli.js') }, execPath }), /Cannot locate/);
});

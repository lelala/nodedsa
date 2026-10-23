'use strict';
// Installs the actual tarball in a separate project; only the test harness uses
// repository devDependencies. Package resolution never uses NODE_PATH.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { runTests } = require('./run-tests');
const { runNpm } = require('./npm-runner');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nodedsa-package-'));
const env = { ...process.env }; delete env.NODE_PATH;
if (process.env.NODEDSA_NPM_CACHE) env.npm_config_cache = process.env.NODEDSA_NPM_CACHE;
function run(args, cwd = root) {
    return runNpm(args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
const info = JSON.parse(run(['pack', '--dry-run', '--ignore-scripts', '--json']))[0];
const actual = JSON.parse(run(['pack', '--ignore-scripts', '--pack-destination', temp, '--json']))[0];
const files = actual.files.map(file => file.path).sort();
const expected = ['CHANGELOG.md', 'README.md', 'app.js', 'lib/secure-tunnel.js', 'lib/xml.js', 'package.json'];
if (JSON.stringify(files) !== JSON.stringify(expected) || JSON.stringify(info.files.map(f => f.path).sort()) !== JSON.stringify(files)) {
    throw new Error('Unexpected package contents');
}
const archive = path.join(temp, actual.filename);
const consumer = path.join(temp, 'consumer'); fs.mkdirSync(consumer);
fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'nodedsa-consumer-fixture', version: '1.0.0', private: true }));
run(['install', process.env.NODEDSA_OFFLINE === 'yes' ? '--offline' : '--prefer-offline',
    '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', archive], consumer);
const installed = path.join(consumer, 'node_modules', 'nodedsa');
execFileSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    global.fetch = () => { throw new Error('require must not make HTTP requests'); };
    const client = require('nodedsa');
    assert.deepEqual(Object.keys(client).sort(), ['dsnsLookup', 'open']);
    assert.equal(require('nodexml/package.json').version, '1.0.2');
    for (const name of ['saxes', '@fission-ai/openspec']) {
        assert.throws(() => require.resolve(name));
    }
`], { cwd: consumer, env, stdio: 'pipe' });
const result = runTests([], {
    cwd: consumer, env: { ...env, NODEDSA_TEST_PACKAGE: installed }, encoding: 'utf8'
});
fs.writeFileSync(path.join(temp, 'tests.tap'), (result.stdout || '') + (result.stderr || ''));
if (result.exitCode !== 0) {
    process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
    throw new Error('Installed tarball tests failed');
}
const evidence = { node: process.version, npm: run(['--version']).trim(), archive,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'), files,
    version: actual.version, productionDependencies: { nodexml: '1.0.2' },
    result: 'passed', log: path.join(temp, 'tests.tap') };
fs.writeFileSync(path.join(temp, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));

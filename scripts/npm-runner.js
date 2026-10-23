'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function resolveNpmCli({ env = process.env, execPath = process.execPath } = {}) {
    const directory = path.dirname(execPath);
    const candidates = env.npm_execpath ? [env.npm_execpath] : [
        path.join(directory, 'node_modules/npm/bin/npm-cli.js'),
        path.resolve(directory, '../lib/node_modules/npm/bin/npm-cli.js')
    ];
    for (const candidate of candidates) {
        if (!path.isAbsolute(candidate) || path.basename(candidate) !== 'npm-cli.js') continue;
        try { if (fs.statSync(candidate).isFile()) return candidate; }
        catch (_) { /* Try only the explicit, standard installation candidates. */ }
    }
    throw new Error('Cannot locate npm-cli.js. Use npm run test:package or set npm_execpath to a valid absolute npm-cli.js path.');
}
function runNpm(args, options = {}) {
    const env = options.env || process.env;
    return execFileSync(process.execPath, [resolveNpmCli({ env }), ...args], { ...options, env, shell: false });
}
module.exports = { resolveNpmCli, runNpm };

'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function runTests(args = [], options = {}) {
    const { root = path.resolve(__dirname, '..'), spawn = spawnSync, ...childOptions } = options;
    try {
        const directory = path.join(root, 'test');
        const files = fs.readdirSync(directory, { withFileTypes: true })
            .filter(entry => entry.isFile() && entry.name.endsWith('.test.js'))
            .map(entry => entry.name).sort().map(name => path.join(directory, name));
        if (!files.length) throw new Error('No *.test.js files found in ' + directory);
        const result = spawn(process.execPath, ['--test', ...args, ...files], childOptions);
        return { ...result, exitCode: result.error || result.status === null ? 1 : result.status };
    } catch (error) {
        return { error, exitCode: 1 };
    }
}

if (require.main === module) {
    const result = runTests(process.argv.slice(2), { stdio: 'inherit' });
    if (result.error) console.error(result.error.message);
    process.exitCode = result.exitCode;
}
module.exports = { runTests };

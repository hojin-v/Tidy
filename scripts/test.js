import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
const files = readdirSync(new URL('../tests/', import.meta.url)).filter(name => name.endsWith('.test.js')).map(name => `tests/${name}`);
const result = spawnSync(process.execPath, ['--test', ...files], {stdio: 'inherit'});
process.exitCode = result.status ?? 1;

import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {join} from 'node:path';
const directories = ['.', 'bin', 'lib', 'scripts', 'tests', 'desktop'];
for (const directory of directories) {
    for (const file of readdirSync(directory).filter(name => /\.(?:js|cjs)$/.test(name))) {
        const result = spawnSync(process.execPath, ['--check', join(directory, file)], {stdio: 'inherit'});
        if (result.status !== 0) process.exit(result.status ?? 1);
    }
}
if (process.platform === 'linux') {
    const result = spawnSync('/usr/bin/python3', ['scripts/check.py'], {stdio: 'inherit'});
    process.exitCode = result.status ?? 1;
}

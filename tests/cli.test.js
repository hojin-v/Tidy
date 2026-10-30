import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {main} from '../bin/tidy.js';

function fixture(t) {
    const directory = mkdtempSync(join(tmpdir(), 'tidy cli '));
    t.after(() => rmSync(directory, {recursive: true, force: true}));
    const packageRoot = join(directory, 'npm package');
    const data = join(directory, 'user data $literal');
    const installed = join(data, 'gnome-shell/extensions/winubun@winubun.local/scripts/manage.py');
    mkdirSync(join(packageRoot, 'dist'), {recursive: true});
    writeFileSync(join(packageRoot, 'dist/winubun@winubun.local.shell-extension.zip'), 'fixture');
    const calls = [];
    const messages = [];
    const options = {packageRoot, platform: 'linux', uid: 1000, env: {LANGUAGE: 'en', XDG_DATA_HOME: data},
        run: (command, args, settings) => {
            calls.push({command, args, settings});
            return {status: 0, stdout: command === 'gnome-shell' ? 'GNOME Shell 50.1\n' : 'gjs 1.86.0\n'};
        }, out: value => messages.push(value), error: value => messages.push(value)};
    return {packageRoot, installed, calls, messages, options};
}

test('CLI help and version work without GNOME, Python or desktop changes', t => {
    const {calls, messages, options} = fixture(t);
    for (const args of [[], ['--help'], ['--version']])
        assert.equal(main({...options, args, platform: 'darwin'}), 0);
    assert.equal(calls.length, 0);
    assert(messages.some(text => text.includes('npx @hnode/tidy@latest install')));
    assert(messages.includes(JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version));
    main({...options, args: ['help'], env: {LANGUAGE: 'ko'}});
    assert(messages.at(-1).includes('사용법'));
});

test('unknown commands, unsupported platforms and root cannot change the desktop', t => {
    const {calls, options} = fixture(t);
    assert.equal(main({...options, args: ['invalid']}), 2);
    assert.equal(main({...options, args: ['install', 'extra']}), 2);
    assert.equal(main({...options, args: ['install'], platform: 'win32'}), 1);
    assert.equal(main({...options, args: ['uninstall'], uid: 0}), 1);
    assert.equal(calls.length, 0);
});

test('install and update use the bundled ZIP and packaged installer with literal arguments', t => {
    const {packageRoot, installed, calls, options} = fixture(t);
    mkdirSync(join(installed, '..'), {recursive: true});
    writeFileSync(installed, 'an older installer');
    for (const command of ['install', 'update']) {
        assert.equal(main({...options, args: [command]}), 0);
        const last = calls.at(-1);
        assert.equal(last.command, '/usr/bin/python3');
        assert.deepEqual(last.args, [join(packageRoot, 'scripts/manage.py'), 'install', '--archive',
            join(packageRoot, 'dist/winubun@winubun.local.shell-extension.zip')]);
        assert.equal(last.settings.stdio, 'inherit');
        assert.equal(last.settings.env.PYTHONDONTWRITEBYTECODE, '1');
        assert(!last.settings.shell);
    }
});

test('settings, status and removal use the installed recovery tools after npm updates', t => {
    const {installed, calls, options} = fixture(t);
    mkdirSync(join(installed, '..'), {recursive: true});
    writeFileSync(installed, 'installed recovery tools');
    for (const command of ['prefs', 'status', 'uninstall']) {
        assert.equal(main({...options, args: [command]}), 0);
        assert.deepEqual(calls.at(-1).args, [installed, command]);
    }
});

test('absent installations give setup instructions and removal can still recover state', t => {
    const {packageRoot, calls, messages, options} = fixture(t);
    for (const command of ['status', 'prefs']) assert.equal(main({...options, args: [command]}), 1);
    assert(messages.some(message => message.includes('tidy install')));
    assert.equal(main({...options, args: ['uninstall']}), 0);
    assert.deepEqual(calls.at(-1).args, [join(packageRoot, 'scripts/manage.py'), 'uninstall']);
});

test('missing runtime dependencies fail before running the installer', t => {
    const {calls, messages, options} = fixture(t);
    assert.equal(main({...options, args: ['install'], run: () => ({error: new Error('ENOENT')})}), 1);
    assert(messages.some(message => message.includes('PyGObject')));
    assert.equal(calls.length, 0);
});

test('the CLI preserves management failures and reports interrupted operations', t => {
    const {options, messages} = fixture(t);
    const run = (_command, args) => args[0] === '-c' ? {status: 0} : {status: 7};
    assert.equal(main({...options, args: ['uninstall'], run}), 7);
    assert.equal(main({...options, args: ['uninstall'], run: (command, args) =>
        args[0] === '-c' ? {status: 0} : {signal: 'SIGTERM'}}), 1);
    assert(messages.some(message => message.includes('interrupted')));
});

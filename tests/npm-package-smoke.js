// Exercise the actual npm tarball without changing the user's GNOME session.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(join(root, 'package.json')));
const directory = mkdtempSync(join(tmpdir(), 'tidy npm package '));
const prefix = join(directory, 'global prefix');
const installedPackage = join(prefix, 'lib/node_modules/@hnode/tidy');
const data = join(directory, 'user data');
const state = join(directory, 'user state');
const extension = join(data, 'gnome-shell/extensions/winubun@winubun.local');
const env = {...process.env, LANGUAGE: 'en', XDG_DATA_HOME: data, XDG_STATE_HOME: state,
    XDG_CONFIG_HOME: join(directory, 'user config'), npm_config_cache: join(directory, 'npm cache')};
const run = (command, args, options = {}) => {
    const result = spawnSync(command, args, {cwd: directory, env, encoding: 'utf8', ...options});
    assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
    return result.stdout;
};
const permissions = (path, readonly) => {
    if (!existsSync(path)) return;
    chmodSync(path, readonly ? 0o555 : 0o755);
    for (const entry of readdirSync(path, {withFileTypes: true})) {
        const child = join(path, entry.name);
        if (entry.isDirectory()) permissions(child, readonly);
        else chmodSync(child, readonly ? 0o555 : 0o755);
    }
};
const fixture = () => {
    mkdirSync(join(extension, 'scripts'), {recursive: true});
    writeFileSync(join(extension, 'scripts/manage.py'), `import json, os, shutil, sys
from pathlib import Path
path = Path(os.environ['XDG_STATE_HOME'])
path.mkdir(parents=True, exist_ok=True)
(path / 'cli-arguments.json').write_text(json.dumps(sys.argv[1:]))
if sys.argv[1] == 'uninstall':
    shutil.rmtree(Path(__file__).resolve().parent.parent)
`);
};

try {
    const argument = process.argv[2];
    let tarball;
    if (argument) tarball = resolve(argument);
    else {
        const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', directory], {cwd: root}));
        tarball = join(directory, packed[0].filename);
    }
    run('npm', ['install', '--global', '--prefix', prefix, tarball, '--offline', '--no-audit', '--no-fund']);
    const packaged = JSON.parse(readFileSync(join(installedPackage, 'package.json')));
    assert.equal(packaged.name, '@hnode/tidy');
    assert.equal(packaged.version, manifest.version);
    assert.equal(packaged.publishConfig.access, 'public');
    assert.equal(packaged.scripts.postinstall, undefined);
    assert.equal(packaged.scripts.preinstall, undefined);
    for (const name of ['bin/tidy.js', 'LICENSE', 'NOTICE', 'README.md', 'docs/README.en.md',
        'scripts/manage.py', 'lib/translations.json', 'dist/winubun@winubun.local.shell-extension.zip'])
        assert(existsSync(join(installedPackage, name)), name);
    for (const name of ['.git', '.npmrc', 'tests', 'node_modules', 'schemas', 'dist/shell-verification.log'])
        assert(!existsSync(join(installedPackage, name)), name);
    const zip = join(installedPackage, 'dist/winubun@winubun.local.shell-extension.zip');
    run('/usr/bin/python3', ['-c', `import json, sys, zipfile
from pathlib import Path
with zipfile.ZipFile(sys.argv[1]) as archive:
    metadata = json.loads(archive.read('metadata.json'))
    assert metadata == json.loads(Path(sys.argv[2]).read_text())
    for name in ['LICENSE', 'NOTICE', 'schemas/gschemas.compiled', 'scripts/manage.py', 'lib/windowManager.js']:
        assert name in archive.namelist(), name
`, zip, join(installedPackage, 'metadata.json')]);
    permissions(installedPackage, true);
    const command = join(prefix, 'bin/tidy');
    assert.equal(run(command, ['--version']).trim(), manifest.version);
    assert.equal(run('npm', ['exec', '--offline', '--yes', '--package', tarball, '--', 'tidy', '--version']).trim(),
        manifest.version, 'npx/npm exec resolves the scoped package executable from its temporary cache');
    assert(run(command, ['--help']).includes('npx @hnode/tidy@latest install'));
    assert(run(command, ['help'], {env: {...env, LANGUAGE: 'ko'}}).includes('사용법'));
    assert(run(command, ['doctor']).includes('requirements are available'));
    assert(!existsSync(extension), 'npm installation and help must not install a GNOME extension implicitly');
    run('/usr/bin/python3', [join(installedPackage, 'scripts/manage.py'), '--help']);
    fixture();
    for (const action of ['status', 'prefs', 'uninstall']) {
        run(command, [action]);
        assert.deepEqual(JSON.parse(readFileSync(join(state, 'cli-arguments.json'))), [action]);
    }
    assert(!existsSync(extension), 'tidy uninstall delegates to the installed recovery tools');
    assert(existsSync(installedPackage), 'desktop removal preserves the npm package');
    fixture();
    permissions(installedPackage, false);
    run('npm', ['uninstall', '--global', '--prefix', prefix, '@hnode/tidy', '--offline', '--no-audit', '--no-fund']);
    assert(!existsSync(installedPackage));
    assert(existsSync(extension), 'npm package removal does not silently change desktop settings');
    console.log(`PASS: @hnode/tidy@${manifest.version} tarball, global command, read-only package, bilingual help and removal separation`);
} finally {
    permissions(installedPackage, false);
    rmSync(directory, {recursive: true, force: true});
}

import {spawn, spawnSync} from 'node:child_process';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {delimiter, dirname, join, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const sourceRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const readJSON = path => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };

function npmScript(env) {
    const candidates = [env.npm_execpath, join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
        join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')];
    for (const directory of (env.PATH || '').split(delimiter)) {
        if (directory) candidates.push(join(directory, 'npm'), join(directory, 'node_modules/npm/bin/npm-cli.js'));
    }
    return candidates.filter(Boolean).filter(existsSync).map(path => realpathSync(path))
        .find(path => path.endsWith('.js'));
}

export function desktopPaths(home = homedir()) {
    const base = join(home, 'Library', 'Application Support', 'Tidy');
    const install = join(base, 'desktop');
    return {base, install, config: join(base, 'config'), status: join(base, 'status.json')};
}

export function launchSpec(install) {
    const binary = join(install, 'Tidy.app', 'Contents', 'MacOS', 'Electron');
    // LaunchServices gives Tidy its own macOS permission identity instead of
    // attributing Accessibility requests to the terminal that ran the CLI.
    return {executable: '/usr/bin/open', binary, args: ['-n', '-a', join(install, 'Tidy.app'), '--args']};
}

export function desktopCommand(command, {platform = process.platform, env = process.env, packageRoot = sourceRoot,
    run = spawnSync, launch = spawn, out = console.log, error = console.error, paths = desktopPaths()} = {}) {
    const options = {env, encoding: 'utf8'};
    const checked = (executable, args, extra = {}) => {
        const result = run(executable, args, {...options, ...extra});
        if (result.error || result.status !== 0)
            throw new Error(result.error?.message || result.stderr?.trim() || `${executable} failed (${result.status}).`);
        return result.stdout?.trim() ?? '';
    };
    const open = (install, flag) => {
        const spec = launchSpec(install);
        if (!existsSync(spec.binary)) throw new Error('Desktop runtime is missing. Run tidy install again.');
        // Never inherit ELECTRON_RUN_AS_NODE from a terminal/editor environment.
        const childEnv = {...env, TIDY_DATA_DIR: paths.base};
        delete childEnv.ELECTRON_RUN_AS_NODE;
        const child = launch(spec.executable, [...spec.args, flag], {env: childEnv, detached: true, stdio: 'ignore'});
        child.on('error', e => error(e.message));
        child.unref();
        return child;
    };
    const alive = () => {
        const state = readJSON(paths.status);
        if (!state || Date.now() - state.updated > 10000) return false;
        try { process.kill(state.pid, 0); return true; } catch { return false; }
    };
    const stop = () => {
        if (!alive()) return;
        const pid = readJSON(paths.status).pid;
        const processAlive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
        open(paths.install, '--quit');
        const deadline = Date.now() + 10000;
        while (processAlive() && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
        if (processAlive()) throw new Error('Quit Tidy from its menu bar icon, then retry.');
    };
    const waitStarted = since => {
        const deadline = Date.now() + 30000;
        do {
            const state = readJSON(paths.status);
            if (state?.updated >= since) {
                if (state.error && state.trusted === undefined) throw new Error(state.error);
                if (alive()) return;
            }
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
        } while (Date.now() < deadline);
        throw new Error('Tidy did not start. Check tidy status and your desktop session.');
    };
    try {
        if (platform !== 'darwin') throw new Error('The desktop app requires macOS. Use the GNOME extension on Linux.');
        if (command === 'status') {
            if (!existsSync(join(paths.install, 'installed.json'))) throw new Error('Tidy is not installed. Run tidy install first.');
            out(JSON.stringify({installed: readJSON(join(paths.install, 'installed.json')), running: alive(),
                runtime: readJSON(paths.status), config: paths.config}, null, 2));
            return 0;
        }
        if (command === 'prefs') {
            if (!existsSync(join(paths.install, 'installed.json'))) throw new Error('Tidy is not installed. Run tidy install first.');
            open(paths.install, '--settings');
            return 0;
        }
        if (command === 'uninstall') {
            if (!existsSync(paths.install)) { out('Tidy is not installed.'); return 0; }
            // The running app removes its own login item before exiting.
            const spec = launchSpec(paths.install);
            const childEnv = {...env, TIDY_DATA_DIR: paths.base};
            delete childEnv.ELECTRON_RUN_AS_NODE;
            checked(spec.executable, ['-W', ...spec.args, '--uninstall'], {env: childEnv, timeout: 20000});
            stop();
            rmSync(paths.install, {recursive: true, force: true, maxRetries: 20, retryDelay: 250});
            rmSync(paths.status, {force: true});
            out('Tidy removed. Settings are preserved for reinstallation.');
            return 0;
        }
        const node = process.versions.node.split('.').map(Number);
        if (node[0] < 22 || (node[0] === 22 && node[1] < 12))
            throw new Error('macOS installation requires Node.js 22.12 or later.');
        checked('xcrun', ['--find', 'swiftc']);
        if (command === 'doctor') {
            out('Swift compiler and Node.js are available. Grant Tidy Accessibility permission after installation.');
            out(`Installation: ${paths.install}`);
            return 0;
        }
        mkdirSync(paths.base, {recursive: true});
        const stage = mkdtempSync(join(paths.base, 'desktop-next-'));
        const backup = join(paths.base, 'desktop-previous');
        try {
            const runtime = join(stage, 'runtime');
            mkdirSync(runtime);
            const desktopManifest = readJSON(join(packageRoot, 'desktop', 'package.json'));
            writeFileSync(join(runtime, 'package.json'), JSON.stringify({private: true, dependencies: desktopManifest.dependencies}));
            cpSync(join(packageRoot, 'desktop', 'package-lock.json'), join(runtime, 'package-lock.json'));
            out('Downloading the desktop runtime…');
            // Invoke npm through Node with literal arguments, including paths with spaces.
            const npmCLI = npmScript(env);
            if (!npmCLI) throw new Error('npm was not found. Run npx @hnode/tidy install or reinstall Node.js with npm.');
            checked(process.execPath, [npmCLI, 'ci', '--prefix', runtime, '--no-audit', '--no-fund', '--ignore-scripts'], {stdio: 'inherit'});
            checked(process.execPath, [join(runtime, 'node_modules', 'electron', 'install.js')], {stdio: 'inherit'});
            renameSync(join(runtime, 'node_modules', 'electron', 'dist', 'Electron.app'), join(stage, 'Tidy.app'));
            const appRoot = join(stage, 'Tidy.app', 'Contents', 'Resources', 'app');
            mkdirSync(join(appRoot, 'lib'), {recursive: true});
            const desktopSource = join(packageRoot, 'desktop');
            cpSync(desktopSource, join(appRoot, 'desktop'), {recursive: true,
                filter: path => !relative(desktopSource, path).split(sep).includes('node_modules')});
            for (const name of ['layouts.js', 'i18nCore.js', 'translations.json'])
                cpSync(join(packageRoot, 'lib', name), join(appRoot, 'lib', name));
            for (const name of ['LICENSE', 'NOTICE']) cpSync(join(packageRoot, name), join(appRoot, name));
            const version = readJSON(join(packageRoot, 'package.json')).version;
            writeFileSync(join(appRoot, 'package.json'), JSON.stringify({name: 'tidy', productName: 'Tidy', version,
                type: 'module', main: 'desktop/main.js'}));
            const helper = join(appRoot, 'desktop', 'native', 'tidy-native');
            checked('xcrun', ['swiftc', '-O', join(appRoot, 'desktop', 'native', 'macos.swift'), '-o', helper]);
            checked('codesign', ['--force', '--sign', '-', '--identifier', 'local.tidy.window-helper', helper]);
            const plist = join(stage, 'Tidy.app', 'Contents', 'Info.plist');
            for (const [key, value] of [['CFBundleIdentifier', 'local.tidy.desktop'], ['CFBundleName', 'Tidy'],
                ['CFBundleDisplayName', 'Tidy'], ['CFBundleShortVersionString', version], ['CFBundleVersion', version]]) {
                const result = run('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist], options);
                if (result.status !== 0) checked('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${value}`, plist]);
            }
            checked('codesign', ['--force', '--deep', '--sign', '-', '--preserve-metadata=entitlements', join(stage, 'Tidy.app')]);
            writeFileSync(join(stage, 'installed.json'), JSON.stringify({version, platform, installed: new Date().toISOString()}));
            stop();
            rmSync(backup, {recursive: true, force: true});
            if (existsSync(paths.install)) renameSync(paths.install, backup);
            try { renameSync(stage, paths.install); }
            catch (e) { if (existsSync(backup)) renameSync(backup, paths.install); throw e; }
            let child;
            try {
                const since = Date.now();
                child = open(paths.install, '--settings');
                if (!child.pid) throw new Error('Could not start the desktop runtime.');
                waitStarted(since);
            } catch (failure) {
                child?.kill();
                rmSync(paths.status, {force: true});
                rmSync(paths.install, {recursive: true, force: true, maxRetries: 20, retryDelay: 250});
                if (existsSync(backup)) { renameSync(backup, paths.install); open(paths.install, '--background'); }
                throw failure;
            }
            rmSync(backup, {recursive: true, force: true, maxRetries: 20, retryDelay: 250});
            out('Tidy installed and started. Use the menu bar icon to choose layouts and settings.');
        } finally { rmSync(stage, {recursive: true, force: true}); }
        return 0;
    } catch (e) { error(e.message); return 1; }
}

import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, relative, sep} from 'node:path';
import {PassThrough} from 'node:stream';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {defaultSettings, DragTracker, TilingController, validateSettings} from '../desktop/core.js';
import {desktopCommand, desktopPaths, launchSpec} from '../desktop/manage.js';
import {NativeBridge} from '../desktop/native-bridge.js';

const monitors = [
    {x: -1600, y: 0, width: 1600, height: 900, workArea: {x: -1600, y: 30, width: 1600, height: 870}},
    {x: 0, y: 0, width: 1920, height: 1080, workArea: {x: 0, y: 0, width: 1920, height: 1040}},
    {x: 0, y: -1080, width: 1920, height: 1080, workArea: {x: 0, y: -1050, width: 1920, height: 1050}},
];
const target = {id: '123', pid: 42, resizable: true, fullscreen: false, rect: {x: 100, y: 80, width: 800, height: 600}};

test('native tiling respects work areas, negative origins, direction and wrapping', () => {
    const controller = new TilingController();
    let window = structuredClone(target);
    const tile = action => {
        const plan = controller.plan(window, action, monitors, 8);
        controller.commit(plan);
        window = {...window, rect: plan.rect};
        return plan;
    };
    assert.deepEqual(tile('left').rect, {x: 4, y: 4, width: 952, height: 1032});
    assert.equal(tile('left').zone, 'right');
    assert.equal(window.rect.x, -796);
    tile('left');
    const wrapped = tile('left');
    assert.equal(wrapped.zone, 'right');
    assert.equal(wrapped.rect.x, 964);
    tile('top');
    const up = tile('top');
    assert.equal(up.zone, 'bottom');
    assert.equal(up.rect.y, -521);
});

test('maximize restores a saved frame and manual movement invalidates prior placement', () => {
    const controller = new TilingController();
    const maximize = controller.plan(target, 'toggle-maximize', monitors);
    controller.commit(maximize);
    const restore = controller.plan({...target, rect: maximize.rect}, 'toggle-maximize', monitors);
    assert.deepEqual(restore.rect, target.rect);
    const moved = {...target, rect: {...maximize.rect, x: 100}};
    const newMaximize = controller.plan(moved, 'toggle-maximize', monitors);
    assert.equal(newMaximize.zone, 'maximize');
    assert.deepEqual(newMaximize.restore, moved.rect);
    assert.throws(() => controller.plan({...target, fullscreen: true}, 'left', monitors));
    assert.throws(() => controller.plan({...target, resizable: false}, 'left', monitors));
    assert.throws(() => controller.plan(target, 'left', monitors, 8, -1));
});

test('placements commit only after success and follow actual application minimum sizes', () => {
    const controller = new TilingController();
    const first = controller.plan(target, 'left', monitors);
    // A failed backend operation must not make a second request jump monitors.
    assert.deepEqual(controller.plan(target, 'left', monitors), first);
    const actual = {...first.rect, width: first.rect.width + 20};
    controller.commit(first, actual);
    assert.equal(controller.plan({...target, rect: actual}, 'left', monitors).zone, 'right');
    // Reused handles from another process must not inherit the previous process's state.
    assert.equal(controller.plan({...target, pid: 43, rect: actual}, 'left', monitors).zone, 'left');
});

test('moving to the next monitor preserves a tiled zone', () => {
    const controller = new TilingController();
    const first = controller.plan(target, 'top-left', monitors);
    controller.commit(first);
    const next = controller.plan({...target, rect: first.rect}, 'next-monitor', monitors);
    assert.equal(next.zone, 'top-left');
    assert.deepEqual(next.rect, {x: 4, y: -1046, width: 952, height: 517});
});

test('drag tracking ignores clicks and resizing and emits exactly one release', () => {
    const tracker = new DragTracker();
    const sample = (mouseDown, window = target) => tracker.update({mouseDown, window});
    assert.equal(sample(true), null);
    assert.equal(sample(true), null);
    assert.equal(sample(true, {...target, rect: {...target.rect, width: 900}}), null);
    assert.equal(sample(false), null);
    sample(true);
    const moved = {...target, rect: {...target.rect, x: 120}};
    assert.equal(sample(true, moved).type, 'drag');
    assert.equal(sample(false, moved).type, 'release');
    assert.equal(sample(false, moved), null);
});

test('macOS defaults use Control+Option and reject malformed settings', () => {
    const value = defaultSettings();
    assert.deepEqual(validateSettings(value), value);
    assert.equal(value.shortcuts['snap-left'], 'Control+Alt+Left');
    assert.throws(() => validateSettings({...value, gap: NaN}));
    assert.throws(() => validateSettings({...value, gap: -1}));
    assert.throws(() => validateSettings({...value, dragPicker: 'true'}));
    value.shortcuts['snap-left'] = 'left';
    assert.throws(() => validateSettings(value));
    value.shortcuts['snap-left'] = value.shortcuts['snap-right'];
    assert.throws(() => validateSettings(value));
    value.shortcuts['snap-left'] = '';
    assert.equal(validateSettings(value).shortcuts['snap-left'], '');
});

function helperFixture(t, responder) {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => child.emit('exit', 0);
    child.stdin.on('finish', () => child.emit('exit', 0));
    const requests = [];
    child.stdin.on('data', bytes => {
        const request = JSON.parse(bytes.toString()); requests.push(request);
        queueMicrotask(() => {
            const response = responder(request);
            if (response) child.stdout.write(`${JSON.stringify({id: request.id, ...response})}\n`);
        });
    });
    let invocation;
    const bridge = new NativeBridge('native path with spaces', {ignorePid: 77,
        launch: (...args) => { invocation = args; return child; }});
    t.after(() => bridge.close());
    return {bridge, child, requests, invocation};
}

test('macOS bridge preserves points and literal process arguments', async t => {
    const {bridge, requests, invocation} = helperFixture(t, request => ({result: request.op === 'snapshot' ?
        {window: structuredClone(target), mouseDown: false} : request.rect}));
    assert.equal(invocation[0], join('native path with spaces', 'tidy-native'));
    assert.deepEqual(invocation[1], []);
    assert.equal(invocation[2].shell, undefined);
    const snapshot = await bridge.snapshot();
    assert.deepEqual(snapshot.window.rect, target.rect);
    const rect = {x: -800, y: 30, width: 640, height: 400};
    assert.deepEqual(await bridge.place(target, rect), rect);
    assert.deepEqual(requests[1].rect, rect);
    assert.deepEqual(requests[1].window, {id: target.id, pid: target.pid});
    assert.equal(requests[0].ignorePid, 77);
});

test('macOS bridge preserves point coordinates and propagates permission and helper failures', async t => {
    const {bridge, child, invocation} = helperFixture(t, request =>
        request.op === 'place' ? {error: 'Accessibility denied'} : {result: {window: structuredClone(target)}});
    assert.equal(invocation[0], join('native path with spaces', 'tidy-native'));
    assert.deepEqual((await bridge.snapshot()).window.rect, target.rect);
    await assert.rejects(bridge.place(target, target.rect), /Accessibility denied/);
    child.stderr.write('helper diagnostic');
    child.emit('exit', 1);
    await assert.rejects(bridge.snapshot(), /helper diagnostic/);
});

test('native helper shutdown closes its input without killing it', async t => {
    const {bridge, child} = helperFixture(t, () => ({result: true}));
    let killed = false;
    child.kill = () => { killed = true; };
    await bridge.close();
    assert(child.stdin.writableEnded);
    assert.equal(killed, false, 'normal shutdown must let the native helper finish');
});

function installFixture(t) {
    const directory = mkdtempSync(join(tmpdir(), 'tidy desktop $literal '));
    t.after(() => rmSync(directory, {recursive: true, force: true}));
    const paths = {base: directory, install: join(directory, 'desktop'), config: join(directory, 'config'), status: join(directory, 'status.json')};
    const packageRoot = join(directory, 'npm cache', 'node_modules', '@hnode', 'tidy');
    mkdirSync(packageRoot, {recursive: true});
    const project = fileURLToPath(new URL('..', import.meta.url));
    for (const name of ['desktop', 'lib', 'package.json', 'LICENSE', 'NOTICE'])
        cpSync(join(project, name), join(packageRoot, name), {recursive: true,
            filter: path => !relative(project, path).split(sep).includes('node_modules')});
    const calls = [], launches = [], messages = [];
    const options = {platform: 'darwin', paths, packageRoot, env: {npm_execpath: fileURLToPath(new URL('../scripts/test.js', import.meta.url))},
        run: (executable, args, settings) => {
            calls.push({executable, args, settings});
            if (args.includes('--prefix')) {
                const runtime = args[args.indexOf('--prefix') + 1];
                const dist = join(runtime, 'node_modules/electron/dist');
                mkdirSync(join(dist, 'Electron.app/Contents/Resources'), {recursive: true});
                writeFileSync(join(dist, 'Electron.app/Contents/Info.plist'), 'fake runtime');
                mkdirSync(join(dist, 'Electron.app/Contents/MacOS'));
                writeFileSync(join(dist, 'Electron.app/Contents/MacOS/Electron'), 'fake runtime');
            }
            if (args.includes('--uninstall')) rmSync(paths.status, {force: true});
            return {status: 0, stdout: 'ok'};
        }, launch: (executable, args, settings) => {
            launches.push({executable, args, settings});
            writeFileSync(paths.status, JSON.stringify({pid: process.pid, updated: Date.now(), trusted: true}));
            return {pid: process.pid, on() {}, unref() {}, kill() {}};
        }, out: message => messages.push(message), error: message => messages.push(message)};
    return {options, paths, calls, launches, messages};
}

test('macOS user installation survives source/cache removal and routes preferences and uninstall', t => {
    const {options, paths, calls, launches, messages} = installFixture(t);
    assert.equal(desktopCommand('install', options), 0, messages.join('\n'));
    assert(existsSync(join(paths.install, 'installed.json')));
    const appRoot = join(paths.install, 'Tidy.app/Contents/Resources/app');
    for (const name of ['desktop/main.js', 'desktop/preload.cjs', 'desktop/native/macos.swift', 'lib/layouts.js', 'LICENSE'])
        assert(existsSync(join(appRoot, name)), name);
    assert.equal(launches[0].args.at(-1), '--settings');
    assert(calls.every(call => !call.settings.shell));
    assert(!calls.some(call => call.executable === '/usr/bin/python3'));
    rmSync(options.packageRoot, {recursive: true});
    assert.equal(desktopCommand('prefs', options), 0);
    assert.equal(desktopCommand('status', options), 0);
    assert.equal(desktopCommand('uninstall', options), 0);
    assert(!existsSync(paths.install));
    assert(calls.some(call => call.args.includes('--uninstall')));
    const spec = launchSpec(paths.install);
    assert.equal(launches[0].executable, spec.executable);
    assert.equal(launches[0].settings.env.TIDY_DATA_DIR, paths.base);
});

test('macOS failed downloads preserve an existing installation', t => {
    const {options, paths} = installFixture(t);
    mkdirSync(paths.install);
    writeFileSync(join(paths.install, 'installed.json'), '{"version":"old"}');
    const run = options.run;
    assert.equal(desktopCommand('update', {...options, run: (executable, args, settings) =>
        args.includes('--prefix') ? {status: 1, stderr: 'download failed'} : run(executable, args, settings)}), 1);
    assert.deepEqual(JSON.parse(readFileSync(join(paths.install, 'installed.json'))), {version: 'old'});
});

test('macOS failed startup restores the previous app and restarts it', t => {
    const {options, paths, launches} = installFixture(t);
    assert.equal(desktopCommand('install', options), 0);
    rmSync(paths.status, {force: true});
    writeFileSync(join(paths.install, 'installed.json'), '{"version":"old"}');
    assert.equal(desktopCommand('update', {...options, launch: (executable, args, settings) => {
        if (args.includes('--background')) return options.launch(executable, args, settings);
        writeFileSync(paths.status, JSON.stringify({pid: process.pid, updated: Date.now(), error: 'startup failed'}));
        return {pid: process.pid, on() {}, unref() {}, kill() {}};
    }}), 1);
    assert.deepEqual(JSON.parse(readFileSync(join(paths.install, 'installed.json'))), {version: 'old'});
    assert.equal(launches.at(-1).args.at(-1), '--background');
});

test('macOS installation paths use per-user application support', () => {
    assert.equal(desktopPaths('/home/test').base, join('/home/test', 'Library', 'Application Support', 'Tidy'));
});

import {app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, screen, Tray} from 'electron';
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ACTIONS, contains, dragIntent, LAYOUTS, ZONES} from '../lib/layouts.js';
import {createTranslator} from '../lib/i18nCore.js';
import {defaultSettings, DragTracker, TilingController, validateSettings} from './core.js';
import {desktopPaths} from './manage.js';
import {NativeBridge} from './native-bridge.js';

const directory = dirname(fileURLToPath(import.meta.url));
const paths = desktopPaths();
const base = process.env.TIDY_DATA_DIR || paths.base;
const configDirectory = join(base, 'config');
mkdirSync(configDirectory, {recursive: true});
app.setName('Tidy');
app.setPath('userData', configDirectory);
const command = process.argv.includes('--uninstall') ? 'uninstall' : process.argv.includes('--quit') ? 'quit' :
    process.argv.includes('--settings') ? 'settings' : 'background';
const primary = app.requestSingleInstanceLock({command});
if (!primary) app.quit();
else {
    app.on('second-instance', (_event, _argv, _cwd, data) => dispatch(data.command));
    app.whenReady().then(start).catch(error => {
        console.error(error);
        writeFileSync(join(base, 'status.json'), JSON.stringify({pid: process.pid, updated: Date.now(), error: error.message}));
        app.exit(1);
    });
}

let bridge, tray, picker, preferences, preview, timer;
let settings = defaultSettings();
let translate = message => message;
let shortcutFailures = [];
let lastError = '';
let trusted = false;
let lastWindow = null;
let pickerTarget = null;
let pickerDisplay = null;
let dragMode = false;
let hitRegions = [];
let selection = null;
let pollBusy = false;
let actionQueue = Promise.resolve();
let quitting = false;
let requestedSettings = false;
let readyForUI = false;
let lastHeartbeat = 0;
let shutdownComplete = false;
const controller = new TilingController();
const drag = new DragTracker();
const settingsFile = join(configDirectory, 'settings.json');
const statusFile = join(base, 'status.json');
const monitors = () => screen.getAllDisplays().map(display => ({...display.bounds, id: display.id, workArea: display.workArea}));

function report(error) {
    lastError = error.message;
    console.error(error);
    updateTray();
    preferences?.webContents.send('changed');
}
function enqueue(action) {
    actionQueue = actionQueue.then(action).catch(report);
    return actionQueue;
}
function loginItem(openAtLogin) {
    app.setLoginItemSettings({openAtLogin, path: process.execPath, args: ['--background'], name: 'Tidy'});
}
function dispatch(action) {
    if (action === 'uninstall') { loginItem(false); app.quit(); }
    else if (action === 'quit') app.quit();
    else if (action === 'settings') {
        if (readyForUI) showPreferences().catch(report);
        else requestedSettings = true;
    }
}

async function start() {
    if (command === 'uninstall') { loginItem(false); app.quit(); return; }
    if (command === 'quit') { app.quit(); return; }
    if (process.platform !== 'darwin') throw new Error('The desktop app requires macOS. Use the GNOME extension on Linux.');
    app.dock?.hide();
    const catalogs = JSON.parse(readFileSync(join(directory, '../lib/translations.json'), 'utf8'));
    translate = createTranslator(catalogs, [app.getLocale()]);
    if (existsSync(settingsFile)) {
        try { settings = validateSettings(JSON.parse(readFileSync(settingsFile, 'utf8'))); }
        catch (error) { lastError = error.message; }
    }
    bridge = new NativeBridge(join(directory, 'native'));
    trusted = (await bridge.request('permissions', {prompt: false})).trusted;
    const bitmap = Buffer.alloc(24 * 24 * 4);
    for (let y = 4; y < 20; y++) {
        for (let x = 3; x < 21; x++) {
            if (x >= 11 && x < 13 || x >= 13 && y >= 11 && y < 13) continue;
            bitmap.set([136, 136, 136, 255], (y * 24 + x) * 4);
        }
    }
    const icon = nativeImage.createFromBitmap(bitmap, {width: 24, height: 24});
    icon.setTemplateImage(true);
    tray = new Tray(icon);
    tray.setToolTip('Tidy');
    tray.on('click', () => showPreferences().catch(report));
    registerShortcuts(settings);
    loginItem(settings.openAtLogin);
    updateTray();
    ipcMain.handle('tidy:state', event => {
        checkSender(event);
        return {settings, defaults: defaultSettings(), layouts: LAYOUTS, zones: ZONES,
            actions: ACTIONS.map(([id, title]) => ({id, title: translate(title)})), trusted, shortcutFailures, lastError,
            labels: Object.fromEntries(['Tidy Settings', 'Settings and shortcuts…', 'Halves', 'Wide', 'Focus', 'Three columns',
                'Wide center', 'Four quarters'].map(text => [text, translate(text)])),
            language: app.getLocale().startsWith('ko') ? 'ko' : 'en'};
    });
    ipcMain.handle('tidy:save', (event, value) => {
        checkSender(event, preferences);
        const next = validateSettings(value);
        const previous = settings;
        registerShortcuts(next);
        if (shortcutFailures.length) {
            const failed = shortcutFailures.join(', ');
            registerShortcuts(previous);
            throw new Error(`Shortcut unavailable: ${failed}`);
        }
        try {
            loginItem(next.openAtLogin);
            writeFileSync(settingsFile, JSON.stringify(next, null, 2));
        } catch (error) {
            registerShortcuts(previous);
            loginItem(previous.openAtLogin);
            throw error;
        }
        settings = next;
        lastError = '';
        return true;
    });
    ipcMain.handle('tidy:permissions', async event => {
        checkSender(event, preferences);
        trusted = (await bridge.request('permissions', {prompt: true})).trusted;
        return trusted;
    });
    ipcMain.on('tidy:choose', (event, zone) => {
        checkSender(event, picker);
        const target = pickerTarget;
        const displayId = pickerDisplay;
        if (Object.hasOwn(ZONES, zone) && target)
            enqueue(() => execute(zone, target, displayId));
        hidePicker();
    });
    ipcMain.on('tidy:regions', (event, regions) => {
        checkSender(event, picker);
        if (Array.isArray(regions)) hitRegions = regions.filter(region => Object.hasOwn(ZONES, region.zone) &&
            ['x', 'y', 'width', 'height'].every(key => Number.isFinite(region[key])));
    });
    ipcMain.on('tidy:close', event => { checkSender(event, picker); hidePicker(); });
    app.on('window-all-closed', () => {});
    app.on('activate', () => showPreferences().catch(report));
    readyForUI = true;
    timer = setInterval(poll, 100);
    await poll();
    if (command === 'settings' || requestedSettings || !trusted || shortcutFailures.length || lastError) await showPreferences();
}

function checkSender(event, window) {
    if (window ? event.sender !== window.webContents :
        ![picker, preferences].some(item => item && event.sender === item.webContents)) throw new Error('Invalid sender.');
}
function registerShortcuts(value) {
    globalShortcut.unregisterAll();
    shortcutFailures = [];
    for (const [id, , action] of ACTIONS) {
        const accelerator = value.shortcuts[id];
        if (!accelerator) continue;
        try {
            if (globalShortcut.register(accelerator, () => enqueue(async () => {
                const snapshot = await bridge.snapshot();
                if (action === 'picker') await showPicker(snapshot.window, false);
                else await execute(action, snapshot.window);
            }))) continue;
        } catch { /* Display malformed or OS-reserved accelerators in settings. */ }
        shortcutFailures.push(accelerator);
    }
}
function updateTray() {
    if (!tray) return;
    tray.setContextMenu(Menu.buildFromTemplate([
        {label: 'Tidy', enabled: false},
        ...(lastError ? [{label: lastError.slice(0, 100), enabled: false}] : []),
        {label: translate('Open layout picker'), click: () => enqueue(() => showPicker(lastWindow, false))},
        {label: translate('Settings and shortcuts…'), click: () => showPreferences().catch(report)},
        {type: 'separator'}, {label: translate('Quit'), click: () => app.quit()},
    ]));
}
function windowOptions() {
    return {show: false, autoHideMenuBar: true, backgroundColor: '#252529',
        webPreferences: {preload: join(directory, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true}};
}
function protect(window) {
    window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
    window.webContents.on('will-navigate', event => event.preventDefault());
}
async function showPreferences() {
    if (preferences) { preferences.show(); preferences.focus(); return; }
    preferences = new BrowserWindow({...windowOptions(), width: 660, height: 740, title: translate('Tidy Settings')});
    protect(preferences);
    preferences.on('closed', () => { preferences = null; });
    await preferences.loadFile(join(directory, 'index.html'), {query: {mode: 'settings'}});
    preferences.show();
}
async function showPicker(target, dragging, displayId = null) {
    if (!target) throw new Error('Select a movable, resizable window first.');
    const displays = screen.getAllDisplays();
    const display = displays.find(item => item.id === displayId) ?? screen.getDisplayMatching(target.rect);
    const area = display.workArea;
    if (!picker) {
        picker = new BrowserWindow({...windowOptions(), width: 820, height: 142, frame: false, resizable: false,
            alwaysOnTop: true, skipTaskbar: true, focusable: !dragging, roundedCorners: true});
        protect(picker);
        picker.on('blur', () => { if (!dragMode) hidePicker(); });
        picker.on('closed', () => { picker = null; });
        await picker.loadFile(join(directory, 'index.html'), {query: {mode: 'picker'}});
    }
    pickerTarget = target;
    pickerDisplay = display.id;
    dragMode = dragging;
    const width = Math.min(820, area.width);
    picker.setBounds({x: Math.round(area.x + (area.width - width) / 2), y: area.y + 12, width, height: Math.min(142, area.height)});
    picker.setFocusable(!dragging);
    picker.setIgnoreMouseEvents(dragging);
    if (dragging) picker.showInactive();
    else { picker.show(); picker.focus(); }
}
function hidePicker() {
    picker?.hide();
    preview?.hide();
    dragMode = false;
    selection = null;
    picker?.webContents.send('hover', null);
}

async function execute(action, target, displayId = null) {
    const list = monitors();
    const destination = displayId === null ? null : list.findIndex(item => item.id === displayId);
    const plan = controller.plan(target, action, list, settings.gap, destination);
    const actual = await bridge.place(plan.window, plan.rect);
    controller.commit(plan, actual);
    lastError = '';
    hidePicker();
}
async function showPreview(rect) {
    if (!preview) {
        preview = new BrowserWindow({...windowOptions(), frame: false, transparent: true, backgroundColor: '#00000000',
            alwaysOnTop: true, focusable: false, skipTaskbar: true, resizable: false});
        preview.setIgnoreMouseEvents(true);
        await preview.loadFile(join(directory, 'index.html'), {query: {mode: 'preview'}});
    }
    preview.setBounds(rect);
    preview.showInactive();
    // Keep the picker above its placement preview.
    if (picker?.isVisible()) picker.moveTop();
}
async function poll() {
    if (pollBusy || quitting) return;
    pollBusy = true;
    try {
        const snapshot = await bridge.snapshot();
        trusted = snapshot.trusted;
        if (snapshot.window) lastWindow = snapshot.window;
        const event = drag.update(snapshot);
        const pointer = screen.getCursorScreenPoint();
        if (event?.type === 'drag' && !preferences?.isFocused()) {
            const display = screen.getDisplayNearestPoint(pointer);
            let intent = dragIntent(display.bounds, display.workArea, pointer.x, pointer.y, {picker: settings.dragPicker});
            if (picker?.isVisible() && dragMode && pickerDisplay === display.id && contains(picker.getBounds(), pointer.x, pointer.y))
                intent = {type: 'picker'};
            if (intent?.type === 'picker' && settings.dragPicker) {
                await showPicker(event.window, true, display.id);
                const bounds = picker.getBounds();
                const hit = hitRegions.find(region => contains(region, pointer.x - bounds.x, pointer.y - bounds.y));
                selection = hit ? {zone: hit.zone, window: event.window, displayId: display.id} : null;
                picker.webContents.send('hover', hit?.zone ?? null);
            } else {
                hidePicker();
                if (intent?.type === 'tile' && settings.edgeSnap)
                    selection = {zone: intent.zone, window: event.window, displayId: display.id};
            }
            if (selection) {
                const list = monitors();
                const plan = controller.plan(selection.window, selection.zone, list, settings.gap,
                    list.findIndex(item => item.id === selection.displayId));
                await showPreview(plan.rect);
            } else preview?.hide();
        } else if (event?.type === 'release') {
            const chosen = selection;
            hidePicker();
            if (chosen) await enqueue(() => execute(chosen.zone, chosen.window, chosen.displayId));
        }
    } catch (error) {
        if (lastError !== error.message) report(error);
    } finally {
        if (!quitting && Date.now() - lastHeartbeat > 2000) {
            lastHeartbeat = Date.now();
            writeFileSync(statusFile, JSON.stringify({pid: process.pid, updated: Date.now(), trusted,
                shortcutFailures, error: lastError}));
        }
        pollBusy = false;
    }
}

app.on('before-quit', event => {
    if (!primary || shutdownComplete) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    clearInterval(timer);
    globalShortcut.unregisterAll();
    (async () => {
        // Finish native requests before shutting down the desktop app.
        await bridge?.close();
        rmSync(statusFile, {force: true});
        shutdownComplete = true;
        app.quit();
    })().catch(error => {
        report(error);
        quitting = false;
        if (readyForUI) { registerShortcuts(settings); timer = setInterval(poll, 100); }
        else app.exit(1);
    });
});

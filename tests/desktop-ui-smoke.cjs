// Real Chromium rendering with a fake native endpoint; no global shortcuts,
// login items, accessibility prompts or user settings are touched.
const assert = require('node:assert/strict');
const {mkdtempSync, rmSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {app, BrowserWindow, ipcMain} = require('electron');
const profile = mkdtempSync(join(tmpdir(), 'tidy-ui-smoke-'));
app.setPath('userData', profile);
app.commandLine.appendSwitch('disable-gpu');
const pause = () => new Promise(resolve => setTimeout(resolve, 100));
const waitFor = async predicate => {
    const deadline = Date.now() + 5000;
    while (!await predicate()) {
        assert(Date.now() < deadline, 'Timed out waiting for the renderer');
        await pause();
    }
};
let window;
app.whenReady().then(async () => {
    const {ACTIONS, LAYOUTS, ZONES} = await import('../lib/layouts.js');
    const {defaultSettings, validateSettings} = await import('../desktop/core.js');
    const settings = defaultSettings();
    let saved, chosen, regions = [], closed = false;
    ipcMain.handle('tidy:state', () => ({settings, defaults: settings,
        actions: ACTIONS.map(([id, title]) => ({id, title})),
        layouts: LAYOUTS, zones: ZONES, language: 'ko', labels: {'Tidy Settings': 'Tidy 설정'},
        trusted: true, shortcutFailures: [], lastError: ''}));
    ipcMain.handle('tidy:save', (_event, value) => { saved = validateSettings(value); return true; });
    ipcMain.on('tidy:choose', (_event, zone) => { chosen = zone; });
    ipcMain.on('tidy:regions', (_event, value) => { regions = value; });
    ipcMain.on('tidy:close', () => { closed = true; });
    window = new BrowserWindow({show: false, width: 820, height: 142, frame: false,
        webPreferences: {preload: join(__dirname, '../desktop/preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false}});
    const document = join(__dirname, '../desktop/index.html');
    const js = source => window.webContents.executeJavaScript(source);
    await window.loadFile(document, {query: {mode: 'picker'}});
    await waitFor(() => regions.length === 17);
    assert.equal(await js("document.querySelectorAll('.zone').length"), LAYOUTS.reduce((sum, layout) => sum + layout.zones.length, 0));
    assert.equal(regions.length, 17);
    assert(regions.every(rect => rect.width > 0 && rect.height > 0 && rect.x >= 0 && rect.x + rect.width <= 820));
    window.webContents.send('hover', 'center-half');
    await waitFor(() => js("document.querySelector('.selected')?.dataset.zone === 'center-half'"));
    assert.equal(await js("document.querySelector('.selected').dataset.zone"), 'center-half');
    await js("document.querySelector('[data-zone=\"center-half\"]').click()");
    await waitFor(() => chosen === 'center-half');
    assert.equal(chosen, 'center-half');
    await js("document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}))");
    await waitFor(() => closed);
    assert(closed);
    await window.loadFile(document, {query: {mode: 'settings'}});
    await waitFor(() => js("document.querySelector('.buttons button') !== null"));
    assert.equal(await js("document.querySelector('h1').textContent"), 'Tidy 설정');
    assert.equal(await js("document.querySelectorAll('.shortcut').length"), ACTIONS.length);
    await js("document.querySelector('input[type=number]').value = 12; document.querySelector('.buttons button').click()");
    await waitFor(() => saved?.gap === 12);
    assert.equal(saved.gap, 12);
    await js("document.querySelector('.shortcut').value = 'invalid'; document.querySelector('.buttons button').click()");
    await waitFor(() => js("document.querySelector('.message')?.textContent.includes('Invalid shortcut')"));
    assert.match(await js("document.querySelector('.message').textContent"), /Invalid shortcut/);
    console.log('PASS: macOS picker, selection, Escape, Korean settings, save and validation in Chromium');
    app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
app.on('quit', () => rmSync(profile, {recursive: true, force: true, maxRetries: 10, retryDelay: 100}));

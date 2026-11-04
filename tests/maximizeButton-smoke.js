import GLib from 'gi://GLib';
import System from 'system';
import {MaximizeButtonLocator} from '../lib/maximizeButton.js';

const ref = path => [':fixture', path];
const nodes = {
    '/app': {children: ['/top']},
    '/top': {Name: 'fixture', Parent: ref('/app'), bounds: [0, 0, 932, 642], children: ['/content']},
    // Like Brave, hit testing returns content while caption controls belong to
    // an enclosing GTK accessible that the hit test has skipped.
    '/content': {Parent: ref('/tabs'), bounds: [16, 40, 900, 600], children: ['/page']},
    '/tabs': {Parent: ref('/browser'), bounds: [16, 40, 900, 600], children: ['/content']},
    '/browser': {Parent: ref('/caption'), bounds: [16, 40, 900, 600], children: ['/tabs']},
    '/caption': {Parent: ref('/wrapper'), bounds: [0, 0, 932, 642], children: ['/min', '/restore', '/close', '/browser']},
    '/wrapper': {Parent: ref('/top'), bounds: [0, 0, 932, 642], children: ['/caption']},
    '/min': {Name: '최소화', role: 'button', Parent: ref('/caption'), bounds: [820, 10, 32, 30]},
    '/restore': {Name: '복구', role: 'button', Parent: ref('/caption'), bounds: [852, 10, 32, 30]},
    '/close': {Name: '닫기', role: 'button', Parent: ref('/caption'), bounds: [884, 10, 32, 30]},
    '/page': {Name: '복구', role: 'button', Parent: ref('/content'), bounds: [852, 100, 32, 30]},
};
const locator = new MaximizeButtonLocator();
locator._connect = async () => ({});
locator._application = async () => ref('/app');
locator._properties = async (_bus, [, path]) => nodes[path];
locator._call = async (_bus, _name, path, _interface, method) => {
    const node = nodes[path];
    if (method === 'GetChildren') return [(node.children ?? []).map(ref)];
    if (method === 'GetAccessibleAtPoint') return [ref('/content')];
    if (method === 'GetExtents') return [node.bounds];
    if (method === 'GetRoleName') return [node.role ?? 'panel'];
    throw new Error(`Unexpected method ${method}`);
};
const window = {get_pid: () => 1, get_title: () => 'fixture',
    get_frame_rect: () => ({x: -900, y: 100, width: 900, height: 600}),
    get_buffer_rect: () => ({x: -916, y: 90, width: 932, height: 642})};
const assert = (condition, message) => { if (!condition) throw new Error(message); print(`PASS: ${message}`); };
const loop = new GLib.MainLoop(null, false);
let failed = false;
(async () => {
    const button = await locator.locate(window, -48, 115);
    assert(button?.x === -64 && button.y === 100 && button.width === 32,
        'Chromium intermediate hit panels resolve to the enclosing Korean restore control with shadow-correct bounds');
    assert(!await locator.locate(window, -16, 115), 'the adjacent close button cannot open layouts');
    assert(!await locator.locate(window, -80, 115), 'the adjacent minimize button cannot open layouts');
    assert(!await locator.locate(window, -48, 205), 'a restore button in page content cannot open layouts');
    nodes['/restore'].role = 'panel';
    assert(!await locator.locate(window, -48, 115), 'a panel named restore is not accepted as a caption control');
    print('TIDY ACCESSIBILITY LOOKUP PASSED');
})().catch(error => { printerr(error.stack); failed = true; }).finally(() => {locator.destroy(); loop.quit();});
loop.run();
if (failed) System.exit(1);

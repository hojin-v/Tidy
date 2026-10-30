import assert from 'node:assert/strict';
import test from 'node:test';
import {ACTIONS, adjacentMonitor, companionZones, contains, dragIntent, directionalMonitor, LAYOUTS, monitorAt, ZONES, zoneRect} from '../lib/layouts.js';

test('every layout partitions the whole screen without overlaps', () => {
    for (const layout of LAYOUTS) {
        let total = 0;
        for (const name of layout.zones) {
            const [x, y, w, h] = ZONES[name];
            assert(x >= 0 && y >= 0 && x + w <= 1 && y + h <= 1);
            total += w * h;
        }
        assert(Math.abs(total - 1) < 1e-10, layout.name);
        for (let i = 0; i < layout.zones.length; i++) {
            const [x, y, w, h] = ZONES[layout.zones[i]];
            for (const other of layout.zones.slice(i + 1)) {
                const [ox, oy, ow, oh] = ZONES[other];
                const overlap = Math.max(0, Math.min(x + w, ox + ow) - Math.max(x, ox)) *
                    Math.max(0, Math.min(y + h, oy + oh) - Math.max(y, oy));
                assert(overlap < 1e-10, `${layout.name}: ${other}`);
            }
        }
    }
});

test('thirds share exact boundaries even on odd-width screens', () => {
    for (const width of [1279, 1920, 2561, 3440]) {
        const area = {x: -1920, y: 32, width, height: 1027};
        const rects = ['left-third', 'center-third', 'right-third'].map(zone => zoneRect(area, zone));
        assert.equal(rects[0].x, area.x);
        assert.equal(rects[0].x + rects[0].width, rects[1].x);
        assert.equal(rects[1].x + rects[1].width, rects[2].x);
        assert.equal(rects[2].x + rects[2].width, area.x + width);
    }
});

test('gaps match between neighboring windows and respect usable area', () => {
    const area = {x: 1920, y: -1060, width: 1920, height: 1040};
    const left = zoneRect(area, 'left', 8);
    const right = zoneRect(area, 'right', 8);
    assert.equal(right.x - left.x - left.width, 8);
    assert.equal(left.y, -1056);
    assert.equal(left.height, 1032);
});

test('negative coordinates, vertical arrangements, and shared monitor boundaries', () => {
    const monitors = [
        {x: 0, y: 0, width: 1920, height: 1080},
        {x: -1280, y: -200, width: 1280, height: 1024},
        {x: 0, y: -1440, width: 2560, height: 1440},
    ];
    assert.equal(monitorAt(monitors, -1, 0), 1);
    assert.equal(monitorAt(monitors, 0, 0), 0);
    assert.equal(monitorAt(monitors, 500, -1), 2);
    assert.equal(monitorAt(monitors, 4000, 0), -1);
});

test('large gaps cannot produce zero-sized windows', () => {
    const rect = zoneRect({x: 0, y: 0, width: 16, height: 12}, 'top-left', 40);
    assert(rect.width > 0 && rect.height > 0);
});

test('companion layouts contain only remaining disjoint regions', () => {
    assert.deepEqual(companionZones('left'), ['right']);
    assert.deepEqual(companionZones('center-third'), ['left-third', 'right-third']);
    assert.deepEqual(companionZones('top-left'), ['top-right', 'bottom-left', 'bottom-right']);
    assert.deepEqual(companionZones('maximize'), []);
    assert.deepEqual(companionZones('center'), []);
});

test('actions have unique keys and accelerators and valid destinations', () => {
    assert.equal(new Set(ACTIONS.map(a => a[0])).size, ACTIONS.length);
    assert.equal(new Set(ACTIONS.map(a => a[3])).size, ACTIONS.length);
    for (const [, , action] of ACTIONS)
        assert(action in ZONES || ['toggle-maximize', 'picker', 'next-monitor'].includes(action));
    for (const [, , , accelerator] of ACTIONS)
        assert(accelerator.startsWith('<Super><Alt>'));
});

test('only the top center activates the picker; other top and side edges snap directly', () => {
    const monitor = {x: -1920, y: -300, width: 1920, height: 1080};
    const area = {x: -1920, y: -268, width: 1920, height: 1048};
    assert.deepEqual(dragIntent(monitor, area, -960, -240), {type: 'picker'});
    assert.deepEqual(dragIntent(monitor, area, -960, -300), {type: 'picker'});
    assert.deepEqual(dragIntent(monitor, area, -1600, -290), {type: 'tile', zone: 'maximize'});
    assert.deepEqual(dragIntent(monitor, area, -100, -290), {type: 'tile', zone: 'maximize'});
    assert.equal(dragIntent(monitor, area, -1600, -220), null);
    assert.deepEqual(dragIntent(monitor, area, -1918, 200), {type: 'tile', zone: 'left'});
    assert.deepEqual(dragIntent(monitor, area, -2, 200), {type: 'tile', zone: 'right'});
    assert.equal(dragIntent(monitor, area, -960, 100), null);
    assert.equal(dragIntent(monitor, area, 1, 100), null);
    assert.deepEqual(dragIntent(monitor, area, -960, -290, {picker: false}), {type: 'tile', zone: 'maximize'});
    assert.deepEqual(dragIntent(monitor, area, -2, 200, {picker: false}), {type: 'tile', zone: 'right'});
});

test('activation follows the rendered picker width and the work area center', () => {
    const monitor = {x: 1600, y: -200, width: 1280, height: 900};
    const area = {x: 1680, y: -168, width: 1200, height: 868};
    const center = area.x + area.width / 2;
    assert.deepEqual(dragIntent(monitor, area, center + 490, area.y + 48, {width: 1000}), {type: 'picker'});
    assert.equal(dragIntent(monitor, area, center + 510, area.y + 48, {width: 1000}), null);
    assert.deepEqual(dragIntent(monitor, area, center + 510, monitor.y + 2, {width: 1000}),
        {type: 'tile', zone: 'maximize'});
    assert.equal(dragIntent(monitor, area, center + 210, area.y + 48, {width: 400}), null);
});

test('directional monitor movement uses physical positions rather than index or wrapping', () => {
    const monitors = [
        {x: 1920, y: 100, width: 1440, height: 900},
        {x: 0, y: 0, width: 1920, height: 1080},
        {x: -1280, y: 300, width: 1280, height: 1024},
        {x: 0, y: -1080, width: 1920, height: 1080},
    ];
    assert.equal(adjacentMonitor(monitors, 1, 'right'), 0);
    assert.equal(adjacentMonitor(monitors, 1, 'left'), 2);
    assert.equal(adjacentMonitor(monitors, 0, 'right'), -1);
    assert.equal(adjacentMonitor(monitors, 2, 'left'), -1);
    assert.equal(adjacentMonitor([monitors[1]], 0, 'right'), -1);
    assert.equal(adjacentMonitor(monitors, 1, 'up'), 3);
    assert.equal(adjacentMonitor(monitors, 3, 'down'), 1);
});

test('vertical navigation and wrapping use physical order, including negative coordinates', () => {
    const monitors = [
        {x: 100, y: 900, width: 1600, height: 900},
        {x: 0, y: -1080, width: 1920, height: 1080},
        {x: 0, y: 0, width: 1280, height: 900},
    ];
    assert.deepEqual(directionalMonitor(monitors, 2, 'up'), {monitor: 1, wrapped: false});
    assert.deepEqual(directionalMonitor(monitors, 2, 'down'), {monitor: 0, wrapped: false});
    assert.deepEqual(directionalMonitor(monitors, 1, 'up'), {monitor: 0, wrapped: true});
    assert.deepEqual(directionalMonitor(monitors, 0, 'down'), {monitor: 1, wrapped: true});
});

test('different monitor sizes do not create neighbors on the perpendicular axis', () => {
    const vertical = [{x: 0, y: 0, width: 1920, height: 1080}, {x: 0, y: 1080, width: 1280, height: 720}];
    const horizontal = [{x: 0, y: 0, width: 1920, height: 1080}, {x: 1920, y: 0, width: 1280, height: 720}];
    for (const index of [0, 1]) {
        for (const direction of ['left', 'right']) assert.equal(directionalMonitor(vertical, index, direction), null);
        for (const direction of ['up', 'down']) assert.equal(directionalMonitor(horizontal, index, direction), null);
    }
});

test('mixed monitor layouts prefer the same row or column, including wraparound', () => {
    const monitors = [
        {x: 1200, y: 900, width: 1200, height: 900},
        {x: 0, y: 0, width: 1200, height: 900},
        {x: 1200, y: 0, width: 1200, height: 900},
        {x: 0, y: 900, width: 1200, height: 900},
    ];
    assert.deepEqual(directionalMonitor(monitors, 1, 'right'), {monitor: 2, wrapped: false});
    assert.deepEqual(directionalMonitor(monitors, 1, 'down'), {monitor: 3, wrapped: false});
    assert.deepEqual(directionalMonitor(monitors, 1, 'up'), {monitor: 3, wrapped: true});
    assert.deepEqual(directionalMonitor(monitors, 0, 'right'), {monitor: 3, wrapped: true});
});

test('a separated diagonal monitor remains reachable along either of its physical directions', () => {
    const monitors = [{x: 0, y: 0, width: 1280, height: 900}, {x: 2000, y: -1000, width: 1600, height: 900}];
    assert.equal(adjacentMonitor(monitors, 0, 'up'), 1);
    assert.equal(adjacentMonitor(monitors, 0, 'right'), 1);
    assert.deepEqual(directionalMonitor(monitors, 1, 'up'), {monitor: 0, wrapped: true});
});

test('horizontal movement wraps from the outer edge to the opposite physical monitor', () => {
    const monitors = [
        {x: 1920, y: 100, width: 1440, height: 900},
        {x: 0, y: 0, width: 1920, height: 1080},
        {x: -1280, y: 300, width: 1280, height: 1024},
    ];
    assert.deepEqual(directionalMonitor(monitors, 1, 'right'), {monitor: 0, wrapped: false});
    assert.deepEqual(directionalMonitor(monitors, 1, 'left'), {monitor: 2, wrapped: false});
    assert.deepEqual(directionalMonitor(monitors, 0, 'right'), {monitor: 2, wrapped: true});
    assert.deepEqual(directionalMonitor(monitors, 2, 'left'), {monitor: 0, wrapped: true});
});

test('horizontal wrapping skips a single monitor, vertical stacks and invalid directions', () => {
    const single = [{x: -500, y: 0, width: 1000, height: 800}];
    assert.equal(directionalMonitor(single, 0, 'left'), null);
    assert.equal(directionalMonitor(single, 0, 'right'), null);
    assert.equal(directionalMonitor([...single, {...single[0], y: -800}], 0, 'right'), null);
    assert.equal(directionalMonitor(single, 0, 'up'), null);
    assert.equal(directionalMonitor(single, 0, 'center'), null);
    assert.equal(directionalMonitor(single, 3, 'left'), null);
});

test('hit testing excludes the right and bottom boundaries', () => {
    const rect = {x: 10, y: 20, width: 30, height: 40};
    assert(contains(rect, 10, 20));
    assert(!contains(rect, 40, 20));
    assert(!contains(rect, 10, 60));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {accessibleButtonRect, anchoredPickerPosition, isMaximizeButton, migratePickerSize, PICKER_BASE_SCALE,
    pickerGrid, withinHoverPicker} from '../lib/pickerGeometry.js';

test('six diagrams occupy two rows of three without changing individual diagram dimensions', () => {
    const grid = pickerGrid(6, 90, 62, 14, 3);
    assert.equal(grid.width, 298);
    assert.equal(grid.height, 138);
    assert.deepEqual(grid.positions, [
        {x: 0, y: 0}, {x: 104, y: 0}, {x: 208, y: 0},
        {x: 0, y: 76}, {x: 104, y: 76}, {x: 208, y: 76},
    ]);
});

test('the top picker keeps every diagram on a single row', () => {
    const grid = pickerGrid(6, 90, 62, 14);
    assert.equal(grid.width, 610);
    assert.equal(grid.height, 62);
    assert(grid.positions.every(position => position.y === 0));
    assert.deepEqual(grid.positions[5], {x: 520, y: 0});
});

test('115% saved picker size becomes 100% while fresh defaults use the enlarged baseline', () => {
    const settings = (saved, version = 0) => ({values: {'picker-scale': saved ?? 100, 'picker-size-version': version},
        get_int(key) { return this.values[key]; },
        set_int(key, value) { this.values[key] = value; },
        get_user_value() { return saved; }});
    const previous = settings(115);
    migratePickerSize(previous);
    assert.equal(previous.values['picker-scale'], 100);
    assert(Math.abs(previous.values['picker-scale'] * PICKER_BASE_SCALE - 115) < 1e-10);
    migratePickerSize(previous);
    assert.equal(previous.values['picker-scale'], 100, 'migration must not repeat');
    const fresh = settings(null);
    migratePickerSize(fresh);
    assert.equal(fresh.values['picker-scale'], 100);
    const small = settings(50);
    migratePickerSize(small);
    assert.equal(small.values['picker-scale'], 50);
});

test('maximize button labels exclude close, minimize and document content', () => {
    for (const name of ['Maximize', 'Restore', 'Restore down', '최대화', '최대화 해제', '복원', '복구', '원래 크기로 복원'])
        assert(isMaximizeButton(name), name);
    for (const name of ['Close', 'Minimize', '닫기', '최소화', 'Restore backup', 'Maximize image'])
        assert(!isMaximizeButton(name), name);
});

test('accessible control coordinates follow negative monitor origins and scaled windows', () => {
    const frame = {x: -1200, y: 32, width: 900, height: 600};
    const surface = {x: 0, y: 0, width: 1800, height: 1200};
    const button = {x: 1600, y: 8, width: 68, height: 68};
    assert.deepEqual(accessibleButtonRect(frame, surface, button), {x: -400, y: 36, width: 34, height: 34});
    assert.equal(accessibleButtonRect(frame, surface, {...button, y: 600}), null);
    assert.equal(accessibleButtonRect(frame, surface, {...button, width: 500}), null);
    assert.equal(accessibleButtonRect(frame, surface, {...button, x: -80}), null);
});

test('button picker stays on the target monitor and preserves a path from the button', () => {
    const area = {x: -1600, y: 30, width: 1600, height: 870};
    const size = {width: 800, height: 110};
    const anchor = {x: -70, y: 40, width: 34, height: 34};
    const position = anchoredPickerPosition(area, size, anchor);
    assert.deepEqual(position, {x: -836, y: 80});
    assert(withinHoverPicker(anchor, {...position, ...size}, -50, 77));
    assert(!withinHoverPicker(anchor, {...position, ...size}, 10, 250));
    const lower = anchoredPickerPosition(area, size, {...anchor, y: 850});
    assert.equal(lower.y, 734);
    assert(lower.y + size.height <= area.y + area.height);
});

test('Chromium caption buttons account for shadows outside the visible window frame', () => {
    const frame = {x: -900, y: 100, width: 900, height: 600};
    const buffer = {x: -916, y: 90, width: 932, height: 642};
    const surface = {x: 0, y: 0, width: 932, height: 642};
    const control = {x: 852, y: 10, width: 32, height: 30};
    assert.deepEqual(accessibleButtonRect(frame, surface, control, buffer), {x: -64, y: 100, width: 32, height: 30});
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {resizePlan, resizeTogether} from '../lib/resizeGeometry.js';

const tile = (x, y, width, height, limits = {}) => ({rect: {x, y, width, height}, ...limits});

test('shared vertical boundary keeps both outer edges and the original gap', () => {
    const tiles = [tile(4, 4, 492, 792), tile(504, 4, 492, 792)];
    const plan = resizePlan(tiles, 0, ['right'], 8);
    const result = resizeTogether(tiles, 0, {x: 4, y: 4, width: 592, height: 792}, plan);
    assert.deepEqual(result.get(1), {x: 604, y: 4, width: 392, height: 792});
    assert.equal(result.get(1).x - result.get(0).x - result.get(0).width, 8);
});

test('a half tile resizes both quarter neighbors on the same cut', () => {
    const tiles = [tile(4, 4, 492, 792), tile(504, 4, 492, 392), tile(504, 404, 492, 392)];
    const result = resizeTogether(tiles, 0, {x: 4, y: 4, width: 552, height: 792}, resizePlan(tiles, 0, ['right'], 8));
    assert.equal(result.size, 3);
    assert.equal(result.get(1).x, 564);
    assert.equal(result.get(2).x, 564);
    assert.equal(result.get(1).height, 392);
});

test('a quarter tile moves the connected cut through the whole grid', () => {
    const tiles = [tile(4, 4, 492, 392), tile(504, 4, 492, 392), tile(4, 404, 492, 392), tile(504, 404, 492, 392)];
    const result = resizeTogether(tiles, 0, {x: 4, y: 4, width: 532, height: 392}, resizePlan(tiles, 0, ['right'], 8));
    assert.equal(result.size, 4);
    assert.equal(result.get(2).width, 532);
    assert.equal(result.get(3).x, 544);
});

test('corner resizing updates horizontal and vertical neighbors coherently', () => {
    const tiles = [tile(4, 4, 492, 392), tile(504, 4, 492, 392), tile(4, 404, 492, 392), tile(504, 404, 492, 392)];
    const result = resizeTogether(tiles, 0, {x: 4, y: 4, width: 532, height: 422}, resizePlan(tiles, 0, ['right', 'bottom'], 8));
    assert.deepEqual(result.get(3), {x: 544, y: 434, width: 452, height: 362});
    assert.equal(result.get(1).height, 422);
    assert.equal(result.get(2).width, 532);
});

test('neighbor minimum size clamps the whole shared cut', () => {
    const tiles = [tile(4, 4, 492, 792), tile(504, 4, 492, 792, {minWidth: 400})];
    const result = resizeTogether(tiles, 0, {x: 4, y: 4, width: 800, height: 792}, resizePlan(tiles, 0, ['right'], 8));
    assert.equal(result.get(0).width, 584);
    assert.deepEqual(result.get(1), {x: 596, y: 4, width: 400, height: 792});
});

test('left and top edges preserve the far edge and work at negative monitor coordinates', () => {
    const tiles = [tile(-496, -396, 492, 792), tile(-996, -396, 492, 792)];
    const result = resizeTogether(tiles, 0, {x: -556, y: -396, width: 552, height: 792}, resizePlan(tiles, 0, ['left'], 8));
    assert.deepEqual(result.get(1), {x: -996, y: -396, width: 432, height: 792});
    assert.equal(result.get(0).x + result.get(0).width, -4);
});

test('unconnected tiles and exterior edges stay independent', () => {
    const tiles = [tile(4, 4, 492, 392), tile(504, 900, 492, 392)];
    assert.deepEqual(resizePlan(tiles, 0, ['right'], 8), []);
    assert.deepEqual(resizePlan(tiles, 0, ['left'], 8), []);
});

test('returning to the starting size restores neighbors exactly', () => {
    const tiles = [tile(4, 4, 492, 792), tile(504, 4, 492, 792)];
    const result = resizeTogether(tiles, 0, tiles[0].rect, resizePlan(tiles, 0, ['right'], 8));
    assert.deepEqual(result.get(1), tiles[1].rect);
});

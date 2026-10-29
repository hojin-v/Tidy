import test from 'node:test';
import assert from 'node:assert/strict';
import {automaticPickerScale, displayProfiles} from '../lib/monitorScale.js';

const laptop = {x: 2560, y: 402, width: 1440, height: 900, inches: 15.94, builtin: true};
const external = {x: 0, y: 0, width: 2560, height: 1440, inches: 33.36, builtin: false};

test('a 16 inch built-in display remains the baseline while a 32 inch external display grows gently', () => {
    assert.equal(automaticPickerScale(laptop, laptop), 1);
    assert.equal(automaticPickerScale(external, laptop), 1.35);
});

test('monitor rotation preserves the automatic size', () => {
    assert.equal(automaticPickerScale({...external, width: external.height, height: external.width}, laptop),
        automaticPickerScale(external, laptop));
});

test('logical dimensions account for HiDPI without applying display scale twice', () => {
    assert.equal(automaticPickerScale({...external, scale: 2}, laptop), automaticPickerScale(external, laptop));
    assert(automaticPickerScale({...external, width: 1920, height: 1080}, laptop) < automaticPickerScale(external, laptop));
});

test('missing physical sizes use a conservative resolution fallback', () => {
    assert.equal(automaticPickerScale({width: 1600, height: 900}), 1);
    assert(automaticPickerScale({width: 3840, height: 2160}) > 1);
    for (const inches of [0, -1, NaN, Infinity, 250])
        assert.equal(automaticPickerScale({...external, inches}, laptop), 1.3);
});

test('automatic enlargement remains bounded and handles absent monitors', () => {
    assert.equal(automaticPickerScale({...external, width: 16000, height: 9000}, laptop), 1.5);
    assert.equal(automaticPickerScale({...external, width: 800, height: 600, inches: 10}, laptop), 1);
    assert.equal(automaticPickerScale(null), 1);
    assert.equal(automaticPickerScale({width: 0, height: 0}), 1);
});

test('display profiles map physical dimensions to logical coordinates rather than monitor array order', () => {
    const builtinSpec = ['eDP-1', 'SDC', 'panel', 'internal'];
    const externalSpec = ['DP-1', 'AOC', 'display', 'external'];
    const state = [1, [[externalSpec, [], {'is-builtin': false}], [builtinSpec, [], {'is-builtin': true}]],
        [[2560, 402, 2, 0, false, [builtinSpec], {}], [0, 0, 1, 0, true, [externalSpec], {}]]];
    const output = (connector, w, h) => [0, 0, 0, [], connector, [], [], {'width-mm': w, 'height-mm': h}];
    const resources = [1, [], [output('eDP-1', 340, 220), output('DP-1', 730, 430)]];
    const profiles = displayProfiles(state, resources, [external, laptop]);
    assert.equal(profiles[0].builtin, false);
    assert.equal(profiles[1].builtin, true);
    assert.equal(automaticPickerScale(profiles[1], profiles[1]), 1);
    assert.equal(automaticPickerScale(profiles[0], profiles[1]), 1.35);
});

test('mirrored screens use the smaller physical display and retain built-in sizing', () => {
    const internal = ['eDP-1'];
    const other = ['DP-1'];
    const profiles = displayProfiles([1, [[internal, [], {'is-builtin': true}], [other, [], {}]],
        [[0, 0, 2, 0, true, [internal, other], {}]]], [1, [], [
        [0, 0, 0, [], 'eDP-1', [], [], {'width-mm': 340, 'height-mm': 220}],
        [0, 0, 0, [], 'DP-1', [], [], {'width-mm': 730, 'height-mm': 430}],
    ]], [{x: 0, y: 0, width: 1440, height: 900}]);
    assert(profiles[0].inches < 17);
    assert.equal(automaticPickerScale(profiles[0]), 1);
});

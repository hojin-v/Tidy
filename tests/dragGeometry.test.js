import assert from 'node:assert/strict';
import test from 'node:test';
import {dragPreviewScale} from '../lib/dragGeometry.js';

test('desktop windows, overview thumbnails and small app icons all shrink proportionally', () => {
    const area = {width: 1920, height: 1080};
    for (const [width, height] of [[1800, 1000], [500, 300], [200, 100], [64, 80]]) {
        const scale = dragPreviewScale(width, height, area);
        assert(scale > 0 && scale <= 0.65);
        assert(width * scale <= 280 && height * scale <= 180);
    }
    assert.equal(dragPreviewScale(64, 80, area), 0.65);
});

test('drag miniatures respect the usable area of a smaller monitor', () => {
    const area = {width: 800, height: 600};
    const scale = dragPreviewScale(1200, 900, area);
    assert(1200 * scale <= area.width * 0.22);
    assert(900 * scale <= area.height * 0.24);
});

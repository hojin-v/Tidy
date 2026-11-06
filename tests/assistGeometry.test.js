import test from 'node:test';
import assert from 'node:assert/strict';
import {assistGrid, fitThumbnail} from '../lib/assistGeometry.js';

test('window cards wrap and scroll within empty halves, quarters and narrow regions', () => {
    for (const scale of [1, 2]) {
        for (const [width, height] of [[792, 860], [792, 422], [300, 230], [160, 120]]) {
            for (const count of [1, 2, 15, 40]) {
                const grid = assistGrid(count, width, height, scale);
                assert(grid.columns >= 1 && grid.columns <= count);
                assert(grid.viewportWidth > 0 && grid.viewportWidth <= width);
                assert(grid.viewportHeight > 0 && grid.viewportHeight <= height);
                assert(grid.previewWidth > 0 && grid.previewHeight > 0);
                assert(grid.cardWidth * grid.columns + (grid.columns - 1) * 12 * scale <= grid.viewportWidth);
                if (count === 40) assert(grid.cardHeight * Math.ceil(count / grid.columns) > grid.viewportHeight);
            }
        }
    }
});

test('landscape and portrait previews preserve aspect ratio and stay inside the card', () => {
    for (const frame of [{width: 1600, height: 900}, {width: 400, height: 900}, {width: 60, height: 40}]) {
        const fitted = fitThumbnail(frame, 224, 140);
        assert(fitted.x >= 0 && fitted.y >= 0);
        assert(fitted.x + fitted.width <= 224 && fitted.y + fitted.height <= 140);
        assert(Math.abs(fitted.width / fitted.height - frame.width / frame.height) < 0.00001);
        assert(fitted.width <= frame.width && fitted.height <= frame.height);
        assert.equal(fitted.x * 2 + fitted.width, 224);
        assert.equal(fitted.y * 2 + fitted.height, 140);
    }
});

test('a disappearing window with an empty frame cannot produce invalid preview coordinates', () => {
    const fitted = fitThumbnail({width: 0, height: 0}, 224, 140);
    assert(Object.values(fitted).every(Number.isFinite));
    assert(fitted.width > 0 && fitted.height > 0);
});

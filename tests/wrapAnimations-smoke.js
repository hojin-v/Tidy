import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {rectCopy} from '../lib/resizeGeometry.js';

const sameRect = (actual, expected) => ['x', 'y', 'width', 'height']
    .every(key => Math.abs(actual[key] - expected[key]) < 1);
const visibleRect = actor => {
    const viewport = actor.get_parent();
    return {x: viewport.x + actor.x, y: viewport.y + actor.y, width: actor.width, height: actor.height};
};

export async function testWrapAnimations(extension, window, assert) {
    await Scripting.waitTestWindows();
    const tiler = extension._tiler;
    const animations = tiler._animations;
    const monitors = Main.layoutManager.monitors;
    const ordered = monitors.map((monitor, index) => ({monitor, index})).sort((a, b) => a.monitor.x - b.monitor.x);
    const left = ordered[0].index;
    const right = ordered.at(-1).index;
    if (left === right) return;
    const actor = window.get_compositor_private();
    const apply = direction => {
        const target = tiler.horizontalTarget(window, direction);
        tiler.apply(window, target.zone, target.monitor, {wrap: target.wrap});
        return animations._running.get(window);
    };
    try {
        for (const direction of ['left', 'right']) {
            const startMonitor = direction === 'left' ? left : right;
            const destination = direction === 'left' ? right : left;
            tiler.apply(window, direction, startMonitor);
            await Scripting.sleep(350);
            const source = rectCopy(window.get_frame_rect());
            const entry = apply(direction);
            const portal = entry?.portal;
            assert(portal && entry.surface instanceof Clutter.Clone && portal.sourceSurface instanceof Clutter.Clone &&
                entry.surface.source === actor && portal.sourceSurface.source === actor && actor.opacity === 0,
                `${direction} wrapping uses live outgoing and incoming surfaces while hiding the real destination`);
            assert(window.get_monitor() === destination &&
                sameRect(visibleRect(portal.outgoing), source) &&
                sameRect(portal.sourceViewport, monitors[startMonitor]) &&
                sameRect(portal.targetViewport, monitors[destination]) &&
                portal.sourceViewport.get_clip().every((v, i) => v === [0, 0, monitors[startMonitor].width, monitors[startMonitor].height][i]),
                `${direction} wrap begins at the actual source and clips each surface to its own monitor`);
            const initial = visibleRect(entry.clone);
            assert(direction === 'left' ? initial.x >= monitors[destination].x + monitors[destination].width :
                initial.x + initial.width <= monitors[destination].x,
                `${direction} wrap enters from beyond the opposite monitor edge`);
            await Scripting.sleep(90);
            const incoming = visibleRect(entry.clone);
            const outgoing = visibleRect(portal.outgoing);
            const [paintX, paintY] = entry.clone.get_transformed_position();
            assert((direction === 'left' ? outgoing.x < source.x && incoming.x < initial.x :
                outgoing.x > source.x && incoming.x > initial.x) &&
                Math.abs(paintX - incoming.x) < 1 && Math.abs(paintY - incoming.y) < 1 &&
                Math.abs(outgoing.x - source.x) <= source.width + 32 &&
                Math.abs(incoming.x - entry.target.x) <= entry.target.width + 32 &&
                entry.clone.get_parent() === portal.targetViewport && portal.outgoing.get_parent() === portal.sourceViewport,
                `${direction} wrap only slides through the two outer edges without traversing intermediate screens`);
            await Scripting.sleep(260);
            assert(!animations._running.has(window) && actor.opacity === 255,
                `${direction} wrap releases both clipped surfaces after the destination paints`);
        }
        // Interrupt a wrap with another wrap, then interrupt that with a normal
        // placement. Neither path may expose the real window or leave a ghost.
        const first = apply('left');
        const oldPortal = first.portal;
        let oldSourceDestroyed = false;
        let oldTargetDestroyed = false;
        oldPortal.sourceViewport.connect('destroy', () => { oldSourceDestroyed = true; });
        oldPortal.targetViewport.connect('destroy', () => { oldTargetDestroyed = true; });
        await Scripting.sleep(70);
        const shown = visibleRect(first.clone);
        const second = apply('right');
        assert(second === first && sameRect(visibleRect(second.portal.outgoing), shown) &&
            oldSourceDestroyed && oldTargetDestroyed && actor.opacity === 0,
            'rapid opposite wrapping reuses the visible surface and removes the previous edge containers');
        await Scripting.sleep(70);
        const before = visibleRect(second.clone);
        tiler.apply(window, 'top');
        assert(animations._running.get(window) === second && !second.portal && sameRect(second.clone, before) && actor.opacity === 0,
            'interrupting a wrap with normal tiling preserves the visible position and clears edge clipping');
        await Scripting.sleep(350);
        tiler.apply(window, 'left', left);
        await Scripting.sleep(350);
        const cancelled = apply('left');
        let outgoingDestroyed = false;
        let incomingDestroyed = false;
        cancelled.portal.sourceViewport.connect('destroy', () => { outgoingDestroyed = true; });
        cancelled.portal.targetViewport.connect('destroy', () => { incomingDestroyed = true; });
        animations.finishAll();
        assert(outgoingDestroyed && incomingDestroyed && !animations._running.size && actor.opacity === 255,
            'finishing or disabling mid-wrap destroys both edge containers and restores window visibility');
        tiler.apply(window, 'right', right, {animate: false});
        apply('right');
        const unpainted = animations._running.get(window);
        const unpaintedRect = visibleRect(unpainted.clone);
        tiler.apply(window, 'top');
        assert(sameRect(unpainted.clone, unpaintedRect) &&
            Object.values(rectCopy(unpainted.clone)).every(Number.isFinite),
            'a wrap interrupted before its first painted frame retains finite, correct stage coordinates');
    } finally {
        animations.finishAll();
        tiler.restore(window);
        await Scripting.sleep(350);
        await Scripting.waitTestWindows();
    }
}

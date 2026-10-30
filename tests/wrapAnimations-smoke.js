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

export async function testWrapAnimations(extension, window, assert, {vertical = false} = {}) {
    await Scripting.waitTestWindows();
    const tiler = extension._tiler;
    const animations = tiler._animations;
    const monitors = Main.layoutManager.monitors;
    const axis = vertical ? 'y' : 'x';
    const span = vertical ? 'height' : 'width';
    const negative = vertical ? 'up' : 'left';
    const positive = vertical ? 'down' : 'right';
    const zones = {left: 'left', right: 'right', up: 'top', down: 'bottom'};
    const ordered = monitors.map((monitor, index) => ({monitor, index})).sort((a, b) => a.monitor[axis] - b.monitor[axis]);
    const first = ordered[0].index;
    const last = ordered.at(-1).index;
    if (monitors[first][axis] === monitors[last][axis]) return;
    const actor = window.get_compositor_private();
    const apply = direction => {
        const target = tiler.directionalTarget(window, zones[direction]);
        tiler.apply(window, target.zone, target.monitor, {wrap: target.wrap});
        return animations._running.get(window);
    };
    try {
        for (const direction of [negative, positive]) {
            const startMonitor = direction === negative ? first : last;
            const destination = direction === negative ? last : first;
            const from = Main.layoutManager.getWorkAreaForMonitor(startMonitor);
            const to = Main.layoutManager.getWorkAreaForMonitor(destination);
            tiler.apply(window, zones[direction], startMonitor);
            await Scripting.sleep(350);
            const source = rectCopy(window.get_frame_rect());
            const entry = apply(direction);
            const portal = entry?.portal;
            assert(portal && entry.surface instanceof Clutter.Clone && portal.sourceSurface instanceof Clutter.Clone &&
                entry.surface.source === actor && portal.sourceSurface.source === actor && actor.opacity === 0,
                `${direction} wrapping uses live outgoing and incoming surfaces while hiding the real destination`);
            assert(window.get_monitor() === destination && sameRect(visibleRect(portal.outgoing), source) &&
                sameRect(portal.sourceViewport, from) && sameRect(portal.targetViewport, to) &&
                portal.sourceViewport.get_clip().every((v, i) => v === [0, 0, from.width, from.height][i]),
                `${direction} wrap begins at the actual source and clips each surface to its monitor work area`);
            const initial = visibleRect(entry.clone);
            assert(direction === negative ? initial[axis] >= to[axis] + to[span] : initial[axis] + initial[span] <= to[axis],
                `${direction} wrap enters from beyond the opposite monitor edge`);
            await Scripting.sleep(90);
            const incoming = visibleRect(entry.clone);
            const outgoing = visibleRect(portal.outgoing);
            const [paintX, paintY] = entry.clone.get_transformed_position();
            assert((direction === negative ? outgoing[axis] < source[axis] && incoming[axis] < initial[axis] :
                outgoing[axis] > source[axis] && incoming[axis] > initial[axis]) &&
                Math.abs(paintX - incoming.x) < 1 && Math.abs(paintY - incoming.y) < 1 &&
                Math.abs(outgoing[axis] - source[axis]) <= source[span] + 32 &&
                Math.abs(incoming[axis] - entry.target[axis]) <= entry.target[span] + 32 &&
                entry.clone.get_parent() === portal.targetViewport && portal.outgoing.get_parent() === portal.sourceViewport,
                `${direction} wrap only slides through the two outer edges without traversing intermediate screens`);
            await Scripting.sleep(260);
            assert(!animations._running.has(window) && actor.opacity === 255,
                `${direction} wrap releases both clipped surfaces after the destination paints`);
        }
        const initialWrap = apply(negative);
        const oldPortal = initialWrap.portal;
        let oldSourceDestroyed = false;
        let oldTargetDestroyed = false;
        oldPortal.sourceViewport.connect('destroy', () => { oldSourceDestroyed = true; });
        oldPortal.targetViewport.connect('destroy', () => { oldTargetDestroyed = true; });
        await Scripting.sleep(70);
        const shown = visibleRect(initialWrap.clone);
        const second = apply(positive);
        assert(second === initialWrap && sameRect(visibleRect(second.portal.outgoing), shown) &&
            oldSourceDestroyed && oldTargetDestroyed && actor.opacity === 0,
            `${axis} rapid opposite wrapping reuses the visible surface and removes the previous edge containers`);
        await Scripting.sleep(70);
        const before = visibleRect(second.clone);
        tiler.apply(window, 'top');
        assert(animations._running.get(window) === second && !second.portal && sameRect(second.clone, before) && actor.opacity === 0,
            `${axis} interrupting a wrap with normal tiling preserves the visible position and clears edge clipping`);
        await Scripting.sleep(350);
        tiler.apply(window, zones[negative], first);
        await Scripting.sleep(350);
        const cancelled = apply(negative);
        let outgoingDestroyed = false;
        let incomingDestroyed = false;
        cancelled.portal.sourceViewport.connect('destroy', () => { outgoingDestroyed = true; });
        cancelled.portal.targetViewport.connect('destroy', () => { incomingDestroyed = true; });
        animations.finishAll();
        assert(outgoingDestroyed && incomingDestroyed && !animations._running.size && actor.opacity === 255,
            `${axis} finishing or disabling mid-wrap destroys both edge containers and restores window visibility`);
        tiler.apply(window, zones[positive], last, {animate: false});
        apply(positive);
        const unpainted = animations._running.get(window);
        const unpaintedRect = visibleRect(unpainted.clone);
        tiler.apply(window, 'top');
        assert(sameRect(unpainted.clone, unpaintedRect) && Object.values(rectCopy(unpainted.clone)).every(Number.isFinite),
            `${axis} a wrap interrupted before its first painted frame retains finite, correct stage coordinates`);
    } finally {
        animations.finishAll();
        tiler.restore(window);
        await Scripting.sleep(350);
        await Scripting.waitTestWindows();
    }
}

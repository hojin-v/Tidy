import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {rectCopy} from '../lib/resizeGeometry.js';

const sameRect = (actual, expected) => ['x', 'y', 'width', 'height']
    .every(key => Math.abs(actual[key] - expected[key]) < 1);

export async function testWindowAnimations(extension, window, assert) {
    await Scripting.waitTestWindows();
    const animations = extension._tiler._animations;
    extension._tiler.restore(window);
    await Scripting.sleep(300);
    const actor = window.get_compositor_private();
    let transparentFrame = false;
    let coveredHandoff = false;
    let nativeOverlay = false;
    let paintedView;
    const observer = global.stage.connect('after-paint', (_stage, view) => {
        paintedView = view?.layout;
        const entry = animations._running.get(window);
        if (!entry) return;
        transparentFrame ||= actor.opacity < 255 && entry.clone.opacity < 255;
        coveredHandoff ||= Boolean(entry.paintSignal && actor.opacity === 255 && entry.clone.opacity === 255);
        nativeOverlay ||= Boolean(actor.__animationInfo);
    });
    try {
        const start = rectCopy(window.get_frame_rect());
        extension._tiler.apply(window, 'left');
        const entry = animations._running.get(window);
        assert(entry?.surface instanceof Clutter.Clone && entry.surface.source === actor,
            'desktop placement animates a live window surface instead of a bitmap');
        assert(sameRect(entry.clone, start),
            'first animation frame starts at the actual native window position and size');
        await Scripting.sleep(350);
        assert(!transparentFrame && coveredHandoff && !animations._running.has(window) && actor.opacity === 255,
            'desktop movement stays opaque and paints the real window beneath its cover before releasing it');

        extension._tiler.apply(window, 'right');
        const first = animations._running.get(window);
        await Scripting.sleep(70);
        const beforeRetarget = rectCopy(first.clone);
        extension._tiler.apply(window, 'left');
        assert(animations._running.get(window) === first && sameRect(first.clone, beforeRetarget) && actor.opacity === 0 && first.clone.opacity === 255,
            'rapid layout changes retarget the same surface without briefly revealing the real window');
        await Scripting.sleep(350);

        extension._tiler.toggleMaximize(window);
        assert(window.maximized_horizontally && animations._running.has(window) && !actor.__animationInfo,
            'desktop maximize uses one placement animation without GNOME adding another snapshot');
        await Scripting.sleep(350);
        extension._tiler.toggleMaximize(window);
        await Scripting.sleep(350);
        assert(!window.maximized_horizontally && !window.maximized_vertically && !nativeOverlay &&
            !transparentFrame && !Main.wm._skippedActors.has(actor) && actor.opacity === 255,
            'maximize and restore finish without transparent frames, duplicate effects or a leftover effect skip');
        const otherMonitor = Main.layoutManager.monitors.findIndex((_, index) => index !== window.get_monitor());
        if (otherMonitor >= 0) {
            const crossingStart = rectCopy(window.get_frame_rect());
            extension._tiler.apply(window, 'right', otherMonitor);
            const crossing = animations._running.get(window);
            assert(sameRect(crossing.clone, crossingStart),
                'monitor transfer starts at the source window instead of the desktop origin');
            let handoffView;
            crossing.clone.connect('destroy', () => { handoffView = paintedView; });
            await Scripting.sleep(350);
            const frame = window.get_frame_rect();
            assert(handoffView && frame.x + frame.width / 2 >= handoffView.x &&
                frame.x + frame.width / 2 < handoffView.x + handoffView.width &&
                !animations._running.has(window) && actor.opacity === 255,
                'monitor transfers release the cover after the destination monitor actually paints');
            const arrived = rectCopy(frame);
            extension._tiler.apply(window, 'left', otherMonitor);
            const onward = animations._running.get(window);
            assert(sameRect(onward.clone, arrived),
                'the next placement on another monitor starts where the previous placement finished');
            await Scripting.sleep(70);
            assert(onward.clone.x >= Math.min(arrived.x, onward.target.x) &&
                onward.clone.x <= Math.max(arrived.x, onward.target.x),
                'movement on the second monitor stays between its real start and destination');
            await Scripting.sleep(280);
        }
        // Restoring an originally maximized window supplies a native boxed
        // work-area rectangle as the destination, rather than a JS object.
        extension._tiler.restore(window);
        await Scripting.sleep(350);
        window.maximize();
        await Scripting.sleep(350);
        extension._tiler.apply(window, 'left');
        await Scripting.sleep(350);
        const half = rectCopy(window.get_frame_rect());
        const full = rectCopy(Main.layoutManager.getWorkAreaForMonitor(window.get_monitor()));
        extension._tiler.restore(window);
        const restoring = animations._running.get(window);
        assert(sameRect(restoring.clone, half) && sameRect(restoring.target, full),
            'restoring original maximization preserves native destination coordinates and dimensions');
        await Scripting.sleep(350);
        assert(window.maximized_horizontally && window.maximized_vertically &&
            sameRect(window.get_frame_rect(), full) && !animations._running.has(window),
            'a native boxed destination completes at the original maximized rectangle');
    } finally {
        global.stage.disconnect(observer);
        animations.finishAll();
        extension._tiler.restore(window);
        await Scripting.sleep(300);
        await Scripting.waitTestWindows();
    }
}

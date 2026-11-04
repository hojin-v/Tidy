import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import {rectCopy} from './resizeGeometry.js';

export function windowSurface(window, rect, opacity = 255) {
    // GI boxed rectangles expose fields through accessors, so spreading one
    // drops its geometry and starts the actor at (0, 0) with no explicit size.
    const clone = new Clutter.Actor({...rectCopy(rect), reactive: false, opacity,
        layout_manager: new Shell.WindowPreviewLayout()});
    const surface = clone.layout_manager.add_window(window);
    if (!surface) { clone.destroy(); return null; }
    return {clone, surface};
}

// Keep the moving surface opaque while the real window is made paintable.
// Remove it only after a rendered frame, so there is no transparent frame or
// handoff to an actor whose allocation hasn't reached the renderer yet.
export function handoffSurface(entry, finish) {
    if (entry.finished) return;
    cancelSurfaceHandoff(entry);
    entry.later = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
        entry.later = 0;
        if (entry.finished) return false;
        if (entry.window.get_compositor_private() !== entry.actor) {
            finish(true);
            return false;
        }
        entry.actor.remove_transition('opacity');
        entry.actor.opacity = entry.opacity;
        const signal = global.stage.connect('after-paint', (_stage, view) => {
            if (entry.finished || entry.window.get_compositor_private() !== entry.actor) {
                if (entry.paintSignal === signal) cancelSurfaceHandoff(entry);
                else global.stage.disconnect(signal);
                if (!entry.finished) finish(true);
                return;
            }
            const frame = entry.window.get_frame_rect();
            const viewport = view?.layout;
            // Monitors can paint at different refresh rates. Painting the
            // other monitor is not evidence that this window was rendered.
            if (viewport && (frame.x + frame.width <= viewport.x || frame.x >= viewport.x + viewport.width ||
                frame.y + frame.height <= viewport.y || frame.y >= viewport.y + viewport.height)) return;
            finish();
        });
        entry.paintSignal = signal;
        entry.clone.queue_redraw();
        return false;
    });
}

export function cancelSurfaceHandoff(entry) {
    if (entry.later) global.compositor.get_laters().remove(entry.later);
    entry.later = 0;
    if (entry.paintSignal) global.stage.disconnect(entry.paintSignal);
    entry.paintSignal = 0;
}

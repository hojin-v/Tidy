import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {cancelSurfaceHandoff, handoffSurface, windowSurface} from './windowSurface.js';
import {rectCopy} from './resizeGeometry.js';
import {dockMotion} from './dockMotion.js';

// Move the actual window once and animate a live view over it. A bitmap
// cross-fade exposed the background and briefly showed two window sizes.
export class WindowAnimations {
    constructor() {
        this._running = new Map();
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
    }

    move(window, target, changeGeometry) {
        target = rectCopy(target);
        let entry = this._running.get(window);
        if (entry?.portal) this._detachPortal(entry);
        if (entry?.drag) this._detachDrag(window, entry);
        const source = rectCopy(entry?.clone ?? window.get_frame_rect());
        const actor = window.get_compositor_private();
        if (!actor || !actor.visible || !this._interface.get_boolean('enable-animations') ||
            ['x', 'y', 'width', 'height'].every(key => Math.abs(source[key] - target[key]) < 1)) {
            this._finish(window);
            changeGeometry();
            return;
        }
        if (entry) {
            cancelSurfaceHandoff(entry);
            entry.clone.remove_all_transitions();
        } else {
            entry = this._create(window, source);
            if (!entry) { changeGeometry(); return; }
        }
        entry.target = target;
        actor.opacity = 0;
        try {
            changeGeometry();
        } catch (error) {
            this._finish(window);
            throw error;
        }
        entry.clone.ease({...target, duration: 240, mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => handoffSurface(entry, () => this._finish(window))});
    }

    wrap(window, target, from, to, direction, changeGeometry) {
        if (!this._interface.get_boolean('enable-animations')) {
            this._finish(window);
            changeGeometry();
            return;
        }
        target = rectCopy(target);
        let entry = this._running.get(window);
        if (entry?.portal) this._detachPortal(entry);
        if (entry?.drag) this._detachDrag(window, entry);
        const source = rectCopy(entry?.clone ?? window.get_frame_rect());
        const incoming = windowSurface(window, target);
        if (!incoming) { this.move(window, target, changeGeometry); return; }
        entry ??= this._create(window, source);
        if (!entry) { incoming.clone.destroy(); changeGeometry(); return; }
        cancelSurfaceHandoff(entry);
        entry.clone.remove_all_transitions();
        const viewport = monitor => {
            const actor = new Clutter.Actor({...rectCopy(monitor), reactive: false});
            actor.set_clip(0, 0, monitor.width, monitor.height);
            Main.uiGroup.add_child(actor);
            return actor;
        };
        const sourceViewport = viewport(from);
        const targetViewport = viewport(to);
        const outgoing = entry.clone;
        outgoing.get_parent().remove_child(outgoing);
        sourceViewport.add_child(outgoing);
        outgoing.set_position(source.x - from.x, source.y - from.y);
        targetViewport.add_child(incoming.clone);
        incoming.clone.set_position(direction === 'left' ? to.width + 16 : -target.width - 16, target.y - to.y);
        entry.portal = {sourceViewport, targetViewport, outgoing, sourceSurface: entry.surface, direction};
        entry.clone = incoming.clone;
        entry.surface = incoming.surface;
        entry.target = target;
        entry.actor.opacity = 0;
        try {
            changeGeometry();
        } catch (error) {
            this._finish(window);
            throw error;
        }
        // Two clipped surfaces connect the outer edges. Neither surface ever
        // travels through the desktop between the source and destination.
        outgoing.ease({x: direction === 'left' ? -source.width - 16 : from.width + 16,
            duration: 240, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        incoming.clone.ease({x: target.x - to.x, y: target.y - to.y,
            duration: 240, mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => handoffSurface(entry, () => this._finish(window))});
    }

    _clearPortal(entry) {
        const portal = entry.portal;
        if (!portal) return;
        entry.portal = null;
        portal.outgoing.remove_all_transitions();
        portal.sourceViewport.destroy();
        portal.targetViewport.destroy();
    }

    _detachPortal(entry) {
        cancelSurfaceHandoff(entry);
        // These containers only translate. Use their explicit coordinates:
        // Clutter's transformed bounds can be NaN before the first allocation,
        // for example when two shortcuts arrive before the next painted frame.
        const x = entry.portal.targetViewport.x + entry.clone.x;
        const y = entry.portal.targetViewport.y + entry.clone.y;
        entry.clone.remove_all_transitions();
        entry.clone.get_parent().remove_child(entry.clone);
        Main.uiGroup.add_child(entry.clone);
        entry.clone.set_position(x, y);
        this._clearPortal(entry);
    }

    _create(window, source) {
        const actor = window.get_compositor_private();
        if (!actor) return null;
        const view = windowSurface(window, source);
        if (!view) return null;
        Main.uiGroup.add_child(view.clone);
        const entry = {...view, actor, opacity: actor.opacity, destroyId: 0};
        this._running.set(window, entry);
        entry.destroyId = actor.connect('destroy', () => this._finish(window, true));
        return entry;
    }

    previewDrag(window, x, y, area) {
        let entry = this._running.get(window);
        if (entry?.shrinking) return;
        if (entry && !entry.drag) this._finish(window);
        entry = this._running.get(window);
        if (!entry) {
            const frame = rectCopy(window.get_frame_rect());
            entry = this._create(window, frame);
            if (!entry) return;
            // Keep the grabbed title-bar point under the pointer. Mutter keeps
            // moving the full window; only its live presentation shrinks.
            entry.clone.set_pivot_point(Math.max(0, Math.min(1, (x - frame.x) / frame.width)),
                Math.max(0, Math.min(1, (y - frame.y) / frame.height)));
            entry.drag = true;
            const follow = () => {
                const rect = window.get_frame_rect();
                entry.clone.set_position(rect.x, rect.y);
                entry.clone.set_size(rect.width, rect.height);
            };
            entry.frameSignals = ['position-changed', 'size-changed'].map(signal => window.connect(signal, follow));
        }
        cancelSurfaceHandoff(entry);
        entry.clone.remove_all_transitions();
        entry.actor.opacity = 0;
        entry.shrinking = true;
        const scale = Math.min(0.65, Math.min(280, area.width * 0.22) / entry.clone.width,
            Math.min(180, area.height * 0.24) / entry.clone.height);
        entry.clone.ease({scale_x: scale, scale_y: scale, ...dockMotion()});
    }

    restoreDrag(window, immediate = false) {
        const entry = this._running.get(window);
        if (!entry?.drag) return;
        if (immediate) { this._finish(window); return; }
        if (!entry.shrinking) return;
        cancelSurfaceHandoff(entry);
        entry.shrinking = false;
        entry.clone.remove_all_transitions();
        entry.clone.ease({scale_x: 1, scale_y: 1, ...dockMotion(),
            onComplete: () => handoffSurface(entry, () => this._finish(window))});
    }

    _detachDrag(window, entry) {
        const [px, py] = entry.clone.get_pivot_point();
        const x = entry.clone.x + px * entry.clone.width * (1 - entry.clone.scale_x);
        const y = entry.clone.y + py * entry.clone.height * (1 - entry.clone.scale_y);
        const width = entry.clone.width * entry.clone.scale_x;
        const height = entry.clone.height * entry.clone.scale_y;
        for (const id of entry.frameSignals) window.disconnect(id);
        entry.frameSignals = [];
        entry.clone.remove_all_transitions();
        entry.clone.set_pivot_point(0, 0);
        entry.clone.set_scale(1, 1);
        entry.clone.set_position(x, y);
        entry.clone.set_size(width, height);
        entry.drag = false;
        entry.shrinking = false;
    }

    _finish(window, actorDestroyed = false) {
        const entry = this._running.get(window);
        if (!entry)
            return;
        this._running.delete(window);
        cancelSurfaceHandoff(entry);
        for (const id of entry.frameSignals ?? []) window.disconnect(id);
        entry.clone.remove_all_transitions();
        entry.clone.destroy();
        this._clearPortal(entry);
        if (!actorDestroyed) {
            entry.actor.disconnect(entry.destroyId);
            entry.actor.remove_transition('opacity');
            entry.actor.opacity = entry.opacity;
        }
    }

    finishAll() {
        for (const window of [...this._running.keys()])
            this._finish(window);
    }

    finish(window) { this._finish(window); }

    destroy() {
        this.finishAll();
        this._interface = null;
    }
}

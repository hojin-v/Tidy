import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {cancelSurfaceHandoff, handoffSurface, windowSurface} from './windowSurface.js';
import {rectCopy} from './resizeGeometry.js';

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
            const view = windowSurface(window, source);
            if (!view) { changeGeometry(); return; }
            Main.uiGroup.add_child(view.clone);
            entry = {...view, actor, opacity: actor.opacity, destroyId: 0};
            this._running.set(window, entry);
            entry.destroyId = actor.connect('destroy', () => this._finish(window, true));
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

    _finish(window, actorDestroyed = false) {
        const entry = this._running.get(window);
        if (!entry)
            return;
        this._running.delete(window);
        cancelSurfaceHandoff(entry);
        entry.clone.remove_all_transitions();
        entry.clone.destroy();
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

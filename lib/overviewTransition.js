import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Overview from 'resource:///org/gnome/shell/ui/overview.js';
import {cancelSurfaceHandoff, handoffSurface, windowSurface} from './windowSurface.js';
import {rectCopy} from './resizeGeometry.js';

// Carry the visible thumbnail into its final rectangle while GNOME exits the
// overview. The real surface takes over there without a second move animation.
export class OverviewTransition {
    _previews(window) {
        const previews = [];
        const visit = actor => {
            if (actor instanceof Shell.WindowPreview && actor.metaWindow === window) previews.push(actor);
            for (const child of actor.get_children()) visit(child);
        };
        visit(Main.layoutManager.overviewGroup);
        return previews;
    }

    _suppressPreviews(entry) {
        if (this.entry !== entry) return;
        for (const preview of this._previews(entry.window)) this._hidePreview(entry, preview);
    }

    _hidePreview(entry, preview, restoreOpacity = preview.opacity) {
        if (!entry.previews.has(preview)) {
            const signal = preview.connect('destroy', () => {
                entry.previews.delete(preview);
                if (entry.preview === preview) entry.preview = null;
            });
            entry.previews.set(preview, {opacity: restoreOpacity, signal});
        }
        preview.opacity = 0;
    }

    prepare(window, target, {preview, container: dragActor, restoreOpacity} = {}) {
        this.cancel();
        target = rectCopy(target);
        if (!Main.overview.visible || !St.Settings.get().enable_animations) return null;
        const actor = window.get_compositor_private();
        if (!actor) return null;
        if (!preview) {
            const area = Main.layoutManager.getWorkAreaForMonitor(window.get_monitor());
            const score = candidate => {
                const container = candidate.window_container;
                if (!container.mapped || container.get_paint_opacity() === 0) return -1;
                const [x, y] = container.get_transformed_position();
                const [w, h] = container.get_transformed_size();
                return Math.max(0, Math.min(x + w, area.x + area.width) - Math.max(x, area.x)) *
                    Math.max(0, Math.min(y + h, area.y + area.height) - Math.max(y, area.y)) / Math.max(1, w * h);
            };
            preview = this._previews(window).sort((a, b) => score(b) - score(a))[0] ?? window._delegate;
        }
        const container = dragActor ?? preview?.window_container;
        const visible = container?.mapped && container.get_paint_opacity() > 0;
        let source = {...target};
        if (visible) {
            const [x, y] = container.get_transformed_position();
            const [width, height] = container.get_transformed_size();
            if (width > 0 && height > 0) source = {x, y, width, height};
        }
        // Use Mutter's live window preview renderer, including frame cropping
        // and new client buffers. A stretched bitmap of the old window caused
        // the apparent zoom-back when replaced by the newly resized surface.
        const view = windowSurface(window, source, visible ? container.get_paint_opacity() : 0);
        if (!view) return null;
        const {clone, surface} = view;
        Main.uiGroup.add_child(clone);
        const entry = {window, actor, clone, surface, preview, target, source, opacity: actor.opacity,
            previews: new Map(), motionDone: false, committed: false};
        this.entry = entry;
        if (preview) this._hidePreview(entry, preview, restoreOpacity ?? preview.opacity);
        if (dragActor && dragActor !== preview) this._hidePreview(entry, dragActor);
        this._suppressPreviews(entry);
        entry.actorSignal = actor.connect('destroy', () => this._finish(entry, true));
        actor.opacity = 0;
        return entry;
    }

    start(entry) {
        if (!entry || this.entry !== entry) return;
        this._suppressPreviews(entry);
        entry.clone.ease({...entry.target, opacity: 255, duration: Overview.ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => {
                entry.motionDone = true;
                this._handoff(entry);
            }});
        // Moving monitors can create a new native thumbnail. Keep all copies
        // of this window hidden so only one moving surface is visible.
        const timeline = ['x', 'y', 'width', 'height', 'opacity'].map(name => entry.clone.get_transition(name)).find(Boolean);
        timeline?.connect('new-frame', () => this._suppressPreviews(entry));
    }

    complete(entry) {
        if (!entry || this.entry !== entry) return;
        entry.committed = true;
        this._handoff(entry);
    }

    _handoff(entry) {
        if (this.entry !== entry || !entry.motionDone || !entry.committed || entry.handingOff) return;
        entry.handingOff = true;
        handoffSurface(entry, () => this._finish(entry));
    }

    _finish(entry, actorDestroyed = false) {
        if (this.entry !== entry) return;
        this.entry = null;
        cancelSurfaceHandoff(entry);
        entry.clone.remove_all_transitions();
        entry.clone.destroy();
        if (!actorDestroyed) {
            entry.actor.disconnect(entry.actorSignal);
            entry.actor.remove_transition('opacity');
            entry.actor.opacity = entry.opacity;
        }
        for (const [preview, {signal, opacity}] of entry.previews) {
            preview.disconnect(signal);
            preview.opacity = opacity;
        }
        entry.previews.clear();
    }

    cancel(keep = null) {
        if (this.entry && this.entry !== keep) this._finish(this.entry);
    }

    destroy() { this.cancel(); }
}

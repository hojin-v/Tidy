import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import {dockMotion} from './dockMotion.js';
import {dragPreviewScale} from './dragGeometry.js';
import {monitorAt} from './layouts.js';

// Keep workspace/grid layout and pointer positioning on different actors.
// Shell's standard getDragActor hook leaves the source in its original layout.
export class OverviewDrag {
    beginWindow(window) {
        const find = actor => {
            if (actor instanceof Shell.WindowPreview && actor.metaWindow === window && actor.inDrag) return actor;
            for (const child of actor.get_children()) {
                const preview = find(child);
                if (preview) return preview;
            }
            return null;
        };
        const source = find(Main.layoutManager.overviewGroup);
        if (!source) return;
        this.beginItem(source);
        const entry = this.entry;
        if (source.getDragActor) return;
        entry.getActor = () => {
            const [width, height] = source.window_container.get_transformed_size();
            const actor = new Clutter.Actor({width, height, reactive: false,
                layout_manager: new Shell.WindowPreviewLayout()});
            actor.layout_manager.add_window(window);
            source.opacity = 0;
            entry.hidden = true;
            return actor;
        };
        entry.getSource = () => source.window_container;
        source.getDragActor = entry.getActor;
        source.getDragActorSource = entry.getSource;
    }

    beginItem(source) {
        this.end();
        if (!source?._draggable) return;
        const native = source._draggable;
        const entry = {source, native, opacity: source.opacity, hidden: false,
            sourceScaleX: source.scale_x, sourceScaleY: source.scale_y,
            maxSize: native._dragActorMaxSize, animateEnd: native._animateDragEnd,
            restore: native._restoreDragActor, location: native._getRestoreLocation};
        this.entry = entry;
        // A fixed maximum size leaves already-small overview thumbnails at
        // their full size. We own only the scale and its pointer offset, while
        // Shell continues to own the drag position and return lifecycle.
        native._dragActorMaxSize = undefined;
        entry.restoreLocation = () => {
            if (!source.metaWindow) {
                for (const name of ['scale-x', 'scale-y', 'opacity']) source.remove_transition(name);
                source.set_scale(entry.sourceScaleX, entry.sourceScaleY);
                source.opacity = 0;
            }
            return entry.location.call(native);
        };
        entry.animate = (time, params) => {
            entry.returning = true;
            return entry.animateEnd.call(native, time, {...params, ...dockMotion()});
        };
        entry.restoreActor = time => {
            if (entry.handedOff) return entry.restore.call(native, time);
            const [x, y, scale] = native._getRestoreLocation();
            return native._animateDragEnd(time, {x, y, scale_x: scale, scale_y: scale});
        };
        native._animateDragEnd = entry.animate;
        native._restoreDragActor = entry.restoreActor;
        native._getRestoreLocation = entry.restoreLocation;
        entry.destroySignal = source.connect('destroy', () => this.end(true));
        entry.monitor = {dragMotion: () => {
            this._stabilize(entry);
            return DND.DragMotionResult.CONTINUE;
        }};
        DND.addDragMonitor(entry.monitor);
        // drag-begin is emitted before Shell creates/reparents the drag actor.
        entry.later = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            entry.later = 0;
            this._stabilize(entry);
            return false;
        });
    }

    _stabilize(entry) {
        if (this.entry !== entry) return;
        const actor = entry.native._dragActor;
        if (!actor || entry.native._animationInProgress || entry.returning || entry.handedOff) return;
        // Position belongs to pointer motion during a drag. Stop any old
        // layout-position animation without interfering with the return trip.
        for (const property of ['allocation', 'x', 'y']) actor.remove_transition(property);
        if (!entry.scaled) this._shrink(entry, actor);
    }

    _shrink(entry, actor) {
        const width = actor.width || actor.get_preferred_width(-1)[1];
        const height = actor.height || actor.get_preferred_height(width)[1];
        if (!(width > 0 && height > 0)) return;
        if (!actor.width || !actor.height) actor.set_size(width, height);
        const native = entry.native;
        const monitor = monitorAt(Main.layoutManager.monitors, native._dragX, native._dragY);
        const area = Main.layoutManager.getWorkAreaForMonitor(monitor >= 0 ? monitor : Main.layoutManager.primaryIndex);
        const originalScale = actor.scale_x;
        entry.relativeScale = dragPreviewScale(width * originalScale, height * originalScale, area);
        const scale = originalScale * entry.relativeScale;
        const [tx, ty] = actor.get_translation();
        const offsetX = native._dragOffsetX + tx;
        const offsetY = native._dragOffsetY + ty;
        const follow = () => {
            if (this.entry !== entry || native._dragActor !== actor || entry.returning || entry.handedOff) return;
            const ratio = actor.scale_x / originalScale;
            native._dragOffsetX = ratio * offsetX - tx;
            native._dragOffsetY = ratio * offsetY - ty;
            actor.set_position(native._dragX + native._dragOffsetX, native._dragY + native._dragOffsetY);
        };
        entry.scaled = true;
        entry.scaledActor = actor;
        entry.scaleSignal = actor.connect('notify::scale-x', follow);
        entry.actorDestroySignal = actor.connect('destroy', () => { entry.actorDestroyed = true; });
        // Timeline new-frame fires before its scale value is applied. Follow
        // the property notification to keep the grabbed point fixed this frame.
        actor.ease({scale_x: scale, scale_y: scale, ...dockMotion(), onComplete: follow});
    }

    handoff(source) {
        const entry = this.entry;
        if (entry?.source !== source) return;
        entry.handedOff = true;
        if (entry.hidden) {
            entry.source.opacity = entry.opacity;
            entry.hidden = false;
        }
    }

    end(destroyed = false) {
        const entry = this.entry;
        if (!entry) return;
        this.entry = null;
        if (entry.later) global.compositor.get_laters().remove(entry.later);
        DND.removeDragMonitor(entry.monitor);
        if (entry.scaledActor && !entry.actorDestroyed) {
            entry.scaledActor.disconnect(entry.scaleSignal);
            entry.scaledActor.disconnect(entry.actorDestroySignal);
        }
        entry.native._dragActorMaxSize = entry.maxSize;
        if (entry.native._animateDragEnd === entry.animate) entry.native._animateDragEnd = entry.animateEnd;
        if (entry.native._restoreDragActor === entry.restoreActor) entry.native._restoreDragActor = entry.restore;
        if (entry.native._getRestoreLocation === entry.restoreLocation) entry.native._getRestoreLocation = entry.location;
        if (destroyed) return;
        entry.source.disconnect(entry.destroySignal);
        if (entry.source.getDragActor === entry.getActor) delete entry.source.getDragActor;
        if (entry.source.getDragActorSource === entry.getSource) delete entry.source.getDragActorSource;
        if (entry.hidden) entry.source.opacity = entry.opacity;
        if (!entry.source.metaWindow) {
            // App-grid undoScaleAndFade otherwise fades the source in only
            // after its returning proxy has disappeared, exposing a gap.
            for (const name of ['opacity', 'scale-x', 'scale-y']) entry.source.remove_transition(name);
            entry.source.opacity = entry.opacity;
            if (entry.returning) entry.source.set_scale(entry.sourceScaleX, entry.sourceScaleY);
            else {
                entry.source.set_scale(entry.sourceScaleX * (entry.relativeScale ?? 1),
                    entry.sourceScaleY * (entry.relativeScale ?? 1));
                entry.source.ease({scale_x: entry.sourceScaleX, scale_y: entry.sourceScaleY, ...dockMotion()});
            }
        }
    }

    destroy() { this.end(); }
}

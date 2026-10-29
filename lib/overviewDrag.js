import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';

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
        const entry = {source, native: source._draggable, opacity: source.opacity, hidden: false};
        this.entry = entry;
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
        if (!actor || entry.native._animationInProgress) return;
        // Position belongs to pointer motion during a drag. Keep Shell's
        // scale animation, but stop any old layout-position animation.
        for (const property of ['allocation', 'x', 'y']) actor.remove_transition(property);
    }

    handoff(source) {
        const entry = this.entry;
        if (entry?.source !== source || !entry.hidden) return;
        entry.source.opacity = entry.opacity;
        entry.hidden = false;
    }

    end(destroyed = false) {
        const entry = this.entry;
        if (!entry) return;
        this.entry = null;
        if (entry.later) global.compositor.get_laters().remove(entry.later);
        DND.removeDragMonitor(entry.monitor);
        if (destroyed) return;
        entry.source.disconnect(entry.destroySignal);
        if (entry.source.getDragActor === entry.getActor) delete entry.source.getDragActor;
        if (entry.source.getDragActorSource === entry.getSource) delete entry.source.getDragActorSource;
        if (entry.hidden) entry.source.opacity = entry.opacity;
    }

    destroy() { this.end(); }
}

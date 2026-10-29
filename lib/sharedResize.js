import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import {rectCopy, resizePlan, resizeTogether} from './resizeGeometry.js';

const OPERATIONS = new Map([
    [Meta.GrabOp.RESIZING_N, ['top']], [Meta.GrabOp.RESIZING_S, ['bottom']],
    [Meta.GrabOp.RESIZING_W, ['left']], [Meta.GrabOp.RESIZING_E, ['right']],
    [Meta.GrabOp.RESIZING_NW, ['top', 'left']], [Meta.GrabOp.RESIZING_NE, ['top', 'right']],
    [Meta.GrabOp.RESIZING_SW, ['bottom', 'left']], [Meta.GrabOp.RESIZING_SE, ['bottom', 'right']],
]);

export class SharedResize {
    constructor(settings, tiler) {
        this._settings = settings;
        this._tiler = tiler;
        this._signals = [];
    }

    begin(window, op) {
        this.end();
        const sides = OPERATIONS.get(op & ~(1024 | 256));
        if (!sides || !window || !this._settings.get_boolean('resize-together')) return false;
        this._tiler.finishAnimations();
        const tiles = this._tiler.resizeCandidates(window);
        const active = tiles.findIndex(tile => tile.window === window);
        if (active < 0) return false;
        const plan = resizePlan(tiles, active, sides, this._settings.get_int('window-gap'));
        if (!plan.length) return false;
        this._session = {window, tiles, active, plan};
        for (const signal of ['size-changed', 'position-changed'])
            this._signals.push([window, window.connect(signal, () => this._queue())]);
        this._signals.push([window, window.connect('unmanaged', () => this.end())]);
        return true;
    }

    _queue() {
        if (this._syncing || this._idle) return;
        this._idle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idle = 0;
            this.sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    sync() {
        const session = this._session;
        if (!session || this._syncing || !session.window.get_compositor_private()) return;
        const current = rectCopy(session.window.get_frame_rect());
        const targets = resizeTogether(session.tiles, session.active, current, session.plan);
        this._syncing = true;
        try {
            for (const [index, rect] of targets) {
                const window = session.tiles[index].window;
                if (!window.get_compositor_private()) continue;
                const before = window.get_frame_rect();
                if (['x', 'y', 'width', 'height'].some(key => Math.abs(before[key] - rect[key]) > 1)) {
                    window.move_frame(true, rect.x, rect.y);
                    window.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height);
                }
                this._tiler.rememberTile(window, rect);
            }
        } finally {
            this._syncing = false;
        }
    }

    end(window = null) {
        if (window && this._session?.window !== window) return;
        this.sync();
        if (this._idle) { GLib.Source.remove(this._idle); this._idle = 0; }
        for (const [object, id] of this._signals) object.disconnect(id);
        this._signals = [];
        this._session = null;
    }

    destroy() { this.end(); this._tiler = null; this._settings = null; }
}

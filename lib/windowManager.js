import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {adjacentMonitor, ZONES, zoneRect} from './layouts.js';
import {WindowAnimations} from './animations.js';
import {rectCopy} from './resizeGeometry.js';

export function canTile(window) {
    const maximized = window?.maximized_horizontally || window?.maximized_vertically;
    return window && !window.skip_taskbar && window.get_window_type() === Meta.WindowType.NORMAL &&
        (window.allows_move() || maximized) && (window.allows_resize() || maximized) && !window.is_fullscreen();
}

export class WindowTiler {
    constructor(settings) {
        this._settings = settings;
        this._originals = new WeakMap();
        this._placements = new WeakMap();
        this._maximizedFrom = new WeakMap();
        this._animations = new WindowAnimations();
        this._tiles = new Map();
        this._tileSignals = new Map();
    }

    apply(window, zone, monitor = window.get_monitor(), {animate = true} = {}) {
        if (!canTile(window) || !Main.layoutManager.monitors[monitor])
            return false;
        if (!this._originals.has(window)) {
            const rect = window.get_frame_rect();
            this._originals.set(window, {rect: {x: rect.x, y: rect.y, width: rect.width, height: rect.height},
                monitor: window.get_monitor(), maximized: window.maximized_horizontally && window.maximized_vertically});
        }
        const rect = zoneRect(Main.layoutManager.getWorkAreaForMonitor(monitor), zone,
            zone === 'maximize' ? 0 : this._settings.get_int('window-gap'));
        const move = () => {
            if (zone === 'maximize' && window.maximized_horizontally && window.maximized_vertically &&
                window.get_monitor() === monitor) return;
            this._unmaximize(window, false);
            window.move_to_monitor(monitor);
            if (zone === 'maximize') this._maximize(window, false);
            else {
                window.move_frame(true, rect.x, rect.y);
                window.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height);
            }
        };
        if (animate) this._animations.move(window, rect, move);
        else {
            this._animations.finish(window);
            move(); // Overview placement supplies its own transition.
        }
        this._placements.set(window, zone);
        if (zone === 'maximize' || zone === 'center') this.forgetTile(window);
        else this.rememberTile(window, zoneRect(Main.layoutManager.getWorkAreaForMonitor(monitor), zone, this._settings.get_int('window-gap')));
        if (window.minimized) {
            if (!animate) this._skipEffect(window);
            window.unminimize();
        }
        window.activate(global.get_current_time());
        return true;
    }

    restore(window) {
        if (!canTile(window))
            return;
        const original = this._originals.get(window);
        if (original) {
            const monitor = Main.layoutManager.monitors[original.monitor] ? original.monitor : window.get_monitor();
            const area = Main.layoutManager.getWorkAreaForMonitor(monitor);
            const width = Math.min(original.rect.width, area.width);
            const height = Math.min(original.rect.height, area.height);
            const x = Math.max(area.x, Math.min(original.rect.x, area.x + area.width - width));
            const y = Math.max(area.y, Math.min(original.rect.y, area.y + area.height - height));
            const target = original.maximized ? area : {x, y, width, height};
            this._animations.move(window, target, () => {
                if (original.maximized && window.maximized_horizontally && window.maximized_vertically &&
                    window.get_monitor() === monitor) return;
                this._unmaximize(window, false);
                window.move_to_monitor(monitor);
                window.move_frame(true, x, y);
                window.move_resize_frame(true, x, y, width, height);
                if (original.maximized) this._maximize(window, false);
            });
            this._originals.delete(window);
        } else {
            this._animations.finish(window);
            this._unmaximize(window);
        }
        this._placements.delete(window);
        this.forgetTile(window);
    }

    nextMonitor(window) {
        if (!canTile(window))
            return;
        const next = (window.get_monitor() + 1) % Main.layoutManager.monitors.length;
        const zone = this._placements.get(window);
        if (zone)
            this.apply(window, zone, next);
        else
            window.move_to_monitor(next);
    }

    horizontalTarget(window, direction) {
        const monitor = window.get_monitor();
        if (this._placements.get(window) === direction) {
            const expected = zoneRect(Main.layoutManager.getWorkAreaForMonitor(monitor), direction,
                this._settings.get_int('window-gap'));
            const actual = window.get_frame_rect();
            // A manually moved window starts with a fresh half snap.
            const stillPlaced = Math.abs(actual.x - expected.x) <= 4 && Math.abs(actual.y - expected.y) <= 4;
            const next = adjacentMonitor(Main.layoutManager.monitors, monitor, direction);
            if (stillPlaced && next >= 0)
                return {zone: direction === 'right' ? 'left' : 'right', monitor: next};
        }
        return {zone: direction, monitor};
    }

    toggleMaximize(window) {
        if (!canTile(window))
            return;
        if (window.maximized_horizontally || window.maximized_vertically) {
            const saved = this._maximizedFrom.get(window);
            if (!saved) {
                this.restore(window);
                return;
            }
            const monitor = Main.layoutManager.monitors[saved.monitor] ? saved.monitor : window.get_monitor();
            const area = Main.layoutManager.getWorkAreaForMonitor(monitor);
            const width = Math.min(saved.width, area.width);
            const height = Math.min(saved.height, area.height);
            const x = Math.max(area.x, Math.min(saved.x, area.x + area.width - width));
            const y = Math.max(area.y, Math.min(saved.y, area.y + area.height - height));
            this._animations.move(window, {x, y, width, height}, () => {
                this._unmaximize(window, false);
                window.move_to_monitor(monitor);
                window.move_frame(true, x, y);
                window.move_resize_frame(true, x, y, width, height);
            });
            if (saved.zone)
                this._placements.set(window, saved.zone);
            else
                this._placements.delete(window);
            if (!saved.hadOriginal)
                this._originals.delete(window);
            this._maximizedFrom.delete(window);
            if (saved.zone && saved.zone !== 'center' && saved.zone !== 'maximize')
                this.rememberTile(window, {x, y, width, height});
        } else {
            const rect = window.get_frame_rect();
            this._maximizedFrom.set(window, {x: rect.x, y: rect.y, width: rect.width, height: rect.height,
                monitor: window.get_monitor(), zone: this._placements.get(window), hadOriginal: this._originals.has(window)});
            this.apply(window, 'maximize');
        }
    }

    _skipEffect(window) {
        const actor = window.get_compositor_private();
        if (actor) Main.wm.skipNextEffect(actor);
    }

    _maximize(window, animate = true) {
        if (window.maximized_horizontally && window.maximized_vertically) return;
        if (!animate) this._skipEffect(window);
        if (window.maximize.length === 0) window.maximize();
        else window.maximize(Meta.MaximizeFlags.BOTH);
    }

    _unmaximize(window, animate = true) {
        if (!window.maximized_horizontally && !window.maximized_vertically) return;
        if (!animate) this._skipEffect(window);
        if (window.unmaximize.length === 0)
            window.unmaximize();
        else
            window.unmaximize(Meta.MaximizeFlags.BOTH);
    }

    rememberTile(window, rect) {
        this._tiles.set(window, rectCopy(rect));
        if (!this._tileSignals.has(window))
            this._tileSignals.set(window, window.connect('unmanaged', () => this.forgetTile(window)));
    }

    forgetTile(window) {
        this._tiles.delete(window);
        const id = this._tileSignals.get(window);
        if (id) { window.disconnect(id); this._tileSignals.delete(window); }
    }

    resizeCandidates(active) {
        const monitor = active.get_monitor();
        const workspace = active.get_workspace();
        const area = Main.layoutManager.getWorkAreaForMonitor(monitor);
        const gap = this._settings.get_int('window-gap');
        const same = (a, b) => ['x', 'y', 'width', 'height'].every(key => Math.abs(a[key] - b[key]) <= 8);
        const eligible = window => {
            if (!canTile(window) || window.minimized || window.get_monitor() !== monitor ||
                !window.located_on_workspace(workspace) || window.maximized_horizontally || window.maximized_vertically) return false;
            const rect = window.get_frame_rect();
            const stored = this._tiles.get(window);
            return stored ? same(rect, stored) : Object.keys(ZONES).filter(zone => !['maximize', 'center'].includes(zone))
                .some(zone => same(rect, zoneRect(area, zone, gap)));
        };
        if (!eligible(active)) return [];
        const windows = [active, ...global.display.sort_windows_by_stacking(workspace.list_windows()).reverse()
            .filter(window => window !== active && eligible(window))];
        const tiles = [];
        for (const window of windows) {
            const rect = rectCopy(window.get_frame_rect());
            if (tiles.some(tile => Math.min(rect.x + rect.width, tile.rect.x + tile.rect.width) - Math.max(rect.x, tile.rect.x) > 4 &&
                Math.min(rect.y + rect.height, tile.rect.y + tile.rect.height) - Math.max(rect.y, tile.rect.y) > 4)) continue;
            const [minWidth, minHeight] = window.get_min_size?.() ?? [64, 64];
            const [maxWidth, maxHeight] = window.get_max_size?.() ?? [0, 0];
            tiles.push({window, rect, minWidth: Math.max(64, minWidth), minHeight: Math.max(64, minHeight), maxWidth, maxHeight});
        }
        return tiles;
    }

    finishAnimations() { this._animations.finishAll(); }

    destroy() {
        this._animations.destroy();
        for (const window of [...this._tiles.keys()]) this.forgetTile(window);
    }
}

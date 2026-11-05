import {ACTIONS, directionalMonitor, zoneRect, ZONES} from '../lib/layouts.js';

export function defaultSettings() {
    const keys = {Left: 'Left', Right: 'Right', Up: 'Up', Down: 'Down', Return: 'Enter', space: 'Space'};
    return {gap: 8, dragPicker: true, edgeSnap: true, openAtLogin: true,
        shortcuts: Object.fromEntries(ACTIONS.map(([id, , , accelerator]) => {
            const key = accelerator.replace('<Super><Alt>', '');
            return [id, `Control+Alt+${keys[key] ?? key.toUpperCase()}`];
        }))};
}

export function validateSettings(value) {
    const defaults = defaultSettings();
    if (!value || !Number.isInteger(value.gap) || value.gap < 0 || value.gap > 64)
        throw new Error('Gap must be an integer between 0 and 64.');
    for (const key of ['dragPicker', 'edgeSnap', 'openAtLogin'])
        if (typeof value[key] !== 'boolean') throw new Error(`Invalid setting: ${key}`);
    const shortcuts = {};
    for (const id of Object.keys(defaults.shortcuts)) {
        const accelerator = value.shortcuts?.[id];
        if (typeof accelerator !== 'string' || accelerator.length > 100 ||
            (accelerator !== '' && !/^(?:(?:Control|Ctrl|Alt|Option|Shift|Super|Command|Cmd|CommandOrControl)\+)+(?:[A-Z0-9]|Left|Right|Up|Down|Enter|Space|Tab|F(?:[1-9]|1[0-9]|2[0-4]))$/i.test(accelerator)))
            throw new Error(`Invalid shortcut: ${id}`);
        shortcuts[id] = accelerator;
    }
    const enabled = Object.values(shortcuts).filter(Boolean).map(key => key.toLowerCase());
    if (new Set(enabled).size !== enabled.length) throw new Error('Shortcuts must be unique.');
    return {gap: value.gap, dragPicker: value.dragPicker, edgeSnap: value.edgeSnap,
        openAtLogin: value.openAtLogin, shortcuts};
}

export function sameRect(a, b, tolerance = 3) {
    return !!a && !!b && ['x', 'y', 'width', 'height'].every(key => Math.abs(a[key] - b[key]) <= tolerance);
}

export function monitorFor(rect, monitors) {
    let best = 0;
    let score = -Infinity;
    monitors.forEach((monitor, index) => {
        const intersection = Math.max(0, Math.min(rect.x + rect.width, monitor.x + monitor.width) - Math.max(rect.x, monitor.x)) *
            Math.max(0, Math.min(rect.y + rect.height, monitor.y + monitor.height) - Math.max(rect.y, monitor.y));
        const distance = Math.hypot(rect.x + rect.width / 2 - monitor.x - monitor.width / 2,
            rect.y + rect.height / 2 - monitor.y - monitor.height / 2);
        const value = intersection > 0 ? intersection : -distance;
        if (value > score) { best = index; score = value; }
    });
    return best;
}

// Coordinates use logical pixels, matching macOS accessibility points.
export class TilingController {
    placements = new Map();

    plan(window, action, monitors, gap = 8, destination = null) {
        if (!window || !window.resizable || window.fullscreen || !monitors.length)
            throw new Error('Select a movable, resizable window first.');
        const key = `${window.pid}:${window.id}`;
        const saved = this.placements.get(key);
        const previous = sameRect(window.rect, saved?.rect) ? saved : null;
        let monitor = destination ?? monitorFor(window.rect, monitors);
        if (!monitors[monitor]) throw new Error('The selected monitor is no longer connected.');
        let zone = action;
        if (action === 'toggle-maximize') {
            if (previous?.zone === 'maximize')
                return {window, rect: previous.restore, zone: null, key, restore: previous.restore};
            zone = 'maximize';
        } else if (action === 'next-monitor') {
            monitor = (monitor + 1) % monitors.length;
            zone = previous?.zone ?? 'center';
        } else if (destination === null && previous?.zone === action && ['left', 'right', 'top', 'bottom'].includes(action)) {
            const direction = {top: 'up', bottom: 'down'}[action] ?? action;
            const next = directionalMonitor(monitors, monitor, direction);
            if (next) {
                monitor = next.monitor;
                zone = {left: 'right', right: 'left', top: 'bottom', bottom: 'top'}[action];
            }
        }
        if (!Object.hasOwn(ZONES, zone)) throw new Error('Unknown layout.');
        const area = monitors[monitor].workArea ?? monitors[monitor];
        return {window, rect: zoneRect(area, zone, zone === 'maximize' ? 0 : gap), zone, key,
            restore: previous?.zone === 'maximize' ? previous.restore : window.rect};
    }

    commit(plan, actualRect = plan.rect) {
        if (this.placements.size > 256) this.placements.delete(this.placements.keys().next().value);
        this.placements.set(plan.key, {...plan, rect: actualRect});
    }
}

// A mouse press alone is insufficient: only a moving window starts a drag.
export class DragTracker {
    previous = null;
    dragging = null;

    update(snapshot) {
        const old = this.previous;
        this.previous = snapshot;
        if (!snapshot.mouseDown) {
            const released = this.dragging;
            this.dragging = null;
            return released ? {type: 'release', window: released} : null;
        }
        const window = snapshot.window;
        if (!window || !window.resizable || window.fullscreen) return null;
        if (old?.mouseDown && old.window?.id === window.id && old.window.pid === window.pid &&
            !sameRect(old.window.rect, window.rect, 0) &&
            Math.abs(old.window.rect.width - window.rect.width) <= 3 &&
            Math.abs(old.window.rect.height - window.rect.height) <= 3)
            this.dragging = window;
        return this.dragging ? {type: 'drag', window: this.dragging} : null;
    }
}

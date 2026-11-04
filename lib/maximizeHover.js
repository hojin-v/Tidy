import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {contains} from './layouts.js';
import {withinHoverPicker} from './pickerGeometry.js';
import {canTile} from './windowManager.js';
import {MaximizeButtonLocator} from './maximizeButton.js';

const now = () => GLib.get_monotonic_time() / 1000;

export class MaximizeHover {
    constructor({picker, scaleFor, onSelect, available, onOpen = () => {}, onClose = () => {}}) {
        this.picker = picker;
        this._scaleFor = scaleFor;
        this._onSelect = onSelect;
        this._available = available;
        this._onOpen = onOpen;
        this._onClose = onClose;
        this._locator = new MaximizeButtonLocator();
        this._source = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            this._poll();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _windowAt(x, y) {
        const windows = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, global.workspace_manager.get_active_workspace());
        return global.display.sort_windows_by_stacking(windows).reverse().find(window =>
            !window.minimized && window.showing_on_its_workspace() && contains(window.get_frame_rect(), x, y));
    }

    _poll() {
        const [x, y, modifiers] = global.get_pointer();
        const buttons = Clutter.ModifierType.BUTTON1_MASK | Clutter.ModifierType.BUTTON2_MASK |
            Clutter.ModifierType.BUTTON3_MASK | Clutter.ModifierType.BUTTON4_MASK | Clutter.ModifierType.BUTTON5_MASK;
        if (!this._available() || Main.modalCount > 0) {
            this.close(true);
            return;
        }
        if (modifiers & buttons) {
            // Preserve the pressed cell until its button-release/click event.
            // Closing on every mouse-down would drop slower, deliberate clicks.
            if (this._active && this.picker.contains(x, y)) return;
            this.close(true);
            return;
        }
        if (this._active) {
            const active = this._active;
            const frame = active.window.get_frame_rect();
            if (!canTile(active.window) || !active.window.get_compositor_private() ||
                ['x', 'y', 'width', 'height'].some(key => frame[key] !== active.frame[key])) {
                this.close();
                return;
            }
            if (withinHoverPicker(active.anchor, this.picker._bounds, x, y)) this._leftAt = 0;
            else if (!this._leftAt) this._leftAt = now();
            else if (now() - this._leftAt >= 250) this.close();
            return;
        }
        if (this._suppressed && contains(this._suppressed, x, y)) return;
        this._suppressed = null;
        const window = this._windowAt(x, y);
        if (!canTile(window) || !window.can_maximize() || y > window.get_frame_rect().y + 80) {
            this._candidate = null;
            return;
        }
        const frame = window.get_frame_rect();
        let candidate = this._candidate;
        if (candidate?.window !== window || Math.hypot(x - candidate.x, y - candidate.y) > 4 ||
            ['x', 'y', 'width', 'height'].some(key => candidate.frame[key] !== frame[key])) {
            candidate = {window, frame, x, y, since: now(), checked: false};
            this._candidate = candidate;
        }
        if (candidate.button && contains(candidate.button, x, y) && now() - candidate.since >= 350) {
            this.open(window, candidate.button);
        } else if (!this._checking && !candidate.checked && now() - candidate.since >= 150) {
            this._checking = true;
            this._locator.locate(window, x, y).then(button => {
                if (this._candidate !== candidate || this._destroyed) return;
                candidate.button = button;
                candidate.checked = true;
            }).finally(() => { this._checking = false; });
        }
    }

    open(window, anchor) {
        this.close();
        const monitor = window.get_monitor();
        this._active = {window, anchor, monitor, frame: window.get_frame_rect()};
        this.picker.show(monitor, {anchor, scale: this._scaleFor(monitor)});
        this._onOpen();
    }

    select(zone, zones) {
        if (!this._active) return;
        const {window, monitor} = this._active;
        this.close();
        this._onSelect(window, zone, monitor, zones);
    }

    close(suppress = false) {
        const wasOpen = Boolean(this._active);
        if (suppress && this._active) this._suppressed = this._active.anchor;
        this._candidate = null;
        this._active = null;
        this._leftAt = 0;
        this.picker.hide(true);
        if (wasOpen) this._onClose();
    }

    destroy() {
        this._destroyed = true;
        GLib.Source.remove(this._source);
        this.close();
        this._locator.destroy();
    }
}

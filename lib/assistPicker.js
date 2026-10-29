import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {_} from './i18n.js';
import {contains, zoneRect} from './layouts.js';
import {canTile} from './windowManager.js';

// Only the unfilled layout regions have visible surfaces. The transparent
// input actor lets a click anywhere else finish without moving another window.
export class AssistPicker {
    constructor(excluded, zones, monitor, gap, onSelect, onClose, onEvent) {
        this._excluded = new Set(excluded);
        this._zones = [...zones];
        this._monitor = monitor;
        this._gap = gap;
        this._onSelect = onSelect;
        this._onClose = onClose;
        this._tracker = Shell.WindowTracker.get_default();
        this._signals = [];
        this.regions = [];
        this.actor = new St.Widget({reactive: true, visible: false});
        // Clutter grabs can bypass the stage's capture phase. Handle bubbled
        // events here as well so Escape and outside clicks always dismiss.
        this.actor.connect('event', (_actor, event) => onEvent(event));
        this.actor.add_constraint(new Clutter.BindConstraint({source: global.stage, coordinate: Clutter.BindCoordinate.ALL}));
    }

    _candidates() {
        const workspace = global.workspace_manager.get_active_workspace();
        const windows = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, workspace).filter(window =>
            !this._excluded.has(window) && canTile(window) && window.get_compositor_private());
        const apps = new Set();
        return windows.flatMap(window => {
            const app = this._tracker.get_window_app(window);
            const key = app?.get_id() ?? window;
            if (apps.has(key)) return [];
            apps.add(key);
            return [{window, app}];
        });
    }

    _render() {
        for (const [window, signal] of this._signals) window.disconnect(signal);
        this._signals = [];
        this.actor.destroy_all_children();
        this.regions = [];
        const candidates = this._candidates();
        if (!candidates.length || !this._zones.length) return false;
        const area = Main.layoutManager.getWorkAreaForMonitor(this._monitor);
        for (const zone of this._zones) {
            const rect = zoneRect(area, zone, this._gap);
            const region = new St.Widget({...rect, reactive: true, clip_to_allocation: true,
                style_class: 'wintiling-assist-region', layout_manager: new Clutter.BinLayout()});
            const columns = Math.max(1, Math.min(candidates.length, Math.floor((rect.width - 32) / 76)));
            const rows = new St.BoxLayout({vertical: true, style_class: 'wintiling-assist-grid'});
            const scroll = new St.ScrollView({x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
                width: Math.max(1, Math.min(rect.width - 16, columns * 76 - 12)),
                height: Math.max(1, Math.min(rect.height - 16, Math.ceil(candidates.length / columns) * 76 - 12)),
                hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC});
            scroll.set_child(rows);
            region.add_child(scroll);
            const buttons = [];
            let row;
            candidates.forEach(({window, app}, index) => {
                if (index % columns === 0) {
                    row = new St.BoxLayout({style_class: 'wintiling-assist-row'});
                    rows.add_child(row);
                }
                const button = new St.Button({style_class: 'wintiling-assist-app', width: 64, height: 64,
                    can_focus: true, reactive: true,
                    accessible_name: `${app?.get_name() ?? _('Window')}: ${window.get_title() ?? ''}`});
                button.set_child(app?.create_icon_texture(44) ?? new St.Icon({icon_name: 'application-x-executable-symbolic', icon_size: 44}));
                button.connect('clicked', () => this._select(window, zone));
                row.add_child(button);
                buttons.push({button, window});
            });
            this.actor.add_child(region);
            this.regions.push({actor: region, zone, rect, buttons});
        }
        for (const {window} of candidates) {
            this._signals.push([window, window.connect('unmanaged', () => this._refreshLater())]);
        }
        if (this._grab) this.regions[0].buttons[0].button.grab_key_focus();
        return true;
    }

    _refreshLater() {
        if (this._refreshId || this._destroyed) return;
        this._refreshId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._refreshId = 0;
            if (!this._render()) this.destroy();
            return GLib.SOURCE_REMOVE;
        });
    }

    _select(window, zone) {
        if (this._destroyed) return;
        if (!this._excluded.has(window) && canTile(window) && window.get_compositor_private() && this._onSelect(window, zone)) {
            this._excluded.add(window);
            this._zones = this._zones.filter(other => other !== zone);
        }
        if (!this._render()) this.destroy();
    }

    open() {
        if (!this._render()) return false;
        Main.layoutManager.addTopChrome(this.actor);
        this.actor.opacity = 0;
        this.actor.show();
        this._grab = Main.pushModal(this.actor, {actionMode: Shell.ActionMode.NORMAL});
        this.actor.ease({opacity: 255, duration: 160, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        this.regions[0].buttons[0].button.grab_key_focus();
        return true;
    }

    hit(x, y) {
        return this.regions.some(region => region.buttons.some(({button}) => {
            if (!button.mapped) return false;
            const [bx, by] = button.get_transformed_position();
            const [width, height] = button.get_transformed_size();
            return contains({x: bx, y: by, width, height}, x, y);
        }));
    }

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        if (this._refreshId) GLib.Source.remove(this._refreshId);
        this._refreshId = 0;
        for (const [window, signal] of this._signals) window.disconnect(signal);
        this._signals = [];
        if (this._grab) Main.popModal(this._grab);
        this._grab = null;
        this.actor.remove_all_transitions();
        this.actor.destroy();
        this.regions = [];
        this._onClose();
    }
}

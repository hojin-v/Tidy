import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {assistGrid, fitThumbnail} from './assistGeometry.js';
import {_} from './i18n.js';
import {contains, zoneRect} from './layouts.js';
import {canTile} from './windowManager.js';
import {windowSurface} from './windowSurface.js';

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
        return windows.map(window => ({window, app: this._tracker.get_window_app(window)}));
    }

    _connect(object, signal, callback) {
        this._signals.push([object, object.connect(signal, callback)]);
    }

    _disconnectSignals() {
        for (const [object, signal] of this._signals) object.disconnect(signal);
        this._signals = [];
    }

    _title(window, app) {
        return window.get_title() || app?.get_name() || _('Window');
    }

    _button(window, app, zone, grid, scale) {
        const button = new St.Button({style_class: 'wintiling-assist-window',
            width: grid.cardWidth, height: grid.cardHeight, can_focus: true, reactive: true,
            accessible_name: `${app?.get_name() ?? _('Window')}: ${this._title(window, app)}`});
        const content = new St.BoxLayout({vertical: true, style_class: 'wintiling-assist-content'});
        const preview = new St.Widget({width: grid.previewWidth, height: grid.previewHeight,
            clip_to_allocation: true, style_class: 'wintiling-assist-thumbnail'});
        const source = windowSurface(window, fitThumbnail(window.get_frame_rect(), grid.previewWidth, grid.previewHeight));
        if (!source) {
            button.destroy();
            content.destroy();
            preview.destroy();
            return null;
        }
        preview.add_child(source.clone);
        content.add_child(preview);
        const caption = new St.BoxLayout({style_class: 'wintiling-assist-caption', width: grid.previewWidth, height: 24 * scale});
        caption.add_child(app?.create_icon_texture(20) ?? new St.Icon({icon_name: 'application-x-executable-symbolic', icon_size: 20}));
        const title = new St.Label({style_class: 'wintiling-assist-title', text: this._title(window, app),
            x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        title.clutter_text.single_line_mode = true;
        caption.add_child(title);
        content.add_child(caption);
        button.set_child(content);
        button.connect('clicked', () => this._select(window, zone));
        return {button, window, title, preview, ...source};
    }

    _render() {
        const focusedRegion = this.regions.find(region => region.buttons.some(({button}) => button.has_key_focus()));
        const focusedWindow = focusedRegion?.buttons.find(({button}) => button.has_key_focus()).window;
        this._disconnectSignals();
        this.actor.destroy_all_children();
        this.regions = [];
        const candidates = this._candidates();
        if (!candidates.length || !this._zones.length) return false;
        const area = Main.layoutManager.getWorkAreaForMonitor(this._monitor);
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        for (const zone of this._zones) {
            const rect = zoneRect(area, zone, this._gap);
            const region = new St.Widget({...rect, reactive: true, clip_to_allocation: true,
                style_class: 'wintiling-assist-region', layout_manager: new Clutter.BinLayout()});
            const grid = assistGrid(candidates.length, rect.width, rect.height, scale);
            const rows = new St.BoxLayout({vertical: true, style_class: 'wintiling-assist-grid'});
            const scroll = new St.ScrollView({x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
                width: grid.viewportWidth, height: grid.viewportHeight,
                hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC});
            scroll.set_child(rows);
            region.add_child(scroll);
            const buttons = [];
            let row;
            candidates.forEach(({window, app}, index) => {
                if (index % grid.columns === 0) {
                    row = new St.BoxLayout({style_class: 'wintiling-assist-row'});
                    rows.add_child(row);
                }
                const entry = this._button(window, app, zone, grid, scale);
                if (!entry) return;
                entry.button.connect('key-focus-in', () => {
                    const adjustment = scroll.vadjustment;
                    const y = entry.button.get_parent().y + entry.button.y;
                    adjustment.value = Math.max(y + entry.button.height - adjustment.page_size,
                        Math.min(y, adjustment.value));
                });
                row.add_child(entry.button);
                buttons.push(entry);
            });
            if (!buttons.length) {
                region.destroy();
                continue;
            }
            this.actor.add_child(region);
            this.regions.push({actor: region, zone, rect, buttons, scroll});
        }
        if (!this.regions.length) return false;
        for (const {window, app} of candidates) {
            const entries = this.regions.flatMap(region => region.buttons.filter(entry => entry.window === window));
            this._connect(window, 'unmanaged', () => {
                this._excluded.add(window);
                this._refreshLater();
            });
            this._connect(window, 'notify::title', () => {
                for (const {button, title} of entries) {
                    title.text = this._title(window, app);
                    button.accessible_name = `${app?.get_name() ?? _('Window')}: ${title.text}`;
                }
            });
            this._connect(window, 'size-changed', () => {
                for (const {clone, preview} of entries) {
                    const fitted = fitThumbnail(window.get_frame_rect(), preview.width, preview.height);
                    clone.set_position(fitted.x, fitted.y);
                    clone.set_size(fitted.width, fitted.height);
                }
            });
        }
        const workspace = global.workspace_manager.get_active_workspace();
        this._connect(workspace, 'window-added', () => this._refreshLater());
        this._connect(workspace, 'window-removed', () => this._refreshLater());
        // window-added can precede the compositor actor becoming available.
        this._connect(global.window_manager, 'map', () => this._refreshLater());
        if (this._grab) {
            const region = this.regions.find(candidate => candidate.zone === focusedRegion?.zone) ?? this.regions[0];
            const entry = region.buttons.find(candidate => candidate.window === focusedWindow) ?? region.buttons[0];
            entry.button.grab_key_focus();
        }
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
        // Include the scrollbar, and exclude portions of cards clipped by it.
        return this.regions.some(({scroll}) => {
            if (!scroll.mapped) return false;
            const [bx, by] = scroll.get_transformed_position();
            const [width, height] = scroll.get_transformed_size();
            return contains({x: bx, y: by, width, height}, x, y);
        });
    }

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        if (this._refreshId) GLib.Source.remove(this._refreshId);
        this._refreshId = 0;
        this._disconnectSignals();
        if (this._grab) Main.popModal(this._grab);
        this._grab = null;
        this.actor.remove_all_transitions();
        this.actor.destroy();
        this.regions = [];
        this._onClose();
    }
}

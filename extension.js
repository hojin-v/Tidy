import {_} from './lib/i18n.js';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {ACTIONS, companionZones, dragIntent, monitorAt, zoneRect} from './lib/layouts.js';
import {SettingsLease} from './lib/overrides.js';
import {canTile, WindowTiler} from './lib/windowManager.js';
import {DragPalette, LayoutDialog} from './lib/ui.js';
import {AssistPicker} from './lib/assistPicker.js';
import {SharedResize} from './lib/sharedResize.js';
import {OverviewTransition} from './lib/overviewTransition.js';
import {OverviewDrag} from './lib/overviewDrag.js';
import {DisplayConfig} from './lib/displayConfig.js';

export default class Tidy extends Extension {
    openPreferences() {
        Gio.Subprocess.new(['gjs', '-m', `${this.path}/lib/preferencesApp.js`], Gio.SubprocessFlags.NONE);
    }

    enable() {
        this._settings = this.getSettings();
        this._interactionSerial = 0;
        this._sources = new Set();
        this._signals = [];
        this._tiler = new WindowTiler(this._settings);
        this._overviewTransition = new OverviewTransition();
        this._overviewDrag = new OverviewDrag();
        this._displayConfig = new DisplayConfig(() => {
            if (this._superPicker && !this._overviewDrag.entry) this._configureSuperKey();
        });
        this._sharedResize = new SharedResize(this._settings, this._tiler);
        this._lease = new SettingsLease(this._settings);
        this._palette = new DragPalette((zone, zones) => {
            const picker = this._superPicker;
            if (!picker) return;
            this._chooseOverviewLayout(picker.window, zone, picker.monitor, zones);
        }, target => {
            if (!this._superPicker) return;
            if (Main.overview.visible) return;
            if (target) {
                const area = Main.layoutManager.getWorkAreaForMonitor(this._superPicker.monitor);
                this._palette.showPreview(zoneRect(area, target.zone, target.zone === 'maximize' ? 0 : this._settings.get_int('window-gap')));
            } else this._palette.hidePreview();
        });
        this._lease.set('org.gnome.mutter', 'edge-tiling', new GLib.Variant('b', false));
        for (const [schema, key, owned] of [
            ['org.gnome.desktop.wm.keybindings', 'switch-to-workspace-left', '<Super><Alt>Left'],
            ['org.gnome.desktop.wm.keybindings', 'switch-to-workspace-right', '<Super><Alt>Right'],
            ['org.gnome.shell.keybindings', 'shift-overview-up', '<Super><Alt>Up'],
            ['org.gnome.shell.keybindings', 'shift-overview-down', '<Super><Alt>Down'],
        ]) {
            const system = new Gio.Settings({schema_id: schema});
            if (system.settings_schema.has_key(key))
                this._lease.set(schema, key, new GLib.Variant('as', system.get_strv(key).filter(binding => binding !== owned)));
        }
        this._bindings = [];
        for (const [key, , action] of ACTIONS) {
            Main.wm.addKeybinding(key, this._settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                Shell.ActionMode.NORMAL, () => this._action(action));
            this._bindings.push(key);
        }
        this._connect(global.display, 'grab-op-begin', (_display, window, op) => {
            this._overviewTransition.cancel();
            this._sharedResize.begin(window, op);
            if ((op & ~1024) === Meta.GrabOp.MOVING && canTile(window))
                this._beginDrag(window);
        });
        this._connect(global.display, 'grab-op-end', (_display, window) => {
            this._sharedResize.end(window);
            if (this._drag?.window === window)
                this._endDrag();
        });
        this._connect(global.display, 'accelerator-activated', (_display, action) => {
            if (action === this._escapeAction)
                this._dismiss();
        });
        this._connect(Main.layoutManager, 'monitors-changed', () => {
            this._sharedResize.end();
            this._dismiss();
            this._displayConfig.refresh();
        });
        this._connect(Main.overview, 'showing', () => {
            this._dismiss();
            this._showOverviewPicker();
        });
        this._connect(Main.overview, 'hiding', () => this._closeSuperPicker());
        this._connect(Main.overview, 'window-drag-cancelled', () => {
            this._clearOverviewDrop();
            this._palette.clearSelection();
        });
        this._connect(Main.overview, 'window-drag-begin', (_overview, window) => {
            this._overviewDrag.beginWindow(window);
        });
        this._connect(Main.overview, 'window-drag-end', () => {
            this._overviewDrag.end();
            this._palette.clearSelection();
        });
        this._connect(Main.overview, 'item-drag-begin', (_overview, source) => {
            if (Main.overview.visible) this._overviewDrag.beginItem(source);
        });
        this._connect(Main.overview, 'item-drag-end', () => this._overviewDrag.end());
        this._connect(Main.overview, 'hidden', () => {
            this._restoreOverviewSpace();
            const pending = this._overviewPlacement;
            this._overviewPlacement = null;
            if (pending) this._later(() => {
                if (pending.serial === this._interactionSerial && canTile(pending.window)) {
                    Main.activateWindow(pending.window);
                    this._overviewTransition.complete(pending.transition);
                    this._offerAssist(pending.window, pending.zone, pending.monitor, pending.zones, pending.serial);
                } else this._overviewTransition.cancel();
            });
        });
        this._connect(Main.sessionMode, 'updated', () => this._dismiss());
        this._connect(global.stage, 'captured-event', (_stage, event) => this._onCapturedEvent(event));
        this._connect(this._settings, 'changed::top-edge-enabled', () => this._cancelDrag());
        this._connect(this._settings, 'changed::resize-together', () => this._sharedResize.end());
        this._connect(this._settings, 'changed::super-key-picker', () => this._configureSuperKey());
        this._connect(this._settings, 'changed::picker-scale', () => {
            if (this._superPicker) this._configureSuperKey();
            else this._cancelDrag();
        });
        this._connect(this._settings, 'changed::overview-picker-scale', () => {
            if (this._superPicker) this._configureSuperKey();
        });
        this._connect(this._settings, 'changed::auto-picker-scale', () => {
            if (this._superPicker) this._configureSuperKey();
            else this._cancelDrag();
        });
        this._connect(this._settings, 'changed::disable-native-tiling-shortcuts', () => this._configureNativeShortcuts());
        this._configureNativeShortcuts();
        this._configureSuperKey();
        this._createIndicator();
    }

    _connect(object, signal, callback) {
        this._signals.push([object, object.connect(signal, callback)]);
    }

    _onCapturedEvent(event) {
        if (this._assist && [Clutter.EventType.BUTTON_PRESS, Clutter.EventType.TOUCH_BEGIN].includes(event.type())) {
            const [x, y] = event.get_coords();
            if (!this._assist.hit(x, y)) {
                this._interactionSerial++;
                this._closeAssist();
                return Clutter.EVENT_STOP;
            }
        }
        if (this._superPicker && Main.overview.visible)
            return Clutter.EVENT_PROPAGATE;
        if (event.type() === Clutter.EventType.KEY_PRESS && event.get_key_symbol() === Clutter.KEY_Escape &&
            (this._drag || this._dialog || this._assist || this._palette.actor.visible || this._palette.preview.visible)) {
            const propagate = Boolean(this._drag) || Main.overview.visible;
            this._dismiss();
            return propagate ? Clutter.EVENT_PROPAGATE : Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _later(callback, delay = 0) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(1, delay), () => {
            this._sources.delete(id);
            callback();
            return GLib.SOURCE_REMOVE;
        });
        this._sources.add(id);
        return id;
    }

    _createIndicator() {
        this._indicator = new PanelMenu.Button(0.0, 'Tidy');
        this._indicator.add_child(new St.Icon({icon_name: 'view-grid-symbolic', style_class: 'system-status-icon'}));
        this._indicator.menu.addAction(_("Tidy · Choose layout"), () => {
            this._indicator.menu.close();
            this._later(() => this._action('picker'));
        });
        const assist = new PopupMenu.PopupSwitchMenuItem(_("Choose windows for the remaining space"), this._settings.get_boolean('snap-assist'));
        assist.connect('toggled', (_item, enabled) => this._settings.set_boolean('snap-assist', enabled));
        this._indicator.menu.addMenuItem(assist);
        this._connect(this._settings, 'changed::snap-assist', () => {
            this._interactionSerial++;
            assist.setToggleState(this._settings.get_boolean('snap-assist'));
            this._closeDialog();
            this._closeAssist();
        });
        this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._indicator.menu.addAction(_("Settings and shortcuts…"), () => this.openPreferences());
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    _action(action) {
        this._overviewTransition.cancel();
        const serial = ++this._interactionSerial;
        const window = this._superPicker?.window ?? global.display.focus_window;
        this._closeSuperPicker();
        this._closeAssist();
        if (!canTile(window))
            return;
        this._closeDialog();
        if (action === 'restore')
            this._tiler.restore(window);
        else if (action === 'toggle-maximize')
            this._tiler.toggleMaximize(window);
        else if (action === 'next-monitor')
            this._tiler.nextMonitor(window);
        else if (action === 'picker') {
            this._showDialog(new LayoutDialog((zone, zones) => {
                this._later(() => {
                    if (serial === this._interactionSerial)
                        this._place(window, zone, window.get_monitor(), zones);
                }, 180);
            }));
        } else if (['left', 'right', 'top', 'bottom'].includes(action)) {
            const target = this._tiler.directionalTarget(window, action);
            this._place(window, target.zone, target.monitor, [target.zone, ...companionZones(target.zone)], {wrap: target.wrap});
        } else {
            this._place(window, action, window.get_monitor(), [action, ...companionZones(action)]);
        }
    }

    _place(window, zone, monitor, zones, options = {}) {
        this._closeAssist();
        const serial = ++this._interactionSerial;
        if (!window.get_compositor_private() || !this._tiler.apply(window, zone, monitor, options)) {
            this._tiler._animations.restoreDrag(window, true);
            return;
        }
        if (options.assist !== false) this._offerAssist(window, zone, monitor, zones, serial);
    }

    _offerAssist(window, zone, monitor, zones, serial) {
        const remaining = zones.filter(other => other !== zone);
        if (!this._settings.get_boolean('snap-assist') || !remaining.length)
            return;
        this._later(() => {
            if (serial !== this._interactionSerial || !this._settings.get_boolean('snap-assist'))
                return;
            this._closeDialog();
            const assist = new AssistPicker([window], remaining, monitor, this._settings.get_int('window-gap'), (other, target) => {
                if (!this._tiler.apply(other, target, monitor)) return false;
                Main.activateWindow(other);
                return true;
            }, () => {
                if (this._assist === assist) this._assist = null;
            }, event => this._onCapturedEvent(event));
            this._assist = assist;
            if (!assist.open()) this._closeAssist();
        }, 200);
    }

    _beginDrag(window) {
        this._overviewTransition.cancel();
        this._interactionSerial++;
        this._closeSuperPicker();
        this._cancelDrag(true);
        this._closeDialog();
        this._closeAssist();
        this._drag = {window, monitor: -1, enteredAt: 0, selected: null};
        this._tiler._animations.finish(window);
        this._armEscape();
        this._pollDrag();
        if (!this._drag) return;
        this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 32, () => {
            this._pollDrag();
            return this._drag ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
        });
    }

    _pollDrag(releasing = false) {
        if (!this._drag)
            return;
        const [x, y, modifiers] = global.get_pointer();
        // Also finish if Mutter's end notification was missed. A modifier key
        // by itself must never keep this transient selector alive.
        if (!releasing && !(modifiers & Clutter.ModifierType.BUTTON1_MASK)) {
            this._endDrag();
            return;
        }
        const monitor = monitorAt(Main.layoutManager.monitors, x, y);
        if (monitor < 0 || !this._drag.window.get_compositor_private()) {
            this._cancelDrag();
            return;
        }
        if (monitor !== this._drag.monitor) {
            this._palette.hide();
            this._drag.monitor = monitor;
            this._drag.enteredAt = 0;
            this._drag.selected = null;
        }
        const area = Main.layoutManager.getWorkAreaForMonitor(monitor);
        const picker = this._settings.get_boolean('top-edge-enabled');
        const bounds = picker ? this._palette.prepare(monitor, {scale: this._pickerScale(monitor)}) : null;
        const width = this._settings.get_boolean('auto-trigger-width') ? bounds?.width :
            Math.min(this._settings.get_int('trigger-width'), area.width - 24);
        const intent = dragIntent(Main.layoutManager.monitors[monitor], area, x, y, {
            height: this._settings.get_int('trigger-height'), width,
            picker, center: area.x + area.width / 2,
        });
        this._drag.selected = null;
        // Once open, allow selecting every card, beyond the narrow activation
        // strip. Physical top/side edges still take priority outside the menu.
        if (this._palette.isOpen && this._palette.contains(x, y)) {
            this._drag.selected = this._palette.hit(x, y);
        } else if (intent?.type === 'tile') {
            if (picker) this._palette.peek(monitor, {scale: this._pickerScale(monitor), width});
            else this._palette.hidePicker();
            this._drag.enteredAt = 0;
            this._drag.selected = {zone: intent.zone, zones: [intent.zone, ...companionZones(intent.zone)]};
        } else if (intent?.type === 'picker') {
            const now = GLib.get_monotonic_time() / 1000;
            if (!this._drag.enteredAt)
                this._drag.enteredAt = now;
            if (!this._palette.isOpen && now - this._drag.enteredAt >= this._settings.get_int('trigger-delay'))
                this._palette.show(monitor, {scale: this._pickerScale(monitor)});
            else if (!this._palette.isOpen)
                this._palette.peek(monitor, {scale: this._pickerScale(monitor), width});
            if (this._palette.isOpen)
                this._drag.selected = this._palette.hit(x, y);
        } else {
            this._drag.enteredAt = 0;
            if (!this._palette.contains(x, y, 16)) {
                if (picker) this._palette.peek(monitor, {scale: this._pickerScale(monitor), width});
                else this._palette.hidePicker();
            }
        }
        if (this._palette.isOpen && (intent?.type === 'picker' || this._palette.contains(x, y, 16))) {
            this._tiler._animations.previewDrag(this._drag.window, x, y, area);
            // The miniature must stay beneath the choices while still following
            // the native grab. It never receives pointer or drop events.
            const parent = this._palette.actor.get_parent();
            parent.set_child_above_sibling(this._palette.actor, null);
        } else this._tiler._animations.restoreDrag(this._drag.window);
        if (this._drag.selected) {
            this._palette.showPreview(zoneRect(area, this._drag.selected.zone,
                this._drag.selected.zone === 'maximize' ? 0 : this._settings.get_int('window-gap')));
        } else {
            this._palette.hidePreview();
        }
    }

    _endDrag() {
        if (!this._drag)
            return;
        // Sample once more so a release between timer ticks uses the actual cell.
        this._pollDrag(true);
        const drag = this._drag;
        this._cancelDrag(false, Boolean(drag?.selected));
        if (drag?.selected) {
            const {zone, zones} = drag.selected;
            const serial = this._interactionSerial;
            this._later(() => {
                if (serial === this._interactionSerial)
                    this._place(drag.window, zone, drag.monitor, zones);
                else this._tiler._animations.restoreDrag(drag.window);
            });
        }
    }

    _dismiss(keepTransition = null) {
        this._interactionSerial++;
        this._overviewPlacement = null;
        this._overviewTransition.cancel(keepTransition);
        this._closeSuperPicker();
        this._cancelDrag();
        this._closeDialog();
        this._closeAssist();
    }

    _configureSuperKey() {
        this._closeSuperPicker();
        if (!this._settings.get_boolean('super-key-picker'))
            this._restoreOverviewSpace();
        if (Main.overview.visible && !Main.overview.closing)
            this._showOverviewPicker();
    }

    _configureNativeShortcuts() {
        const disabled = this._settings.get_boolean('disable-native-tiling-shortcuts');
        for (const [schema, keys] of [
            ['org.gnome.mutter.keybindings', ['toggle-tiled-left', 'toggle-tiled-right']],
            ['org.gnome.desktop.wm.keybindings', ['maximize', 'unmaximize', 'toggle-maximized']],
        ]) {
            const system = new Gio.Settings({schema_id: schema});
            for (const key of keys) {
                if (!system.settings_schema.has_key(key)) continue;
                if (!disabled) {
                    this._lease.release(schema, key);
                    continue;
                }
                const bindings = system.get_strv(key);
                const filtered = bindings.filter(binding => !/^<(Super|Mod4)>(Left|Right|Up|Down|KP_Left|KP_Right|KP_Up|KP_Down)$/i.test(binding));
                if (filtered.length !== bindings.length)
                    this._lease.set(schema, key, new GLib.Variant('as', filtered));
            }
        }
    }

    _showOverviewPicker() {
        if (this._superPicker || !this._settings.get_boolean('super-key-picker')) return;
        if (this._drag || this._sharedResize._session || !Main.sessionMode.hasWindows || Main.sessionMode.isLocked) return;
        this._tiler.finishAnimations();
        const window = canTile(global.display.focus_window) ? global.display.focus_window :
            global.display.get_tab_list(Meta.TabList.NORMAL_ALL, global.workspace_manager.get_active_workspace()).find(canTile);
        const monitor = window?.get_monitor() ?? Main.layoutManager.primaryIndex;
        if (monitor < 0) return;
        const parent = this._palette.actor.get_parent();
        const index = parent.get_children().indexOf(this._palette.actor);
        // Share GNOME's overview and its stage grab. A separate modal backdrop
        // would swallow clicks on window thumbnails, the dash and app grid.
        parent.remove_child(this._palette.actor);
        Main.layoutManager.overviewGroup.add_child(this._palette.actor);
        this._palette.show(monitor, {scale: this._pickerScale(monitor, true)});
        const controls = Main.overview._overview.controls;
        const search = controls._searchEntryBin;
        if (!this._overviewSearch) {
            const entry = controls._searchEntry;
            const controller = controls._searchController;
            this._overviewSearch = {search, margin: search.margin_top, entry, controller,
                opacity: entry.opacity, reactive: entry.reactive, canFocus: entry.can_focus};
            this._overviewSearch.signal = controller.connect('notify::search-active', () => this._syncOverviewSearch());
        }
        if (monitor === Main.layoutManager.primaryIndex) {
            const [, height] = this._palette.actor.get_preferred_height(-1);
            search.margin_top = this._overviewSearch.margin + height + 24;
        }
        this._superPicker = {window, monitor, parent, index};
        this._syncOverviewSearch();
        this._palette.enableWindowDrops((source, target) => this._acceptOverviewDrop(source, target));
    }

    _pickerScale(monitor, overview = false) {
        const automatic = this._settings.get_boolean('auto-picker-scale') ? this._displayConfig.scaleFor(monitor) : 1;
        return this._settings.get_int('picker-scale') / 100 * automatic *
            (overview ? this._settings.get_int('overview-picker-scale') / 100 : 1);
    }

    _syncOverviewSearch() {
        if (!this._overviewSearch) return;
        const {entry, controller, opacity, reactive, canFocus} = this._overviewSearch;
        const active = controller.searchActive;
        entry.opacity = active ? opacity : 0;
        entry.reactive = active && reactive;
        entry.can_focus = active && canFocus;
    }

    _chooseOverviewLayout(window, zone, monitor, zones, preparedTransition = null) {
        if (!canTile(window) || !window.get_compositor_private()) return;
        const target = zoneRect(Main.layoutManager.getWorkAreaForMonitor(monitor), zone,
            zone === 'maximize' ? 0 : this._settings.get_int('window-gap'));
        const transition = preparedTransition ?? this._overviewTransition.prepare(window, target);
        this._dismiss(transition);
        if (Main.overview.visible) {
            // Commit while the overview is still open, so GNOME doesn't start
            // another maximize/resize effect when its exit animation completes.
            this._place(window, zone, monitor, zones, {animate: false, assist: false});
            this._overviewPlacement = {window, zone, monitor, zones, serial: this._interactionSerial, transition};
            this._overviewTransition.start(transition);
            Main.overview.hide();
        } else {
            const serial = this._interactionSerial;
            this._later(() => {
                if (serial === this._interactionSerial)
                    this._place(window, zone, monitor, zones);
            }, 150);
        }
    }

    _acceptOverviewDrop(source, {zone, zones}) {
        if (!this._superPicker || this._overviewDrop || !canTile(source.metaWindow)) return false;
        const native = source._draggable;
        const dragActor = native?._dragActor;
        const nativeOpacity = dragActor && native._restoreOnSuccess ? native._dragOrigOpacity : undefined;
        const target = zoneRect(Main.layoutManager.getWorkAreaForMonitor(this._superPicker.monitor), zone,
            zone === 'maximize' ? 0 : this._settings.get_int('window-gap'));
        this._overviewDrag.handoff(source);
        const transition = this._overviewTransition.prepare(source.metaWindow, target, {preview: source,
            container: dragActor, restoreOpacity: dragActor === source ? nativeOpacity : undefined});
        const drop = {source, window: source.metaWindow, monitor: this._superPicker.monitor,
            zone, zones, serial: this._interactionSerial, signals: [], transition, nativeOpacity};
        this._overviewDrop = drop;
        const finish = () => {
            if (this._overviewDrop !== drop) return;
            this._clearOverviewDrop(true);
            this._later(() => {
                if (this._superPicker && drop.serial === this._interactionSerial)
                    this._chooseOverviewLayout(drop.window, drop.zone, drop.monitor, drop.zones, drop.transition);
                else this._overviewTransition.cancel();
            });
        };
        if (source.inDrag) {
            drop.signals.push(source.connect('drag-end', finish));
            drop.signals.push(source.connect('destroy', () => this._clearOverviewDrop()));
            if (transition && nativeOpacity !== undefined) {
                // Shell still restores the source actor and releases its DND
                // grab. Its invisible snap-back finishes in one frame instead
                // of showing a separate 750 ms return trip before placement.
                native._dragOrigOpacity = 0;
                this._later(() => {
                    if (this._overviewDrop === drop)
                        dragActor.get_transition('opacity')?.set_duration(1);
                });
            }
        } else {
            this._later(finish);
        }
        return true;
    }

    _clearOverviewDrop(keepTransition = false) {
        const drop = this._overviewDrop;
        if (!drop) return;
        this._overviewDrop = null;
        for (const signal of drop.signals) drop.source.disconnect(signal);
        if (drop.nativeOpacity !== undefined) drop.source._draggable._dragOrigOpacity = drop.nativeOpacity;
        if (!keepTransition && drop.transition) this._overviewTransition.cancel();
    }

    _restoreOverviewSpace() {
        if (!this._overviewSearch) return;
        const {search, margin, entry, controller, signal, opacity, reactive, canFocus} = this._overviewSearch;
        controller.disconnect(signal);
        search.margin_top = margin;
        entry.opacity = opacity;
        entry.reactive = reactive;
        entry.can_focus = canFocus;
        this._overviewSearch = null;
    }

    _closeSuperPicker() {
        this._clearOverviewDrop();
        this._overviewDrag.end();
        if (!this._superPicker) return;
        this._palette.disableWindowDrops();
        const {parent, index} = this._superPicker;
        this._superPicker = null;
        // Keep the overview geometry stable until its exit animation finishes.
        if (!Main.overview.visible)
            this._restoreOverviewSpace();
        this._palette.actor.get_parent().remove_child(this._palette.actor);
        parent.insert_child_at_index(this._palette.actor, index);
        this._palette.hide();
        this._cancelDrag();
    }

    _armEscape() {
        if (this._escapeAction)
            return;
        this._escapeAction = global.display.grab_accelerator('Escape', Meta.KeyBindingFlags.NONE);
        if (this._escapeAction)
            Main.wm.allowKeybinding(Meta.external_binding_name_for_action(this._escapeAction), Shell.ActionMode.ALL);
    }

    _cancelDrag(immediate = false, keepPreview = false) {
        if (this._escapeAction) {
            Main.wm.allowKeybinding(Meta.external_binding_name_for_action(this._escapeAction), Shell.ActionMode.NONE);
            global.display.ungrab_accelerator(this._escapeAction);
            this._escapeAction = 0;
        }
        if (this._pollId) {
            GLib.Source.remove(this._pollId);
            this._pollId = 0;
        }
        if (this._drag && !keepPreview) this._tiler._animations.restoreDrag(this._drag.window, immediate);
        this._drag = null;
        this._palette?.hide(immediate);
    }

    _closeDialog() {
        this._dialog?.destroy();
        this._dialog = null;
    }

    _closeAssist() {
        const assist = this._assist;
        this._assist = null;
        assist?.destroy();
    }

    _showDialog(dialog) {
        this._closeDialog();
        this._closeAssist();
        this._dialog = dialog;
        dialog.connect('destroy', () => {
            if (this._dialog === dialog)
                this._dialog = null;
        });
        if (!dialog.open(global.get_current_time()))
            this._closeDialog();
    }

    disable() {
        this._overviewPlacement = null;
        this._closeSuperPicker();
        this._restoreOverviewSpace();
        this._overviewTransition?.destroy();
        this._overviewDrag?.destroy();
        this._displayConfig?.destroy();
        this._sharedResize?.destroy();
        this._sharedResize = null;
        this._cancelDrag(true);
        this._closeDialog();
        this._closeAssist();
        for (const id of this._sources ?? [])
            GLib.Source.remove(id);
        this._sources?.clear();
        for (const [object, id] of this._signals ?? [])
            object.disconnect(id);
        this._signals = [];
        for (const key of this._bindings ?? [])
            Main.wm.removeKeybinding(key);
        this._bindings = [];
        this._indicator?.destroy();
        this._indicator = null;
        this._palette?.destroy();
        this._palette = null;
        this._lease?.restore();
        this._lease = null;
        this._tiler?.destroy();
        this._tiler = null;
        this._settings = null;
    }
}

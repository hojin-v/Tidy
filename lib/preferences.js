import {_} from './i18n.js';
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ACTIONS} from './layouts.js';

function acceleratorLabel(accelerator) {
    if (!accelerator)
        return _("Unassigned");
    const [valid, key, modifiers] = Gtk.accelerator_parse(accelerator);
    return valid ? Gtk.accelerator_get_label(key, modifiers) : accelerator;
}

export function populatePreferences(window, settings) {
    window.set_default_size(760, 780);
    window.set_title(_("Tidy Settings"));
    const page = new Adw.PreferencesPage({title: _("Window tiling"), icon_name: 'view-grid-symbolic'});
    window.add(page);
    const intro = new Adw.PreferencesGroup({title: 'Tidy',
        description: _("Drag a window to the top of the screen and drop it into a layout. Settings take effect immediately.")});
    page.add(intro);
    for (const [key, title, subtitle] of [
        ['resize-together', _("Resize tiled windows together"), _("Drag a shared boundary to resize adjacent windows together. Default: on.")],
        ['super-key-picker', _("Show layouts in the window and app overview"), _("Press Super to open the overview and layouts together. Drag a window thumbnail onto a layout cell. Search appears only when you type. Default: on.")],
        ['disable-native-tiling-shortcuts', _("Disable native Super+arrow tiling"), _("Disable GNOME Super+arrow tiling, maximize and restore shortcuts. Super+Alt and edge dragging remain available. Turn this option off to restore the original shortcuts.")],
        ['top-edge-enabled', _("Top-center layout picker"), _("While dragging, the picker opens at the top center. Other top edges maximize; left and right edges tile halves.")],
        ['auto-picker-scale', _('Adapt picker size to each monitor'), _('Keep the built-in display size and gently enlarge the picker on larger external displays. Your size settings remain the baseline. Default: on.')],
        ['auto-trigger-width', _('Match activation width to picker'), _('The top activation area and drag hint follow the picker width on each monitor. Turn off to use a custom width. Default: on.')],
        ['snap-assist', _("Choose windows for the remaining space"), _("Show running app icons inside empty layout regions. Select an icon to tile its window, or click elsewhere or press Esc to finish. Default: off.")],
    ]) {
        const row = new Adw.SwitchRow({title, subtitle});
        settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        intro.add(row);
    }
    const behavior = new Adw.PreferencesGroup({title: _("Dragging and spacing"),
        description: _("A small hint appears while dragging. Move into the top-center area to reveal layouts and shrink the dragged window. Other top edges and side edges tile directly.")});
    page.add(behavior);
    for (const [key, title, subtitle, min, max, step] of [
        ['picker-scale', _('Layout picker size'), _('Percent. Sizes are limited to fit the monitor.'), 50, 200, 10],
        ['overview-picker-scale', _('Overview picker size'), _('Percent of the normal picker size. 100% keeps both the same size.'), 50, 200, 10],
        ['trigger-height', _("Activation area height"), _("Distance from the top of the monitor work area, in logical pixels"), 24, 200, 8],
        ['trigger-width', _("Activation area width"), _("Width around the top center, in logical pixels"), 120, 800, 20],
        ['trigger-delay', _("Picker delay"), _("Milliseconds · helps prevent accidental activation"), 0, 1000, 50],
        ['window-gap', _("Window gap"), _("Logical pixels · does not apply to maximized windows"), 0, 40, 2],
    ]) {
        const row = new Adw.SpinRow({title, subtitle,
            adjustment: new Gtk.Adjustment({lower: min, upper: max, step_increment: step, page_increment: step * 2})});
        settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
        if (key === 'trigger-width')
            settings.bind('auto-trigger-width', row, 'sensitive', Gio.SettingsBindFlags.GET | Gio.SettingsBindFlags.INVERT_BOOLEAN);
        behavior.add(row);
    }
    const shortcuts = new Adw.PreferencesPage({title: _("Shortcuts"), icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic'});
    window.add(shortcuts);
    const group = new Adw.PreferencesGroup({title: _("Customize your layouts"),
        description: _("All layout shortcuts use Super+Alt. Click a button and press a new combination. Backspace: clear · Esc: cancel.")});
    shortcuts.add(group);
    const signals = [];
    for (const [key, title] of ACTIONS) {
        const row = new Adw.ActionRow({title: _(title)});
        const button = new Gtk.Button({valign: Gtk.Align.CENTER, css_classes: ['flat']});
        const update = () => button.set_label(settings.get_strv(key).map(acceleratorLabel).join(', ') || _("Unassigned"));
        signals.push(settings.connect(`changed::${key}`, update));
        update();
        button.connect('clicked', () => captureShortcut(window, settings, key, title));
        row.add_suffix(button);
        row.set_activatable_widget(button);
        group.add(row);
    }
    window.connect('close-request', () => {
        for (const id of signals)
            settings.disconnect(id);
        return false;
    });
    const reset = new Adw.PreferencesGroup();
    const resetRow = new Adw.ActionRow({title: _("Restore default shortcuts")});
    const resetButton = new Gtk.Button({label: _("Restore defaults"), valign: Gtk.Align.CENTER});
    resetButton.connect('clicked', () => {
        for (const [key] of ACTIONS)
            settings.reset(key);
    });
    resetRow.add_suffix(resetButton);
    reset.add(resetRow);
    shortcuts.add(reset);
    const help = new Adw.PreferencesGroup({title: _("Usage"),
        description: _("Super + Alt + Arrow: tile to that half\nRepeat Left or Right to move to the monitor in that direction; outer edges wrap to the opposite monitor\nSuper + Alt + Enter: maximize / restore previous layout\nSuper + Alt + Space: layout picker\nSuper + Alt + N: next monitor\n\nUbuntu Tiling Assistant may conflict with tiling and shortcuts. The installer disables it and restores its original state on uninstall.\nApp minimum window sizes may prevent an exact fit.")});
    page.add(help);
}

export function captureShortcut(parent, settings, key, title) {
    const dialog = new Gtk.Window({title: _("Set shortcut"), transient_for: parent, modal: true,
        default_width: 440, default_height: 240, resizable: false});
    const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 18,
        margin_top: 30, margin_bottom: 30, margin_start: 30, margin_end: 30});
    box.append(new Gtk.Label({label: _(title), css_classes: ['title-2']}));
    const message = new Gtk.Label({label: _("Press your new key combination"), wrap: true, justify: Gtk.Justification.CENTER});
    box.append(message);
    box.append(new Gtk.Label({label: _("Backspace to clear · Esc to cancel"), css_classes: ['dim-label']}));
    dialog.set_child(box);
    const controller = new Gtk.EventControllerKey();
    controller.connect('key-pressed', (_controller, keyval, _keycode, state) => {
        if (keyval === Gdk.KEY_Escape) {
            dialog.close();
            return true;
        }
        if (keyval === Gdk.KEY_BackSpace) {
            settings.set_strv(key, []);
            dialog.close();
            return true;
        }
        if ([Gdk.KEY_Control_L, Gdk.KEY_Control_R, Gdk.KEY_Alt_L, Gdk.KEY_Alt_R,
            Gdk.KEY_Super_L, Gdk.KEY_Super_R, Gdk.KEY_Shift_L, Gdk.KEY_Shift_R,
            Gdk.KEY_Meta_L, Gdk.KEY_Meta_R, Gdk.KEY_ISO_Level3_Shift].includes(keyval))
            return true;
        const modifiers = state & Gtk.accelerator_get_default_mod_mask();
        if (!(modifiers & Gdk.ModifierType.ALT_MASK) || !(modifiers & Gdk.ModifierType.SUPER_MASK) ||
            !Gtk.accelerator_valid(keyval, modifiers)) {
            message.set_label(_("Include both Super and Alt in the shortcut."));
            return true;
        }
        const accelerator = Gtk.accelerator_name(Gdk.keyval_to_lower(keyval), modifiers);
        const same = other => {
            const [valid, value, mask] = Gtk.accelerator_parse(other);
            return valid && Gtk.accelerator_name(Gdk.keyval_to_lower(value), mask) === accelerator;
        };
        const duplicate = ACTIONS.find(([other]) => other !== key && settings.get_strv(other).some(same));
        if (duplicate) {
            message.set_label(_('Already used for “{action}”. Clear that shortcut first.', {action: _(duplicate[1])}));
            return true;
        }
        for (const schema of ['org.gnome.desktop.wm.keybindings', 'org.gnome.mutter.keybindings',
            'org.gnome.shell.keybindings', 'org.gnome.settings-daemon.plugins.media-keys']) {
            const system = new Gio.Settings({schema_id: schema});
            const conflict = system.settings_schema.list_keys().find(name => {
                const value = system.get_value(name);
                return value.get_type_string() === 'as' && value.deep_unpack().some(same);
            });
            if (conflict) {
                message.set_label(_('Conflicts with the system shortcut “{shortcut}”. Choose another combination.', {shortcut: conflict}));
                return true;
            }
        }
        settings.set_strv(key, [accelerator]);
        dialog.close();
        return true;
    });
    dialog.add_controller(controller);
    dialog.present();
    return {dialog, controller, message};
}

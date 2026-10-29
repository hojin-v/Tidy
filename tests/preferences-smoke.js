import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import {_} from '../lib/i18n.js';
const {populatePreferences, captureShortcut} = await import('../lib/preferences.js');
Adw.init();
Gtk.init();
const settings = new Gio.Settings({schema_id: 'org.gnome.shell.extensions.winubun'});
const window = new Adw.PreferencesWindow();
populatePreferences(window, settings);

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
    print(`PASS: ${message}`);
}

const mods = Gdk.ModifierType.SUPER_MASK | Gdk.ModifierType.ALT_MASK;
assert(window.title === (GLib.getenv('LANGUAGE') === 'ko' ? 'Tidy 설정' : 'Tidy Settings'),
    'settings window title follows the selected locale');
assert(!settings.get_boolean('snap-assist'), 'GTK preferences use optional assist default');
let capture = captureShortcut(window, settings, 'snap-left', 'Left half / left monitor');
capture.controller.emit('key-pressed', Gdk.KEY_a, 0, 0);
assert(capture.message.label === _('Include both Super and Alt in the shortcut.'), 'plain key is rejected in the selected language');
capture.controller.emit('key-pressed', Gdk.KEY_k, 0, mods);
assert(capture.message.label === _('Already used for “{action}”. Clear that shortcut first.', {action: _('Bottom-right quarter')}),
    'duplicate shortcut and its action name use the selected language');
capture.controller.emit('key-pressed', Gdk.KEY_Escape, 0, 0);
assert(settings.get_strv('snap-left')[0] === '<Super><Alt>Left', 'Escape keeps existing shortcut');
capture = captureShortcut(window, settings, 'snap-left', 'Left half / left monitor');
capture.controller.emit('key-pressed', Gdk.KEY_b, 0, mods);
const [valid, key, mask] = Gtk.accelerator_parse(settings.get_strv('snap-left')[0]);
assert(valid && key === Gdk.KEY_b && mask === mods, 'custom key combination is persisted');
capture = captureShortcut(window, settings, 'snap-left', 'Left half / left monitor');
capture.controller.emit('key-pressed', Gdk.KEY_BackSpace, 0, 0);
assert(settings.get_strv('snap-left').length === 0, 'Backspace disables shortcut');
window.close();
window.destroy();
print('TIDY PREFERENCES SMOKE PASSED');

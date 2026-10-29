import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {SettingsLease} from '../lib/overrides.js';

const settings = new Gio.Settings({schema_id: 'org.gnome.shell.extensions.winubun'});
const desktop = new Gio.Settings({schema_id: 'org.gnome.desktop.wm.keybindings'});
function assert(condition, message) {
    if (!condition)
        throw new Error(message);
    print(`PASS: ${message}`);
}
desktop.reset('maximize');
const initial = desktop.get_value('maximize');
let lease = new SettingsLease(settings);
lease.set('org.gnome.desktop.wm.keybindings', 'maximize', new GLib.Variant('as', []));
assert(desktop.get_strv('maximize').length === 0, 'override is applied');
lease.restore();
assert(desktop.get_user_value('maximize') === null && desktop.get_value('maximize').equal(initial), 'unset original restored as unset');
desktop.set_strv('maximize', ['<Super>m']);
lease = new SettingsLease(settings);
lease.set('org.gnome.desktop.wm.keybindings', 'maximize', new GLib.Variant('as', []));
new SettingsLease(settings);
assert(desktop.get_strv('maximize')[0] === '<Super>m', 'crash journal recovers custom original');
lease = new SettingsLease(settings);
lease.set('org.gnome.desktop.wm.keybindings', 'maximize', new GLib.Variant('as', []));
desktop.set_strv('maximize', ['<Super>x']);
lease.restore();
assert(desktop.get_strv('maximize')[0] === '<Super>x', 'new user changes survive restoration');
assert(settings.get_string('settings-backup') === '[]', 'recovery journal is cleared');
desktop.set_strv('maximize', ['<Super>Up', '<Alt>F10']);
lease = new SettingsLease(settings);
lease.set('org.gnome.desktop.wm.keybindings', 'maximize', new GLib.Variant('as', ['<Alt>F10']));
lease.set('org.gnome.desktop.wm.keybindings', 'maximize', new GLib.Variant('as', []));
lease.set('org.gnome.desktop.wm.keybindings', 'unmaximize', new GLib.Variant('as', []));
lease.release('org.gnome.desktop.wm.keybindings', 'maximize');
assert(desktop.get_strv('maximize').join(',') === '<Super>Up,<Alt>F10', 'selective release restores the first original after repeated overrides');
assert(JSON.parse(settings.get_string('settings-backup')).length === 1, 'selective release keeps unrelated overrides journaled');
lease.restore();
desktop.reset('maximize');

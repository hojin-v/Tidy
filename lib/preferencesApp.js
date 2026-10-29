import {_} from './i18n.js';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {populatePreferences} from './preferences.js';

const extensionDir = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent();
const source = Gio.SettingsSchemaSource.new_from_directory(
    extensionDir.get_child('schemas').get_path(), Gio.SettingsSchemaSource.get_default(), false);
const schema = source.lookup('org.gnome.shell.extensions.winubun', false);
if (!schema)
    throw new Error(_("Tidy settings schema was not found. Please reinstall."));

GLib.set_application_name('Tidy');
const app = new Adw.Application({application_id: 'local.winubun.Settings'});
app.connect('activate', () => {
    if (app.active_window) {
        app.active_window.present();
        return;
    }
    const window = new Adw.PreferencesWindow({application: app});
    populatePreferences(window, new Gio.Settings({settings_schema: schema}));
    window.present();
});
app.run([]);

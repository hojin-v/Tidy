// Exercise migration against a real compositor with a private settings backend.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {_} from '../lib/i18n.js';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async', 'communicate_utf8_finish');
const legacyUuid = 'winubun@winubun.local';
const uuid = 'tidy@hnode.dev';
const read = file => new TextDecoder().decode(file.load_contents(null)[1]);
const assert = (condition, message) => {
    if (!condition) throw new Error(message);
    print(`PASS: ${message}`);
};

export const METRICS = {};

export function init() {
    Main.layoutManager._startInOverview = false;
}

export async function run() {
    await Scripting.sleep(1500);
    Main.overview.hide();
    await Scripting.sleep(250);
    const old = Extension.lookupByUUID(legacyUuid);
    assert(old?._tiler, 'the legacy UUID is initially active in the isolated compositor');
    const settings = old.getSettings();
    settings.set_int('window-gap', 19);
    settings.set_strv('snap-left', ['<Super><Alt>b']);
    settings.set_boolean('disable-native-tiling-shortcuts', true);
    await Scripting.sleep(100);
    const backup = JSON.parse(settings.get_string('settings-backup'));
    assert(backup.length > 0, 'legacy desktop overrides are journaled before migration');
    const root = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent();
    const update = Gio.Subprocess.new(['node', root.get_child('bin/tidy.js').get_path(), 'update'],
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    const [output, errors] = await update.communicate_utf8_async(null, null);
    print(output);
    assert(update.get_successful(), `the new CLI completes UUID migration (${errors})`);
    assert(output.includes(_('[Login required] Log out and log back in to apply the update.')),
        'the update ends with an explicit localized logout/login instruction');
    assert(!old._tiler && !Main.extensionManager.lookup(legacyUuid),
        'migration stops and unregisters the legacy extension instead of running two copies');
    const extensions = Gio.File.new_for_path(`${GLib.get_user_data_dir()}/gnome-shell/extensions`);
    assert(!extensions.get_child(legacyUuid).query_exists(null), 'the old UUID directory has been removed');
    const metadata = JSON.parse(read(extensions.get_child(uuid).get_child('metadata.json')));
    assert(metadata.uuid === uuid && metadata['settings-schema'] === 'org.gnome.shell.extensions.winubun',
        'the installed extension has the new UUID and the original settings schema');
    assert(settings.get_int('window-gap') === 19 && settings.get_strv('snap-left')[0] === '<Super><Alt>b',
        'custom gaps and keyboard shortcuts survive migration');
    assert(settings.get_string('settings-backup') === '[]' && backup.every(entry =>
        (new Gio.Settings({schema_id: entry.schema}).get_user_value(entry.key)?.print(true) ?? null) === entry.original),
        'desktop overrides are restored while the new identity waits for the next login');
    const state = Gio.File.new_for_path(`${GLib.get_user_state_dir()}/winubun`);
    assert(JSON.parse(read(state.get_child('pending-update.json'))).version === metadata.version,
        'the next login is scheduled to activate the new extension version');
    const autostart = Gio.File.new_for_path(`${GLib.get_user_config_dir()}/autostart/winubun-update.desktop`);
    assert(read(autostart).includes(`${uuid}/scripts/manage.py`), 'automatic activation points to the new UUID');
    const status = Gio.Subprocess.new(['node', root.get_child('bin/tidy.js').get_path(), 'status'],
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    const [, notice] = await status.communicate_utf8_async(null, null);
    assert(status.get_successful() && notice.includes(_('[Login required] Log out and log back in to apply the update.')),
        'tidy status also reminds the user that the new identity needs a fresh login');
    print('TIDY UUID MIGRATION SMOKE PASSED');
}

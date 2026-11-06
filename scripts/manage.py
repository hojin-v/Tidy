#!/usr/bin/env python3
"""Build/install Tidy with a recoverable Ubuntu extension handover."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import zipfile
from gi.repository import Gio, GLib
sys.path.insert(0, str(Path(__file__).resolve().parent))
from i18n import _

ROOT = Path(__file__).resolve().parent.parent
UUID = 'tidy@hnode'
LEGACY_UUIDS = ('winubun@winubun.local', 'tidy@hnode.dev')
DATA = Path(os.environ.get('XDG_DATA_HOME', Path.home() / '.local/share'))
STATE = Path(os.environ.get('XDG_STATE_HOME', Path.home() / '.local/state')) / 'winubun'
DEST = DATA / 'gnome-shell/extensions' / UUID
ARCHIVE = ROOT / 'dist' / f'{UUID}.shell-extension.zip'
AUTOSTART = Path(os.environ.get('XDG_CONFIG_HOME', Path.home() / '.config')) / 'autostart/winubun-update.desktop'
COMPETITORS = ['tiling-assistant@ubuntu.com', 'tiling-assistant@leleat-on-github']
RUNTIME_SCRIPTS = ('manage.py', 'i18n.py', 'recover.js')


def shell_call(method, signature=None, values=()):
    """Talk to the compositor without starting the prefs/portal service."""
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    try:
        result = bus.call_sync('org.gnome.Shell', '/org/gnome/Shell',
            'org.gnome.Shell.Extensions', method,
            GLib.Variant(signature, values) if signature else None,
            None, Gio.DBusCallFlags.NONE, 5000, None)
        return result.unpack()
    except GLib.Error as error:
        raise RuntimeError(_('GNOME Shell communication failed ({method}): {error}', method=method, error=error.message)) from error


def extension_info(uuid=UUID):
    return shell_call('GetExtensionInfo', '(s)', (uuid,))[0]


def set_enabled(uuid, enabled):
    result = shell_call('EnableExtension' if enabled else 'DisableExtension', '(s)', (uuid,))
    if not result[0]:
        raise RuntimeError(_('GNOME could not find the extension: {uuid}', uuid=uuid))


def wait_for_extension(uuid, enabled):
    for attempt in range(50):
        info = extension_info(uuid)
        state = info.get('state')
        if (enabled and state == 1) or (not enabled and (not info or state in (2, 6))):
            return
        if state in (3, 4, 99):
            raise RuntimeError(_('Extension transition failed: {uuid}: {error}',
                uuid=uuid, error=info.get('error') or str(state)))
        time.sleep(0.1)
    raise RuntimeError(_('Extension transition timed out: {uuid}', uuid=uuid))


def extension_installed(uuid):
    directories = [DATA, *(Path(path) for path in GLib.get_system_data_dirs())]
    return any((directory / 'gnome-shell/extensions' / uuid / 'extension.js').is_file()
        for directory in directories)


def enable_after_login(uuid):
    # Removing a user override unregisters the UUID for this session even when
    # a system copy remains. Persist the preference without trying to load JS.
    settings = Gio.Settings.new('org.gnome.shell')
    enabled = settings.get_strv('enabled-extensions')
    disabled = settings.get_strv('disabled-extensions')
    changes = {}
    if uuid not in enabled:
        changes['enabled-extensions'] = [*enabled, uuid]
    if uuid in disabled:
        changes['disabled-extensions'] = [item for item in disabled if item != uuid]
    if any(not settings.is_writable(key) for key in changes):
        raise RuntimeError(_('Extension preferences are read-only: {uuid}', uuid=uuid))
    settings.delay()
    for key, value in changes.items():
        if not settings.set_strv(key, value):
            settings.revert()
            raise RuntimeError(_('Could not save extension preferences: {uuid}', uuid=uuid))
    settings.apply()
    Gio.Settings.sync()


def open_preferences():
    STATE.mkdir(parents=True, exist_ok=True)
    with (STATE / 'preferences.log').open('a') as log:
        subprocess.Popen(['/usr/bin/gjs', '-m', str(DEST / 'lib/preferencesApp.js')],
            stdout=log, stderr=log, start_new_session=True)


def schedule_update(version):
    STATE.mkdir(parents=True, exist_ok=True)
    (STATE / 'pending-update.json').write_text(json.dumps({'version': version}))
    AUTOSTART.parent.mkdir(parents=True, exist_ok=True)
    script = str(DEST / 'scripts/manage.py').replace('\\', '\\\\').replace('"', '\\"').replace('`', '\\`').replace('$', '\\$').replace('%', '%%')
    AUTOSTART.write_text('[Desktop Entry]\nType=Application\nName=Tidy update\n'
        f'Exec=/usr/bin/python3 "{script}" apply-update\nTerminal=false\nNoDisplay=true\n')


def finish_update():
    (STATE / 'pending-update.json').unlink(missing_ok=True)
    AUTOSTART.unlink(missing_ok=True)


def print_update_notice(requires_login, stream=None):
    stream = stream or sys.stdout
    print(file=stream)
    if requires_login:
        print(_('[Login required] Log out and log back in to apply the update.'), file=stream)
        print(_('Tidy will start automatically at the next login. Turning the extension off and on does not apply the new code.'), file=stream)
    else:
        print(_('[Update notice] GNOME extension code updates require logging out and back in.'), file=stream)
        print(_('This extension code version is already loaded, so no logout is needed this time.'), file=stream)


def recover_settings(directory):
    schema_dir = directory / 'schemas'
    if schema_dir.exists():
        env = dict(os.environ, GSETTINGS_SCHEMA_DIR=str(schema_dir))
        subprocess.run(['gjs', '-m', str(directory / 'scripts/recover.js')], env=env, check=True)


def migrate_legacy():
    installations = []
    for uuid in LEGACY_UUIDS:
        legacy = DATA / 'gnome-shell/extensions' / uuid
        if legacy.is_symlink():
            raise RuntimeError(_('Manage symlink installations manually: {path}', path=legacy))
        registered = extension_info(uuid)
        if not registered and not legacy.exists():
            continue
        if registered:
            set_enabled(uuid, False)
            wait_for_extension(uuid, False)
        installations.append((uuid, legacy, registered))
    if not installations:
        return False
    # Keep the original schema and state directory so custom shortcuts and the
    # settings recovery journal survive the UUID change. Stop all old copies
    # before recovering shared settings or restoring another tiler.
    for _uuid, legacy, _registered in installations:
        recover_settings(legacy)
    restore_competitors()
    for uuid, legacy, registered in installations:
        if registered and registered.get('type') != 1:
            if not shell_call('UninstallExtension', '(s)', (uuid,))[0]:
                raise RuntimeError(_('GNOME could not remove the previous Tidy extension.'))
        if legacy.exists():
            shutil.rmtree(legacy)
    print(_('Moved Tidy to {uuid}. Your settings and custom shortcuts have been kept.', uuid=UUID))
    return True


def run(*args, check=True):
    return subprocess.run(args, check=check, text=True, capture_output=True,
        env=dict(os.environ, LC_ALL='C'))


def install_launcher():
    path = DATA / 'applications/winubun.desktop'
    path.parent.mkdir(parents=True, exist_ok=True)
    # Desktop-entry quoting follows the Exec key spec, not shell quoting.
    script = str(DEST / 'scripts/manage.py').replace('\\', '\\\\').replace('"', '\\"').replace('`', '\\`').replace('$', '\\$').replace('%', '%%')
    path.write_text('[Desktop Entry]\nType=Application\nName=Tidy\n'
        'Comment=Window tiling settings and shortcuts\nComment[ko]=창 배치 설정 및 단축키\nIcon=view-grid-symbolic\n'
        f'Exec=/usr/bin/python3 "{script}" launch\nTerminal=false\nCategories=Utility;Settings;\n')


def build():
    run('glib-compile-schemas', '--strict', str(ROOT / 'schemas'))
    ARCHIVE.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(ARCHIVE, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name in ['LICENSE', 'NOTICE', 'metadata.json', 'extension.js', 'prefs.js', 'stylesheet.css']:
            archive.write(ROOT / name, name)
        for directory in ['lib', 'schemas']:
            for path in sorted((ROOT / directory).glob('*')):
                if path.is_file():
                    archive.write(path, path.relative_to(ROOT))
        for name in RUNTIME_SCRIPTS:
            archive.write(ROOT / 'scripts' / name, f'scripts/{name}')
    print(_('Built: {path}', path=ARCHIVE))
    return ARCHIVE


def enabled_extensions():
    return {uuid for uuid, info in shell_call('ListExtensions')[0].items()
        if info.get('enabled') or info.get('state') == 1}


def restore_competitors():
    path = STATE / 'handover.json'
    if path.exists():
        pending = json.loads(path.read_text())
        failed = []
        for uuid in pending:
            try:
                if extension_info(uuid):
                    set_enabled(uuid, True)
                    wait_for_extension(uuid, True)
                elif extension_installed(uuid):
                    enable_after_login(uuid)
                    print(_('The previous extension will be restored at the next login: {uuid}', uuid=uuid))
                else:
                    print(_('The previous extension is no longer installed; skipping restoration: {uuid}', uuid=uuid))
            except RuntimeError as error:
                failed.append(uuid)
                print(error, file=sys.stderr)
        if failed:
            path.write_text(json.dumps(failed))
            raise RuntimeError(_('Could not restore the previous extension. Run uninstall again.'))
        path.unlink()


def install(archive=None):
    version = run('gnome-shell', '--version').stdout.split()[-1].split('.')[0]
    metadata = json.loads((ROOT / 'metadata.json').read_text())
    if version not in metadata['shell-version']:
        raise RuntimeError(_('GNOME {version} is not supported. Supported versions: 46–50', version=version))
    archive = Path(archive) if archive is not None else build()
    with zipfile.ZipFile(archive) as package:
        bundled = json.loads(package.read('metadata.json'))
        if any(bundled.get(key) != metadata.get(key) for key in ['uuid', 'version', 'shell-version']):
            raise RuntimeError(_('The bundled extension does not match this installer. Download Tidy again.'))
    if DEST.is_symlink():
        raise RuntimeError(_('Manage symlink installations manually: {path}', path=DEST))
    for uuid in LEGACY_UUIDS:
        legacy = DATA / 'gnome-shell/extensions' / uuid
        if legacy.is_symlink():
            raise RuntimeError(_('Manage symlink installations manually: {path}', path=legacy))
    # The session may need to discover a first installation at the next login.
    # Keep the original tiler active until Tidy is actually available.
    registered = extension_info()
    if registered:
        set_enabled(UUID, False)
        for attempt in range(50):
            if extension_info().get('state') in (2, 6):
                break
            time.sleep(0.1)
        else:
            raise RuntimeError(_('The previous Tidy did not stop. The update was cancelled.'))
    DEST.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as package:
        package.extractall(DEST)
        if 'schemas/gschemas.compiled' not in package.namelist():
            run('glib-compile-schemas', '--strict', str(DEST / 'schemas'))
    migrated = migrate_legacy()
    install_launcher()
    if not registered or registered.get('version') != metadata['version']:
        schedule_update(metadata['version'])
        if registered or migrated:
            print(_('The previous Tidy has been stopped for this session.'))
        print_update_notice(True)
        return
    activate()
    print_update_notice(False)


def activate():
    registered = extension_info()
    if not registered:
        raise RuntimeError(_('Install Tidy, then log out and log back in.'))
    expected = json.loads((DEST / 'metadata.json').read_text())['version']
    if registered.get('version') != expected:
        raise RuntimeError(_('New Tidy code is installed. Please log out and log back in to apply it automatically.'))
    STATE.mkdir(parents=True, exist_ok=True)
    handover = STATE / 'handover.json'
    previous = json.loads(handover.read_text()) if handover.exists() else []
    enabled = enabled_extensions()
    competitors = [uuid for uuid in COMPETITORS if uuid in enabled]
    handover.write_text(json.dumps(sorted(set(previous + competitors))))
    try:
        for uuid in competitors:
            set_enabled(uuid, False)
            wait_for_extension(uuid, False)
        set_enabled(UUID, True)
        for attempt in range(50):
            info = extension_info()
            if info.get('state') == 1:
                break
            if info.get('state') == 3:
                raise RuntimeError(_('Tidy extension error: ') + info.get('error', _('Unknown error')))
            time.sleep(0.1)
        else:
            raise RuntimeError(_('Tidy activation failed. Restoring the previous tiling configuration.\n') + json.dumps(info, ensure_ascii=False))
    except Exception:
        set_enabled(UUID, False)
        restore_competitors()
        raise
    print(_('Tidy is active. Use the grid icon in the top bar → Settings and shortcuts…'))
    print(_('Status: gnome-extensions info ') + UUID)
    finish_update()


def apply_update():
    for attempt in range(50):
        if extension_info():
            activate()
            return
        time.sleep(0.2)
    raise RuntimeError(_('GNOME has not registered Tidy yet. Launch Tidy from the app list.'))


def status():
    info = extension_info()
    print(json.dumps(info, ensure_ascii=False, indent=2) if info else _('The extension is not registered in the current session.'))
    if (STATE / 'pending-update.json').exists():
        expected = json.loads((DEST / 'metadata.json').read_text())['version']
        if info.get('version') != expected:
            # Keep stdout machine-readable when GNOME returned a JSON status.
            print_update_notice(True, sys.stderr)


def uninstall():
    if DEST.is_symlink():
        raise RuntimeError(_('Remove symlink installations manually: {path}', path=DEST))
    registered = extension_info()
    if registered:
        set_enabled(UUID, False)
        wait_for_extension(UUID, False)
    elif DEST.exists():
        print(_('The extension is not registered in this session. Checking settings recovery.'))
    # Also recover settings if a Shell crash prevented disable() from running.
    recover_settings(DEST)
    restore_competitors()
    finish_update()
    if registered:
        if not shell_call('UninstallExtension', '(s)', (UUID,))[0]:
            raise RuntimeError(_('GNOME could not remove Tidy.'))
    if DEST.exists():
        shutil.rmtree(DEST)
    (DATA / 'applications/winubun.desktop').unlink(missing_ok=True)
    print(_('Tidy was removed and previous tiling settings were restored. Your custom shortcuts have been kept.'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['build', 'install', 'activate', 'uninstall', 'prefs', 'status', 'launch', 'apply-update'])
    parser.add_argument('--archive', type=Path, help=_('Install a prebuilt extension ZIP without writing to the package directory'))
    args = parser.parse_args()
    if args.archive is not None and args.command != 'install':
        parser.error('--archive requires install')
    if args.command == 'install':
        install(args.archive)
    elif args.command == 'apply-update':
        apply_update()
    elif args.command == 'launch':
        activate()
        open_preferences()
    elif args.command == 'prefs':
        open_preferences()
    else:
        globals()[args.command]()


if __name__ == '__main__':
    try:
        main()
    except (subprocess.CalledProcessError, RuntimeError, OSError, zipfile.BadZipFile) as error:
        message = getattr(error, 'stderr', '') or str(error)
        print(message, file=sys.stderr)
        if len(sys.argv) > 1 and sys.argv[1] == 'launch':
            STATE.mkdir(parents=True, exist_ok=True)
            (STATE / 'launcher.log').write_text(message + '\n')
            subprocess.run(['notify-send', _('Tidy launch error'), message], check=False)
        sys.exit(1)

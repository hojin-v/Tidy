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
UUID = 'winubun@winubun.local'
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
                set_enabled(uuid, True)
            except RuntimeError as error:
                failed.append(uuid)
                print(error, file=sys.stderr)
        if failed:
            path.write_text(json.dumps(failed))
            raise RuntimeError(_('Could not restore the previous extension. Run uninstall again.'))
        path.unlink()


def install():
    version = run('gnome-shell', '--version').stdout.split()[-1].split('.')[0]
    metadata = json.loads((ROOT / 'metadata.json').read_text())
    if version not in metadata['shell-version']:
        raise RuntimeError(_('GNOME {version} is not supported. Supported versions: 46–50', version=version))
    archive = build()
    if DEST.is_symlink():
        raise RuntimeError(_('Manage symlink installations manually: {path}', path=DEST))
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
    install_launcher()
    if not registered or registered.get('version') != metadata['version']:
        schedule_update(metadata['version'])
        print(_('The new version is installed. GNOME cannot reload cached JavaScript during the current session.'))
        print(_('Log out and log back in once to activate the new Tidy automatically.'))
        print(_('The previous Tidy has been stopped for this session.'))
        return
    activate()


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
        for attempt in range(50):
            if all(extension_info(uuid).get('state') != 1 for uuid in competitors):
                break
            time.sleep(0.1)
        else:
            raise RuntimeError(_('The previous tiling extension did not stop.'))
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


def uninstall():
    if DEST.is_symlink():
        raise RuntimeError(_('Remove symlink installations manually: {path}', path=DEST))
    if extension_info():
        set_enabled(UUID, False)
    elif DEST.exists():
        print(_('The extension is not registered in this session. Checking settings recovery.'))
    # Also recover settings if a Shell crash prevented disable() from running.
    schema_dir = DEST / 'schemas'
    if schema_dir.exists():
        env = dict(os.environ, GSETTINGS_SCHEMA_DIR=str(schema_dir))
        subprocess.run(['gjs', '-m', str(DEST / 'scripts/recover.js')], env=env, check=True)
    restore_competitors()
    finish_update()
    if DEST.exists():
        shutil.rmtree(DEST)
    (DATA / 'applications/winubun.desktop').unlink(missing_ok=True)
    print(_('Tidy was removed and previous tiling settings were restored. Your custom shortcuts have been kept.'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['build', 'install', 'activate', 'uninstall', 'prefs', 'status', 'launch', 'apply-update'])
    args = parser.parse_args()
    if args.command == 'apply-update':
        apply_update()
    elif args.command == 'launch':
        activate()
        open_preferences()
    elif args.command == 'prefs':
        open_preferences()
    elif args.command == 'status':
        info = extension_info()
        print(json.dumps(info, ensure_ascii=False, indent=2) if info else _('The extension is not registered in the current session.'))
    else:
        globals()[args.command]()


if __name__ == '__main__':
    try:
        main()
    except (subprocess.CalledProcessError, RuntimeError, OSError) as error:
        message = getattr(error, 'stderr', '') or str(error)
        print(message, file=sys.stderr)
        if len(sys.argv) > 1 and sys.argv[1] == 'launch':
            STATE.mkdir(parents=True, exist_ok=True)
            (STATE / 'launcher.log').write_text(message + '\n')
            subprocess.run(['notify-send', _('Tidy launch error'), message], check=False)
        sys.exit(1)

#!/usr/bin/env python3
"""Use a private D-Bus, settings backend, runtime dir, and headless compositor."""
import os
import argparse
import json
import signal
import shutil
from pathlib import Path
import subprocess
import tempfile
import zipfile

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
scenarios = parser.add_mutually_exclusive_group()
scenarios.add_argument('--brave-only', action='store_true', help='Run only the isolated Brave hover regression')
scenarios.add_argument('--migration-only', action='store_true', help='Run the legacy UUID migration in an isolated Shell')
options = parser.parse_args()
scenario = 'uuidMigration-smoke.js' if options.migration_only else 'brave-smoke.js' if options.brave_only else 'shell-smoke.js'
subprocess.run(['python3', str(root / 'scripts/manage.py'), 'build'], check=True)
with tempfile.TemporaryDirectory(prefix='winubun-runtime-') as runtime:
    metadata = json.loads((root / 'metadata.json').read_text())
    archive = root / 'dist' / f"{metadata['uuid']}.shell-extension.zip"
    if options.migration_only:
        # Runtime code is independent of the UUID. Start under the old identity
        # so the current installer must perform the real disable/uninstall flow.
        legacy_uuid = os.environ.get('TIDY_TEST_LEGACY_UUID', 'winubun@winubun.local')
        if legacy_uuid not in ('winubun@winubun.local', 'tidy@hnode.dev'):
            parser.error('TIDY_TEST_LEGACY_UUID must name a supported previous UUID')
        legacy_archive = Path(runtime) / 'legacy.shell-extension.zip'
        with zipfile.ZipFile(archive) as source, zipfile.ZipFile(legacy_archive, 'w', zipfile.ZIP_DEFLATED) as legacy:
            for name in source.namelist():
                contents = source.read(name)
                if name == 'metadata.json':
                    contents = json.dumps(dict(metadata, uuid=legacy_uuid,
                        version=24 if legacy_uuid == 'tidy@hnode.dev' else 23)).encode()
                legacy.writestr(name, contents)
        archive = legacy_archive
    env = dict(os.environ, XDG_RUNTIME_DIR=runtime, XDG_STATE_HOME=f'{runtime}/state', NO_AT_BRIDGE='1',
        GNOME_SHELL_SESSION_MODE='user', XDG_CURRENT_DESKTOP='GNOME',
        SHELL_BACKGROUND_IMAGE='/usr/share/backgrounds/ubuntu-default-greyscale-wallpaper.png')
    if env.get('TIDY_BRAVE_BINARY'):
        module = f'{runtime}/brave-controls.so'
        subprocess.run(['cc', '-shared', '-fPIC', str(root / 'tests/brave-gtk-module.c'),
            '-o', module, '-l:libgtk-3.so.0', '-l:libgobject-2.0.so.0'], check=True)
        env['TIDY_BRAVE_GTK_MODULE'] = module
    process = subprocess.Popen(['dbus-run-session', '--', 'gnome-shell-test-tool', '--headless',
        '--extra-filter', 'local.winubun.Settings',
        '--wrap', str(root / 'scripts/shell-test-wrapper.sh'),
        '--extension', str(archive),
        str(root / 'tests' / scenario)], cwd=root, env=env, start_new_session=True)
    try:
        result = process.wait(timeout=120)
        if result:
            raise SystemExit(result)
    finally:
        # Test helpers and the compositor must not survive a failed test.
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        # D-Bus may leave private document/GVfs FUSE mounts attached briefly
        # after the daemons exit. Detach them before traversing the directory.
        unmounter = shutil.which('fusermount3') or shutil.which('fusermount')
        if unmounter:
            for mount in ['doc', 'gvfs']:
                subprocess.run([unmounter, '-uz', f'{runtime}/{mount}'],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)

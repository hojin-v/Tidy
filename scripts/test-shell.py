#!/usr/bin/env python3
"""Use a private D-Bus, settings backend, runtime dir, and headless compositor."""
import os
import argparse
import signal
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--brave-only', action='store_true', help='Run only the isolated Brave hover regression')
options = parser.parse_args()
scenario = 'brave-smoke.js' if options.brave_only else 'shell-smoke.js'
subprocess.run(['python3', str(root / 'scripts/manage.py'), 'build'], check=True)
with tempfile.TemporaryDirectory(prefix='winubun-runtime-') as runtime:
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
        '--extension', str(root / 'dist/winubun@winubun.local.shell-extension.zip'),
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

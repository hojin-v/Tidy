"""Regression checks for updating a cached Shell extension without re-enabling old code."""
import importlib.util
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location('manage', Path(__file__).resolve().parents[1] / 'scripts/manage.py')
manage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(manage)


class UpdateTests(unittest.TestCase):
    def setUp(self):
        translator = patch.object(manage, '_', lambda message, **values: message.format(**values))
        translator.start()
        self.addCleanup(translator.stop)
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.addCleanup(self.directory.cleanup)
        for name, value in {
            'ROOT': self.root, 'DEST': self.root / 'installed', 'STATE': self.root / 'state',
            'DATA': self.root / 'data', 'AUTOSTART': self.root / 'config/autostart/update.desktop',
        }.items():
            patcher = patch.object(manage, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.metadata = {'version': 2, 'shell-version': ['50']}
        (self.root / 'metadata.json').write_text(json.dumps(self.metadata))
        self.archive = self.root / 'extension.zip'
        with zipfile.ZipFile(self.archive, 'w') as archive:
            archive.writestr('metadata.json', json.dumps(self.metadata))

    def test_old_loaded_version_is_disabled_and_staged_for_next_login(self):
        with patch.object(manage, 'build', return_value=self.archive), \
             patch.object(manage, 'run', return_value=SimpleNamespace(stdout='GNOME Shell 50.1')), \
             patch.object(manage, 'extension_info', side_effect=[{'version': 1, 'state': 1}, {'version': 1, 'state': 2}]), \
             patch.object(manage, 'set_enabled') as enabled, \
             patch.object(manage, 'activate') as activate:
            manage.install()
        enabled.assert_called_once_with(manage.UUID, False)
        activate.assert_not_called()
        self.assertEqual(json.loads((manage.STATE / 'pending-update.json').read_text())['version'], 2)
        self.assertIn('apply-update', manage.AUTOSTART.read_text())
        self.assertEqual(json.loads((manage.DEST / 'metadata.json').read_text())['version'], 2)

    def test_launcher_does_not_reenable_incompatible_cached_code(self):
        manage.DEST.mkdir()
        (manage.DEST / 'metadata.json').write_text(json.dumps(self.metadata))
        with patch.object(manage, 'extension_info', return_value={'version': 1}), \
             patch.object(manage, 'set_enabled') as enabled:
            with self.assertRaisesRegex(RuntimeError, 'log out'):
                manage.activate()
        enabled.assert_not_called()

    def test_success_clears_only_the_pending_update_files(self):
        manage.schedule_update(2)
        preserved = manage.STATE / 'handover.json'
        preserved.write_text('["tiling-assistant@ubuntu.com"]')
        manage.finish_update()
        self.assertFalse(manage.AUTOSTART.exists())
        self.assertFalse((manage.STATE / 'pending-update.json').exists())
        self.assertTrue(preserved.exists())


class PortableInstallTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='tidy-install-')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.source = self.root / 'downloaded Tidy'
        self.data = self.root / 'application data'
        self.dest = self.data / 'gnome-shell/extensions' / manage.UUID
        self.state = self.root / 'state/winubun'
        self.autostart = self.root / 'config/autostart/winubun-update.desktop'
        project = Path(__file__).resolve().parents[1]
        shutil.copytree(project, self.source, ignore=shutil.ignore_patterns('dist', '__pycache__', '.git'))
        for name, value in {
            'ROOT': self.source, 'DEST': self.dest, 'DATA': self.data,
            'STATE': self.state, 'AUTOSTART': self.autostart,
            'ARCHIVE': self.source / 'dist/extension.zip',
        }.items():
            patcher = patch.object(manage, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        environment = patch.dict(os.environ, {
            'XDG_DATA_HOME': str(self.data), 'XDG_STATE_HOME': str(self.root / 'state'),
            'XDG_CONFIG_HOME': str(self.root / 'config'), 'GSETTINGS_BACKEND': 'memory',
        })
        environment.start()
        self.addCleanup(environment.stop)
        actual_run = manage.run

        def run(*args, **kwargs):
            if args == ('gnome-shell', '--version'):
                return SimpleNamespace(stdout='GNOME Shell 50.1')
            return actual_run(*args, **kwargs)

        # Files, schema compilation, packaging and installation are real;
        # only Shell registration is stubbed to leave the user's session alone.
        with patch.object(manage, 'run', side_effect=run), \
             patch.object(manage, 'extension_info', return_value={}):
            manage.install()
        shutil.rmtree(self.source)

    def command(self, path):
        line = next(line for line in path.read_text().splitlines() if line.startswith('Exec='))
        return shlex.split(line.removeprefix('Exec='))

    def test_launcher_and_next_login_work_without_the_download(self):
        launcher = self.data / 'applications/winubun.desktop'
        script = self.dest / 'scripts/manage.py'
        self.assertFalse(self.source.exists())
        self.assertEqual(self.command(launcher), ['/usr/bin/python3', str(script), 'launch'])
        self.assertEqual(self.command(self.autostart), ['/usr/bin/python3', str(script), 'apply-update'])
        for name in manage.RUNTIME_SCRIPTS:
            self.assertTrue((self.dest / 'scripts' / name).is_file(), name)
        self.assertIn('GNU GENERAL PUBLIC LICENSE', (self.dest / 'LICENSE').read_text())
        self.assertIn('GPL-3.0-or-later', (self.dest / 'NOTICE').read_text())
        for language in ['en', 'ko']:
            # Start a fresh process in an unrelated directory: Python must
            # load its helper and translations entirely from the installation.
            result = subprocess.run(['/usr/bin/python3', str(script), '--help'], cwd=self.root,
                env=dict(os.environ, LANGUAGE=language), text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('Tidy', result.stdout)

    def test_settings_use_the_installed_application_after_source_removal(self):
        with patch.object(manage.subprocess, 'Popen') as process:
            manage.open_preferences()
        self.assertEqual(process.call_args.args[0],
            ['/usr/bin/gjs', '-m', str(self.dest / 'lib/preferencesApp.js')])
        self.assertTrue((self.state / 'preferences.log').exists())

    def test_uninstall_recovers_settings_without_the_download(self):
        # Run the real installed GJS recovery helper with memory settings.
        with patch.object(manage, 'extension_info', return_value={}):
            manage.uninstall()
        self.assertFalse(self.dest.exists())
        self.assertFalse((self.data / 'applications/winubun.desktop').exists())
        self.assertFalse(self.autostart.exists())
        self.assertFalse((self.state / 'pending-update.json').exists())


if __name__ == '__main__':
    unittest.main()

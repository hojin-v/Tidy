"""Regression checks for updating a cached Shell extension without re-enabling old code."""
import importlib.util
from contextlib import redirect_stderr, redirect_stdout
import hashlib
import io
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
        self.metadata = {'uuid': manage.UUID, 'version': 2, 'shell-version': ['50'],
            'settings-schema': 'org.gnome.shell.extensions.winubun'}
        (self.root / 'metadata.json').write_text(json.dumps(self.metadata))
        self.archive = self.root / 'extension.zip'
        with zipfile.ZipFile(self.archive, 'w') as archive:
            archive.writestr('metadata.json', json.dumps(self.metadata))

    def test_old_loaded_version_is_disabled_and_staged_for_next_login(self):
        output = io.StringIO()
        with patch.object(manage, 'build', return_value=self.archive), \
             patch.object(manage, 'run', return_value=SimpleNamespace(stdout='GNOME Shell 50.1')), \
             patch.object(manage, 'extension_info', side_effect=[{'version': 1, 'state': 1}, {'version': 1, 'state': 2}, {}]), \
             patch.object(manage, 'set_enabled') as enabled, \
             patch.object(manage, 'activate') as activate, redirect_stdout(output):
            manage.install()
        enabled.assert_called_once_with(manage.UUID, False)
        activate.assert_not_called()
        self.assertEqual(json.loads((manage.STATE / 'pending-update.json').read_text())['version'], 2)
        self.assertIn('apply-update', manage.AUTOSTART.read_text())
        self.assertEqual(json.loads((manage.DEST / 'metadata.json').read_text())['version'], 2)
        self.assertIn('[Login required]', output.getvalue())
        self.assertIn('Log out and log back in', output.getvalue())
        self.assertNotIn('no logout is needed', output.getvalue())

    def test_reinstalling_loaded_code_still_explains_when_logout_is_required(self):
        output = io.StringIO()
        info = lambda uuid=manage.UUID: {} if uuid == manage.LEGACY_UUID else {'version': 2, 'state': 2}
        with patch.object(manage, 'run', return_value=SimpleNamespace(stdout='GNOME Shell 50.1')), \
             patch.object(manage, 'extension_info', side_effect=info), \
             patch.object(manage, 'set_enabled'), patch.object(manage, 'activate') as activate, redirect_stdout(output):
            manage.install(self.archive)
        activate.assert_called_once()
        self.assertIn('[Update notice]', output.getvalue())
        self.assertIn('logging out and back in', output.getvalue())
        self.assertIn('no logout is needed this time', output.getvalue())
        self.assertNotIn('[Login required]', output.getvalue())
        self.assertFalse(manage.AUTOSTART.exists())

    def test_status_keeps_login_notice_until_new_code_is_registered_without_breaking_json(self):
        manage.DEST.mkdir()
        (manage.DEST / 'metadata.json').write_text(json.dumps(self.metadata))
        manage.schedule_update(2)
        for info in [{'version': 1}, {}, {'version': 2}]:
            with self.subTest(info=info):
                output, notice = io.StringIO(), io.StringIO()
                with patch.object(manage, 'extension_info', return_value=info), \
                     redirect_stdout(output), redirect_stderr(notice):
                    manage.status()
                if info:
                    self.assertEqual(json.loads(output.getvalue()), info)
                self.assertEqual('[Login required]' in notice.getvalue(), info.get('version') != 2)

    def test_uuid_migration_stops_and_removes_legacy_and_preserves_settings_storage(self):
        legacy = manage.DATA / 'gnome-shell/extensions' / manage.LEGACY_UUID
        (legacy / 'schemas').mkdir(parents=True)
        (legacy / 'scripts').mkdir()
        (legacy / 'scripts/recover.js').write_text('// legacy recovery tool')
        (legacy / 'metadata.json').write_text(json.dumps(dict(self.metadata, uuid=manage.LEGACY_UUID)))
        manage.STATE.mkdir()
        preserved = manage.STATE / 'preferences.log'
        preserved.write_text('preserve existing state')
        competitor = manage.COMPETITORS[0]
        (manage.STATE / 'handover.json').write_text(json.dumps([competitor]))
        registered = {manage.LEGACY_UUID: {'state': 1, 'type': 2}, competitor: {'state': 2}}

        def enabled(uuid, value):
            registered[uuid]['state'] = 1 if value else 2

        output = io.StringIO()
        with patch.object(manage, 'run', return_value=SimpleNamespace(stdout='GNOME Shell 50.1')), \
             patch.object(manage, 'extension_info', side_effect=lambda uuid=manage.UUID: registered.get(uuid, {})), \
             patch.object(manage, 'set_enabled', side_effect=enabled) as toggle, \
             patch.object(manage, 'shell_call', return_value=(True,)) as shell, \
             patch.object(manage.subprocess, 'run') as recovery, redirect_stdout(output):
            manage.install(self.archive)
        toggle.assert_any_call(manage.LEGACY_UUID, False)
        toggle.assert_any_call(competitor, True)
        shell.assert_called_once_with('UninstallExtension', '(s)', (manage.LEGACY_UUID,))
        self.assertEqual(recovery.call_args.args[0], ['gjs', '-m', str(legacy / 'scripts/recover.js')])
        self.assertEqual(recovery.call_args.kwargs['env']['GSETTINGS_SCHEMA_DIR'], str(legacy / 'schemas'))
        self.assertFalse(legacy.exists())
        metadata = json.loads((manage.DEST / 'metadata.json').read_text())
        self.assertEqual(metadata['uuid'], 'tidy@hnode.dev')
        self.assertEqual(metadata['settings-schema'], self.metadata['settings-schema'])
        self.assertEqual(preserved.read_text(), 'preserve existing state')
        self.assertIn(str(manage.DEST / 'scripts/manage.py'), manage.AUTOSTART.read_text())
        self.assertIn('[Login required]', output.getvalue())

    def test_failed_legacy_removal_keeps_old_files_and_does_not_schedule_new_activation(self):
        legacy = manage.DATA / 'gnome-shell/extensions' / manage.LEGACY_UUID
        legacy.mkdir(parents=True)
        info = lambda uuid=manage.UUID: {'state': 2, 'type': 2} if uuid == manage.LEGACY_UUID else {}
        with patch.object(manage, 'run', return_value=SimpleNamespace(stdout='GNOME Shell 50.1')), \
             patch.object(manage, 'extension_info', side_effect=info), \
             patch.object(manage, 'set_enabled'), patch.object(manage, 'shell_call', return_value=(False,)):
            with self.assertRaisesRegex(RuntimeError, 'could not remove the previous'):
                manage.install(self.archive)
        self.assertTrue(legacy.exists())
        self.assertFalse(manage.AUTOSTART.exists())

    def test_legacy_symlinks_are_rejected_before_stopping_or_replacing_any_extension(self):
        legacy = manage.DATA / 'gnome-shell/extensions' / manage.LEGACY_UUID
        legacy.parent.mkdir(parents=True)
        legacy.symlink_to(self.root, target_is_directory=True)
        with patch.object(manage, 'run', return_value=SimpleNamespace(stdout='GNOME Shell 50.1')), \
             patch.object(manage, 'set_enabled') as enabled:
            with self.assertRaisesRegex(RuntimeError, 'symlink'):
                manage.install(self.archive)
        enabled.assert_not_called()
        self.assertFalse(manage.DEST.exists())

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

    def test_mismatched_bundle_is_rejected_before_disabling_an_existing_installation(self):
        with zipfile.ZipFile(self.archive, 'w') as archive:
            archive.writestr('metadata.json', json.dumps(dict(self.metadata, version=1)))
        with patch.object(manage, 'run', return_value=SimpleNamespace(stdout='GNOME Shell 50.1')), \
             patch.object(manage, 'set_enabled') as enabled:
            with self.assertRaisesRegex(RuntimeError, 'does not match'):
                manage.install(self.archive)
        enabled.assert_not_called()
        self.assertFalse(manage.DEST.exists())

    def test_source_only_bundle_recompiles_schemas_even_when_an_old_cache_exists(self):
        schema = Path(__file__).resolve().parents[1] / 'schemas/org.gnome.shell.extensions.winubun.gschema.xml'
        (manage.DEST / 'schemas').mkdir(parents=True)
        cached = manage.DEST / 'schemas/gschemas.compiled'
        cached.write_bytes(b'old schema cache')
        with zipfile.ZipFile(self.archive, 'a') as archive:
            archive.writestr('schemas/' + schema.name, schema.read_bytes())
        actual_run = manage.run

        def run(*args, **kwargs):
            if args == ('gnome-shell', '--version'):
                return SimpleNamespace(stdout='GNOME Shell 50.1')
            return actual_run(*args, **kwargs)

        with patch.object(manage, 'run', side_effect=run), \
             patch.object(manage, 'extension_info', return_value={}):
            manage.install(self.archive)
        self.assertGreater(cached.stat().st_size, len(b'old schema cache'))
        self.assertNotEqual(cached.read_bytes(), b'old schema cache')


class HandoverTests(unittest.TestCase):
    uuid = 'tiling-assistant@ubuntu.com'

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        for name, value in {'STATE': self.root / 'state', 'DATA': self.root / 'data'}.items():
            patcher = patch.object(manage, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        for patcher in [
            patch.object(manage, '_', lambda message, **values: message.format(**values)),
            patch.object(manage.GLib, 'get_system_data_dirs', return_value=[str(self.root / 'system')]),
            patch.object(manage.time, 'sleep'),
        ]:
            patcher.start()
            self.addCleanup(patcher.stop)
        manage.STATE.mkdir()
        self.journal = manage.STATE / 'handover.json'
        self.journal.write_text(json.dumps([self.uuid]))

    def test_registered_extension_must_reach_active_before_clearing_the_journal(self):
        with patch.object(manage, 'extension_info', side_effect=[{'state': 2}, {'state': 5}, {'state': 1}]), \
             patch.object(manage, 'set_enabled') as enabled:
            manage.restore_competitors()
        enabled.assert_called_once_with(self.uuid, True)
        self.assertFalse(self.journal.exists())

    def test_failed_activation_keeps_the_recovery_journal(self):
        with patch.object(manage, 'extension_info', side_effect=[{'state': 2}, {'state': 3, 'error': 'panel failure'}]), \
             patch.object(manage, 'set_enabled'):
            with self.assertRaisesRegex(RuntimeError, 'Could not restore'):
                manage.restore_competitors()
        self.assertEqual(json.loads(self.journal.read_text()), [self.uuid])

    def test_deleted_user_copy_restores_system_copy_preferences_for_next_login(self):
        system = self.root / 'system/gnome-shell/extensions' / self.uuid / 'extension.js'
        system.parent.mkdir(parents=True)
        system.write_text('// system original must not be changed\n')
        preferences = {'enabled-extensions': ['unrelated@example'], 'disabled-extensions': [self.uuid, 'other@example']}

        class Settings:
            def get_strv(self, key): return preferences[key][:]
            def is_writable(self, _key): return True
            def delay(self): pass
            def apply(self): pass
            def set_strv(self, key, value):
                preferences[key] = value
                return True

        with patch.object(manage, 'extension_info', return_value={}), \
             patch.object(manage, 'set_enabled') as enabled, \
             patch.object(manage.Gio.Settings, 'new', return_value=Settings()):
            manage.restore_competitors()
        enabled.assert_not_called()
        self.assertEqual(preferences['enabled-extensions'], ['unrelated@example', self.uuid])
        self.assertEqual(preferences['disabled-extensions'], ['other@example'])
        self.assertEqual(system.read_text(), '// system original must not be changed\n')
        self.assertFalse(self.journal.exists())

    def test_an_extension_removed_from_disk_is_not_reinstalled(self):
        with patch.object(manage, 'extension_info', return_value={}), \
             patch.object(manage, 'set_enabled') as enabled:
            manage.restore_competitors()
        enabled.assert_not_called()
        self.assertFalse(self.journal.exists())

    def test_disable_error_is_not_treated_as_a_successful_stop(self):
        with patch.object(manage, 'extension_info', return_value={'state': 3, 'error': 'cleanup failure'}):
            with self.assertRaisesRegex(RuntimeError, 'cleanup failure'):
                manage.wait_for_extension(self.uuid, False)


class PortableInstallTests(unittest.TestCase):
    bundled = False

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
        shutil.copytree(project, self.source, ignore=shutil.ignore_patterns('dist', '__pycache__', '.git', 'node_modules'))
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
            if self.bundled:
                archive = manage.build()
                inventory = lambda: {path.relative_to(self.source): hashlib.sha256(path.read_bytes()).digest()
                    for path in self.source.rglob('*') if path.is_file()}
                before = inventory()
                self.source.chmod(0o555)
                (self.source / 'schemas').chmod(0o555)
                try:
                    with patch.object(manage, 'build', side_effect=AssertionError('must use the bundled ZIP')):
                        manage.install(archive)
                    self.assertEqual(inventory(), before, 'npm installation must not write into its package')
                finally:
                    self.source.chmod(0o755)
                    (self.source / 'schemas').chmod(0o755)
            else:
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

    def test_uninstall_waits_for_the_running_extension_to_stop(self):
        with patch.object(manage, 'extension_info', side_effect=[{'state': 1}, {'state': 5}, {'state': 2}]), \
             patch.object(manage, 'set_enabled') as enabled, \
             patch.object(manage, 'shell_call', return_value=(True,)) as shell, \
             patch.object(manage.time, 'sleep'):
            manage.uninstall()
        enabled.assert_called_once_with(manage.UUID, False)
        shell.assert_called_once_with('UninstallExtension', '(s)', (manage.UUID,))
        self.assertFalse(self.dest.exists())

    def test_uninstall_preserves_files_if_the_extension_does_not_stop(self):
        with patch.object(manage, 'extension_info', return_value={'state': 1}), \
             patch.object(manage, 'set_enabled'), \
             patch.object(manage.time, 'sleep'):
            with self.assertRaisesRegex(RuntimeError, 'timed out'):
                manage.uninstall()
        self.assertTrue(self.dest.exists())
        self.assertTrue((self.data / 'applications/winubun.desktop').exists())


class BundledInstallTests(PortableInstallTests):
    bundled = True


if __name__ == '__main__':
    unittest.main()

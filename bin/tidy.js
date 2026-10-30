#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync, realpathSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createTranslator} from '../lib/i18nCore.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const metadata = JSON.parse(readFileSync(join(root, 'metadata.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const catalogs = JSON.parse(readFileSync(join(root, 'lib/translations.json'), 'utf8'));
const commands = ['install', 'update', 'uninstall', 'prefs', 'status', 'doctor'];

export function main({args = process.argv.slice(2), env = process.env, platform = process.platform,
    uid = process.getuid?.(), packageRoot = root, run = spawnSync, out = console.log, error = console.error} = {}) {
    const languages = env.LANGUAGE?.split(':') ?? [env.LC_ALL || env.LC_MESSAGES || env.LANG || 'C'];
    const _ = createTranslator(catalogs, languages);
    const help = () => out(_('Tidy · Window tiling for GNOME\n\nUsage: tidy <command>\n\n  install     Install Tidy for the current user\n  update      Install this package version of Tidy\n  uninstall   Remove Tidy and restore desktop settings\n  prefs       Open settings and shortcuts\n  status      Show the installed extension status\n  doctor      Check system requirements\n\nInstall: npx @hnode/tidy@latest install\nAfter installation, log out and back in once.'));
    if (!args.length || args[0] === 'help' || args.includes('--help') || args.includes('-h')) {
        help();
        return 0;
    }
    if (args.length === 1 && ['--version', '-v'].includes(args[0])) {
        out(manifest.version);
        return 0;
    }
    if (args.length !== 1 || !commands.includes(args[0])) {
        error(_('Unknown command. Run tidy --help.'));
        return 2;
    }
    if (platform !== 'linux') {
        error(_('Tidy requires Linux with GNOME Shell 46–50.'));
        return 1;
    }
    const command = args[0];
    if (uid === 0 && command !== 'doctor') {
        error(_('Run Tidy as your desktop user, without sudo.'));
        return 1;
    }
    const installing = ['install', 'update'].includes(command);
    const fullCheck = installing || command === 'doctor';
    const python = 'import gi; from gi.repository import Gio, GLib' + (fullCheck ?
        "; gi.require_version('Gtk', '4.0'); gi.require_version('Adw', '1'); from gi.repository import Gtk, Adw" : '');
    const options = {encoding: 'utf8', env: {...env, PYTHONDONTWRITEBYTECODE: '1'}};
    const check = run('/usr/bin/python3', ['-c', python], options);
    if (check.error || check.status !== 0) {
        error(_('System Python with PyGObject is required. For installation and settings, GTK 4 and libadwaita are also required.'));
        error('sudo apt install python3 python3-gi gjs gir1.2-gtk-4.0 gir1.2-adw-1');
        if (check.stderr?.trim()) error(check.stderr.trim());
        return 1;
    }
    if (fullCheck) {
        const gjs = run('gjs', ['--version'], options);
        const shell = run('gnome-shell', ['--version'], options);
        const version = shell.stdout?.trim().match(/(\d+)(?:\.\d+)*$/)?.[1];
        if (gjs.error || gjs.status !== 0 || shell.error || shell.status !== 0 || !metadata['shell-version'].includes(version)) {
            error(_('Tidy requires GJS and GNOME Shell 46–50. Run this command in your GNOME desktop session.'));
            return 1;
        }
        if (command === 'doctor') {
            out(_('System requirements are available.'));
            out(shell.stdout.trim());
            out(gjs.stdout.trim());
            return 0;
        }
    }
    const installed = join(env.XDG_DATA_HOME || join(homedir(), '.local/share'),
        'gnome-shell/extensions', metadata.uuid, 'scripts/manage.py');
    if (['prefs', 'status'].includes(command) && !existsSync(installed)) {
        error(_('Tidy is not installed. Run tidy install first.'));
        return 1;
    }
    const manager = installing || !existsSync(installed) ? join(packageRoot, 'scripts/manage.py') : installed;
    const parameters = [manager, installing ? 'install' : command];
    if (installing) {
        const archive = join(packageRoot, 'dist', `${metadata.uuid}.shell-extension.zip`);
        if (!existsSync(archive)) {
            error(_('The bundled extension is missing. Reinstall @hnode/tidy, or run npm run build from the source checkout.'));
            return 1;
        }
        parameters.push('--archive', archive);
    }
    const result = run('/usr/bin/python3', parameters, {...options, stdio: 'inherit'});
    if (result.error) {
        error(result.error.message);
        return 1;
    }
    if (result.signal) {
        error(_('Tidy was interrupted.'));
        return 1;
    }
    return result.status ?? 1;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url))
    process.exitCode = main();

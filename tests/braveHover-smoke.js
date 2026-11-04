import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {zoneRect} from '../lib/layouts.js';

export async function testBraveHover(extension, assert) {
    const binary = GLib.getenv('TIDY_BRAVE_BINARY');
    if (!binary) { print('SKIP: set TIDY_BRAVE_BINARY to test a real Brave browser'); return; }
    const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDERR_PIPE});
    launcher.unsetenv('NO_AT_BRIDGE');
    launcher.setenv('GTK_A11Y', 'atspi', true);
    launcher.setenv('GDK_BACKEND', 'wayland', true);
    const module = GLib.getenv('TIDY_BRAVE_GTK_MODULE');
    if (module) launcher.setenv('GTK_MODULES', [GLib.getenv('GTK_MODULES'), module].filter(Boolean).join(':'), true);
    launcher.unsetenv('LD_LIBRARY_PATH');
    launcher.unsetenv('GI_TYPELIB_PATH');
    launcher.setenv('LANGUAGE', 'ko', true);
    const wmSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.wm.preferences'});
    const buttonLayout = wmSettings.get_string('button-layout');
    wmSettings.set_string('button-layout', ':minimize,maximize,close');
    Gio.Settings.sync();
    // The harness disables AT bridges by default. Enable the accessibility bus
    // in this private desktop so GTK titlebar controls can be exported, without
    // enabling a screen reader or forcing Chromium renderer accessibility.
    await new Promise((resolve, reject) => Gio.DBus.session.call('org.a11y.Bus', '/org/a11y/bus',
        'org.freedesktop.DBus.Properties', 'Set', new GLib.Variant('(ssv)',
            ['org.a11y.Status', 'IsEnabled', new GLib.Variant('b', true)]), null,
        Gio.DBusCallFlags.NONE, 1000, null, (bus, result) => {
            try { bus.call_finish(result); resolve(); } catch (error) { reject(error); }
        }));
    // A separate profile and private Wayland/D-Bus session leave the user's
    // browser, tabs, accessibility preferences and running processes untouched.
    const profile = `${GLib.getenv('XDG_RUNTIME_DIR')}/tidy-brave-profile`;
    const args = [binary, `--user-data-dir=${profile}`, '--ozone-platform=wayland', '--gtk-version=3',
        '--window-size=900,600', '--no-first-run', '--no-default-browser-check', '--disable-sync',
        '--disable-background-networking', '--disable-component-update', '--disable-extensions',
        '--disable-gpu', '--password-store=basic', '--lang=ko',
        'data:text/html,<title>Tidy Brave hover test</title><p>Tidy caption control test</p>'];
    // A Snap binary run directly has no setuid helper. This explicit test-only
    // switch is confined to the throwaway profile and static data: page.
    if (GLib.getenv('TIDY_BRAVE_TEST_NO_SANDBOX') === '1') args.push('--no-sandbox');
    const process = launcher.spawnv(args);
    const pid = Number(process.get_identifier());
    const readPointer = global.get_pointer;
    let pointer = [-10000, -10000, 0];
    let window;
    global.get_pointer = () => pointer;
    try {
        for (let attempt = 0; attempt < 80; attempt++) {
            await Scripting.sleep(100);
            window = global.get_window_actors().map(actor => actor.meta_window).find(candidate =>
                candidate.get_pid() === pid || candidate.get_title().includes('Tidy Brave hover test'));
            if (window) break;
        }
        if (!window) {
            process.force_exit();
            const [, errors] = await process.communicate_utf8_async(null, null);
            throw new Error(`Brave did not map: ${errors.slice(-3000)}`);
        }
        assert(Boolean(window), 'a real Brave browser maps in the private compositor with an isolated profile');
        window.move_to_monitor(0);
        const area = Main.layoutManager.getWorkAreaForMonitor(0);
        window.move_resize_frame(true, area.x + 80, area.y + 80, 900, 600);
        Main.activateWindow(window);
        await Scripting.sleep(500);
        for (const maximized of [false, true]) {
            if (maximized) {
                extension._tiler.apply(window, 'maximize');
                await Scripting.sleep(350);
            }
            const frame = window.get_frame_rect();
            let button;
            for (let attempt = 0; attempt < 20; attempt++) {
                for (const offset of [48, 64, 80, 96, 112, 128, 144, 160]) {
                    button = await extension._maximizeHover._locator.locate(window, frame.x + frame.width - offset, frame.y + 15);
                    if (button) break;
                }
                if (button) break;
                await Scripting.sleep(100);
            }
            assert(Boolean(button), `Brave ${maximized ? 'restore' : 'maximize'} control is detected without renderer-accessibility flags (${extension._maximizeHover._locator.lastError ?? 'no error'})`);
            assert(!await extension._maximizeHover._locator.locate(window, frame.x + frame.width - 16, frame.y + 15),
                'Brave close control does not activate layouts');
            pointer = [button.x + button.width / 2, button.y + button.height / 2, 0];
            await Scripting.sleep(650);
            assert(extension._hoverPalette.isOpen && extension._maximizeHover._active?.window === window,
                `hovering Brave ${maximized ? 'restore' : 'maximize'} opens the two-row picker for that browser window`);
            const target = extension._hoverPalette._targets.find(item => item.zone === 'center-half');
            const [x, y] = target.button.get_transformed_position();
            pointer = [x + target.button.width / 2, y + target.button.height / 2, 0];
            target.button.emit('clicked', 1);
            await Scripting.sleep(350);
            const expected = zoneRect(area, 'center-half', extension._settings.get_int('window-gap'));
            const actual = window.get_frame_rect();
            assert(['x', 'y', 'width', 'height'].every(key => Math.abs(actual[key] - expected[key]) <= 2),
                'selecting a layout from Brave hover resizes the real browser to the chosen cell');
            pointer = [-10000, -10000, 0];
            extension._tiler.restore(window);
            await Scripting.sleep(250);
        }
    } finally {
        wmSettings.set_string('button-layout', buttonLayout);
        global.get_pointer = readPointer;
        extension._maximizeHover?.close();
        window?.delete(global.get_current_time());
        process.force_exit();
        await Scripting.sleep(100);
    }
}

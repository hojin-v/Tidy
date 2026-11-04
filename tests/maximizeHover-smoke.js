import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {zoneRect} from '../lib/layouts.js';

export async function testMaximizeHover(extension, assert) {
    const root = Gio.File.new_for_uri(import.meta.url).get_parent();
    const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDERR_PIPE});
    launcher.unsetenv('NO_AT_BRIDGE');
    launcher.setenv('GTK_A11Y', 'atspi', true);
    launcher.setenv('LANGUAGE', 'en', true);
    const process = launcher.spawnv(['/usr/bin/python3', root.get_child('maximize-window.py').get_path()]);
    const readPointer = global.get_pointer;
    const topEnabled = extension._settings.get_boolean('top-edge-enabled');
    let window;
    let pointer = [-10000, -10000, 0];
    global.get_pointer = () => pointer;
    try {
        for (let attempt = 0; attempt < 40; attempt++) {
            await Scripting.sleep(100);
            window = global.get_window_actors().map(actor => actor.meta_window)
                .find(candidate => candidate.get_gtk_application_id() === 'local.winubun.HoverTest');
            if (window) break;
        }
        assert(Boolean(window), 'real GTK Wayland window exposes maximize, restore and close controls');
        extension._settings.set_boolean('top-edge-enabled', false);
        for (const monitor of [0, Main.layoutManager.monitors.length - 1]) {
            const area = Main.layoutManager.getWorkAreaForMonitor(monitor);
            window.move_to_monitor(monitor);
            window.move_resize_frame(true, area.x + 80, area.y + 120, 900, 500);
            Main.activateWindow(window);
            await Scripting.sleep(250);
            const frame = window.get_frame_rect();
            const x = frame.x + frame.width - 60;
            const y = frame.y + 18;
            let button;
            for (let attempt = 0; attempt < 15; attempt++) {
                button = await extension._maximizeHover._locator.locate(window, x, y);
                if (button) break;
                await Scripting.sleep(100);
            }
            assert(Boolean(button), `accessibility locates the actual maximize control on monitor ${monitor} (${extension._maximizeHover._locator.lastError ?? 'no D-Bus error'})`);
            assert(!await extension._maximizeHover._locator.locate(window, frame.x + frame.width - 22, y),
                'close control is never mistaken for maximize');
            assert(!await extension._maximizeHover._locator.locate(window, frame.x + frame.width - 100, y),
                'minimize control is never mistaken for maximize');
            pointer = [button.x + button.width / 2, button.y + button.height / 2, 0];
            await Scripting.sleep(200);
            assert(!extension._hoverPalette.isOpen, 'passing across maximize does not open the picker immediately');
            await Scripting.sleep(400);
            assert(extension._hoverPalette.isOpen && extension._maximizeHover._active?.window === window,
                `dwelling on maximize opens a picker for that window on monitor ${monitor}, independently of top dragging`);
            const palette = extension._hoverPalette;
            const diagrams = palette._cards.cards.map(card => card.diagram.get_transformed_position());
            assert(diagrams.length === 6 && diagrams[3][1] > diagrams[0][1] &&
                diagrams.slice(0, 3).every(point => Math.abs(point[1] - diagrams[0][1]) < 1) &&
                diagrams.slice(3).every(point => Math.abs(point[1] - diagrams[3][1]) < 1),
                'the maximize hover picker uses two rows of three layouts');
            assert(palette.actor.x >= area.x && palette.actor.y >= area.y &&
                palette.actor.x + palette.actor.width <= area.x + area.width &&
                palette.actor.y + palette.actor.height <= area.y + area.height &&
                palette.actor.y >= button.y + button.height,
                'button picker appears below its control and fits the target monitor');
            const target = palette._targets.find(item => item.zone === 'center-half');
            const [tx, ty] = target.button.get_transformed_position();
            pointer = [tx + target.button.width / 2, ty + target.button.height / 2, 0];
            palette.hit(pointer[0], pointer[1]);
            await Scripting.sleep(200);
            assert(palette.isOpen && palette.preview.visible, 'moving from the button into a cell keeps the picker open and previews the placement');
            pointer[2] = Clutter.ModifierType.BUTTON1_MASK;
            await Scripting.sleep(250);
            assert(palette.isOpen, 'holding a picker cell pressed keeps it available until the click is released');
            pointer[2] = 0;
            target.button.emit('clicked', 1);
            await Scripting.sleep(350);
            const expected = zoneRect(area, 'center-half', extension._settings.get_int('window-gap'));
            const actual = window.get_frame_rect();
            assert(!palette.isOpen && ['x', 'y', 'width', 'height'].every(key => Math.abs(actual[key] - expected[key]) <= 2),
                'clicking the wide center places the original window in the central half and dismisses the picker');
            pointer = [-10000, -10000, 0];
            extension._tiler.restore(window);
            await Scripting.sleep(250);
        }
        extension._tiler.apply(window, 'maximize');
        await Scripting.sleep(350);
        const maximized = window.get_frame_rect();
        const restore = await extension._maximizeHover._locator.locate(window,
            maximized.x + maximized.width - 60, maximized.y + 18);
        assert(Boolean(restore), 'the native restore control also opens layouts when the window is maximized');
        extension._tiler.restore(window);
        await Scripting.sleep(250);
        const frame = window.get_frame_rect();
        const button = await extension._maximizeHover._locator.locate(window, frame.x + frame.width - 60, frame.y + 18);
        assert(Boolean(button), 'maximize button remains discoverable after moving and restoring the window');
        pointer = [button.x + button.width / 2, button.y + button.height / 2, 0];
        await Scripting.sleep(900);
        extension._dismiss();
        await Scripting.sleep(700);
        assert(!extension._hoverPalette.isOpen && !extension._escapeAction,
            'dismissal releases Escape and does not reopen until the pointer leaves the button');
        pointer = [-10000, -10000, 0];
        await Scripting.sleep(120);
        extension._maximizeHover.open(window, button);
        assert(extension._onCapturedEvent({type: () => Clutter.EventType.BUTTON_PRESS,
            get_coords: () => [-10000, -10000]}) === Clutter.EVENT_PROPAGATE && !extension._hoverPalette.isOpen,
            'outside clicks close the picker and pass through to the desktop');
        extension._maximizeHover.open(window, button);
        extension._settings.set_boolean('maximize-hover-enabled', false);
        assert(!extension._maximizeHover && !extension._hoverPalette.isOpen,
            'turning the setting off immediately stops detection and removes the visible picker');
        extension._settings.set_boolean('maximize-hover-enabled', true);
        pointer = [button.x + button.width / 2, button.y + button.height / 2, Clutter.ModifierType.BUTTON1_MASK];
        await Scripting.sleep(800);
        assert(!extension._hoverPalette.isOpen, 'dragging and clicking never activate maximize hover');
    } finally {
        global.get_pointer = readPointer;
        extension._settings.set_boolean('top-edge-enabled', topEnabled);
        extension._settings.set_boolean('maximize-hover-enabled', true);
        extension._maximizeHover?.close();
        window?.delete(global.get_current_time());
        process.force_exit();
        await Scripting.sleep(100);
    }
}

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {zoneRect} from '../lib/layouts.js';
import {rectCopy} from '../lib/resizeGeometry.js';
import {testWrapAnimations} from './wrapAnimations-smoke.js';

const call = (method, parameters = null) => new Promise((resolve, reject) => {
    Gio.DBus.session.call('org.gnome.Mutter.DisplayConfig', '/org/gnome/Mutter/DisplayConfig',
        'org.gnome.Mutter.DisplayConfig', method, parameters, null, Gio.DBusCallFlags.NONE, 6000, null, (bus, result) => {
            try { resolve(bus.call_finish(result).deep_unpack()); }
            catch (error) { reject(error); }
        });
});

export async function testVerticalNavigation(extension, window, assert, chord) {
    const initial = await call('GetCurrentState');
    assert(initial[1].length === 2 && initial[1].every(([spec]) => spec[0].startsWith('Meta-')),
        'vertical monitor reconfiguration is restricted to the two isolated virtual displays');
    const value = item => item?.deep_unpack?.() ?? item;
    const modes = new Map(initial[1].map(([spec, available]) =>
        [spec[0], available.find(mode => value(mode[6]['is-current'])) ?? available[0]]));
    const original = initial[2].map(([x, y, scale, transform, primary, specs]) =>
        [x, y, scale, transform, primary, specs.map(spec => [spec[0], modes.get(spec[0])[0], {}])]);
    const properties = initial[3]['layout-mode'] ? {'layout-mode': initial[3]['layout-mode']} : {};
    const apply = async configuration => {
        const [serial] = await call('GetCurrentState');
        await call('ApplyMonitorsConfig', new GLib.Variant('(uua(iiduba(ssa{sv}))a{sv})',
            [serial, 1, configuration, properties]));
        await Scripting.sleep(250);
    };
    extension._tiler.restore(window);
    await Scripting.sleep(350);
    const before = rectCopy(window.get_frame_rect());
    const beforeMonitor = window.get_monitor();
    let y = 0;
    const vertical = [...original].sort((a, b) => a[0] - b[0]).map(([, , scale, transform, primary, specs]) => {
        const result = [0, y, scale, transform, primary, specs];
        const mode = modes.get(specs[0][0]);
        y += Math.round(mode[transform % 2 ? 1 : 2] / scale);
        return result;
    });
    try {
        await apply(vertical);
        const monitors = Main.layoutManager.monitors;
        const ordered = monitors.map((monitor, index) => ({monitor, index})).sort((a, b) => a.monitor.y - b.monitor.y);
        const upper = ordered[0].index;
        const lower = ordered[1].index;
        assert(monitors[upper].x === monitors[lower].x && monitors[upper].y + monitors[upper].height <= monitors[lower].y,
            'Mutter places the real virtual displays above and below each other');
        const placed = (monitor, zone) => {
            const expected = zoneRect(Main.layoutManager.getWorkAreaForMonitor(monitor), zone,
                extension._settings.get_int('window-gap'));
            const actual = window.get_frame_rect();
            return window.get_monitor() === monitor && ['x', 'y', 'width', 'height']
                .every(key => Math.abs(actual[key] - expected[key]) <= 2);
        };
        extension._tiler.apply(window, 'center', lower, {animate: false});
        window.activate(global.get_current_time());
        await Scripting.sleep(150);
        await chord(Clutter.KEY_Up);
        assert(placed(lower, 'top'), 'first Super+Alt+Up places the window in its current monitor top half');
        await chord(Clutter.KEY_Up);
        assert(placed(upper, 'bottom'), 'repeated Super+Alt+Up moves to the upper monitor bottom half');
        await chord(Clutter.KEY_Up);
        assert(placed(upper, 'top'), 'another Up reaches the upper monitor top half');
        await chord(Clutter.KEY_Up);
        assert(placed(lower, 'bottom'), 'Up at the outer top edge wraps to the lowest monitor bottom half');
        await chord(Clutter.KEY_Down);
        assert(placed(upper, 'top'), 'Down at the outer bottom edge wraps to the highest monitor top half');
        await chord(Clutter.KEY_Down);
        assert(placed(upper, 'bottom'), 'another Down reaches the upper monitor bottom half');
        await chord(Clutter.KEY_Down);
        assert(placed(lower, 'top'), 'repeated Super+Alt+Down moves to the lower monitor top half');
        await testWrapAnimations(extension, window, assert, {vertical: true});
    } finally {
        extension._tiler.finishAnimations();
        extension._tiler.restore(window);
        extension._tiler.finishAnimations();
        await apply(original);
        window.move_to_monitor(beforeMonitor);
        window.move_resize_frame(true, before.x, before.y, before.width, before.height);
        window.activate(global.get_current_time());
        await Scripting.sleep(250);
        await Scripting.waitTestWindows();
    }
}

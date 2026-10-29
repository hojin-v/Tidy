import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {zoneRect} from '../lib/layouts.js';

const rect = window => {
    const {x, y, width, height} = window.get_frame_rect();
    return {x, y, width, height};
};
const near = (actual, expected) => ['x', 'y', 'width', 'height'].every(key => Math.abs(actual[key] - expected[key]) <= 2);
const hasLabel = actor => actor instanceof St.Label || actor.get_children().some(hasLabel);

export async function testAssistPicker(extension, windows, assert, press) {
    await Scripting.waitTestWindows();
    const [focused, other] = windows;
    const modalCount = Main.modalCount;
    const monitor = focused.get_monitor();
    const area = Main.layoutManager.getWorkAreaForMonitor(monitor);
    const gap = extension._settings.get_int('window-gap');
    const show = async (zones = ['left', 'right']) => {
        extension._place(focused, 'left', monitor, zones);
        await Scripting.sleep(450);
        assert(extension._assist, 'optional assist opens inside the unfilled layout');
        return extension._assist;
    };
    const escape = async () => {
        press(Clutter.KEY_Escape, Clutter.KeyState.PRESSED);
        press(Clutter.KEY_Escape, Clutter.KeyState.RELEASED);
        await Scripting.sleep(100);
    };
    extension._settings.set_boolean('snap-assist', true);
    let assist = await show();
    assert(assist.regions.length === 1 && near(assist.regions[0].rect, zoneRect(area, 'right', gap)),
        'assist visible surface occupies only the remaining half of the monitor');
    assert(!assist.actor.style_class && !hasLabel(assist.actor) && assist.regions[0].buttons.length > 0,
        'assist presents application icons without a fullscreen dimmer or text popup');
    const originalOther = rect(other);
    const placed = rect(focused);
    if (GLib.getenv('WINTILING_CAPTURE_ASSIST') === '1') {
        const file = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_child('docs/assist-preview.png');
        const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
        await new Promise((resolve, reject) => {
            new Shell.Screenshot().screenshot_area(area.x, area.y, area.width, area.height, stream, (source, result) => {
                try {
                    source.screenshot_area_finish(result);
                    stream.close(null);
                    resolve();
                } catch (error) { reject(error); }
            });
        });
    }
    await escape();
    assert(!extension._assist && Main.modalCount === modalCount && near(rect(other), originalOther) && near(rect(focused), placed),
        `Escape finishes assist without changing any window geometry (open=${Boolean(extension._assist)}, modal=${Main.modalCount}/${modalCount}, other=${JSON.stringify(rect(other))}/${JSON.stringify(originalOther)}, placed=${JSON.stringify(rect(focused))}/${JSON.stringify(placed)})`);
    assist = await show();
    const result = extension._onCapturedEvent({type: () => Clutter.EventType.BUTTON_PRESS,
        get_coords: () => [placed.x + placed.width / 2, placed.y + placed.height / 2]});
    assert(result === Clutter.EVENT_STOP && !extension._assist && near(rect(other), originalOther),
        'clicking the placed window dismisses assist without an additional placement');
    other.minimize();
    // GNOME's minimize animation temporarily inhibits window movement.
    await Scripting.sleep(450);
    assist = await show();
    const entry = assist.regions[0].buttons.find(candidate => candidate.window === other);
    assert(entry, 'running apps with minimized windows are available as icons');
    entry.button.emit('clicked', 1);
    await Scripting.sleep(350);
    assert(!other.minimized && near(rect(other), zoneRect(area, 'right', gap)) &&
        !extension._assist && Main.modalCount === modalCount,
        'selecting an application icon restores and tiles its window in the chosen region');
    await Scripting.createTestWindow({width: 320, height: 240});
    await Scripting.waitTestWindows();
    await Scripting.sleep(150);
    const third = global.display.get_tab_list(0, global.workspace_manager.get_active_workspace())
        .find(window => !windows.includes(window));
    assist = await show(['left', 'top-right', 'bottom-right']);
    assert(assist.regions.length === 2 && assist.regions.every(region => region.buttons.length === 1),
        'each empty quarter shows one icon per eligible application');
    const top = assist.regions.find(region => region.zone === 'top-right');
    const selected = top.buttons[0].window;
    const untouched = selected === third ? other : third;
    const beforeUntouched = rect(untouched);
    top.buttons[0].button.emit('clicked', 1);
    await Scripting.sleep(300);
    assert(extension._assist?.regions.length === 1 && extension._assist.regions[0].zone === 'bottom-right' &&
        near(rect(selected), zoneRect(area, 'top-right', gap)),
        'choosing a quarter removes that region and keeps icons in the remaining quarter');
    await escape();
    assert(!extension._assist && near(rect(untouched), beforeUntouched) &&
        near(rect(selected), zoneRect(area, 'top-right', gap)),
        'cancelling a partially filled layout preserves completed placements and untouched windows');
    await show();
    extension._settings.set_boolean('snap-assist', false);
    assert(!extension._assist && Main.modalCount === modalCount,
        'turning off assist removes its surfaces and releases input immediately');
    third.delete(global.get_current_time());
    extension._tiler.restore(other);
    focused.activate(global.get_current_time());
    await Scripting.sleep(250);
}

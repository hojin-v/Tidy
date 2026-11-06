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
const hasWindowPreview = entry => entry.surface instanceof Clutter.Clone &&
    entry.surface.source === entry.window.get_compositor_private() && entry.clone.mapped &&
    entry.clone.width > 0 && entry.clone.height > 0 && entry.title.text === entry.window.get_title();

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
    const capture = async file => {
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
    };
    extension._settings.set_boolean('snap-assist', true);
    let assist = await show();
    assert(assist.regions.length === 1 && near(assist.regions[0].rect, zoneRect(area, 'right', gap)),
        'assist visible surface occupies only the remaining half of the monitor');
    assert(!assist.actor.style_class && hasLabel(assist.actor) &&
        assist.regions[0].buttons.length > 0 && assist.regions[0].buttons.every(hasWindowPreview),
        'assist presents live window surfaces and visible window titles inside the empty region');
    const originalOther = rect(other);
    const placed = rect(focused);
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
    assert(entry && hasWindowPreview(entry) && other.minimized && near(rect(other), originalOther),
        'a minimized window has its own live preview without being restored or moved');
    if (GLib.getenv('WINTILING_CAPTURE_ASSIST') === '1')
        await capture(Gio.File.new_for_path(`${GLib.get_tmp_dir()}/tidy-assist-minimized.png`));
    entry.button.emit('clicked', 1);
    await Scripting.sleep(350);
    assert(!other.minimized && near(rect(other), zoneRect(area, 'right', gap)) &&
        !extension._assist && Main.modalCount === modalCount,
        'selecting the minimized window preview restores and tiles that exact window');
    await Scripting.createTestWindow({width: 320, height: 240});
    await Scripting.waitTestWindows();
    await Scripting.sleep(150);
    const third = global.display.get_tab_list(0, global.workspace_manager.get_active_workspace())
        .find(window => !windows.includes(window));
    assist = await show(['left', 'top-right', 'bottom-right']);
    const tracker = Shell.WindowTracker.get_default();
    assert(tracker.get_window_app(other) === tracker.get_window_app(third), 'candidate windows belong to the same application');
    assert(assist.regions.length === 2 && assist.regions.every(region => region.buttons.length === 2 &&
        region.buttons.some(candidate => candidate.window === other) &&
        region.buttons.some(candidate => candidate.window === third) && region.buttons.every(hasWindowPreview)),
        'each empty quarter shows separate live previews for both windows of the same application');
    if (GLib.getenv('WINTILING_CAPTURE_ASSIST') === '1')
        await capture(Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_child('docs/assist-preview.png'));
    const top = assist.regions.find(region => region.zone === 'top-right');
    const selected = third;
    const untouched = other;
    const beforeUntouched = rect(untouched);
    top.buttons.find(candidate => candidate.window === selected).button.emit('clicked', 1);
    await Scripting.sleep(300);
    assert(extension._assist?.regions.length === 1 && extension._assist.regions[0].zone === 'bottom-right' &&
        near(rect(selected), zoneRect(area, 'top-right', gap)),
        'choosing a specific window fills that quarter and leaves only the other window preview');
    assert(extension._assist.regions[0].buttons.length === 1 &&
        extension._assist.regions[0].buttons[0].window === untouched && near(rect(untouched), beforeUntouched),
        'selecting one window of an application never moves its other window');
    await escape();
    assert(!extension._assist && near(rect(untouched), beforeUntouched) &&
        near(rect(selected), zoneRect(area, 'top-right', gap)),
        'cancelling a partially filled layout preserves completed placements and untouched windows');
    assist = await show(['left', 'top-right', 'bottom-right']);
    assist.regions.find(region => region.zone === 'top-right').buttons
        .find(candidate => candidate.window === other).button.emit('clicked', 1);
    await Scripting.sleep(300);
    extension._assist.regions[0].buttons.find(candidate => candidate.window === third).button.grab_key_focus();
    press(Clutter.KEY_Return, Clutter.KeyState.PRESSED);
    press(Clutter.KEY_Return, Clutter.KeyState.RELEASED);
    await Scripting.sleep(300);
    assert(!extension._assist && Main.modalCount === modalCount &&
        near(rect(other), zoneRect(area, 'top-right', gap)) && near(rect(third), zoneRect(area, 'bottom-right', gap)),
        'both windows of the same application can fill separate regions using mouse or keyboard');
    assist = await show();
    const closedPreviews = assist.regions[0].buttons.filter(candidate => candidate.window === third);
    let destroyedPreviews = 0;
    for (const candidate of closedPreviews) candidate.clone.connect('destroy', () => destroyedPreviews++);
    third.delete(global.get_current_time());
    await Scripting.sleep(350);
    assert(extension._assist && extension._assist.regions[0].buttons.length === 1 &&
        extension._assist.regions[0].buttons[0].window === other && destroyedPreviews === closedPreviews.length,
        'closing one window removes its preview while retaining the other window of the same application');
    const beforeNew = global.display.get_tab_list(0, global.workspace_manager.get_active_workspace());
    await Scripting.createTestWindow({width: 340, height: 260});
    await Scripting.waitTestWindows();
    await Scripting.sleep(200);
    const fourth = global.display.get_tab_list(0, global.workspace_manager.get_active_workspace())
        .find(window => !beforeNew.includes(window));
    assert(extension._assist.regions[0].buttons.some(candidate => candidate.window === fourth && hasWindowPreview(candidate)),
        'a newly opened window is added to the existing assist with its own preview');
    const resizing = extension._assist.regions[0].buttons.find(candidate => candidate.window === fourth);
    fourth.move_resize_frame(true, area.x + 30, area.y + 40, 300, 500);
    await Scripting.sleep(150);
    const resized = fourth.get_frame_rect();
    assert(Math.abs(resizing.clone.width / resizing.clone.height - resized.width / resized.height) < 0.01,
        'a preview keeps the native window aspect ratio when its window is resized');
    await escape();
    const beforeExtra = global.display.get_tab_list(0, global.workspace_manager.get_active_workspace());
    for (let index = 0; index < 7; index++) await Scripting.createTestWindow({width: 320, height: 240});
    await Scripting.waitTestWindows();
    await Scripting.sleep(200);
    const extra = global.display.get_tab_list(0, global.workspace_manager.get_active_workspace())
        .filter(window => !beforeExtra.includes(window));
    assist = await show(['left', 'top-right', 'bottom-right']);
    const region = assist.regions[0];
    const last = region.buttons.at(-1);
    last.button.grab_key_focus();
    await Scripting.sleep(100);
    const [sx, sy] = region.scroll.get_transformed_position();
    const [bx, by] = last.button.get_transformed_position();
    assert(region.buttons.length === 9 && region.scroll.vadjustment.value > 0 &&
        by >= sy - 1 && by + last.button.height <= sy + region.scroll.height + 1,
        'many windows scroll inside the empty region and keyboard focus reveals the chosen preview');
    assert(assist.hit(bx + last.button.width / 2, by + last.button.height / 2) &&
        assist.hit(sx + region.scroll.width - 2, sy + region.scroll.height / 2) &&
        !assist.hit(sx + region.scroll.width / 2, region.rect.y - 1),
        'preview and scrollbar clicks stay inside assist while clipped content cannot intercept outside clicks');
    extension._settings.set_boolean('snap-assist', false);
    assert(!extension._assist && Main.modalCount === modalCount && !assist._signals.length && !assist._refreshId,
        'turning off assist removes its previews, signals, pending refresh and modal input immediately');
    for (const window of extra) window.delete(global.get_current_time());
    fourth.delete(global.get_current_time());
    extension._tiler.restore(other);
    focused.activate(global.get_current_time());
    await Scripting.sleep(250);
}

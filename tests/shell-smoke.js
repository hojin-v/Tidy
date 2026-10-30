// Run in an isolated, headless GNOME Shell, never in the user's session.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {testSharedResize} from './sharedResize-smoke.js';
import {testWindowAnimations} from './windowAnimations-smoke.js';
import {testWrapAnimations} from './wrapAnimations-smoke.js';
import {testOverviewDrag} from './overviewDrag-smoke.js';
import {testOverviewDrop} from './overviewDrop-smoke.js';
import {testOverviewTransition} from './overviewTransition-smoke.js';
import {testPickerVisual} from './pickerVisual-smoke.js';
import {testAssistPicker} from './assistPicker-smoke.js';
import {_} from '../lib/i18n.js';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async', 'communicate_utf8_finish');

export const METRICS = {};

export function init() {
    // Avoid the overview's startup animation waiting for physical input on a
    // virtual monitor. This setting belongs to the isolated test compositor.
    Main.layoutManager._startInOverview = false;
}

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
    print(`PASS: ${message}`);
}

function nearRect(actual, expected) {
    return ['x', 'y', 'width', 'height'].every(key => Math.abs(actual[key] - expected[key]) <= 2);
}

function plain(rect) {
    return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
}

export async function run() {
    await Scripting.sleep(1500);
    Main.overview.hide();
    await Scripting.sleep(500);
    const extension = Extension.lookupByUUID('winubun@winubun.local');
    const record = Main.extensionManager.lookup('winubun@winubun.local');
    assert(extension?._tiler && !record.error, `extension enabled (${record.error ?? 'no error'})`);
    assert(extension._bindings.length === 17, 'all 17 Super+Alt keybindings registered');
    assert(!extension._palette.actor.visible && !extension._palette.preview.visible, 'transient drag UI starts hidden');
    assert(!extension._settings.get_boolean('snap-assist'), 'snap assist defaults to off');
    const root = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent();
    const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE});
    launcher.setenv('GSETTINGS_BACKEND', 'memory', true);
    launcher.setenv('GI_TYPELIB_PATH', '/usr/lib/gnome-shell/girepository-1.0', true);
    launcher.setenv('LD_LIBRARY_PATH', '/usr/lib/gnome-shell', true);
    launcher.setenv('GSETTINGS_SCHEMA_DIR', extension.dir.get_child('schemas').get_path(), true);
    for (const language of ['en', 'ko']) {
        launcher.setenv('LANGUAGE', language, true);
        const preferences = launcher.spawnv(['gjs', '-m', root.get_child('tests/preferences-smoke.js').get_path()]);
        const [output, errors] = await preferences.communicate_utf8_async(null, null);
        print(output);
        if (errors) print(errors);
        assert(preferences.get_successful(), `native GTK preferences and shortcut capture pass in ${language}`);
    }
    const installedManager = extension.dir.get_child('scripts/manage.py');
    assert(installedManager.query_exists(null) && extension.dir.get_child('scripts/i18n.py').query_exists(null) &&
        extension.dir.get_child('scripts/recover.js').query_exists(null),
        'installed package includes startup, preferences and recovery tools');
    const npmInstaller = Gio.Subprocess.new(['node', root.get_child('bin/tidy.js').get_path(), 'install'],
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    const [npmOutput, npmErrors] = await npmInstaller.communicate_utf8_async(null, null);
    print(npmOutput);
    assert(npmInstaller.get_successful() && extension._tiler && extension._palette,
        `npm CLI installs its bundled ZIP in the isolated GNOME session (${npmErrors})`);
    const appLauncher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE});
    appLauncher.set_cwd(GLib.get_tmp_dir());
    for (const command of ['apply-update', 'launch']) {
        const process = appLauncher.spawnv(['/usr/bin/python3', installedManager.get_path(), command]);
        const [launchOutput, launchErrors] = await process.communicate_utf8_async(null, null);
        print(launchOutput);
        assert(process.get_successful(), `installed ${command} works without the source directory as its working directory (${launchErrors})`);
    }
    let settingsWindow;
    for (let attempt = 0; attempt < 30; attempt++) {
        await Scripting.sleep(100);
        settingsWindow = global.get_window_actors().map(actor => actor.meta_window)
            .find(candidate => candidate.get_gtk_application_id() === 'local.winubun.Settings');
        if (settingsWindow)
            break;
    }
    assert(settingsWindow?.get_title() === _('Tidy Settings'), 'desktop launcher maps the standalone preferences window');
    settingsWindow.delete(global.get_current_time());
    await Scripting.sleep(200);
    // Both helpers must fit a quarter of the smaller monitor; their requested
    // size can also become the client's minimum size on this backend.
    await Scripting.createTestWindow({width: 600, height: 300});
    await Scripting.createTestWindow({width: 500, height: 280});
    await Scripting.waitTestWindows();
    await Scripting.sleep(500);
    const windows = global.display.get_tab_list(0, global.workspace_manager.get_active_workspace());
    assert(windows.length >= 2, 'real Wayland windows created');
    const window = windows[0];
    const leftmost = Main.layoutManager.monitors.reduce((best, monitor, index, monitors) =>
        monitor.x < monitors[best].x ? index : best, 0);
    window.move_to_monitor(leftmost);
    await Scripting.sleep(150);
    const original = window.get_frame_rect();
    const area = Main.layoutManager.getWorkAreaForMonitor(window.get_monitor());
    extension._place(window, 'left', window.get_monitor(), ['left', 'right']);
    await Scripting.sleep(400);
    const left = window.get_frame_rect();
    assert(Math.abs(left.x - area.x - 4) <= 2 && Math.abs(left.width - Math.round(area.width / 2) + 8) <= 2,
        'window snapped to left half with gap');
    assert(!extension._dialog, 'no compulsory follow-up chooser');
    extension._tiler.apply(window, 'maximize');
    await Scripting.sleep(300);
    assert(window.maximized_horizontally && window.maximized_vertically, 'GNOME 50 maximize API works');
    extension._tiler.restore(window);
    await Scripting.sleep(300);
    const restoredRect = window.get_frame_rect();
    assert(nearRect(restoredRect, original), 'original window rectangle restored');
    await testSharedResize(extension, windows, assert);
    extension._tiler.restore(window);
    await Scripting.sleep(300);
    const keyboard = global.stage.get_context().get_backend().get_default_seat()
        .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    const keycodes = new Map([
        [Clutter.KEY_Super_L, 125], [Clutter.KEY_Alt_L, 56], [Clutter.KEY_Return, 28],
        [Clutter.KEY_Left, 105], [Clutter.KEY_Right, 106], [Clutter.KEY_Up, 103],
        [Clutter.KEY_Down, 108], [Clutter.KEY_Escape, 1], [Clutter.KEY_b, 48],
        [Clutter.KEY_a, 30],
    ]);
    const press = (key, state) => keyboard.notify_key(GLib.get_monotonic_time(), keycodes.get(key), state);
    const chord = async key => {
        for (const item of [Clutter.KEY_Super_L, Clutter.KEY_Alt_L])
            press(item, Clutter.KeyState.PRESSED);
        await Scripting.sleep(30);
        press(key, Clutter.KeyState.PRESSED);
        await Scripting.sleep(30);
        for (const item of [key, Clutter.KEY_Alt_L, Clutter.KEY_Super_L])
            press(item, Clutter.KeyState.RELEASED);
        await Scripting.sleep(400);
    };
    await testWindowAnimations(extension, window, assert);
    await testWrapAnimations(extension, window, assert);
    const mutterKeys = new Gio.Settings({schema_id: 'org.gnome.mutter.keybindings'});
    const wmKeys = new Gio.Settings({schema_id: 'org.gnome.desktop.wm.keybindings'});
    const nativeLeft = mutterKeys.get_value('toggle-tiled-left');
    const nativeRight = mutterKeys.get_value('toggle-tiled-right');
    // Include an alternate shortcut to verify only Super+arrows are removed.
    wmKeys.set_strv('maximize', ['<Super>Up', '<Alt>F10']);
    extension._settings.set_boolean('disable-native-tiling-shortcuts', true);
    assert(!mutterKeys.get_strv('toggle-tiled-left').includes('<Super>Left') &&
        !mutterKeys.get_strv('toggle-tiled-right').includes('<Super>Right') &&
        wmKeys.get_strv('maximize').join(',') === '<Alt>F10',
        'native Super+arrows can be disabled without removing alternate shortcuts');
    window.activate(global.get_current_time());
    await Scripting.sleep(150);
    const beforeNative = window.get_frame_rect();
    press(Clutter.KEY_Super_L, Clutter.KeyState.PRESSED);
    await Scripting.sleep(30);
    press(Clutter.KEY_Left, Clutter.KeyState.PRESSED);
    await Scripting.sleep(30);
    press(Clutter.KEY_Left, Clutter.KeyState.RELEASED);
    press(Clutter.KEY_Super_L, Clutter.KeyState.RELEASED);
    await Scripting.sleep(300);
    assert(nearRect(window.get_frame_rect(), beforeNative) && !extension._superPicker,
        'disabled Super+Left does not move the window or open the picker');
    await chord(Clutter.KEY_Left);
    assert(extension._tiler._placements.get(window) === 'left', 'Super+Alt placement still works with native shortcuts disabled');
    extension._settings.set_boolean('disable-native-tiling-shortcuts', false);
    assert(mutterKeys.get_value('toggle-tiled-left').equal(nativeLeft) &&
        mutterKeys.get_value('toggle-tiled-right').equal(nativeRight) &&
        wmKeys.get_strv('maximize').join(',') === '<Super>Up,<Alt>F10',
        'turning off native shortcut suppression restores previous bindings immediately');
    wmKeys.reset('maximize');
    extension._tiler.restore(window);
    await Scripting.sleep(300);
    window.activate(global.get_current_time());
    await Scripting.sleep(100);
    extension._settings.set_boolean('super-key-picker', false);
    extension._settings.set_boolean('super-key-picker', true);
    const originalSearchMargin = Main.overview._overview.controls._searchEntryBin.margin_top;
    const originalSearchOpacity = Main.overview._overview.controls._searchEntry.opacity;
    // Keep GNOME's native overview, keyboard search and apps alongside the picker.
    press(Clutter.KEY_Super_L, Clutter.KeyState.PRESSED);
    await Scripting.sleep(120);
    press(Clutter.KEY_Super_L, Clutter.KeyState.RELEASED);
    await Scripting.sleep(500);
    assert(extension._superPicker && extension._palette.isOpen && Main.overview.visible, 'bare Super opens both the native overview and top picker');
    assert(extension._palette.actor.mapped && extension._palette.actor.opacity === 255,
        'Super picker is actually mapped and opaque alongside the overview');
    const [, baseWidth] = extension._palette.actor.get_preferred_width(-1);
    const overviewArea = Main.layoutManager.getWorkAreaForMonitor(extension._superPicker.monitor);
    assert(extension._settings.get_int('overview-picker-scale') === 100 && extension._palette.scale === 1 &&
        extension._palette.actor.scale_x === 1 && extension._palette.actor.scale_y === 1,
        'overview and normal pickers default to the same native size');
    const triggerDelay = extension._settings.get_int('trigger-delay');
    extension._settings.set_int('picker-scale', 120);
    await Scripting.sleep(400);
    assert(Math.abs(extension._palette.actor.get_transformed_size()[0] - Math.min(baseWidth * 1.2, overviewArea.width - 24)) <= 8 &&
        extension._settings.get_int('trigger-delay') === triggerDelay,
        'picker size changes apply immediately without changing its activation delay');
    extension._settings.set_int('overview-picker-scale', 125);
    await Scripting.sleep(400);
    assert(Math.abs(extension._palette.actor.get_transformed_size()[0] - Math.min(baseWidth * 1.5, overviewArea.width - 24)) <= 8 &&
        extension._palette.actor.scale_x === 1,
        'overview size can be adjusted independently using native diagram dimensions');
    extension._settings.reset('overview-picker-scale');
    extension._settings.reset('picker-scale');
    await Scripting.sleep(400);
    await testPickerVisual(extension, assert);
    await testOverviewDrag(extension, windows, assert);
    await Scripting.waitTestWindows();
    assert(Main.actionMode === Shell.ActionMode.OVERVIEW && !extension._superPicker.grab,
        'native overview keeps input control without an extra modal grab');
    const search = Main.overview._overview.controls._searchEntry;
    assert(search.opacity === 0 && !search.reactive && !search.can_focus,
        'empty overview search is hidden and does not intercept clicks or Tab focus');
    if (window.get_monitor() === Main.layoutManager.primaryIndex) {
        const [, sy] = search.get_transformed_position();
        const [, py] = extension._palette.actor.get_transformed_position();
        const [, ph] = extension._palette.actor.get_transformed_size();
        assert(sy >= py + ph, 'overview search is placed below the layout diagrams');
    }
    press(Clutter.KEY_Super_L, Clutter.KeyState.PRESSED);
    press(Clutter.KEY_Super_L, Clutter.KeyState.RELEASED);
    await Scripting.sleep(500);
    assert(!extension._superPicker && !extension._palette.actor.visible && !Main.overview.visible, 'a second Super closes both overview and picker');
    assert(Main.overview._overview.controls._searchEntryBin.margin_top === originalSearchMargin,
        'closing overview restores its original search spacing');
    assert(search.opacity === originalSearchOpacity, 'closing overview restores its original search visibility');
    press(Clutter.KEY_Super_L, Clutter.KeyState.PRESSED);
    press(Clutter.KEY_Super_L, Clutter.KeyState.RELEASED);
    await Scripting.sleep(500);
    assert(extension._palette.actor.mapped && extension._palette.actor.opacity === 255,
        'reopening the Super picker finishes its entrance animation');
    extension._settings.set_boolean('super-key-picker', false);
    assert(Main.overview.visible && !extension._superPicker &&
        Main.overview._overview.controls._searchEntryBin.margin_top === originalSearchMargin,
        'disabling the picker while overview is open preserves the native overview and restores spacing');
    assert(search.opacity === originalSearchOpacity && search.can_focus, 'disabling the picker restores native search interaction');
    extension._settings.set_boolean('super-key-picker', true);
    await Scripting.sleep(250);
    // Pointer input is injected because this headless backend drops virtual
    // mouse events; the key events and resulting native windows are real.
    assert(extension._onCapturedEvent({type: () => Clutter.EventType.BUTTON_PRESS, get_coords: () => [0, 400]}) === Clutter.EVENT_PROPAGATE,
        'clicks outside the palette pass to native overview windows and apps');
    press(Clutter.KEY_Super_L, Clutter.KeyState.PRESSED);
    await Scripting.sleep(30);
    press(Clutter.KEY_a, Clutter.KeyState.PRESSED);
    press(Clutter.KEY_a, Clutter.KeyState.RELEASED);
    press(Clutter.KEY_Super_L, Clutter.KeyState.RELEASED);
    await Scripting.sleep(500);
    assert(Main.overview.dash.showAppsButton.checked && extension._palette.actor.mapped,
        'Super+A switches to the native application grid with the picker still visible');
    press(Clutter.KEY_b, Clutter.KeyState.PRESSED);
    press(Clutter.KEY_b, Clutter.KeyState.RELEASED);
    await Scripting.sleep(300);
    assert(search.get_text() === 'b', 'typing still starts the native overview search');
    assert(search.opacity === originalSearchOpacity && search.reactive, 'typing reveals the search field on demand');
    press(Clutter.KEY_Escape, Clutter.KeyState.PRESSED);
    press(Clutter.KEY_Escape, Clutter.KeyState.RELEASED);
    await Scripting.sleep(300);
    assert(search.get_text() === '' && extension._superPicker, 'Escape clears native search without dismissing the picker alone');
    assert(search.opacity === 0, 'clearing search hides the empty field again');
    Main.activateWindow(windows[1]);
    await Scripting.sleep(500);
    assert(!Main.overview.visible && !extension._superPicker, 'native window activation closes overview and picker together');
    window.activate(global.get_current_time());
    press(Clutter.KEY_Super_L, Clutter.KeyState.PRESSED);
    press(Clutter.KEY_Super_L, Clutter.KeyState.RELEASED);
    await Scripting.sleep(500);
    const thumbnail = window._delegate.window_container;
    const [thumbnailX, thumbnailY] = thumbnail.get_transformed_position();
    extension._palette._targets.find(target => target.zone === 'right').button.emit('clicked', 1);
    const transition = extension._overviewTransition.entry;
    assert(transition?.surface instanceof Clutter.Clone && transition.surface.source === window.get_compositor_private(),
        'overview transition renders the live client buffer instead of a stretched bitmap');
    assert(extension._overviewTransition._previews(window).every(preview => preview.opacity === 0),
        'native copies of the selected window are hidden during the live transition');
    assert(transition && Main.overview.closing && transition.clone.visible &&
        Math.abs(transition.source.x - thumbnailX) <= 2 && Math.abs(transition.source.y - thumbnailY) <= 2,
        'layout selection starts from the visible thumbnail while the overview exits');
    assert(extension._tiler._placements.get(window) === 'right' && !extension._tiler._animations._running.has(window),
        'overview placement commits immediately without a second desktop move animation');
    await Scripting.sleep(80);
    assert(extension._overviewTransition.entry === transition && !transition.motionDone &&
        transition.clone.x !== transition.source.x,
        'thumbnail moves toward the layout during the overview exit');
    if (GLib.getenv('WINTILING_CAPTURE_TRANSITION') === '1') {
        const view = Main.layoutManager.getWorkAreaForMonitor(window.get_monitor());
        const file = Gio.File.new_for_path('/tmp/wintiling-transition.png');
        const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
        await new Promise((resolve, reject) => {
            new Shell.Screenshot().screenshot_area(view.x, view.y, view.width, view.height, stream, (source, result) => {
                try {
                    source.screenshot_area_finish(result);
                    stream.close(null);
                    resolve();
                } catch (error) { reject(error); }
            });
        });
    }
    await Scripting.sleep(670);
    assert(!extension._superPicker && Math.abs(window.get_frame_rect().x - area.x - Math.round(area.width / 2) - 4) <= 2,
        'choosing a Super picker diagram places the previously focused window');
    assert(!extension._overviewTransition.entry && window.get_compositor_private().opacity === 255,
        'continuous overview transition restores the live window and removes its snapshot');
    await testOverviewDrop(extension, windows, assert);
    await testOverviewTransition(extension, windows, assert);
    // PerfHelper exits after 30 seconds without a D-Bus request. Refresh it
    // after the longer overview cases so the remaining tests keep real windows.
    await Scripting.waitTestWindows();
    extension._settings.set_boolean('super-key-picker', false);
    press(Clutter.KEY_Super_L, Clutter.KeyState.PRESSED);
    press(Clutter.KEY_Super_L, Clutter.KeyState.RELEASED);
    await Scripting.sleep(500);
    assert(Main.overview.visible && !extension._superPicker, 'disabling Super picker restores GNOME overview behavior');
    press(Clutter.KEY_Escape, Clutter.KeyState.PRESSED);
    press(Clutter.KEY_Escape, Clutter.KeyState.RELEASED);
    await Scripting.sleep(500);
    assert(!extension._palette.actor.visible && !extension._palette.preview.visible, 'leaving overview does not resurrect hidden drag UI');
    Main.overview.hide();
    extension._settings.set_boolean('super-key-picker', true);
    // Overview tests finish in a left tile. Start from another layout so the
    // first Left below tests a half snap rather than the new outer-edge wrap.
    extension._tiler.apply(window, 'top', leftmost, {animate: false});
    window.activate(global.get_current_time());
    await Scripting.sleep(150);
    await chord(Clutter.KEY_Left);
    assert(!extension._superPicker, 'Super+Alt shortcuts do not trigger the bare Super picker');
    assert(Math.abs(window.get_frame_rect().x - area.x - 4) <= 2, 'Super+Alt+Left snaps to left half');
    const halfBeforeMax = window.get_frame_rect();
    await chord(Clutter.KEY_Return);
    assert(window.maximized_horizontally && window.maximized_vertically, 'Super+Alt+Enter maximizes');
    await chord(Clutter.KEY_Return);
    assert(nearRect(window.get_frame_rect(), halfBeforeMax), 'Super+Alt+Enter restores the previous half placement');
    await chord(Clutter.KEY_Up);
    assert(Math.abs(window.get_frame_rect().height - Math.round(area.height / 2) + 8) <= 2 &&
        Math.abs(window.get_frame_rect().y - area.y - 4) <= 2,
        `Super+Alt+Up snaps to top half (rect=${JSON.stringify(plain(window.get_frame_rect()))}, expected=${JSON.stringify(plain(area))}, placement=${extension._tiler._placements.get(window)})`);
    await chord(Clutter.KEY_Down);
    assert(Math.abs(window.get_frame_rect().y - area.y - Math.round(area.height / 2) - 4) <= 2,
        `Super+Alt+Down snaps to bottom half (actual=${window.get_frame_rect().y}, expected=${area.y + Math.round(area.height / 2) + 4})`);
    await chord(Clutter.KEY_Right);
    const beforeRepeat = window.get_monitor();
    await chord(Clutter.KEY_Right);
    assert(Main.layoutManager.monitors[window.get_monitor()].x > Main.layoutManager.monitors[beforeRepeat].x,
        'repeated right shortcut moves to the physically right monitor');
    const incoming = Main.layoutManager.getWorkAreaForMonitor(window.get_monitor());
    assert(Math.abs(window.get_frame_rect().x - incoming.x - 4) <= 2, 'right monitor entry uses its left half');
    await chord(Clutter.KEY_Right);
    const farRight = window.get_monitor();
    await chord(Clutter.KEY_Right);
    assert(window.get_monitor() === beforeRepeat && extension._tiler._placements.get(window) === 'left',
        'right shortcut at the outer right edge wraps to the leftmost monitor left half');
    await chord(Clutter.KEY_Left);
    assert(window.get_monitor() === farRight && extension._tiler._placements.get(window) === 'right',
        'left shortcut at the outer left edge wraps to the rightmost monitor right half');
    await chord(Clutter.KEY_Left);
    await chord(Clutter.KEY_Left);
    assert(window.get_monitor() === beforeRepeat, 'repeated left shortcut returns to the physically left monitor');
    await chord(Clutter.KEY_Left);
    extension._settings.set_strv('snap-right', ['<Super><Alt>b']);
    await Scripting.sleep(150);
    press(Clutter.KEY_Super_L, Clutter.KeyState.PRESSED);
    press(Clutter.KEY_Alt_L, Clutter.KeyState.PRESSED);
    press(Clutter.KEY_b, Clutter.KeyState.PRESSED);
    press(Clutter.KEY_b, Clutter.KeyState.RELEASED);
    press(Clutter.KEY_Alt_L, Clutter.KeyState.RELEASED);
    press(Clutter.KEY_Super_L, Clutter.KeyState.RELEASED);
    await Scripting.sleep(350);
    assert(Math.abs(window.get_frame_rect().x - area.x - Math.round(area.width / 2) - 4) <= 2,
        'remapped key combination works immediately');
    extension._settings.reset('snap-right');
    assert(Main.layoutManager.monitors.length === 2, 'two virtual monitors available');
    const monitorBefore = window.get_monitor();
    extension._tiler.nextMonitor(window);
    await Scripting.sleep(350);
    const nextArea = Main.layoutManager.getWorkAreaForMonitor(window.get_monitor());
    assert(window.get_monitor() !== monitorBefore, 'window moves to external monitor');
    assert(Math.abs(window.get_frame_rect().x - nextArea.x - Math.round(nextArea.width / 2) - 4) <= 2,
        'monitor transfer preserves proportional placement');
    extension._tiler.restore(window);
    await Scripting.sleep(350);
    // Inject grab notifications and pointer samples: the headless backend
    // constrains virtual pointer warps, so physical mouse input is a manual
    // acceptance check. Actual window resizing still runs through Mutter.
    extension._tiler.nextMonitor(window);
    await Scripting.sleep(250);
    const dragArea = Main.layoutManager.getWorkAreaForMonitor(window.get_monitor());
    const readPointer = global.get_pointer;
    let position = [dragArea.x + dragArea.width / 2, dragArea.y + dragArea.height / 2, 256];
    global.get_pointer = () => position;
    global.display.emit('grab-op-begin', window, Meta.GrabOp.MOVING);
    assert(extension._drag, 'move-grab signal starts tracking');
    await Scripting.sleep(350);
    assert(extension._settings.get_boolean('auto-trigger-width') && extension._palette.hint.visible &&
        !extension._palette.isOpen && Math.abs(extension._palette.hint.width - extension._palette.actor.width) <= 1 &&
        extension._palette.hint.height <= 16 && extension._palette.hint.translation_y === 0,
        'dragging shows a slim top hint matching the actual picker width by default');
    position = [extension._palette.actor.x + extension._palette.actor.width - 24, dragArea.y + 48, 256];
    await Scripting.sleep(500);
    assert(extension._palette.actor.visible, 'dragging inside external monitor top opens picker');
    assert(extension._palette.isOpen && !extension._palette.hint.visible &&
        extension._tiler._animations._running.get(window)?.shrinking,
        'the outer picker cells activate beyond the old narrow strip and shrink the dragged window');
    const dropTarget = extension._palette._targets.find(item => item.zone === 'top-left');
    const [dropX, dropY] = dropTarget.button.get_transformed_position();
    const [dropWidth, dropHeight] = dropTarget.button.get_transformed_size();
    position = [dropX + dropWidth / 2, dropY + dropHeight / 2, 256];
    await Scripting.sleep(100);
    assert(extension._drag?.selected?.zone === 'top-left', 'drag hover selects quarter zone');
    if (GLib.getenv('WINUBUN_CAPTURE_PREVIEW') === '1') {
        const actor = extension._palette.actor;
        const [px, py] = actor.get_transformed_position();
        const [pw, ph] = actor.get_transformed_size();
        const file = root.get_child('docs/preview.png');
        const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
        await new Promise((resolve, reject) => {
            new Shell.Screenshot().screenshot_area(Math.floor(px) - 8, Math.floor(py) - 8,
                Math.ceil(pw) + 16, Math.ceil(ph) + 16, stream, (source, result) => {
                    try {
                        source.screenshot_area_finish(result);
                        stream.close(null);
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                });
        });
    }
    global.display.emit('grab-op-end', window, Meta.GrabOp.MOVING);
    await Scripting.sleep(400);
    assert(!extension._drag && !extension._palette.actor.visible, 'release cleans drag UI');
    const dropped = window.get_frame_rect();
    assert(Math.abs(dropped.x - dragArea.x - 4) <= 2 && Math.abs(dropped.width - Math.round(dragArea.width / 2) + 8) <= 2 &&
        Math.abs(dropped.height - Math.round(dragArea.height / 2) + 8) <= 2,
        `drag release snaps to selected external monitor quarter (rect=${JSON.stringify(plain(dropped))}, area=${JSON.stringify(plain(dragArea))}, placement=${extension._tiler._placements.get(window)})`);
    global.display.emit('grab-op-begin', window, Meta.GrabOp.MOVING);
    await Scripting.sleep(350);
    press(Clutter.KEY_Escape, Clutter.KeyState.PRESSED);
    press(Clutter.KEY_Escape, Clutter.KeyState.RELEASED);
    await Scripting.sleep(150);
    assert(!extension._drag, 'Escape cancels an active selection even when an application owns keyboard focus');
    global.display.emit('grab-op-end', window, Meta.GrabOp.MOVING);
    await Scripting.sleep(100);
    assert(!extension._drag && nearRect(window.get_frame_rect(), dropped), 'Escape cancels selection without applying a new tile');
    position = [dragArea.x + dragArea.width / 2, dragArea.y + 48, 256];
    global.display.emit('grab-op-begin', window, Meta.GrabOp.MOVING);
    await Scripting.sleep(300);
    position = [dragArea.x + dragArea.width / 2, dragArea.y + dragArea.height / 2, 0];
    global.display.emit('grab-op-end', window, Meta.GrabOp.MOVING);
    await Scripting.sleep(320);
    assert(!extension._palette.actor.visible && nearRect(window.get_frame_rect(), dropped),
        'releasing over blank space cancels and closes the panel without changing the window');
    for (const [zone, px, py] of [
        ['maximize', dragArea.x + 64, dragArea.y + 2],
        ['left', dragArea.x + 2, dragArea.y + dragArea.height / 2],
        ['right', dragArea.x + dragArea.width - 2, dragArea.y + dragArea.height / 2],
    ]) {
        position = [px, py, 256];
        global.display.emit('grab-op-begin', window, Meta.GrabOp.MOVING);
        await Scripting.sleep(100);
        assert(!extension._palette.actor.visible && extension._drag?.selected?.zone === zone,
            `${zone} edge selects directly without opening the layout menu`);
        global.display.emit('grab-op-end', window, Meta.GrabOp.MOVING);
        await Scripting.sleep(250);
        if (zone === 'maximize')
            assert(window.maximized_horizontally && window.maximized_vertically, 'noncentral top edge maximizes the window');
        else
            assert(Math.abs(window.get_frame_rect().width - Math.round(dragArea.width / 2) + 8) <= 2,
                `${zone} edge drop tiles half the monitor`);
    }
    extension._settings.set_boolean('top-edge-enabled', false);
    position = [dragArea.x + 2, dragArea.y + dragArea.height / 2, 256];
    global.display.emit('grab-op-begin', window, Meta.GrabOp.MOVING);
    await Scripting.sleep(100);
    assert(extension._drag?.selected?.zone === 'left', 'side tiling remains enabled when central picker is disabled');
    extension._dismiss();
    extension._settings.set_boolean('top-edge-enabled', true);
    position = [dragArea.x + dragArea.width / 2, dragArea.y + 48, 256];
    global.display.emit('grab-op-begin', window, Meta.GrabOp.MOVING);
    await Scripting.sleep(250);
    position = [position[0], position[1], 0];
    await Scripting.sleep(320);
    assert(!extension._drag && !extension._palette.actor.visible, 'missing end-grab notification cannot leave the selector stuck after button release');
    global.get_pointer = readPointer;
    extension._tiler.apply(window, 'left', monitorBefore);
    extension._tiler.restore(window);
    // The drag's floating rectangle is restored on its own monitor. Return to
    // the original monitor for the remaining companion-window assertions.
    window.move_to_monitor(monitorBefore);
    await Scripting.sleep(250);
    extension._palette.show(window.get_monitor());
    extension._armEscape();
    await Scripting.sleep(200);
    assert(extension._palette.actor.visible, 'drag palette visible');
    const target = extension._palette._targets[0];
    const [x, y] = target.button.get_transformed_position();
    const [width, height] = target.button.get_transformed_size();
    assert(width > 10 && height > 10, 'layout cells allocated');
    assert(extension._palette.hit(x + width / 2, y + height / 2)?.zone === 'left', 'drag cell hit testing works');
    extension._palette.hide();
    extension._palette.show(window.get_monitor());
    press(Clutter.KEY_Escape, Clutter.KeyState.PRESSED);
    press(Clutter.KEY_Escape, Clutter.KeyState.RELEASED);
    await Scripting.sleep(300);
    assert(!extension._palette.actor.visible, 'Escape dismisses a visible orphaned palette without a drag');
    window.activate(global.get_current_time());
    await Scripting.sleep(100);
    extension._action('picker');
    await Scripting.sleep(200);
    assert(extension._dialog?.visible, 'keyboard layout dialog opens');
    extension._closeDialog();
    // Pending assist must not reopen after a newer keyboard action.
    extension._settings.set_boolean('snap-assist', true);
    extension._place(window, 'left', window.get_monitor(), ['left', 'right']);
    extension._action('restore');
    await Scripting.sleep(350);
    assert(!extension._dialog && !extension._assist, 'new action cancels pending assist');
    extension._settings.set_boolean('snap-assist', false);
    await testAssistPicker(extension, windows, assert, press);
    // Exercise a timer in flight, a drag poll, and a modal during shutdown.
    extension._beginDrag(window);
    extension._later(() => { throw new Error('timer leaked after disable'); }, 600);
    extension._action('picker');
    extension._tiler.apply(window, 'center');
    assert(extension._tiler._animations._running.size > 0, 'window movement animates through a live compositor surface');
    const backup = JSON.parse(extension._settings.get_string('settings-backup'));
    assert(backup.length === 5, 'edge behavior and conflicting workspace/overview shortcuts journaled');
    extension.disable();
    await Scripting.sleep(700);
    assert(!extension._pollId && !extension._sources.size, 'disable removes timers and drag polling');
    assert(!extension._palette && !extension._dialog && !extension._assist, 'disable removes overlays and dialogs');
    assert(window.get_compositor_private().opacity === 255, 'disable restores animated window visibility');
    const settings = new Gio.Settings({schema_id: 'org.gnome.mutter'});
    const saved = backup.find(entry => entry.key === 'edge-tiling');
    const restored = saved.original === null ? settings.get_user_value('edge-tiling') === null :
        settings.get_value('edge-tiling').print(true) === saved.original;
    assert(restored, 'desktop settings restored on disable');
    extension.enable();
    assert(extension._bindings.length === 17, 'extension re-enables cleanly');
    await Scripting.destroyTestWindows();
    print('TIDY SHELL SMOKE PASSED');
}

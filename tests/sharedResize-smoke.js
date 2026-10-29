import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {rectCopy} from '../lib/resizeGeometry.js';

export async function testSharedResize(extension, windows, assert) {
    const [left, right] = windows;
    const monitor = left.get_monitor();
    const tiler = extension._tiler;
    assert(extension._settings.get_boolean('resize-together'), 'shared tiling resize defaults to enabled');
    tiler.apply(left, 'left', monitor);
    tiler.apply(right, 'right', monitor);
    await Scripting.sleep(400);
    const l = rectCopy(left.get_frame_rect());
    const r = rectCopy(right.get_frame_rect());
    global.display.emit('grab-op-begin', left, Meta.GrabOp.RESIZING_E);
    assert(extension._sharedResize._session?.window === left, 'resize grab discovers a tiled neighbor');
    left.move_resize_frame(true, l.x, l.y, l.width + 100, l.height);
    await Scripting.sleep(250);
    assert(Math.abs(right.get_frame_rect().x - r.x - 100) <= 2 && Math.abs(right.get_frame_rect().width - r.width + 100) <= 2,
        'resizing one real Wayland tile adjusts the adjacent window');
    global.display.emit('grab-op-end', left, Meta.GrabOp.RESIZING_E);
    assert(!extension._sharedResize._session && !extension._sharedResize._idle, 'resize completion removes signals and pending work');
    const resized = rectCopy(right.get_frame_rect());
    global.display.emit('grab-op-begin', right, Meta.GrabOp.RESIZING_W);
    right.move_resize_frame(true, resized.x - 50, resized.y, resized.width + 50, resized.height);
    await Scripting.sleep(250);
    assert(Math.abs(left.get_frame_rect().width - l.width - 50) <= 2, 'resized custom tile proportions remain linked on the next resize');
    global.display.emit('grab-op-end', right, Meta.GrabOp.RESIZING_W);
    extension._settings.set_boolean('resize-together', false);
    global.display.emit('grab-op-begin', left, Meta.GrabOp.RESIZING_E);
    assert(!extension._sharedResize._session, 'shared resize can be disabled');
    global.display.emit('grab-op-end', left, Meta.GrabOp.RESIZING_E);
    extension._settings.set_boolean('resize-together', true);
    await Scripting.createTestWindow({width: 400, height: 300});
    await Scripting.waitTestWindows();
    await Scripting.sleep(200);
    const third = global.display.get_tab_list(0, global.workspace_manager.get_active_workspace()).find(window => !windows.includes(window));
    assert(third, 'third window available for a T-shaped tiling group');
    tiler.apply(left, 'left', monitor);
    tiler.apply(right, 'top-right', monitor);
    tiler.apply(third, 'bottom-right', monitor);
    await Scripting.sleep(400);
    const base = rectCopy(left.get_frame_rect());
    const top = rectCopy(right.get_frame_rect());
    const bottom = rectCopy(third.get_frame_rect());
    global.display.emit('grab-op-begin', left, Meta.GrabOp.RESIZING_E);
    left.move_resize_frame(true, base.x, base.y, base.width + 80, base.height);
    await Scripting.sleep(250);
    assert(Math.abs(right.get_frame_rect().x - top.x - 80) <= 2 && Math.abs(third.get_frame_rect().x - bottom.x - 80) <= 2,
        'a shared cut resizes both quarter neighbors together');
    left.move_resize_frame(true, base.x, base.y, base.width, base.height);
    await Scripting.sleep(250);
    assert(Math.abs(right.get_frame_rect().x - top.x) <= 2 && Math.abs(third.get_frame_rect().x - bottom.x) <= 2,
        'returning the active window to its starting geometry restores the whole group');
    global.display.emit('grab-op-end', left, Meta.GrabOp.RESIZING_E);
    third.delete(global.get_current_time());
    await Scripting.sleep(150);
    assert(!tiler._tiles.has(third), 'closed tiled windows are removed from resize tracking');
    tiler.apply(left, 'left', monitor);
    tiler.apply(right, 'right', monitor);
    await Scripting.sleep(300);
}

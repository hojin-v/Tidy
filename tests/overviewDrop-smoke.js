import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import {zoneRect} from '../lib/layouts.js';

const rect = window => {
    const {x, y, width, height} = window.get_frame_rect();
    return {x, y, width, height};
};
const near = (actual, expected) => ['x', 'y', 'width', 'height'].every(key => Math.abs(actual[key] - expected[key]) <= 2);

export async function testOverviewDrop(extension, [focused, dragged], assert) {
    const monitorsBefore = DND.dragMonitors.length;
    focused.activate(global.get_current_time());
    Main.overview.show();
    await Scripting.sleep(500);
    const palette = extension._palette;
    const target = palette._targets.find(item => item.zone === 'top-left');
    const source = dragged._delegate;
    assert(source?.metaWindow === dragged && source._draggable,
        'overview tiling uses the real GNOME window thumbnail as its drag source');
    const delegates = palette._targets.map(item => item.button._delegate);
    const monitor = palette._dropMonitor;
    assert(DND.dragMonitors.includes(monitor), 'overview picker registers a Shell DND monitor');
    assert(!target.button._delegate.acceptDrop({}) &&
        target.button._delegate.handleDragOver({}) === DND.DragMotionResult.NO_DROP,
        'app icons and non-window sources cannot place the previously focused window');
    const original = rect(dragged);
    const stillFocused = rect(focused);
    const [x, y] = target.button.get_transformed_position();
    const [width, height] = target.button.get_transformed_size();
    const motion = {source, x: x + width / 2, y: y + height / 2};
    source._onDragBegin();
    assert(monitor.dragMotion(motion) === DND.DragMotionResult.MOVE_DROP &&
        target.button.has_style_pseudo_class('selected'), 'dragging a window thumbnail highlights a valid layout cell');
    assert(monitor.dragMotion({...motion, x: -10000, y: -10000}) === DND.DragMotionResult.CONTINUE &&
        !target.button.has_style_pseudo_class('selected'), 'leaving the layout cells clears the drag highlight');
    source._onDragCancelled();
    source._onDragEnd();
    assert(Main.overview.visible && !extension._overviewDrop && near(rect(dragged), original),
        'cancelling a thumbnail drag keeps its geometry and leaves the overview open');
    source._onDragBegin();
    monitor.dragMotion(motion);
    const expected = zoneRect(Main.layoutManager.getWorkAreaForMonitor(extension._superPicker.monitor),
        'top-left', extension._settings.get_int('window-gap'));
    assert(target.button._delegate.acceptDrop(source), 'layout cell accepts the dragged window thumbnail');
    await Scripting.sleep(30);
    assert(Main.overview.visible && extension._overviewDrop && near(rect(dragged), original),
        'accepted drops wait for GNOME thumbnail drag completion before resizing');
    source._onDragEnd();
    await Scripting.sleep(750);
    assert(!Main.overview.visible && !extension._superPicker && near(rect(dragged), expected),
        'dropping a thumbnail tiles that window after the overview closes');
    assert(near(rect(focused), stillFocused) && global.display.focus_window === dragged,
        'thumbnail drop focuses the dragged window and preserves the previously focused window');
    assert(!extension._overviewDrop && !palette._dropMonitor && DND.dragMonitors.length === monitorsBefore &&
        palette._targets.every((item, index) => item.button._delegate !== delegates[index]),
        'closing the overview removes DND monitors, drop delegates and drag signal handlers');
    extension._tiler.restore(dragged);
    await Scripting.sleep(300);
    focused.activate(global.get_current_time());
}

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

export async function testOverviewTransition(extension, [focused, dragged], assert) {
    focused.activate(global.get_current_time());
    Main.overview.show();
    await Scripting.sleep(500);
    const source = dragged._delegate;
    const native = source._draggable;
    const savedActor = native._dragActor;
    const savedOpacity = native._dragOrigOpacity;
    source._onDragBegin();
    const proxy = source.getDragActor();
    Main.uiGroup.add_child(proxy);
    proxy.opacity = 100;
    native._dragActor = proxy;
    native._dragOrigOpacity = 255;
    const cell = extension._palette._targets.find(target => target.zone === 'right');
    assert(cell.button._delegate.acceptDrop(source), 'native thumbnail drop accepts a continuous transition');
    assert(native._dragOrigOpacity === 0 && extension._overviewTransition.entry,
        'accepted native drops hide the snap-back proxy while retaining the live transition');
    // Reproduce Shell's restore-on-success timeline. Physical pointer gestures
    // are unavailable in the headless backend; the source and timeline are real.
    proxy.ease({opacity: native._dragOrigOpacity, duration: 750, onStopped: () => {
        proxy.destroy();
        native._dragActor = savedActor;
        source._onDragEnd();
    }});
    await Scripting.sleep(120);
    assert(!extension._overviewDrop && Main.overview.closing && extension._overviewTransition.entry,
        'accepted drops release native DND promptly without the 750 ms snap-back');
    await Scripting.sleep(600);
    native._dragOrigOpacity = savedOpacity;
    assert((!dragged._delegate || dragged._delegate.opacity === 255) && dragged.get_compositor_private().opacity === 255 &&
        !extension._overviewTransition.entry,
        'native drop handoff releases its preview and restores live surface opacity');

    extension._tiler.apply(focused, 'maximize');
    await Scripting.sleep(350);
    Main.overview.show();
    await Scripting.sleep(500);
    let coveredHandoff = false;
    let nativeOverlay = false;
    const observer = global.stage.connect('after-paint', () => {
        const entry = extension._overviewTransition.entry;
        if (!entry) return;
        nativeOverlay ||= Boolean(entry.actor.__animationInfo);
        coveredHandoff ||= Boolean(entry.paintSignal && entry.actor.opacity === 255 && entry.clone.opacity === 255);
    });
    extension._chooseOverviewLayout(focused, 'left', focused.get_monitor(), ['left', 'right']);
    assert(extension._overviewTransition.entry && !focused.maximized_horizontally &&
        !extension._tiler._animations._running.has(focused),
        'maximized overview windows join the same continuous tiling transition');
    await Scripting.sleep(600);
    global.stage.disconnect(observer);
    assert(coveredHandoff && !nativeOverlay, 'overview handoff paints the actual window beneath an opaque cover without a second native effect');
    const actor = focused.get_compositor_private();
    assert(!extension._overviewTransition.entry && actor.opacity === 255 && actor.scale_x === 1 && actor.scale_y === 1,
        'unmaximizing during overview exit leaves no second scale animation');

    Main.overview.show();
    await Scripting.sleep(500);
    extension._chooseOverviewLayout(focused, 'maximize', focused.get_monitor(), ['maximize']);
    await Scripting.sleep(600);
    assert(focused.maximized_horizontally && focused.maximized_vertically && actor.opacity === 255 &&
        !extension._overviewTransition.entry && !extension._tiler._animations._running.has(focused),
        'overview maximize hands directly to the final live surface');

    Main.overview.show();
    await Scripting.sleep(500);
    extension._chooseOverviewLayout(focused, 'left', focused.get_monitor(), ['left', 'right']);
    assert(extension._overviewTransition.entry, 'an overview snapshot is active before interruption');
    extension._dismiss();
    await Scripting.sleep(350);
    assert(!extension._overviewTransition.entry && actor.opacity === 255 && !extension._overviewPlacement,
        'interrupting an overview transition removes the snapshot and restores the window');
    extension._tiler.restore(dragged);
    await Scripting.sleep(250);
}

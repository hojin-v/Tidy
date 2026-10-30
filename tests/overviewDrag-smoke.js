import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {dockMotion} from '../lib/dockMotion.js';

// Use real sources and Shell's pointer/return methods. The headless backend
// cannot deliver physical pointer gestures, so mirror the native grab setup.
export async function testOverviewDrag(extension, windows, assert) {
    const exercise = async (source, kind, {quick = false, success = false} = {}) => {
        const native = source._draggable;
        const parent = source.get_parent();
        const opacity = source.opacity;
        const maxSize = native._dragActorMaxSize;
        const hooks = [native._animateDragEnd, native._restoreDragActor, native._getRestoreLocation];
        const keys = ['_dragActor', '_dragX', '_dragY', '_dragOffsetX', '_dragOffsetY', '_dragActorSource',
            '_dragActorSourceDestroyId', '_dragActorDestroyId', '_dragOrigParent', '_dragOrigOpacity', '_animationInProgress'];
        const fields = keys.map(key => native[key]);
        source._onDragBegin();
        const actor = source.getDragActor();
        Main.uiGroup.add_child(actor);
        Shell.util_set_hidden_from_pick(actor, true);
        native._dragActor = actor;
        native._dragX = 700;
        native._dragY = 420;
        native._dragOffsetX = -20;
        native._dragOffsetY = -20;
        native._dragOrigParent = undefined;
        native._dragOrigOpacity = 255;
        native._animationInProgress = false;
        native._dragActorSource = source.getDragActorSource();
        native._dragActorSourceDestroyId = native._dragActorSource.connect('destroy', () => { native._dragActorSource = null; });
        let destroyed = false;
        native._dragActorDestroyId = actor.connect('destroy', () => { destroyed = true; native._dragActor = null; });
        const initialScale = actor.scale_x;
        const samples = [];
        try {
            assert(actor !== source && source.get_parent() === parent &&
                (kind !== 'window' || (source.opacity === 0 && actor.layout_manager instanceof Shell.WindowPreviewLayout)),
                `${kind} drag uses an independent presentation without taking the source out of its layout`);
            actor.ease({x: 300, y: 300, duration: 900});
            for (let step = 0; step < (quick ? 2 : 6); step++) {
                const x = 700 + step * 35;
                const y = 420 + step * 9;
                native._updateDragPosition({get_coords: () => [x, y]});
                parent.queue_relayout();
                await Scripting.sleep(35);
                const ratio = actor.scale_x / initialScale;
                samples.push({expected: [x - 20 * ratio, y - 20 * ratio], actual: actor.get_transformed_position()});
            }
            if (!quick) for (let pause = 0; pause < 4; pause++) {
                parent.queue_relayout();
                await Scripting.sleep(35);
                const ratio = actor.scale_x / initialScale;
                samples.push({expected: [855 + 20 * (1 - ratio), 445 + 20 * (1 - ratio)],
                    actual: actor.get_transformed_position()});
            }
            assert(extension._overviewDrag.entry?.scaled && actor.scale_x < initialScale &&
                (quick || actor.scale_x / initialScale <= 0.651),
                `${kind} shrinks on drag start anywhere in the overview, including small previews${quick ? ' and early release' : ''}`);
            const anchored = samples.every(({actual, expected}) => actual.every((value, index) => Math.abs(value - expected[index]) < 1));
            assert(anchored, `${kind} stays anchored to the grabbed point during shrinking, motion and pauses` +
                (anchored ? '' : `: ${JSON.stringify(samples)}`));
            const before = {x: actor.x, y: actor.y, scale: actor.scale_x};
            if (success && kind === 'app icon') {
                // App-grid accepted drops destroy the proxy instead of using
                // restoreOnSuccess. The source should grow from the same size.
                actor.destroy();
                native.emit('drag-end', global.get_current_time(), true);
                native._dragComplete();
                assert(source.opacity === opacity && source.scale_x < 1 &&
                    source.get_transition('scale-x')?.get_duration() === dockMotion().duration,
                    'accepted app-grid drops grow the placed icon with the same motion and no transparent gap');
            } else if (success) native._restoreDragActor(global.get_current_time());
            else native._cancelDrag(global.get_current_time());
            if (!destroyed)
                assert(Math.abs(actor.x - before.x) < 1 && Math.abs(actor.y - before.y) < 1 &&
                    Math.abs(actor.scale_x - before.scale) < 0.001 &&
                    actor.get_transition('scale-x')?.get_duration() === dockMotion().duration,
                    `${kind} ${success ? 'release' : 'cancel'} grows back with the desktop motion without a position or scale reset`);
            await Scripting.sleep(dockMotion().duration + 60);
            assert(destroyed && !extension._overviewDrag.entry && source.opacity === opacity &&
                source.get_parent() === parent && native._dragActorMaxSize === maxSize &&
                [native._animateDragEnd, native._restoreDragActor, native._getRestoreLocation].every((fn, i) => fn === hooks[i]),
                `${kind} return restores the source and every temporary drag hook`);
        } finally {
            if (!destroyed) actor.destroy();
            if (native._dragActorSource) native._dragActorSource.disconnect(native._dragActorSourceDestroyId);
            if (source.inDrag || source._dragging) source._onDragEnd();
            extension._overviewDrag.end();
            keys.forEach((key, index) => { native[key] = fields[index]; });
            await Scripting.sleep(50);
        }
    };
    for (const [index, window] of windows.slice(0, 2).entries())
        await exercise(window._delegate, 'window', {success: index === 1});
    await exercise(windows[1]._delegate, 'window', {quick: true});
    // The overview motion also works when its optional layout picker is off.
    extension._settings.set_boolean('super-key-picker', false);
    await exercise(windows[0]._delegate, 'window', {quick: true});
    extension._settings.set_boolean('super-key-picker', true);
    Main.overview.dash.showAppsButton.checked = true;
    await Scripting.sleep(350);
    const icons = Main.overview._overview.controls._appDisplay._orderedItems
        .filter(item => item.app && item.mapped && item._draggable).slice(0, 2);
    assert(icons.length === 2, 'native app grid provides two actual draggable application icons');
    for (const [index, icon] of icons.entries()) await exercise(icon, 'app icon', {success: index === 1});
    Main.overview.dash.showAppsButton.checked = false;
    await Scripting.sleep(350);
}

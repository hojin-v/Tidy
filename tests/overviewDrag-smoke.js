import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

// Mirror Shell's drag-actor setup, then run its real pointer-motion method.
// The headless backend cannot deliver physical pointer gestures.
export async function testOverviewDrag(extension, windows, assert) {
    const exercise = async (source, kind) => {
        const native = source._draggable;
        const parent = source.get_parent();
        const originalOpacity = source.opacity;
        const keys = ['_dragActor', '_dragX', '_dragY', '_dragOffsetX', '_dragOffsetY'];
        const fields = keys.map(key => native[key]);
        source._onDragBegin();
        const actor = source.getDragActor();
        Main.uiGroup.add_child(actor);
        Shell.util_set_hidden_from_pick(actor, true);
        native._dragActor = actor;
        native._dragOffsetX = -20;
        native._dragOffsetY = -20;
        const samples = [];
        let independent;
        try {
            independent = actor !== source && source.get_parent() === parent &&
                (kind !== 'window' || (source.opacity === 0 && actor.layout_manager instanceof Shell.WindowPreviewLayout));
            // An unfinished layout animation must not compete with pointer
            // motion, including when the user stops moving the pointer.
            actor.ease({x: 300, y: 300, duration: 900});
            for (let step = 0; step < 6; step++) {
                const x = 700 + step * 35;
                const y = 420 + step * 9;
                native._updateDragPosition({get_coords: () => [x, y]});
                parent.queue_relayout();
                await Scripting.sleep(35);
                samples.push({expected: [x - 20, y - 20], actual: actor.get_transformed_position()});
            }
            for (let pause = 0; pause < 4; pause++) {
                parent.queue_relayout();
                await Scripting.sleep(35);
                samples.push({expected: [855, 445], actual: actor.get_transformed_position()});
            }
        } finally {
            if (native._updateHoverId) await Scripting.sleep(30);
            Shell.util_set_hidden_from_pick(actor, false);
            actor.destroy();
            keys.forEach((key, index) => { native[key] = fields[index]; });
            source._onDragCancelled();
            source._onDragEnd();
            await Scripting.sleep(kind === 'app icon' ? 350 : 100);
        }
        assert(independent, `${kind} drag uses its own actor and keeps the source in its original layout`);
        assert(samples.every(({actual, expected}) => actual.every((value, index) => Math.abs(value - expected[index]) < 1)),
            `${kind} drag stays at the pointer while moving and paused during layout updates`);
        assert(!extension._overviewDrag.entry && source.opacity === originalOpacity,
            `${kind} drag cancellation restores the source and removes temporary drag hooks`);
    };
    for (const window of windows.slice(0, 2)) await exercise(window._delegate, 'window');
    Main.overview.dash.showAppsButton.checked = true;
    await Scripting.sleep(350);
    const icons = Main.overview._overview.controls._appDisplay._orderedItems
        .filter(item => item.app && item.mapped && item._draggable).slice(0, 2);
    assert(icons.length === 2, 'native app grid provides two actual draggable application icons');
    for (const icon of icons) await exercise(icon, 'app icon');
    Main.overview.dash.showAppsButton.checked = false;
    await Scripting.sleep(350);
}

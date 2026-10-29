import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

export async function testPickerVisual(extension, assert) {
    const palette = extension._palette;
    const normal = extension._settings.get_int('picker-scale');
    const overview = extension._settings.get_int('overview-picker-scale');
    extension._settings.set_int('overview-picker-scale', 100);
    const border = palette._targets[0].button.get_theme_node().get_border_width(St.Side.TOP);
    const bounds = actor => {
        const [x, y] = actor.get_transformed_position();
        const [width, height] = actor.get_transformed_size();
        return {x, y, width, height};
    };
    const consistentBounds = () => {
        const box = bounds(palette.actor);
        const first = bounds(palette._cards.cards[0].diagram);
        const last = bounds(palette._cards.cards.at(-1).diagram);
        const left = first.x - box.x;
        const right = box.x + box.width - last.x - last.width;
        const top = first.y - box.y;
        const bottom = box.y + box.height - first.y - first.height;
        return left > 0 && top > 0 && Math.abs(left - right) <= 1 && Math.abs(top - bottom) <= 1 &&
            palette._targets.every(({button}) => {
                const cell = bounds(button);
                return cell.x >= box.x && cell.y >= box.y &&
                    cell.x + cell.width <= box.x + box.width && cell.y + cell.height <= box.y + box.height;
            });
    };
    let smallWidth;
    for (const [size, relative] of [[50, 100], [200, 100], [75, 100], [200, 200], [100, 100]]) {
        extension._settings.set_int('picker-scale', size);
        extension._settings.set_int('overview-picker-scale', relative);
        await Scripting.sleep(400);
        const [width] = palette.actor.get_transformed_size();
        const area = Main.layoutManager.getWorkAreaForMonitor(extension._superPicker.monitor);
        assert(palette.actor.scale_x === 1 && palette.actor.scale_y === 1 &&
            palette._targets.every(({button}) => button.scale_x === 1 && button.scale_y === 1 &&
                Number.isInteger(button.width) && Number.isInteger(button.x) &&
                button.get_theme_node().get_border_width(St.Side.TOP) === border),
            `picker at ${size}% redraws native shapes on integer coordinates with unchanged border thickness`);
        assert(width <= area.width - 22, `picker at ${size}% fits its monitor`);
        assert(consistentBounds(), `picker at ${size}% / overview ${relative}% keeps all icons inside with balanced padding`);
        if (size === 50) smallWidth = width;
        else if (size === 200) assert(width > smallWidth, 'large sizes grow diagram geometry instead of magnifying a cached texture');
    }
    // Consecutive settings changes in one frame used to leave the wrapper
    // and content with independently cached dimensions.
    for (const size of [50, 200, 65, 175, 100]) extension._settings.set_int('picker-scale', size);
    await Scripting.sleep(350);
    assert(consistentBounds(), 'rapid resize changes keep the container and diagrams in the same allocation');
    const target = palette._targets.find(item => item.zone === 'top-right');
    const [x, y] = target.button.get_transformed_position();
    const [width, height] = target.button.get_transformed_size();
    const panel = [palette.actor.width, palette.actor.height];
    const positions = palette._cards.cards.map(card => card.actor.get_transformed_position());
    palette.hit(x + width / 2, y + height / 2);
    await Scripting.sleep(180);
    assert(palette.actor.get_n_children() === 1 && target.button.has_style_pseudo_class('selected'),
        'hover highlights the existing cell without creating an enlarged overlay');
    assert(palette.actor.width === panel[0] && palette.actor.height === panel[1] &&
        palette._cards.cards.every((card, index) => card.actor.get_transformed_position().every((v, axis) => Math.abs(v - positions[index][axis]) < 1)),
        'hover keeps the toolbar and every diagram at their original size and position');
    assert(palette.hit(x + width / 2, y + height / 2) === target && target.button._delegate,
        'fixed layout cells retain correct hit testing and native drop targets');
    if (GLib.getenv('WINTILING_CAPTURE_PICKER') === '1') {
        const [px, py] = palette.actor.get_transformed_position();
        const file = Gio.File.new_for_path('/tmp/wintiling-picker-large.png');
        const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
        await new Promise((resolve, reject) => {
            new Shell.Screenshot().screenshot_area(Math.floor(px), Math.floor(py) - 8,
                Math.ceil(panel[0]), Math.ceil(panel[1]) + 16, stream, (source, result) => {
                    try { source.screenshot_area_finish(result); stream.close(null); resolve(); }
                    catch (error) { reject(error); }
                });
        });
    }
    palette.hit(-10000, -10000);
    await Scripting.sleep(150);
    assert(palette.actor.get_n_children() === 1 && !palette._selected,
        'leaving the picker clears the highlight without temporary actors');
    extension._settings.set_int('picker-scale', normal);
    extension._settings.set_int('overview-picker-scale', overview);
    await Scripting.sleep(400);
    assert(extension._settings.get_boolean('auto-picker-scale') &&
        extension._displayConfig._profiles.length === Main.layoutManager.monitors.length,
        'automatic sizing defaults on and reads the private compositor display configuration');
    const profiles = extension._displayConfig._profiles;
    const index = extension._superPicker.monitor;
    const fake = Main.layoutManager.monitors.map((monitor, i) => ({...monitor,
        width: i === index ? 2560 : 1440, height: i === index ? 1440 : 900,
        builtin: i !== index, inches: i === index ? 33.36 : 15.94}));
    try {
        extension._displayConfig._profiles = fake;
        extension._settings.set_boolean('auto-picker-scale', false);
        await Scripting.sleep(350);
        const base = palette.actor.width;
        extension._settings.set_boolean('auto-picker-scale', true);
        await Scripting.sleep(350);
        assert(palette.actor.width > base * 1.3 && consistentBounds() &&
            extension._pickerScale(index) === normal / 100 * 1.35,
            'large external display automatically grows both diagrams and background from the configured size');
        assert(extension._pickerScale(index, true) === extension._pickerScale(index) * overview / 100,
            'overview uses the same monitor adjustment and preserves its separate size preference');
        fake[index].builtin = true;
        extension._settings.set_boolean('auto-picker-scale', false);
        extension._settings.set_boolean('auto-picker-scale', true);
        await Scripting.sleep(350);
        assert(Math.abs(palette.actor.width - base) <= 1 && consistentBounds(),
            'built-in displays retain the configured baseline size');
    } finally {
        extension._displayConfig._profiles = profiles;
        extension._settings.set_boolean('auto-picker-scale', false);
        extension._settings.reset('auto-picker-scale');
        await Scripting.sleep(350);
    }
    const context = St.ThemeContext.get_for_stage(global.stage);
    const density = context.scale_factor;
    try {
        context.scale_factor = 2;
        for (const size of [50, 200]) {
            extension._settings.set_int('picker-scale', size);
            extension._configureSuperKey();
            await Scripting.sleep(350);
            const area = Main.layoutManager.getWorkAreaForMonitor(extension._superPicker.monitor);
            assert(consistentBounds() && palette.actor.width <= area.width - 22 &&
                palette.actor.scale_x === 1 && palette.actor.scale_y === 1,
                `HiDPI picker at ${size}% keeps padding, diagrams and monitor fitting in the same units`);
        }
    } finally {
        context.scale_factor = density;
        extension._settings.set_int('picker-scale', normal);
        extension._configureSuperKey();
        await Scripting.sleep(350);
    }
}

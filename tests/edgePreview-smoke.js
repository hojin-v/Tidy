import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {zoneRect} from '../lib/layouts.js';
import {rectCopy} from '../lib/resizeGeometry.js';

export async function testEdgePreview(extension, window, assert) {
    await Scripting.waitTestWindows();
    const palette = extension._palette;
    const setting = extension._settings.get_boolean('top-edge-enabled');
    const readPointer = global.get_pointer;
    const original = rectCopy(window.get_frame_rect());
    let pointer;
    global.get_pointer = () => pointer;
    try {
        for (const enabled of [true, false]) {
            extension._settings.set_boolean('top-edge-enabled', enabled);
            for (const [monitor, geometry] of Main.layoutManager.monitors.entries()) {
                const area = Main.layoutManager.getWorkAreaForMonitor(monitor);
                const samples = [
                    ['left', geometry.x + 2, area.y + area.height / 2],
                    ['right', geometry.x + geometry.width - 2, area.y + area.height / 2],
                    ['maximize', area.x + 48, area.y + 2],
                ];
                let hidden = 0;
                const visibility = palette.preview.connect('notify::visible', () => {
                    if (!palette.preview.visible) hidden++;
                });
                try {
                    pointer = [samples[0][1], samples[0][2], Clutter.ModifierType.BUTTON1_MASK];
                    extension._beginDrag(window);
                    hidden = 0; // Ignore initialization before the first preview.
                    for (const [zone, x, y] of samples) {
                        pointer = [x, y, Clutter.ModifierType.BUTTON1_MASK];
                        let previousOpacity = 0;
                        for (let sample = 0; sample < 9; sample++) {
                            await Scripting.sleep(45);
                            if (!palette.preview.visible || palette.preview.opacity < previousOpacity || hidden !== 0)
                                assert(false, `${zone} preview lost visibility or opacity (monitor ${monitor}, picker ${enabled}, sample ${sample}, hidden ${hidden})`);
                            previousOpacity = palette.preview.opacity;
                        }
                        const target = zoneRect(area, zone, zone === 'maximize' ? 0 : extension._settings.get_int('window-gap'));
                        assert(palette.preview.opacity === 255 && extension._drag?.selected?.zone === zone &&
                            ['x', 'y', 'width', 'height'].every(key => Math.abs(palette.preview[key] - target[key]) < 1),
                            `${zone} preview remains continuously visible and reaches its final bounds and opacity (monitor ${monitor}, picker ${enabled})`);
                    }
                    if (enabled && monitor === 0 && GLib.getenv('TIDY_CAPTURE_EDGE_PREVIEW') === '1') {
                        pointer = [samples[0][1], samples[0][2], Clutter.ModifierType.BUTTON1_MASK];
                        await Scripting.sleep(250);
                        const path = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_child('dist/edge-preview.png');
                        const stream = path.replace(null, false, Gio.FileCreateFlags.NONE, null);
                        await new Promise((resolve, reject) => {
                            new Shell.Screenshot().screenshot_area(area.x, area.y, area.width, area.height, stream, (source, result) => {
                                try { source.screenshot_area_finish(result); stream.close(null); resolve(); }
                                catch (error) { reject(error); }
                            });
                        });
                    }
                    pointer = [area.x + area.width / 2, area.y + area.height / 2, Clutter.ModifierType.BUTTON1_MASK];
                    await Scripting.sleep(60);
                    assert(!palette.preview.visible, 'leaving the edge removes the preview while the drag hint can remain');
                } finally {
                    palette.preview.disconnect(visibility);
                    extension._cancelDrag(true);
                }
                assert(['x', 'y', 'width', 'height'].every(key => window.get_frame_rect()[key] === original[key]),
                    'showing and dismissing edge previews does not move or resize the window');
            }
        }
    } finally {
        extension._cancelDrag(true);
        global.get_pointer = readPointer;
        extension._settings.set_boolean('top-edge-enabled', setting);
        await Scripting.waitTestWindows();
    }
}

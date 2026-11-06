import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {testBraveHover} from './braveHover-smoke.js';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async', 'communicate_utf8_finish');
export const METRICS = {};
export function init() { Main.layoutManager._startInOverview = false; }
export async function run() {
    await Scripting.sleep(1500);
    Main.overview.hide();
    await Scripting.sleep(500);
    const extension = Extension.lookupByUUID('tidy@hnode');
    const assert = (condition, message) => { if (!condition) throw new Error(message); print(`PASS: ${message}`); };
    assert(Boolean(extension?._maximizeHover), 'maximize hover is enabled in the private compositor');
    await testBraveHover(extension, assert);
    print('TIDY BRAVE SMOKE PASSED');
}

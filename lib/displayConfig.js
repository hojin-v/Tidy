import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {automaticPickerScale, displayProfiles} from './monitorScale.js';

export class DisplayConfig {
    constructor(onChanged) {
        this._onChanged = onChanged;
        this.refresh();
    }

    refresh() {
        this._cancellable?.cancel();
        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;
        this._profiles = [];
        const request = method => new Promise((resolve, reject) => {
            Gio.DBus.session.call('org.gnome.Mutter.DisplayConfig', '/org/gnome/Mutter/DisplayConfig',
                'org.gnome.Mutter.DisplayConfig', method, null, null, Gio.DBusCallFlags.NONE, 3000,
                cancellable, (bus, result) => {
                    try { resolve(bus.call_finish(result).deep_unpack()); }
                    catch (error) { reject(error); }
                });
        });
        Promise.all([request('GetCurrentState'), request('GetResources')]).then(([state, resources]) => {
            if (cancellable.is_cancelled()) return;
            // A hotplug between the replies must not mix two configurations.
            if (state[0] !== resources[0]) return;
            this._profiles = displayProfiles(state, resources, Main.layoutManager.monitors);
            this._onChanged();
        }).catch(() => {
            // Virtual/remote displays may not expose physical dimensions;
            // their logical resolution still provides a conservative fallback.
        });
    }

    scaleFor(index) {
        const monitor = Main.layoutManager.monitors[index];
        const profile = this._profiles.find(item => item.x === monitor?.x && item.y === monitor?.y) ?? monitor;
        return automaticPickerScale(profile, this._profiles.find(item => item.builtin));
    }

    destroy() {
        this._cancellable?.cancel();
        this._onChanged = null;
        this._profiles = [];
    }
}

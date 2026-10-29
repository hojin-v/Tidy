import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// Persist the lease before writing: a Shell crash must not lose original keys.
export class SettingsLease {
    constructor(settings) {
        this._settings = settings;
        this.restore();
        this._entries = [];
    }

    set(schema, key, value) {
        const target = new Gio.Settings({schema_id: schema});
        const original = target.get_user_value(key);
        let entry = this._entries.find(saved => saved.schema === schema && saved.key === key);
        if (!entry) {
            entry = {schema, key, original: original?.print(true) ?? null};
            this._entries.push(entry);
        }
        entry.applied = value.print(true);
        this._settings.set_string('settings-backup', JSON.stringify(this._entries));
        Gio.Settings.sync();
        target.set_value(key, value);
    }

    release(schema, key) {
        const entry = this._entries.find(saved => saved.schema === schema && saved.key === key);
        if (!entry) return;
        this._restoreEntry(entry);
        this._entries = this._entries.filter(saved => saved !== entry);
        this._settings.set_string('settings-backup', JSON.stringify(this._entries));
        Gio.Settings.sync();
    }

    _restoreEntry(entry) {
        const target = new Gio.Settings({schema_id: entry.schema});
        // Keep deliberate changes the user made while Tidy was active.
        if (target.get_value(entry.key).print(true) !== entry.applied)
            return;
        if (entry.original === null)
            target.reset(entry.key);
        else
            target.set_value(entry.key, GLib.Variant.parse(null, entry.original, null, null));
    }

    restore() {
        const entries = JSON.parse(this._settings.get_string('settings-backup'));
        for (const entry of entries.reverse())
            this._restoreEntry(entry);
        this._settings.set_string('settings-backup', '[]');
        this._entries = [];
    }
}

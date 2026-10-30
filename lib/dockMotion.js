import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';

// Ubuntu Dock / Dash to Dock use this duration and EASE_OUT_QUAD for both
// directions. Read the preference for each motion so changes apply at once.
const schema = Gio.SettingsSchemaSource.get_default().lookup('org.gnome.shell.extensions.dash-to-dock', true);
const settings = schema?.has_key('animation-time') ? new Gio.Settings({settings_schema: schema}) : null;

export function dockMotion() {
    return {duration: Math.max(0, Math.round((settings?.get_double('animation-time') ?? 0.3) * 1000)),
        mode: Clutter.AnimationMode.EASE_OUT_QUAD};
}

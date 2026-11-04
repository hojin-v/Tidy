import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {contains} from './layouts.js';
import {accessibleButtonRect, accessibleSurfaceRect, isMaximizeButton} from './pickerGeometry.js';

const ACCESSIBLE = 'org.a11y.atspi.Accessible';
const COMPONENT = 'org.a11y.atspi.Component';
const ROOT = '/org/a11y/atspi/accessible/root';
const now = () => GLib.get_monotonic_time() / 1000;
const rect = ([x, y, width, height]) => ({x, y, width, height});

// Toolkits return either the control itself or an intermediate panel from hit
// testing. Inspect only the titlebar branch containing the pointer; never guess
// caption positions or require Chromium's renderer accessibility to be forced on.
export class MaximizeButtonLocator {
    constructor() {
        this._cancellable = new Gio.Cancellable();
        this._applications = new Map();
    }

    _call(bus, name, path, iface, method, signature = null, args = []) {
        return new Promise((resolve, reject) => bus.call(name, path, iface, method,
            signature ? new GLib.Variant(signature, args) : null, null,
            Gio.DBusCallFlags.NONE, 400, this._cancellable, (connection, result) => {
                try { resolve(connection.call_finish(result).deep_unpack()); }
                catch (error) { reject(error); }
            }));
    }

    async _connect() {
        if (!this._connecting) this._connecting = (async () => {
            const [address] = await this._call(Gio.DBus.session, 'org.a11y.Bus', '/org/a11y/bus', 'org.a11y.Bus', 'GetAddress');
            return new Promise((resolve, reject) => Gio.DBusConnection.new_for_address(address,
                Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION,
                null, this._cancellable, (_source, result) => {
                    try { resolve(Gio.DBusConnection.new_for_address_finish(result)); }
                    catch (error) { reject(error); }
                }));
        })().catch(error => { this._connecting = null; throw error; });
        return this._connecting;
    }

    async _application(bus, pid) {
        if (now() < (this._applicationsUntil ?? 0) && this._applications.has(pid))
            return this._applications.get(pid);
        const [children] = await this._call(bus, 'org.a11y.atspi.Registry', ROOT, ACCESSIBLE, 'GetChildren');
        this._applications.clear();
        // Applications expose a unique name on the accessibility bus. Verify
        // its owner PID before inspecting any window or control.
        await Promise.all(children.map(async ([name, path]) => {
            try {
                const [owner] = await this._call(bus, 'org.freedesktop.DBus', '/org/freedesktop/DBus',
                    'org.freedesktop.DBus', 'GetConnectionUnixProcessID', '(s)', [name]);
                this._applications.set(owner, [name, path]);
            } catch (_) { /* An application may exit while enumerating. */ }
        }));
        this._applicationsUntil = now() + 5000;
        return this._applications.get(pid);
    }

    async _properties(bus, [name, path]) {
        const [values] = await this._call(bus, name, path, 'org.freedesktop.DBus.Properties', 'GetAll', '(s)', [ACCESSIBLE]);
        return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.deep_unpack()]));
    }

    async _controlRect(bus, reference, properties, {frame, surface, buffer, x, y}) {
        if (!isMaximizeButton(properties.Name ?? '')) return null;
        const [role] = await this._call(bus, ...reference, ACCESSIBLE, 'GetRoleName');
        if (!role.includes('button')) return null;
        const [bounds] = await this._call(bus, ...reference, COMPONENT, 'GetExtents', '(u)', [1]);
        const button = accessibleButtonRect(frame, surface, rect(bounds), buffer);
        return button && contains(button, x, y) ? button : null;
    }

    async _descendantButton(bus, references, px, py, context) {
        const pending = [...references];
        const visited = new Set();
        const deadline = now() + 1000;
        while (pending.length && visited.size < 40 && now() < deadline) {
            const current = pending.shift();
            if (!current?.[0] || current[1] === '/org/a11y/atspi/null') continue;
            const key = current.join(':');
            if (visited.has(key)) continue;
            visited.add(key);
            try {
                const props = await this._properties(bus, current);
                const button = await this._controlRect(bus, current, props, context);
                if (button) return button;
                const [children] = await this._call(bus, ...current, ACCESSIBLE, 'GetChildren');
                const contained = await Promise.all(children.slice(0, 32).map(async child => {
                    try {
                        const [value] = await this._call(bus, ...child, COMPONENT, 'GetExtents', '(u)', [1]);
                        const bounds = rect(value);
                        const inside = contains(bounds, px, py);
                        // Chromium can report the caption controls above their
                        // parent's y=30 content bounds. Keep the narrow titlebar
                        // branch even when that parent's hit test misses them.
                        const titlebar = bounds.width > 0 && bounds.height > 0 &&
                            px >= bounds.x && px < bounds.x + bounds.width && bounds.y < context.surface.y +
                                80 * context.surface.height / context.frame.height &&
                            bounds.y + bounds.height > context.surface.y;
                        return inside || titlebar ? {child, inside, area: bounds.width * bounds.height} : null;
                    } catch (_) { return null; }
                }));
                // Prefer a concrete control over an overlapping full-window
                // panel. Bounds filter out the page content and other buttons.
                pending.unshift(...contained.filter(Boolean).sort((a, b) => Number(b.inside) - Number(a.inside) ||
                    a.area - b.area).map(item => item.child));
            } catch (_) { /* An accessible may disappear during a window update. */ }
        }
        return null;
    }

    async locate(window, x, y) {
        this.lastError = null;
        try {
            const bus = await this._connect();
            const app = await this._application(bus, window.get_pid());
            if (!app) return null;
            const [children] = await this._call(bus, ...app, ACCESSIBLE, 'GetChildren');
            const frame = window.get_frame_rect();
            const buffer = window.get_buffer_rect?.() ?? frame;
            for (const top of children.slice(0, 24)) {
                const properties = await this._properties(bus, top);
                if (children.length > 1 && properties.Name !== window.get_title()) continue;
                const [extents] = await this._call(bus, ...top, COMPONENT, 'GetExtents', '(u)', [1]);
                const surface = rect(extents);
                if (surface.width <= 0 || surface.height <= 0) continue;
                const coordinates = accessibleSurfaceRect(frame, surface, buffer);
                const px = Math.round((x - coordinates.x) * surface.width / coordinates.width + surface.x);
                const py = Math.round((y - coordinates.y) * surface.height / coordinates.height + surface.y);
                let hit = top;
                try {
                    const [point] = await this._call(bus, ...top, COMPONENT, 'GetAccessibleAtPoint', '(iiu)', [px, py, 1]);
                    if (point?.[0] && point[1] !== '/org/a11y/atspi/null') hit = point;
                } catch (_) { /* Fall back to the bounded titlebar subtree. */ }
                const ancestors = [];
                const context = {frame, surface, buffer, x, y};
                // Some toolkits return the icon or label inside the button.
                for (let depth = 0; depth < 8 && hit?.[0] && hit[1] !== '/org/a11y/atspi/null'; depth++) {
                    ancestors.push(hit);
                    const props = await this._properties(bus, hit);
                    const button = await this._controlRect(bus, hit, props, context);
                    if (button) return button;
                    if (hit[0] === top[0] && hit[1] === top[1]) break;
                    hit = props.Parent;
                }
                // Chromium may hit its content panel even over caption controls
                // exported by the enclosing GTK frame. Inspect that parent's
                // siblings before descending further into the content panel.
                const scopes = ancestors.reverse();
                const button = await this._descendantButton(bus, scopes, px, py, context);
                if (button) return button;
            }
        } catch (error) {
            // Kept for diagnostics; unsupported clients do not log repeatedly.
            this.lastError = error.message;
        }
        return null;
    }

    destroy() {
        this._cancellable.cancel();
        this._applications.clear();
        this._connecting?.then(bus => bus.close(null, () => {})).catch(() => {});
    }
}


import {_} from './i18n.js';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import {ACTIONS, contains, LAYOUTS, ZONES} from './layouts.js';
import {canTile} from './windowManager.js';
import {dockMotion} from './dockMotion.js';

export function layoutCards(onSelect, compact = false, layouts = LAYOUTS) {
    const root = new St.BoxLayout({style_class: 'winubun-cards'});
    const targets = [];
    const cards = [];
    const baseWidth = compact ? 78 : 96;
    const baseHeight = compact ? 54 : 68;
    for (const layout of layouts) {
        const card = new St.BoxLayout({vertical: true, style_class: 'winubun-card'});
        const diagram = new St.Widget();
        const record = {actor: card, diagram, layout, targets: []};
        for (const zone of layout.zones) {
            const button = new St.Button({style_class: 'winubun-zone', can_focus: true, reactive: true,
                accessible_name: `${_(layout.name)}: ${_(ACTIONS.find(([, , action]) => action === zone)?.[1] ?? 'Maximize')}`});
            button.connect('clicked', () => onSelect(zone, layout.zones));
            diagram.add_child(button);
            const target = {button, zone, zones: layout.zones, card: record};
            targets.push(target);
            record.targets.push(target);
        }
        card.add_child(diagram);
        root.add_child(card);
        cards.push(record);
    }
    const setSize = factor => {
        const density = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const width = Math.round(baseWidth * factor * density);
        const height = Math.round(baseHeight * factor * density);
        const inset = Math.max(1, Math.round(2 * factor * density));
        const spacing = Math.round(12 * factor);
        root.set_style(`spacing: ${spacing}px;`);
        const rowWidth = width * cards.length + spacing * density * Math.max(0, cards.length - 1);
        root.set_size(rowWidth, height);
        for (const {diagram, targets: cells} of cards) {
            diagram.set_size(width, height);
            for (const {button, zone} of cells) {
                const [x, y, w, h] = ZONES[zone];
                button.set_position(Math.round(x * width) + inset, Math.round(y * height) + inset);
                button.set_size(Math.max(1, Math.round((x + w) * width) - Math.round(x * width) - inset * 2),
                    Math.max(1, Math.round((y + h) * height) - Math.round(y * height) - inset * 2));
            }
        }
        return {width: rowWidth, height, density};
    };
    setSize(1);
    return {root, targets, cards, setSize};
}

export class DragPalette {
    constructor(onSelect = () => {}, onHover = () => {}) {
        // Render at the requested dimensions. Scaling a cached actor magnifies
        // its rasterized borders, so every diagram keeps a 1:1 paint transform.
        this._onHover = onHover;
        this._open = false;
        this._cards = layoutCards(onSelect, true);
        // The themed container owns its content size; a separately sized
        // wrapper could retain an older allocation while the diagrams resize.
        this.actor = new St.Bin({visible: false, style_class: 'winubun-palette', child: this._cards.root});
        this._targets = this._cards.targets;
        for (const target of this._targets) this._wireHover(target);
        this.preview = new St.Bin({style_class: 'winubun-preview', visible: false, reactive: false,
            child: new St.Widget({style_class: 'tidy-preview-surface', reactive: false, x_expand: true, y_expand: true})});
        this.hint = new St.Widget({style_class: 'tidy-drag-hint', visible: false, reactive: false});
        Main.layoutManager.addChrome(this.preview);
        Main.layoutManager.addChrome(this.hint);
        Main.layoutManager.addChrome(this.actor);
        for (const actor of [this.actor, this.hint])
            actor.connect('notify::translation-y', () => this._clipToMonitor(actor));
    }

    _wireHover(target) {
        target.button.connect('enter-event', () => {
            this._select(target);
            return Clutter.EVENT_PROPAGATE;
        });
        target.button.connect('leave-event', () => {
            if (this._selected === target) this.clearSelection();
            return Clutter.EVENT_PROPAGATE;
        });
        target.button.connect('key-focus-in', () => this._select(target));
    }

    _resize(factor) {
        const content = this._cards.setSize(factor);
        const padding = Math.round(16 * factor);
        this.actor.set_style(`padding: ${padding}px; border-radius: ${Math.round(20 * factor)}px;`);
        this.actor.ensure_style();
        const theme = this.actor.get_theme_node();
        // Never re-read cached preferred sizes after fitting within the same
        // frame. The row and background use exactly the same rounded geometry.
        const width = content.width + 2 * padding * content.density +
            theme.get_border_width(St.Side.LEFT) + theme.get_border_width(St.Side.RIGHT);
        const height = content.height + 2 * padding * content.density +
            theme.get_border_width(St.Side.TOP) + theme.get_border_width(St.Side.BOTTOM);
        this.actor.set_size(width, height);
        return {width, height};
    }

    prepare(monitor, {scale: requestedScale = 1} = {}) {
        const area = Main.layoutManager.getWorkAreaForMonitor(monitor);
        const density = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        if (this._monitor === monitor && this._requestedScale === requestedScale && this._density === density &&
            this._bounds && ['x', 'y', 'width', 'height'].every(key => this._area[key] === area[key]))
            return this._bounds;
        this.hide(true);
        let scale = requestedScale;
        let size = this._resize(scale);
        for (let attempt = 0; attempt < 4 && (size.width > area.width - 24 || size.height > area.height - 24); attempt++) {
            const fit = Math.min((area.width - 26) / size.width, (area.height - 26) / size.height);
            scale *= fit;
            size = this._resize(scale);
        }
        this._monitor = monitor;
        this._requestedScale = requestedScale;
        this._density = density;
        this._targetScale = scale;
        this.actor.set_scale(1, 1);
        this.actor.set_position(Math.round(area.x + (area.width - size.width) / 2), area.y + 12);
        this._bounds = {x: this.actor.x, y: this.actor.y, ...size};
        this._area = area;
        return this._bounds;
    }

    _clipToMonitor(actor) {
        if (!this._area) return;
        // The panel slides from behind the top edge, including on vertically
        // stacked monitors. Never paint it over the panel or another monitor.
        const shadow = 48;
        actor.set_clip(-shadow, this._area.y - actor.y - actor.translation_y,
            actor.width + shadow * 2, this._area.height);
    }

    peek(monitor, {scale = 1, width} = {}) {
        const bounds = this.prepare(monitor, {scale});
        this._hidePanel();
        const height = Math.max(6, Math.round(8 * this.scale * this._density));
        const hintWidth = Math.round(width ?? bounds.width);
        this.hint.set_size(hintWidth, height);
        this.hint.set_position(Math.round(bounds.x + (bounds.width - hintWidth) / 2), this._area.y);
        if (this._peeking) return;
        const resuming = this.hint.visible;
        this._peeking = true;
        this.hint.remove_all_transitions();
        if (!resuming) this.hint.translation_y = -height - 2;
        this.hint.opacity = 255;
        this.hint.show();
        this._clipToMonitor(this.hint);
        this.hint.ease({translation_y: 0, ...dockMotion()});
    }

    _hideHint(immediate = false) {
        if (!this._peeking && !immediate) return;
        this._peeking = false;
        this.hint.remove_all_transitions();
        if (immediate) this.hint.hide();
        else if (this.hint.visible) this.hint.ease({translation_y: -this.hint.height - 2, ...dockMotion(),
            onComplete: () => { if (!this._peeking) this.hint.hide(); }});
    }

    show(monitor, options = {}) {
        this.prepare(monitor, options);
        if (this._open) return;
        this.clearSelection();
        const resuming = this.actor.visible;
        const peekHeight = this._peeking ? this.hint.height : 0;
        this._hideHint(true);
        this.actor.remove_all_transitions();
        this._open = true;
        this.actor.opacity = 255;
        if (!resuming) this.actor.translation_y = -this.actor.height - 12 + peekHeight;
        this.actor.show();
        this._clipToMonitor(this.actor);
        this.actor.ease({translation_y: 0, ...dockMotion()});
    }

    get isOpen() { return this._open; }
    get scale() { return this._targetScale ?? 1; }

    _select(target) {
        if (!this._open) return;
        if (this._selected === target) return;
        this._selected = target;
        for (const item of this._targets) {
            if (item === target) item.button.add_style_pseudo_class('selected');
            else item.button.remove_style_pseudo_class('selected');
        }
        this._onHover(target);
    }

    _inside(actor, x, y, margin = 0) {
        if (!actor?.visible) return false;
        const [ax, ay] = actor.get_transformed_position();
        const [width, height] = actor.get_transformed_size();
        return contains({x: ax - margin, y: ay - margin, width: width + 2 * margin, height: height + 2 * margin}, x, y);
    }

    enableWindowDrops(onDrop) {
        this.disableWindowDrops();
        const accepts = source => this._open && source?.metaWindow instanceof Meta.Window &&
            canTile(source.metaWindow) && Boolean(source.metaWindow.get_compositor_private());
        this._dropDelegate = {
            handleDragOver: source => accepts(source) ? DND.DragMotionResult.MOVE_DROP : DND.DragMotionResult.NO_DROP,
            acceptDrop: (source, _actor, x, y) => {
                if (!accepts(source)) return false;
                const [ax, ay] = this.actor.get_transformed_position();
                const target = this.hit(ax + x, ay + y);
                return Boolean(target && onDrop(source, target));
            },
        };
        this.actor._delegate = this._dropDelegate;
        this._dropDelegates = this._targets.map(target => {
            const previous = target.button._delegate;
            const delegate = {
                handleDragOver: source => accepts(source) ? DND.DragMotionResult.MOVE_DROP : DND.DragMotionResult.NO_DROP,
                acceptDrop: source => accepts(source) && onDrop(source, target),
            };
            target.button._delegate = delegate;
            return {button: target.button, previous, delegate};
        });
        this._dropMonitor = {dragMotion: ({source, x, y}) => {
            if (accepts(source) && this.hit(x, y)) return DND.DragMotionResult.MOVE_DROP;
            this.clearSelection();
            return DND.DragMotionResult.CONTINUE;
        }};
        DND.addDragMonitor(this._dropMonitor);
    }

    disableWindowDrops() {
        if (this._dropMonitor) DND.removeDragMonitor(this._dropMonitor);
        this._dropMonitor = null;
        if (this.actor._delegate === this._dropDelegate) this.actor._delegate = null;
        this._dropDelegate = null;
        for (const {button, previous, delegate} of this._dropDelegates ?? []) {
            if (button._delegate === delegate) button._delegate = previous;
        }
        this._dropDelegates = [];
        this.clearSelection();
    }

    clearSelection() {
        this._selected = null;
        for (const {button} of this._targets) button.remove_style_pseudo_class('selected');
        this._onHover(null);
    }

    hit(x, y) {
        if (!this._open) return null;
        if (y < this._area.y || y >= this._area.y + this._area.height) {
            this.clearSelection();
            return null;
        }
        const target = this._targets.find(item => this._inside(item.button, x, y));
        if (target) {
            this._select(target);
            return this._selected;
        }
        this.clearSelection();
        return null;
    }

    contains(x, y, margin = 0) {
        return this._open && y >= this._area.y && y < this._area.y + this._area.height &&
            this._inside(this.actor, x, y, margin);
    }

    showPreview(rect) {
        const previous = this._previewRect;
        if (this.preview.visible && previous && ['x', 'y', 'width', 'height'].every(key => previous[key] === rect[key])) return;
        this._previewRect = {...rect};
        this.preview.remove_all_transitions();
        if (!this.preview.visible) {
            this.preview.set_position(rect.x, rect.y);
            this.preview.set_size(rect.width, rect.height);
            this.preview.opacity = 0;
        }
        this.preview.show();
        this.preview.ease({...rect, opacity: 255, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
    }

    _hidePanel(immediate = false) {
        if (!this._open && !immediate) return;
        this.clearSelection();
        this._open = false;
        this.actor.remove_all_transitions();
        if (immediate) this.actor.hide();
        else this.actor.ease({translation_y: -this.actor.height - 60, ...dockMotion(),
            onComplete: () => { if (!this._open) this.actor.hide(); }});
    }

    hidePicker(immediate = false) {
        this._hideHint(immediate);
        this._hidePanel(immediate);
    }

    hidePreview() {
        this.preview.remove_all_transitions();
        this.preview.hide();
        this._previewRect = null;
    }

    hide(immediate = false) {
        this.hidePicker(immediate);
        this.hidePreview();
    }

    destroy() {
        this.disableWindowDrops();
        this.hide(true);
        this.actor.destroy();
        this.hint.destroy();
        this.preview.destroy();
    }
}

export const LayoutDialog = GObject.registerClass(class LayoutDialog extends ModalDialog.ModalDialog {
    _init(onSelect) {
        super._init({styleClass: 'winubun-dialog', destroyOnClose: true});
        const {root, targets} = layoutCards((zone, zones) => {
            this.close();
            onSelect(zone, zones);
        });
        this.contentLayout.add_child(root);
        this.setInitialKeyFocus(targets[0].button);
        this.setButtons([{label: _("Cancel"), key: Clutter.KEY_Escape, action: () => this.close()}]);
    }
});

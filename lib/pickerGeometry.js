import {contains} from './layouts.js';

// The former 115% size is now the reference size shown as 100% in settings.
export const PICKER_BASE_SCALE = 1.15;

export function pickerGrid(count, width, height, spacing, columns = count) {
    columns = Math.min(Math.max(1, columns), count);
    const rows = columns ? Math.ceil(count / columns) : 0;
    return {
        width: columns * width + Math.max(0, columns - 1) * spacing,
        height: rows * height + Math.max(0, rows - 1) * spacing,
        positions: Array.from({length: count}, (_, index) => ({
            x: index % columns * (width + spacing), y: Math.floor(index / columns) * (height + spacing),
        })),
    };
}

export function migratePickerSize(settings) {
    if (settings.get_int('picker-size-version') >= 1) return;
    if (settings.get_user_value('picker-scale') !== null) {
        const size = Math.round(settings.get_int('picker-scale') / PICKER_BASE_SCALE);
        settings.set_int('picker-scale', Math.max(50, Math.min(200, size)));
    }
    settings.set_int('picker-size-version', 1);
}

export function anchoredPickerPosition(area, size, anchor) {
    const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
    let y = anchor.y + anchor.height + 6;
    if (y + size.height > area.y + area.height - 12)
        y = anchor.y - size.height - 6;
    return {
        x: Math.round(clamp(anchor.x + anchor.width - size.width, area.x + 12, area.x + area.width - size.width - 12)),
        y: Math.round(clamp(y, area.y + 12, area.y + area.height - size.height - 12)),
    };
}

export function isMaximizeButton(name) {
    return /^(maximize(?: window)?|unmaximize|restore(?: down| window)?|최대화(?: 해제)?|복구|복원|(?:원래|이전) 크기로 복원)$/i.test(name.trim());
}

export function accessibleSurfaceRect(frame, surface, buffer = frame) {
    if (!buffer || buffer.width <= 0 || buffer.height <= 0) return frame;
    // GTK and Chromium disagree about whether the window-relative coordinate
    // space includes CSD shadows. Prefer the matching aspect ratio, including
    // uniformly scaled accessible coordinates on HiDPI displays.
    const distortion = area => Math.abs(Math.log(surface.width / area.width / (surface.height / area.height)));
    return distortion(buffer) + 0.0001 < distortion(frame) ? buffer : frame;
}

export function accessibleButtonRect(frame, surface, button, buffer = frame) {
    if (![frame, surface, button].every(rect => rect &&
        ['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key])) && rect.width > 0 && rect.height > 0)) return null;
    const coordinates = accessibleSurfaceRect(frame, surface, buffer);
    const sx = coordinates.width / surface.width;
    const sy = coordinates.height / surface.height;
    const rect = {x: coordinates.x + (button.x - surface.x) * sx,
        y: coordinates.y + (button.y - surface.y) * sy, width: button.width * sx, height: button.height * sy};
    // Only accept a small control in the titlebar, never a similarly named
    // button inside the document or outside the visible window.
    if (rect.width > 96 || rect.height > 64 || rect.y < frame.y - 1 || rect.y + rect.height > frame.y + 80 ||
        rect.x < frame.x - 1 || rect.x + rect.width > frame.x + frame.width + 1) return null;
    return rect;
}

export function withinHoverPicker(anchor, picker, x, y) {
    const rect = {x: Math.min(anchor.x, picker.x) - 8, y: Math.min(anchor.y, picker.y) - 8,
        width: Math.max(anchor.x + anchor.width, picker.x + picker.width) - Math.min(anchor.x, picker.x) + 16,
        height: Math.max(anchor.y + anchor.height, picker.y + picker.height) - Math.min(anchor.y, picker.y) + 16};
    return contains(rect, x, y);
}

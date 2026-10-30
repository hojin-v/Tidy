// Coordinates are fractions of the usable monitor area, in logical pixels.
export const ZONES = {
    left: [0, 0, 0.5, 1], right: [0.5, 0, 0.5, 1],
    top: [0, 0, 1, 0.5], bottom: [0, 0.5, 1, 0.5],
    'top-left': [0, 0, 0.5, 0.5], 'top-right': [0.5, 0, 0.5, 0.5],
    'bottom-left': [0, 0.5, 0.5, 0.5], 'bottom-right': [0.5, 0.5, 0.5, 0.5],
    'left-third': [0, 0, 1 / 3, 1], 'center-third': [1 / 3, 0, 1 / 3, 1],
    'right-third': [2 / 3, 0, 1 / 3, 1],
    'left-two-thirds': [0, 0, 2 / 3, 1], 'right-two-thirds': [1 / 3, 0, 2 / 3, 1],
    maximize: [0, 0, 1, 1], center: [0.125, 0.125, 0.75, 0.75],
};

export const LAYOUTS = [
    {name: "Halves", zones: ['left', 'right']},
    {name: "Wide", zones: ['left-two-thirds', 'right-third']},
    {name: "Three columns", zones: ['left-third', 'center-third', 'right-third']},
    {name: "Focus", zones: ['left', 'top-right', 'bottom-right']},
    {name: "Four quarters", zones: ['top-left', 'top-right', 'bottom-left', 'bottom-right']},
    {name: "Top and bottom", zones: ['top', 'bottom']},
    {name: "Maximize", zones: ['maximize']},
];

export const ACTIONS = [
    ['snap-left', "Left half / left monitor", 'left', '<Super><Alt>Left'],
    ['snap-right', "Right half / right monitor", 'right', '<Super><Alt>Right'],
    ['snap-toggle-maximize', "Maximize / restore previous layout", 'toggle-maximize', '<Super><Alt>Return'],
    ['snap-top', "Top half / upper monitor", 'top', '<Super><Alt>Up'],
    ['snap-bottom', "Bottom half / lower monitor", 'bottom', '<Super><Alt>Down'],
    ['snap-top-left', "Top-left quarter", 'top-left', '<Super><Alt>u'],
    ['snap-top-right', "Top-right quarter", 'top-right', '<Super><Alt>i'],
    ['snap-bottom-left', "Bottom-left quarter", 'bottom-left', '<Super><Alt>j'],
    ['snap-bottom-right', "Bottom-right quarter", 'bottom-right', '<Super><Alt>k'],
    ['snap-left-third', "Left third", 'left-third', '<Super><Alt>d'],
    ['snap-center-third', "Center third", 'center-third', '<Super><Alt>f'],
    ['snap-right-third', "Right third", 'right-third', '<Super><Alt>g'],
    ['snap-left-two-thirds', "Left two-thirds", 'left-two-thirds', '<Super><Alt>e'],
    ['snap-right-two-thirds', "Right two-thirds", 'right-two-thirds', '<Super><Alt>t'],
    ['snap-center', "Centered three-quarter size", 'center', '<Super><Alt>c'],
    ['show-layouts', "Open layout picker", 'picker', '<Super><Alt>space'],
    ['next-monitor', "Move to next monitor", 'next-monitor', '<Super><Alt>n'],
];

export function zoneRect(area, zone, gap = 0) {
    const parts = typeof zone === 'string' ? ZONES[zone] : zone;
    if (!parts || area.width <= 0 || area.height <= 0)
        throw new Error('Invalid zone or work area');
    const [x, y, width, height] = parts;
    // Round boundaries, not widths: adjacent thirds must share an exact edge.
    const x1 = Math.round(area.x + area.width * x);
    const y1 = Math.round(area.y + area.height * y);
    const x2 = Math.round(area.x + area.width * (x + width));
    const y2 = Math.round(area.y + area.height * (y + height));
    const inset = Math.max(0, Math.min(Math.round(gap / 2), Math.floor((Math.min(x2 - x1, y2 - y1) - 1) / 2)));
    return {x: x1 + inset, y: y1 + inset, width: x2 - x1 - inset * 2, height: y2 - y1 - inset * 2};
}

export function companionZones(zone) {
    const layout = LAYOUTS.find(item => item.zones.includes(zone));
    return layout ? layout.zones.filter(other => other !== zone) : [];
}

export function monitorAt(monitors, x, y) {
    return monitors.findIndex(m => x >= m.x && y >= m.y && x < m.x + m.width && y < m.y + m.height);
}

export function contains(rect, x, y) {
    return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
}

export function dragIntent(monitor, area, x, y, {height = 96, width = 320,
    center = area.x + area.width / 2, picker = true} = {}) {
    if (!contains(monitor, x, y))
        return null;
    const halfWidth = Math.min(width, area.width - 24) / 2;
    if (picker && Math.abs(x - center) <= halfWidth && y <= area.y + height)
        return {type: 'picker'};
    // The rest of the top edge maximizes; the side edges tile directly.
    if (y <= area.y + 12)
        return {type: 'tile', zone: 'maximize'};
    if (x <= monitor.x + 12)
        return {type: 'tile', zone: 'left'};
    if (x >= monitor.x + monitor.width - 12)
        return {type: 'tile', zone: 'right'};
    return null;
}

const DIRECTIONS = {
    left: ['x', 'width', 'y', 'height', -1], right: ['x', 'width', 'y', 'height', 1],
    up: ['y', 'height', 'x', 'width', -1], down: ['y', 'height', 'x', 'width', 1],
};

function monitorCandidates(monitors, current, direction) {
    const origin = monitors[current];
    if (!origin || !Object.hasOwn(DIRECTIONS, direction)) return null;
    const [axis, span, cross, crossSpan, sign] = DIRECTIONS[direction];
    const center = origin[axis] + origin[span] / 2;
    const crossCenter = origin[cross] + origin[crossSpan] / 2;
    const candidates = monitors.map((monitor, index) => {
        const advance = (monitor[axis] + monitor[span] / 2 - center) * sign;
        const offset = Math.abs(monitor[cross] + monitor[crossSpan] / 2 - crossCenter);
        const overlap = Math.min(origin[cross] + origin[crossSpan], monitor[cross] + monitor[crossSpan]) -
            Math.max(origin[cross], monitor[cross]);
        const axisOverlap = Math.min(origin[axis] + origin[span], monitor[axis] + monitor[span]) -
            Math.max(origin[axis], monitor[axis]);
        const gap = sign > 0 ? monitor[axis] - origin[axis] - origin[span] : origin[axis] - monitor[axis] - monitor[span];
        return {index, advance, offset, axisOverlap, aligned: overlap > 0, gap: Math.max(0, gap),
            edge: monitor[axis] + (sign < 0 ? monitor[span] : 0)};
    }).filter(item => item.index !== current && (item.aligned || item.axisOverlap <= 0));
    return {sign, candidates};
}

export function adjacentMonitor(monitors, current, direction) {
    const candidates = monitorCandidates(monitors, current, direction)?.candidates.filter(item => item.advance > 0) ?? [];
    candidates.sort((a, b) => Number(b.aligned) - Number(a.aligned) ||
        a.gap - b.gap || Math.hypot(a.advance, a.offset) - Math.hypot(b.advance, b.offset));
    return candidates[0]?.index ?? -1;
}

export function directionalMonitor(monitors, current, direction) {
    const adjacent = adjacentMonitor(monitors, current, direction);
    if (adjacent >= 0) return {monitor: adjacent, wrapped: false};
    const measured = monitorCandidates(monitors, current, direction);
    if (!measured) return null;
    const {sign, candidates} = measured;
    const opposite = candidates.filter(item => item.advance < 0);
    // Prefer the same row/column, then its opposite outer edge. Offsets on
    // the other axis must not turn a vertical stack into a left/right move.
    opposite.sort((a, b) => Number(b.aligned) - Number(a.aligned) || sign * (a.edge - b.edge) || a.offset - b.offset);
    return opposite.length ? {monitor: opposite[0].index, wrapped: true} : null;
}

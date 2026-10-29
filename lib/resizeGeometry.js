export function rectCopy(rect) {
    return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
}

function seam(rect, edge, gap) {
    if (edge === 'left') return rect.x - gap / 2;
    if (edge === 'right') return rect.x + rect.width + gap / 2;
    if (edge === 'top') return rect.y - gap / 2;
    return rect.y + rect.height + gap / 2;
}

// A boundary is shared transitively: a half-height tile and two neighbors on
// the same cut must move together, not just the window under the pointer.
export function resizePlan(tiles, active, sides, gap = 0) {
    const axes = [];
    for (const edge of sides) {
        const horizontal = edge === 'left' || edge === 'right';
        const edges = horizontal ? ['left', 'right'] : ['top', 'bottom'];
        const boundary = seam(tiles[active].rect, edge, gap);
        const span = rect => horizontal
            ? [rect.y - gap / 2, rect.y + rect.height + gap / 2]
            : [rect.x - gap / 2, rect.x + rect.width + gap / 2];
        const members = [{index: active, edge}];
        const included = new Set([active]);
        let [start, end] = span(tiles[active].rect);
        let changed = true;
        while (changed) {
            changed = false;
            tiles.forEach((tile, index) => {
                if (included.has(index)) return;
                const touching = edges.find(side => Math.abs(seam(tile.rect, side, gap) - boundary) <= 4);
                const [a, b] = span(tile.rect);
                if (!touching || a > end + 2 || b < start - 2) return;
                members.push({index, edge: touching});
                included.add(index);
                start = Math.min(start, a);
                end = Math.max(end, b);
                changed = true;
            });
        }
        if (members.some(member => member.edge !== edge))
            axes.push({edge, horizontal, members});
    }
    return axes;
}

export function resizeTogether(tiles, active, current, plan) {
    const result = new Map([[active, rectCopy(current)]]);
    const original = tiles[active].rect;
    for (const axis of plan) {
        let delta = seam(current, axis.edge, 0) - seam(original, axis.edge, 0);
        let lower = -Infinity;
        let upper = Infinity;
        for (const {index, edge} of axis.members) {
            const tile = tiles[index];
            const size = axis.horizontal ? tile.rect.width : tile.rect.height;
            const min = Math.max(1, axis.horizontal ? tile.minWidth ?? 64 : tile.minHeight ?? 64);
            const max = (axis.horizontal ? tile.maxWidth : tile.maxHeight) || Infinity;
            if (edge === 'right' || edge === 'bottom') {
                lower = Math.max(lower, min - size);
                upper = Math.min(upper, max - size);
            } else {
                lower = Math.max(lower, size - max);
                upper = Math.min(upper, size - min);
            }
        }
        delta = lower <= upper ? Math.max(lower, Math.min(upper, delta)) : 0;
        for (const {index, edge} of axis.members) {
            const before = tiles[index].rect;
            const rect = result.get(index) ?? rectCopy(before);
            if (edge === 'right') rect.width = before.width + delta;
            if (edge === 'left') { rect.x = before.x + delta; rect.width = before.width - delta; }
            if (edge === 'bottom') rect.height = before.height + delta;
            if (edge === 'top') { rect.y = before.y + delta; rect.height = before.height - delta; }
            result.set(index, rect);
        }
    }
    return result;
}

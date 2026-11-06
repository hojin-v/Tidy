// Dimensions are in stage coordinates; St's CSS spacing scales with the theme.
export function assistGrid(count, width, height, scale = 1) {
    const spacing = 12 * scale;
    const inset = 16 * scale;
    const scrollbar = 16 * scale;
    const available = Math.max(1, width - 2 * inset - scrollbar);
    const columns = Math.max(1, Math.min(count, Math.floor((available + spacing) / (200 * scale + spacing))));
    const cardWidth = Math.max(1, Math.floor(Math.min(240 * scale, (available - (columns - 1) * spacing) / columns)));
    const previewWidth = Math.max(1, cardWidth - 16 * scale);
    const previewHeight = Math.max(1, Math.min(144 * scale, previewWidth * 0.625, height - 2 * inset - 48 * scale));
    const cardHeight = previewHeight + 48 * scale;
    const rows = Math.ceil(count / columns);
    return {columns, cardWidth, cardHeight, previewWidth, previewHeight,
        viewportWidth: Math.min(Math.max(1, width - 2 * inset), columns * cardWidth + (columns - 1) * spacing + scrollbar),
        viewportHeight: Math.min(Math.max(1, height - 2 * inset), rows * cardHeight + (rows - 1) * spacing)};
}

export function fitThumbnail(frame, width, height) {
    const scale = Math.min(1, width / Math.max(1, frame.width), height / Math.max(1, frame.height));
    const fittedWidth = Math.min(width, Math.max(1, frame.width) * scale);
    const fittedHeight = Math.min(height, Math.max(1, frame.height) * scale);
    return {x: (width - fittedWidth) / 2, y: (height - fittedHeight) / 2, width: fittedWidth, height: fittedHeight};
}

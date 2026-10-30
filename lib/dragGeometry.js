// Both desktop windows and overview thumbnails use the same proportional
// miniature. Small thumbnails/icons still shrink instead of hitting a cap.
export function dragPreviewScale(width, height, area) {
    return Math.min(0.65, Math.min(280, area.width * 0.22) / width,
        Math.min(180, area.height * 0.24) / height);
}

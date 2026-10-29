const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const logicalDiagonal = monitor => Math.hypot(monitor.width, monitor.height);
const validInches = value => Number.isFinite(value) && value >= 8 && value <= 80;

export function automaticPickerScale(monitor, reference = null) {
    if (!monitor || monitor.builtin) return 1;
    const baseline = reference ?? {width: 1920, height: 1080, inches: 16};
    const logicalRatio = logicalDiagonal(monitor) / logicalDiagonal(baseline);
    if (!Number.isFinite(logicalRatio) || logicalRatio <= 0) return 1;
    // Larger displays are usually viewed farther away. Use a gentle blend
    // of physical size and available logical space, rather than doubling
    // the UI with the diagonal or applying GNOME's display scale twice.
    const physical = validInches(monitor.inches) && validInches(baseline.inches);
    const factor = physical ? Math.pow(logicalRatio, 0.25) * Math.pow(monitor.inches / baseline.inches, 0.2) :
        Math.sqrt(logicalRatio);
    return Math.round(clamp(factor, 1, 1.5) * 20) / 20;
}

export function displayProfiles(state, resources, monitors) {
    const unpack = value => value?.deep_unpack ? value.deep_unpack() : value;
    const physical = new Map(resources[2].map(output => {
        const props = output[7];
        const width = unpack(props['width-mm']);
        const height = unpack(props['height-mm']);
        return [output[4], width > 0 && height > 0 ? Math.hypot(width, height) / 25.4 : 0];
    }));
    const builtin = new Map(state[1].map(([spec, , props]) => [spec[0], Boolean(unpack(props['is-builtin']))]));
    return monitors.map(monitor => {
        const logical = state[2].find(([x, y]) => x === monitor.x && y === monitor.y);
        const specs = logical?.[5] ?? [];
        const inches = specs.map(([connector]) => physical.get(connector)).filter(validInches);
        return {...monitor, builtin: specs.some(([connector]) => builtin.get(connector)),
            inches: inches.length ? Math.min(...inches) : 0};
    });
}

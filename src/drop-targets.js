const registry = [];

export function registerDropTarget(el, config) {
    if (!el) return () => {};
    const entry = {
        el,
        accepts: config.accepts || ['songs'],
        onDrop: config.onDrop,
        onEnter: config.onEnter,
        onLeave: config.onLeave,
    };
    registry.push(entry);
    return () => {
        const i = registry.indexOf(entry);
        if (i >= 0) registry.splice(i, 1);
    };
}

export function findDropTarget(x, y, payloadType = 'songs') {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    for (const entry of registry) {
        if (!entry.accepts.includes(payloadType)) continue;
        if (entry.el === el || entry.el.contains(el)) return entry;
    }
    return null;
}

export function clearAllHighlights() {
    for (const entry of registry) {
        entry.el.classList.remove('is-drop-target');
    }
}
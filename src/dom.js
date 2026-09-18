export function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);

    for (const [key, value] of Object.entries(props || {})) {
        if (value === null || value === undefined || value === false) continue;

        if (key === 'class' || key === 'className') {
            node.className = value;
        } else if (key === 'style' && typeof value === 'object') {
            Object.assign(node.style, value);
        } else if (key === 'dataset' && typeof value === 'object') {
            Object.assign(node.dataset, value);
        } else if (key === 'html') {
            node.innerHTML = value;
        } else if (key === 'text') {
            node.textContent = value;
        } else if (key.startsWith('on') && typeof value === 'function') {
            node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (key === 'checked' || key === 'disabled' || key === 'selected') {
            node[key] = Boolean(value);
        } else if (key === 'value') {
            node.value = value;
        } else {
            node.setAttribute(key, value);
        }
    }

    appendChildren(node, children);
    return node;
}

function appendChildren(node, children) {
    for (const child of children) {
        if (child === null || child === undefined || child === false) continue;

        if (Array.isArray(child)) {
            appendChildren(node, child);
        } else if (child instanceof Node) {
            node.appendChild(child);
        } else {
            node.appendChild(document.createTextNode(String(child)));
        }
    }
}

export function on(target, event, selector, handler) {
    target.addEventListener(event, function (e) {
        if (!selector) {
            handler.call(target, e);
            return;
        }
        const matched = e.target.closest(selector);
        if (matched && target.contains(matched)) {
            handler.call(matched, e, matched);
        }
    });
}

export function escape(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
}

export function mount(parent, node) {
    clear(parent);
    if (node) parent.appendChild(node);
}
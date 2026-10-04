import { el } from './dom.js';
import { store } from './store.js';
import { icon, openModal, Dropdown } from './components.js';
import {
    FIELD_DEFS,
    getOperatorsForField,
    createGroup,
    createCondition,
    defaultForOperator,
    countConditions,
} from './filter.js';

const OP_OPTIONS = [
    { value: 'and', label: '且' },
    { value: 'or', label: '或' },
];

function loadWikiOptionsFromIndexedDB() {
    return new Promise((resolve) => {
        const empty = { genre: [], language: [], bizTags: [] };
        try {
            const req = indexedDB.open('mscd-wiki', 2);
            req.onerror = () => resolve(empty);
            req.onsuccess = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('songWiki')) {
                    resolve(empty);
                    return;
                }
                const tx = db.transaction('songWiki', 'readonly');
                const st = tx.objectStore('songWiki');
                const genre = new Set();
                const language = new Set();
                const bizTags = new Set();
                st.openCursor().onsuccess = (ev) => {
                    const cur = ev.target.result;
                    if (!cur) return;
                    const v = cur.value;
                    if (v && !v.failed && v.data) {
                        const d = v.data;
                        if (d.genre) genre.add(String(d.genre));
                        if (d.language) language.add(String(d.language));
                        if (Array.isArray(d.bizTags)) {
                            for (const t of d.bizTags) if (t) bizTags.add(String(t));
                        }
                    }
                    cur.continue();
                };
                tx.oncomplete = () => {
                    resolve({
                        genre: Array.from(genre).sort(),
                        language: Array.from(language).sort(),
                        bizTags: Array.from(bizTags).sort(),
                    });
                };
                tx.onerror = () => resolve(empty);
            };
        } catch {
            resolve(empty);
        }
    });
}

function collectFromStore() {
    const empty = { genre: [], language: [], bizTags: [] };
    try {
        const s = store && store.get ? store.get() : {};
        if (s.wikiOptions && (s.wikiOptions.genre?.length || s.wikiOptions.language?.length || s.wikiOptions.bizTags?.length)) {
            return s.wikiOptions;
        }
        if (s.wikiMap instanceof Map && s.wikiMap.size > 0) {
            const genre = new Set();
            const language = new Set();
            const bizTags = new Set();
            for (const entry of s.wikiMap.values()) {
                if (!entry) continue;
                if (entry.genre) genre.add(String(entry.genre));
                if (entry.language) language.add(String(entry.language));
                if (Array.isArray(entry.bizTags)) {
                    for (const t of entry.bizTags) if (t) bizTags.add(String(t));
                }
            }
            return {
                genre: Array.from(genre).sort(),
                language: Array.from(language).sort(),
                bizTags: Array.from(bizTags).sort(),
            };
        }
    } catch {}
    return empty;
}

let uidSeq = 0;
function nextUid(prefix = 'fg') {
    uidSeq += 1;
    return `${prefix}-${uidSeq}`;
}

function ensureUid(group) {
    if (!group.__uid) group.__uid = nextUid('group');
    return group.__uid;
}

export function openFilterEditor({ title = '筛选', fields, initial, onApply }) {
    function applyOptions(wikiOptions) {
        for (const f of fields) {
            if (!f.dynamic) continue;
            const list = wikiOptions[f.key] || [];
            f.options = list.map((v) => ({ value: String(v), label: String(v) }));
        }
    }

    function getField(key) {
        return fields.find((f) => f.key === key) || FIELD_DEFS[key] || FIELD_DEFS.title;
    }

    applyOptions(collectFromStore());

    let draft = initial ? JSON.parse(JSON.stringify(initial)) : createGroup('and');
    if (!draft.children) draft.children = [];

    const collapsed = new Set();
    const activeDropdowns = [];

    const treeHost = el('div', { class: 'filter-editor__tree' });
    const body = el('div', { class: 'filter-editor' }, treeHost);

    function trackDropdown(d) {
        activeDropdowns.push(d);
        return d;
    }

    function destroyDropdowns() {
        for (const d of activeDropdowns) {
            try { d.destroy(); } catch {}
        }
        activeDropdowns.length = 0;
    }

    function rerender() {
        destroyDropdowns();
        treeHost.innerHTML = '';
        treeHost.appendChild(renderGroupBody(draft, 0, true));
    }

    function iconBtn(name, titleText, onClick, extraClass = '') {
        const btn = el('button', {
            class: `ena-btn ena-btn--icon filter-icon-btn${extraClass ? ' ' + extraClass : ''}`,
            type: 'button',
            title: titleText,
        }, icon(name));
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            onClick(e);
        });
        return btn;
    }

    function renderGroupBody(group, depth, isRoot) {
        ensureUid(group);
        const container = el('div', { class: 'filter-group-body' });
        const children = group.children || [];

        if (!children.length) {
            container.appendChild(el('div', {
                class: 'filter-empty',
                text: isRoot ? '还没有条件' : '此分组为空',
            }));
        } else {
            const connectors = [];
            children.forEach((child, idx) => {
                if (idx > 0 && children.length >= 2) {
                    const wrap = el('div', { class: 'filter-op-connector' });
                    const dropdown = trackDropdown(Dropdown({
                        options: OP_OPTIONS,
                        value: group.op || 'and',
                        title: '组间逻辑',
                        onChange: (v) => {
                            group.op = v;
                            for (const d of connectors) {
                                if (d !== dropdown) d.update(v);
                            }
                        },
                    }));
                    connectors.push(dropdown);
                    wrap.appendChild(dropdown.node);
                    container.appendChild(wrap);
                }
                container.appendChild(renderBlock(child, group, idx, depth));
            });
        }

        const actions = el('div', { class: 'filter-actions' });
        actions.appendChild(iconBtn('plus', '添加条件', () => {
            group.children.push(createCondition(fields[0]?.key));
            rerender();
        }));
        actions.appendChild(iconBtn('folder-plus', '添加分组', () => {
            const g = createGroup('and');
            g.children.push(createCondition(fields[0]?.key));
            group.children.push(g);
            rerender();
        }));
        container.appendChild(actions);

        return container;
    }

    function renderBlock(node, parent, idx, depth) {
        if (node.type === 'condition') return renderCondition(node, parent, idx);
        return renderSubgroup(node, parent, idx, depth);
    }

    function renderCondition(cond, parent, idx) {
        const node = el('div', { class: 'filter-condition' });

        const fieldOptions = fields.map((f) => ({ value: f.key, label: f.label }));
        node.appendChild(trackDropdown(Dropdown({
            options: fieldOptions,
            value: cond.field,
            title: '字段',
            onChange: (v) => {
                cond.field = v;
                const field = getField(v);
                const ops = getOperatorsForField(field);
                if (!ops.some((o) => o.key === cond.operator)) {
                    cond.operator = ops[0]?.key || 'contains';
                }
                cond.value = defaultForOperator(cond.operator, field);
                rerender();
            },
        })).node);

        const field = getField(cond.field);
        const ops = getOperatorsForField(field);

        node.appendChild(trackDropdown(Dropdown({
            options: ops.map((o) => ({ value: o.key, label: o.label })),
            value: cond.operator,
            title: '运算符',
            className: 'filter-condition__op',
            onChange: (v) => {
                cond.operator = v;
                cond.value = defaultForOperator(v, field);
                rerender();
            },
        })).node);

        const valueHost = el('div', { class: 'filter-condition__value' });
        renderValueEditor(valueHost, cond, field, ops.find((o) => o.key === cond.operator));
        node.appendChild(valueHost);

        node.appendChild(iconBtn('close', '删除条件', () => {
            parent.children.splice(idx, 1);
            rerender();
        }, 'filter-condition__del'));

        return node;
    }

    function renderSubgroup(group, parent, idx, depth) {
        ensureUid(group);
        const node = el('div', { class: 'filter-subgroup' });

        const isCollapsed = collapsed.has(group.__uid);

        const header = el('div', { class: 'filter-subgroup__header' });

        const collapseBtn = iconBtn('chevron-down', isCollapsed ? '展开' : '折叠', () => {
            if (isCollapsed) collapsed.delete(group.__uid);
            else collapsed.add(group.__uid);
            rerender();
        });
        if (isCollapsed) {
            const svg = collapseBtn.querySelector('svg');
            if (svg) svg.style.transform = 'rotate(-90deg)';
        }
        header.appendChild(collapseBtn);

        const notBtn = iconBtn('not', group.negate ? '取消取反' : '取反', () => {
            group.negate = !group.negate;
            rerender();
        }, group.negate ? 'is-active' : '');
        header.appendChild(notBtn);

        header.appendChild(el('span', { class: 'filter-subgroup__label', text: '分组' }));
        header.appendChild(el('div', { class: 'filter-subgroup__spacer' }));

        header.appendChild(iconBtn('close', '删除分组', () => {
            parent.children.splice(idx, 1);
            rerender();
        }));

        node.appendChild(header);

        if (!isCollapsed) {
            const inner = renderGroupBody(group, depth + 1, false);
            inner.classList.add('filter-subgroup__body');
            node.appendChild(inner);
        }

        return node;
    }

    function renderValueEditor(host, cond, field, op) {
        if (!op || field.type === 'boolean') return;

        if (field.type === 'date') {
            if (op.valueShape === 'range') {
                const minInput = el('input', {
                    type: 'date',
                    class: 'ena-input filter-value__date',
                    value: cond.value?.min ?? '',
                });
                minInput.addEventListener('input', () => {
                    cond.value = { ...(cond.value || {}), min: minInput.value };
                });
                const maxInput = el('input', {
                    type: 'date',
                    class: 'ena-input filter-value__date',
                    value: cond.value?.max ?? '',
                });
                maxInput.addEventListener('input', () => {
                    cond.value = { ...(cond.value || {}), max: maxInput.value };
                });
                host.appendChild(minInput);
                host.appendChild(el('span', { class: 'filter-value__sep', text: '~' }));
                host.appendChild(maxInput);
                return;
            }

            const input = el('input', {
                type: 'date',
                class: 'ena-input filter-value__date',
                value: typeof cond.value === 'string' ? cond.value : '',
            });
            input.addEventListener('input', () => { cond.value = input.value; });
            host.appendChild(input);
            return;
        }

        if (field.type === 'duration') {
            const unitOptions = [
                { value: 's', label: '秒' },
                { value: 'm', label: '分钟' },
            ];

            if (op.valueShape === 'range') {
                const minInput = el('input', {
                    type: 'number',
                    class: 'ena-input filter-value__num',
                    value: cond.value?.min ?? 0,
                });
                minInput.addEventListener('input', () => {
                    cond.value = { ...(cond.value || {}), min: Number(minInput.value) || 0 };
                });
                const maxInput = el('input', {
                    type: 'number',
                    class: 'ena-input filter-value__num',
                    value: cond.value?.max ?? 0,
                });
                maxInput.addEventListener('input', () => {
                    cond.value = { ...(cond.value || {}), max: Number(maxInput.value) || 0 };
                });
                const unitDropdown = trackDropdown(Dropdown({
                    options: unitOptions,
                    value: cond.value?.unit || 's',
                    title: '单位',
                    className: 'filter-value__unit',
                    onChange: (v) => {
                        cond.value = { ...(cond.value || {}), unit: v };
                    },
                }));
                host.appendChild(minInput);
                host.appendChild(el('span', { class: 'filter-value__sep', text: '~' }));
                host.appendChild(maxInput);
                host.appendChild(unitDropdown.node);
                return;
            }

            const valueInput = el('input', {
                type: 'number',
                class: 'ena-input filter-value__num',
                value: cond.value?.value ?? 0,
            });
            valueInput.addEventListener('input', () => {
                cond.value = { ...(cond.value || {}), value: Number(valueInput.value) || 0 };
            });
            const unitDropdown = trackDropdown(Dropdown({
                options: unitOptions,
                value: cond.value?.unit || 's',
                title: '单位',
                className: 'filter-value__unit',
                onChange: (v) => {
                    cond.value = { ...(cond.value || {}), unit: v };
                },
            }));
            host.appendChild(valueInput);
            host.appendChild(unitDropdown.node);
            return;
        }

        if (op.valueShape === 'range') {
            const minInput = el('input', {
                type: 'number',
                class: 'ena-input filter-value__num',
                value: cond.value?.min ?? 0,
            });
            minInput.addEventListener('input', () => {
                cond.value = { min: Number(minInput.value) || 0, max: cond.value?.max ?? 0 };
            });
            const maxInput = el('input', {
                type: 'number',
                class: 'ena-input filter-value__num',
                value: cond.value?.max ?? 0,
            });
            maxInput.addEventListener('input', () => {
                cond.value = { min: cond.value?.min ?? 0, max: Number(maxInput.value) || 0 };
            });
            host.appendChild(minInput);
            host.appendChild(el('span', { class: 'filter-value__sep', text: '~' }));
            host.appendChild(maxInput);
            return;
        }

        if (op.valueShape === 'multi') {
            const opts = field.options || [];
            const values = Array.isArray(cond.value) ? cond.value.map(String) : [];
            for (const opt of opts) {
                const input = el('input', { type: 'checkbox' });
                input.checked = values.includes(String(opt.value));
                input.addEventListener('change', () => {
                    const cur = new Set(Array.isArray(cond.value) ? cond.value.map(String) : []);
                    if (input.checked) cur.add(String(opt.value));
                    else cur.delete(String(opt.value));
                    cond.value = Array.from(cur);
                });
                host.appendChild(el('label', { class: 'ena-checkbox filter-value__opt' },
                    input,
                    el('span', { class: 'box' }),
                    el('span', { text: opt.label })
                ));
            }
            return;
        }

        if (field.type === 'enum') {
            const options = field.options || [];
            const dropdown = trackDropdown(Dropdown({
                options: options.map((o) => ({ value: String(o.value), label: o.label })),
                value: String(cond.value ?? ''),
                title: field.label,
                onChange: (v) => { cond.value = v; },
            }));
            host.appendChild(dropdown.node);
            return;
        }

        if (field.type === 'number') {
            const input = el('input', {
                type: 'number',
                class: 'ena-input filter-value__num',
                value: cond.value ?? 0,
            });
            input.addEventListener('input', () => { cond.value = Number(input.value) || 0; });
            host.appendChild(input);
            return;
        }

        const input = el('input', {
            type: 'text',
            class: 'ena-input filter-value__text',
            value: cond.value ?? '',
            placeholder: '输入值',
        });
        input.addEventListener('input', () => { cond.value = input.value; });
        host.appendChild(input);
    }

    rerender();

    const modal = openModal({
        title,
        body,
        confirmText: '应用',
        cancelText: '取消',
        onConfirm: () => {
            const count = countConditions(draft);
            onApply(count > 0 ? draft : null);
        },
        onCancel: () => {
            destroyDropdowns();
        },
    });

    loadWikiOptionsFromIndexedDB().then((opts) => {
        if (!(opts.genre.length || opts.language.length || opts.bizTags.length)) return;
        applyOptions(opts);
        try { store.update({ wikiOptions: opts }); } catch {}
        rerender();
    });

    return modal;
}
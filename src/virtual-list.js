const DEFAULT_OVERSCAN = 6;

export class VirtualList {
    constructor(options) {
        this.scrollContainer = options.scrollContainer || document.getElementById('content-area');
        this.node = document.createElement('div');
        this.node.className = 'song-list song-list--virtual';
        if (options.className) this.node.className += ' ' + options.className;

        this.cols = options.cols || 1;
        this.rowHeight = options.rowHeight || 52;
        this.gapY = options.gapY ?? 0;
        this.overscan = options.overscan ?? DEFAULT_OVERSCAN;
        this.renderItem = options.renderItem;
        this.getKey = options.getKey || ((item, index) => String(item?.id ?? index));

        this.items = [];
        this.rowCache = new Map();
        this.startRow = -1;
        this.endRow = -1;
        this.totalRows = 0;
        this.locked = false;
        this.rafId = null;
        this.destroyed = false;

        this._onScroll = this._onScroll.bind(this);
        this._onResize = this._onResize.bind(this);

        this.scrollContainer.addEventListener('scroll', this._onScroll, { passive: true });
        window.addEventListener('resize', this._onResize);
    }

    update(items) {
        if (this.destroyed) return;
        this.items = Array.isArray(items) ? items : [];
        this.totalRows = Math.ceil(this.items.length / this.cols);
        const totalHeight = this.totalRows * (this.rowHeight + this.gapY);
        this.node.style.minHeight = totalHeight + 'px';
        if (this.locked) return;
        this.startRow = -1;
        this.endRow = -1;
        this._render(true);
    }

    refresh() {
        if (this.locked) return;
        this.startRow = -1;
        this.endRow = -1;
        this._render(true);
    }

    lock() {
        this.locked = true;
    }

    unlock() {
        if (!this.locked) return;
        this.locked = false;
        this.startRow = -1;
        this.endRow = -1;
        this._render(true);
    }

    destroy() {
        this.destroyed = true;
        this.scrollContainer.removeEventListener('scroll', this._onScroll);
        window.removeEventListener('resize', this._onResize);
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.rowCache.clear();
        if (this.node.parentNode) this.node.parentNode.removeChild(this.node);
    }

    _onScroll() {
        if (this.locked) return;
        if (this.rafId) return;
        this.rafId = requestAnimationFrame(() => {
            this.rafId = null;
            this._render(false);
        });
    }

    _onResize() {
        if (this.locked) return;
        this.startRow = -1;
        this.endRow = -1;
        this._render(true);
    }

    _computeRange() {
        const containerRect = this.scrollContainer.getBoundingClientRect();
        const nodeRect = this.node.getBoundingClientRect();
        const localTop = Math.max(0, containerRect.top - nodeRect.top);
        const localBottom = localTop + this.scrollContainer.clientHeight;
        const rowSpan = this.rowHeight + this.gapY;
        let startRow = Math.floor(localTop / rowSpan) - this.overscan;
        let endRow = Math.ceil(localBottom / rowSpan) + this.overscan;
        if (startRow < 0) startRow = 0;
        if (endRow > this.totalRows) endRow = this.totalRows;
        if (endRow < startRow) endRow = startRow;
        return { startRow, endRow };
    }

    _render(force) {
        if (this.destroyed) return;
        if (this.locked) return;
        const { startRow, endRow } = this._computeRange();

        if (!force && startRow === this.startRow && endRow === this.endRow) return;
        this.startRow = startRow;
        this.endRow = endRow;

        const frag = document.createDocumentFragment();
        const rowSpan = this.rowHeight + this.gapY;

        if (startRow > 0) {
            const spacer = document.createElement('div');
            spacer.className = 'virtual-spacer';
            spacer.style.height = (startRow * rowSpan) + 'px';
            frag.appendChild(spacer);
        }

        for (let row = startRow; row < endRow; row++) {
            const rowEl = document.createElement('div');
            rowEl.className = 'virtual-row';
            rowEl.style.height = this.rowHeight + 'px';
            if (this.gapY > 0) rowEl.style.marginBottom = this.gapY + 'px';

            const startIndex = row * this.cols;
            const endIndex = Math.min(this.items.length, startIndex + this.cols);

            for (let i = startIndex; i < endIndex; i++) {
                const item = this.items[i];
                const key = this.getKey(item, i);
                let cell = this.rowCache.get(key);
                if (!cell) {
                    cell = this.renderItem(item, i);
                    if (cell) {
                        cell.dataset.virtualKey = key;
                        this.rowCache.set(key, cell);
                    }
                }
                if (cell) {
                    cell.dataset.index = String(i);
                    rowEl.appendChild(cell);
                }
            }
            frag.appendChild(rowEl);
        }

        const remaining = this.totalRows - endRow;
        if (remaining > 0) {
            const spacer = document.createElement('div');
            spacer.className = 'virtual-spacer';
            spacer.style.height = (remaining * rowSpan) + 'px';
            frag.appendChild(spacer);
        }

        this.node.replaceChildren(frag);
    }
}

export function createVirtualList(options) {
    return new VirtualList(options);
}
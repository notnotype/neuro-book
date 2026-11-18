// 评审稿里的手感原型，不是产品代码：两种实时布局（行跟手、卡片跟手留空位）共用同一套判定与让位动画，只差拿起后的样子。
// 判定同工作台标签条里排序：被拖的东西往下时下沿过了下一个邻居的中线、往上时上沿过了上一个邻居的中线，邻居就让开；
// 另一组的标题也算一个“邻居”，跨过它就进了那一组。
(() => {
    const ITEMS = [
        {id: "context", side: "left", title: "上下文用量", desc: "圆环与百分比，点开看上下文详情", on: true, chip: "◔ 13%"},
        {id: "words", side: "left", title: "本会话改的字数", desc: "来自插件“字数统计”", plugin: true, on: true, chip: "改了 1.2k 字"},
        {id: "cost", side: "right", title: "费用", desc: "累计费用，单价未知时不显示", on: true, chip: "$0.07"},
        {id: "usage", side: "right", title: "用量与缓存命中", desc: "累计 tokens、输入、输出、缓存命中，明细在悬停", on: true, chip: "⚡162.4k ↓101.2k ↑3.1k ⛁62%"},
        {id: "model", side: "right", title: "模型与推理档", desc: "这次对话用的模型", on: false, chip: "Claude Sonnet · 低"},
    ];
    const MOVE_MS = 280;
    const EASE = "cubic-bezier(0.23, 1, 0.32, 1)";
    const THRESHOLD = 6;
    const ICON_UP = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5"/></svg>';
    const ICON_DOWN = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v10M3.5 8.5 8 13l4.5-4.5"/></svg>';
    const ICON_CHECK = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none"><path d="M3.5 8.2 6.3 11.2 12.5 4.8" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    const translateY = (el) => new DOMMatrixReadOnly(getComputedStyle(el).transform === "none" ? undefined : getComputedStyle(el).transform).m42;
    /** 不算正在走的位移：判定按布局算，不按动画中途的样子。 */
    const layoutTop = (el) => el.getBoundingClientRect().top - translateY(el);

    function rowHtml(item) {
        return `<li class="sl-row" data-id="${item.id}">
            <span class="sl-line"><span class="sl-grip" aria-hidden="true"></span></span>
            <span class="sl-line"><span class="sl-check" role="checkbox" tabindex="0" aria-checked="${item.on}" aria-label="${item.title}">${ICON_CHECK}</span></span>
            <span class="sl-text"><span class="sl-name">${item.title}</span><span class="sl-desc">${item.desc}</span></span>
            ${item.plugin ? '<span class="sl-line"><span class="sl-badge">插件</span></span>' : ""}
            <span class="sl-line sl-moves"><button type="button" class="sl-up" title="上移">${ICON_UP}</button><button type="button" class="sl-down" title="下移">${ICON_DOWN}</button></span>
        </li>`;
    }

    function mount(root) {
        const feel = root.dataset.proto;
        const items = new Map(ITEMS.map((item) => [item.id, {...item}]));
        root.innerHTML = `
            <div class="sl-preview"><span class="sl-label">预览</span><div class="sl-bar"><span class="sl-bar-side" data-bar="left"></span><span class="sl-bar-side" data-bar="right"></span></div></div>
            <div class="sl-groups">
                <section class="sl-group" data-side="left"><h4 class="sl-title">左边</h4><ul class="sl-list"></ul></section>
                <section class="sl-group" data-side="right"><h4 class="sl-title">右边</h4><ul class="sl-list"></ul></section>
            </div>
            <p class="sl-status" aria-live="polite">拖一行试试，可以拖到另一组；拖动中按 Esc 取消。</p>`;
        const lists = {left: root.querySelector('[data-side="left"] .sl-list'), right: root.querySelector('[data-side="right"] .sl-list')};
        const rightTitle = root.querySelector('[data-side="right"] .sl-title');
        const status = root.querySelector(".sl-status");
        for (const item of items.values()) lists[item.side].insertAdjacentHTML("beforeend", rowHtml(item));

        const rows = (side) => [...lists[side].querySelectorAll(":scope > .sl-row")];
        const gap = 2;

        function syncChecks() {
            for (const row of root.querySelectorAll(".sl-row")) {
                const on = items.get(row.dataset.id).on;
                row.querySelector(".sl-check").setAttribute("aria-checked", String(on));
            }
        }
        function syncButtons() {
            const all = [...rows("left"), ...rows("right")];
            all.forEach((row, index) => {
                row.querySelector(".sl-up").disabled = index === 0;
                row.querySelector(".sl-down").disabled = index === all.length - 1;
            });
        }
        function renderBar() {
            for (const side of ["left", "right"]) {
                const chips = rows(side).map((row) => items.get(row.dataset.id)).filter((item) => item.on).map((item) => `<span class="sl-chip">${item.chip}</span>`);
                root.querySelector(`[data-bar="${side}"]`).innerHTML = chips.join("");
            }
        }
        function commitText(id) {
            const row = root.querySelector(`.sl-row[data-id="${id}"]`);
            const side = lists.left.contains(row) ? "left" : "right";
            const index = rows(side).indexOf(row) + 1;
            return `已把“${items.get(id).title}”放到${side === "left" ? "左边" : "右边"}第 ${index} 位。`;
        }
        syncChecks();
        syncButtons();
        renderBar();

        // ─── 让位：先记下每个东西此刻在哪，改完 DOM 再从旧位置滑到新位置 ───
        function flip(mutate, except) {
            const els = [...root.querySelectorAll(".sl-row, .sl-title")].filter((el) => el !== except);
            const before = new Map(els.map((el) => [el, el.getBoundingClientRect().top]));
            mutate();
            for (const el of els) {
                el.style.transition = "none";
                el.style.transform = "";
            }
            for (const el of els) {
                const delta = before.get(el) - el.getBoundingClientRect().top;
                if (Math.abs(delta) > 0.5) el.style.transform = `translateY(${delta}px)`;
            }
            void root.offsetHeight;
            for (const el of els) {
                el.style.transition = `transform ${MOVE_MS}ms ${EASE}`;
                el.style.transform = "";
            }
        }

        // ─── 位置：左边的行、右边的标题、右边的行排成一串“邻居”，来源夹在其中某个空隙里 ───
        function obstacles(source) {
            return [...rows("left").filter((row) => row !== source), rightTitle, ...rows("right").filter((row) => row !== source)];
        }
        function slotOf(source) {
            const left = rows("left").filter((row) => row !== source);
            if (lists.left.contains(source)) return rows("left").indexOf(source);
            return left.length + 1 + rows("right").indexOf(source);
        }
        function placeAt(source, slot) {
            const left = rows("left").filter((row) => row !== source);
            const right = rows("right").filter((row) => row !== source);
            if (slot <= left.length) lists.left.insertBefore(source, left[slot] ?? null);
            else lists.right.insertBefore(source, right[slot - left.length - 1] ?? null);
        }
        /** 按“摘掉来源后”的布局判：在来源后面的邻居都往上让一个来源的高度。往下要过 中线 + 来源占的高度，往上过中线就换，自带回滞。 */
        function judge(source, top, bottom) {
            const obs = obstacles(source);
            const space = source.offsetHeight + gap;
            const current = slotOf(source);
            const removedMid = obs.map((el, index) => {
                const rect = el.getBoundingClientRect();
                const mid = layoutTop(el) + rect.height / 2;
                return index >= current ? mid - space : mid;
            });
            let slot = current;
            for (let guard = 0; guard < obs.length + 1; guard += 1) {
                if (slot < obs.length && bottom > removedMid[slot] + space) slot += 1;
                else if (slot > 0 && top < removedMid[slot - 1]) slot -= 1;
                else break;
            }
            return slot;
        }

        // ─── 一场拖动 ───
        let pending = null;
        let drag = null;
        let suppressClick = false;

        function begin(event) {
            const source = pending.row;
            const rect = source.getBoundingClientRect();
            drag = {
                source,
                pointerId: pending.pointerId,
                grabX: pending.x - rect.left,
                grabY: pending.y - rect.top,
                origin: {left: rows("left").map((row) => row.dataset.id), right: rows("right").map((row) => row.dataset.id)},
                card: null,
            };
            pending = null;
            suppressClick = true;
            root.classList.add("is-dragging");
            try { source.setPointerCapture(drag.pointerId); } catch { /* 原型：拿不到捕获照样能拖 */ }
            if (feel === "card") {
                const card = source.cloneNode(true);
                card.classList.add("sl-card");
                card.style.width = `${rect.width}px`;
                card.style.left = `${rect.left}px`;
                card.style.top = `${rect.top}px`;
                document.body.append(card);
                drag.card = card;
                source.classList.add("is-slot");
            } else {
                source.classList.add("is-held");
                source.style.transition = "none";
            }
            move(event);
        }

        function move(event) {
            const {source} = drag;
            const height = source.offsetHeight;
            let top;
            if (feel === "card") {
                drag.card.style.left = `${event.clientX - drag.grabX}px`;
                drag.card.style.top = `${event.clientY - drag.grabY}px`;
                top = event.clientY - drag.grabY;
            } else {
                // 行只沿竖直方向跟手，夹在两组之间。
                const groups = root.querySelector(".sl-groups").getBoundingClientRect();
                top = Math.min(Math.max(event.clientY - drag.grabY, groups.top), groups.bottom - height);
            }
            const slot = judge(source, top, top + height);
            if (slot !== slotOf(source)) {
                flip(() => placeAt(source, slot), source);
                status.textContent = feel === "card" ? "空位跟着挪了。" : "邻居让开了。";
            }
            if (feel !== "card") source.style.transform = `translateY(${top - layoutTop(source)}px)`;
        }

        function finish(cancelled) {
            const {source, card, origin} = drag;
            drag = null;
            root.classList.remove("is-dragging");
            if (cancelled) {
                flip(() => {
                    for (const side of ["left", "right"]) for (const id of origin[side]) lists[side].append(root.querySelector(`.sl-row[data-id="${id}"]`));
                }, source);
            }
            if (card !== null) {
                const rect = source.getBoundingClientRect();
                card.style.transition = `left ${MOVE_MS}ms ${EASE}, top ${MOVE_MS}ms ${EASE}, box-shadow ${MOVE_MS}ms ${EASE}`;
                card.style.left = `${rect.left}px`;
                card.style.top = `${layoutTop(source)}px`;
                card.classList.add("is-landing");
                setTimeout(() => {
                    card.remove();
                    source.classList.remove("is-slot");
                }, MOVE_MS);
            } else {
                source.style.transition = `transform ${MOVE_MS}ms ${EASE}, box-shadow ${MOVE_MS}ms ${EASE}, background-color ${MOVE_MS}ms ${EASE}`;
                source.style.transform = "";
                source.classList.add("is-landing");
                setTimeout(() => source.classList.remove("is-held", "is-landing"), MOVE_MS);
            }
            syncButtons();
            if (cancelled) {
                status.textContent = "已取消，回到原样，设置没变。";
            } else {
                renderBar();
                status.textContent = commitText(source.dataset.id);
            }
        }

        root.addEventListener("pointerdown", (event) => {
            if (event.button !== 0 || drag !== null) return;
            const row = event.target.closest(".sl-row");
            if (row === null || event.target.closest("button") !== null) return;
            suppressClick = false;
            pending = {row, pointerId: event.pointerId, x: event.clientX, y: event.clientY};
        });
        window.addEventListener("pointermove", (event) => {
            if (drag !== null && event.pointerId === drag.pointerId) {
                move(event);
                return;
            }
            if (pending === null || event.pointerId !== pending.pointerId) return;
            if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) >= THRESHOLD) begin(event);
        });
        window.addEventListener("pointerup", (event) => {
            if (drag !== null && event.pointerId === drag.pointerId) finish(false);
            pending = null;
        });
        window.addEventListener("pointercancel", () => {
            if (drag !== null) finish(true);
            pending = null;
        });
        window.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && drag !== null) {
                event.preventDefault();
                finish(true);
            }
        });
        // 拖过之后浏览器照样发一次 click：吞掉，免得松手时顺带勾掉了这一项。
        root.addEventListener("click", (event) => {
            if (!suppressClick) return;
            suppressClick = false;
            event.preventDefault();
            event.stopPropagation();
        }, true);

        root.addEventListener("click", (event) => {
            const row = event.target.closest(".sl-row");
            if (row === null) return;
            const up = event.target.closest(".sl-up");
            const down = event.target.closest(".sl-down");
            if (up !== null || down !== null) {
                const slot = slotOf(row) + (up !== null ? -1 : 1);
                flip(() => placeAt(row, slot));
                syncButtons();
                renderBar();
                status.textContent = commitText(row.dataset.id);
                return;
            }
            if (event.target.closest(".sl-check, .sl-text") !== null) {
                const item = items.get(row.dataset.id);
                item.on = !item.on;
                syncChecks();
                renderBar();
            }
        });
    }

    document.querySelectorAll("[data-proto]").forEach(mount);
})();

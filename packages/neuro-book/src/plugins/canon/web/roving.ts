/**
 * 列表里行之间的键盘移动（docs/specs/canon/author-ui.md 输出 23、24）：上下键、Home、End 在行之间移，只有焦点所在那行在 Tab
 * 序列里（行里的按钮也一样）。照设置窗口左栏与 `ProviderRail` 的写法。待处理、改动记录两个视图先在 canon 里用；第三处要用时挪进
 * nb-ui。
 *
 * 行是带 `data-row` 属性（值是行的键）的元素。焦点跟着按键直接移到目标行上，不等父组件改受控值：宿主慢一拍时焦点也不丢。组件在
 * 行的 `focusin` 里报出当前行，选中跟着焦点走的视图（待处理）在那里换选中。
 */

/** 按了 `key` 以后焦点去哪一行；不是这几个键时为 null。没有当前行时上下键都到第一行。 */
export function rovingTarget(keys: readonly string[], current: string | null, key: string): string | null {
    if (keys.length === 0) return null;
    const at = current === null ? -1 : keys.indexOf(current);
    if (key === "ArrowDown") return keys[at < 0 ? 0 : Math.min(keys.length - 1, at + 1)]!;
    if (key === "ArrowUp") return keys[Math.max(0, at - 1)]!;
    if (key === "Home") return keys[0]!;
    if (key === "End") return keys[keys.length - 1]!;
    return null;
}

/** 行之间移焦点：在列表根上监听 `keydown`。焦点不在某一行或行里的按钮上（例如在列表顶上的筛选里）时不管。 */
export function rovingKeydown(event: KeyboardEvent, root: HTMLElement | null): void {
    if (root === null || !(event.target instanceof HTMLElement)) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const row = event.target.closest<HTMLElement>("[data-row]");
    if (row === null || !root.contains(row)) return;
    const rows = [...root.querySelectorAll<HTMLElement>("[data-row]")];
    const target = rovingTarget(rows.map((element) => element.dataset.row!), row.dataset.row!, event.key);
    if (target === null) return;
    event.preventDefault();
    rows.find((element) => element.dataset.row === target)?.focus();
}

/** 在 Tab 序列里的那一行：当前行还在列表里就是它，否则是第一行。 */
export function tabbableRow(keys: readonly string[], current: string | null | undefined): string | null {
    return current !== null && current !== undefined && keys.includes(current) ? current : keys[0] ?? null;
}

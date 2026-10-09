/**
 * 内容文件夹里的排序（docs/specs/workbench/files-explorer.md 的“拖动”与“上移 / 下移”）：上移下移与拖动排序共用这一份
 * 变换，结果交给 `reorder`（只改清单）。`order` 是这一层清单里的全部条目（含缺失条目），按清单顺序。
 */

/** 选中的条目整体移动一位，保持它们的相对顺序；已经在最前（最后）的连续一段不动。没有变化时返回 `null`。 */
export function shiftNames(order: ReadonlyArray<string>, selected: ReadonlySet<string>, direction: "up" | "down"): string[] | null {
    const next = [...order];
    const indices = direction === "up" ? next.map((_, index) => index) : next.map((_, index) => next.length - 1 - index);
    const step = direction === "up" ? -1 : 1;
    let changed = false;
    for (const index of indices) {
        const name = next[index] as string;
        const neighbour = index + step;
        if (!selected.has(name) || neighbour < 0 || neighbour >= next.length || selected.has(next[neighbour] as string)) continue;
        next[index] = next[neighbour] as string;
        next[neighbour] = name;
        changed = true;
    }
    return changed ? next : null;
}

/** 把 `moved`（保持它们在 `order` 里的相对顺序）放到 `before` 之前；`before` 为 `null` 时放到末尾。没有变化时返回 `null`。 */
export function placeNames(order: ReadonlyArray<string>, moved: ReadonlySet<string>, before: string | null): string[] | null {
    if (before !== null && moved.has(before)) return null;
    const kept = order.filter((name) => !moved.has(name));
    const block = order.filter((name) => moved.has(name));
    const at = before === null ? kept.length : kept.indexOf(before);
    if (at < 0) return null;
    const next = [...kept.slice(0, at), ...block, ...kept.slice(at)];
    return next.every((name, index) => name === order[index]) ? null : next;
}

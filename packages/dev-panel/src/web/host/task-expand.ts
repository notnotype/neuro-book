/**
 * Work 页就地展开 Task（t15 阶段 4 第 2 批，决定点 9）：展开时才取这个 Task 的接口，同时最多 3 行。
 * 每个 Task 接口都要跑一次 `git log` 与执行 checkout 的判定，展开的行又各是一份订阅推送的资源，所以页面只开 3 个固定的资源槽：
 * 展开一行占一个空槽；没有空槽时收起最早展开的那行、把它的槽给新的一行。槽位固定，别的行展开、收起时已展开的行不会重取。
 */
export const MAX_EXPANDED = 3;

export type Expansion = {
    /** 资源槽：每个槽里是展开着的 Task id，空槽为 null。 */
    slots: Array<string | null>;
    /** 展开的先后，最早的在前。 */
    order: string[];
};

export const emptyExpansion = (): Expansion => ({slots: Array<string | null>(MAX_EXPANDED).fill(null), order: []});

export function toggleExpansion(current: Expansion, taskId: string): Expansion {
    const slots = [...current.slots];
    const at = slots.indexOf(taskId);
    if (at >= 0) {
        slots[at] = null;
        return {slots, order: current.order.filter((entry) => entry !== taskId)};
    }
    let free = slots.indexOf(null);
    let order = current.order;
    if (free < 0) {
        const oldest = order[0]!;
        free = slots.indexOf(oldest);
        order = order.slice(1);
    }
    slots[free] = taskId;
    return {slots, order: [...order, taskId]};
}

/** 展开的一行里显示什么：页面取 Task 接口后算好，交给零件 TaskTable（零件不取数）。 */
export type TaskTableDetail = {
    state: {loading: boolean; error: {message: string; status?: number} | null; hasData: boolean; receivedAt: string | null};
    /** README“当前状态”“下一步”两节渲染后的 HTML；没有这一节为 null。 */
    currentHtml: string | null;
    nextHtml: string | null;
    artifacts: Array<{key: string; label: string; href: string; waiting: number}>;
    evidences: Array<{key: string; label: string; href: string | null}>;
};

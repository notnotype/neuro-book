/**
 * 开发模式的配置检查（Spec `ui/nested-grid` 输出 151、158、159）：几种会让网格“拖不动”却没有任何报错的接线错误，开关打开时在控制台警告。
 *
 * - 开关是模块级的、缺省关：库不读 `import.meta.env`。库模式构建会把它静态替换（提案标着“凭记忆，第二档发产物时核实”），
 *   宿主自己的开发构建才知道是不是开发模式，所以由宿主调 `setLayoutDevChecks(true)`。
 * - 状态放在全局符号上：将来的发布产物里根入口与 `./vue` 入口如果各带一份本模块（推断：今天 `exports` 直接指向源码，只有一份），
 *   宿主从根入口打开的开关仍然到得了 Vue 层的检查点。
 * - 每个检查点的“已经报过”按所属的组件或宿主记（`WeakMap`），寿命跟着它：一页里有几个网格时各报各的，`v-if` 摘掉再挂回的会再报一次。
 * - 只 `console.warn`，不走 `onIssues`：这是给写宿主的人看的接线错误，不是运行时诊断；被拒的提交照旧经 `issues` 事件交出。
 * - 库不把诊断本身打到控制台，诊断照旧只走 `onIssues`；“没给 `onIssues`”本身算接线错误，由 `useGridHost` 在这里报一次（Spec 输出 158）。
 */

import {axisOf} from "./grid-geometry";
import type {GridLayoutResult, GridNode} from "./grid-types";

type DevCheckState = {enabled: boolean; reported: WeakMap<object, Set<string>>};

const STATE_KEY = Symbol.for("nb-layout.devChecks");

function state(): DevCheckState {
    const holder = globalThis as {[STATE_KEY]?: DevCheckState};
    holder[STATE_KEY] ??= {enabled: false, reported: new WeakMap()};
    return holder[STATE_KEY];
}

/**
 * 打开或关闭开发模式的配置检查（缺省关）。宿主在自己的开发构建里打开，例如 `if (import.meta.env.DEV) setLayoutDevChecks(true)`。
 * 在网格挂载之前调：开关不是响应式的，挂载之后才打开时，已经挂着的网格要到下一次布局变化才查分隔条那一条。
 * @experimental
 */
export function setLayoutDevChecks(enabled: boolean): void {
    state().enabled = enabled;
}

/** 开关打开时，`owner`（一个 `NestedGrid` 或一个宿主）的每种 `kind` 只警告一次。不从入口导出。 */
export function layoutDevWarning(owner: object, kind: string, message: string): void {
    const current = state();
    if (!current.enabled) return;
    let kinds = current.reported.get(owner);
    if (kinds === undefined) {
        kinds = new Set();
        current.reported.set(owner, kinds);
    }
    if (kinds.has(kind)) return;
    kinds.add(kind);
    console.warn(message);
}

/**
 * 一个网格实例的警告函数：“每种只报一次”按这个实例记（`owner` 在这里建，寿命跟着返回的函数），警告带上是哪个网格，
 * 没给 `contextKey` 的宿主也认得出（Spec 输出 151）。`contextKey` 按调用时的值取。不从入口导出。
 */
export function gridDevWarner(contextKey: () => string): (kind: string, problem: string) => void {
    const owner = {};
    return (kind, problem) => {
        const key = contextKey();
        const grid = key === "" ? "A NestedGrid without a contextKey" : `NestedGrid "${key}"`;
        layoutDevWarning(owner, kind, `[nb-layout/NestedGrid] ${grid} ${problem}`);
    };
}

/** 宿主的提交处理返回的是不是 `{ok: true}` 或失败（带布尔的 `ok`）。不从入口导出。 */
export const isCommitResult = (value: unknown): boolean => typeof value === "object" && value !== null && typeof (value as {ok?: unknown}).ok === "boolean";

/** 警告里给写宿主的人看的“拿到了什么”。不从入口导出。 */
export const describeValue = (value: unknown): string => (value === null ? "null" : Array.isArray(value) ? "an array" : value instanceof Promise ? "a Promise" : typeof value);

/** 开关关着时不必算检查的条件。不从入口导出。 */
export function layoutDevChecksEnabled(): boolean {
    return state().enabled;
}

/**
 * 有两侧都能调的边界、而它们全是 0 宽（`createGrid` 的 `sashSize` 缺省 0 时就是这样）：这种网格拖不动。
 * 只看两侧都能调的边界：挨着固定尺寸节点（工作台的条、收起成 0 的面板）的缝 0 宽本来就拖不动、也无害，
 * 工作台窄窗口里区域被收走、只剩编辑区与条时，剩下的缝全是这种。不从入口导出。
 */
export function onlyZeroWidthBoundaries(root: GridNode<unknown> | null, layout: GridLayoutResult): boolean {
    let adjustable = 0;
    let visible = 0;
    const resizable = (id: string, axis: "width" | "height"): boolean => {
        const bounds = layout.constraints[id];
        return bounds !== undefined && bounds.maximumSize[axis] - bounds.minimumSize[axis] > 0.5;
    };
    const visit = (node: GridNode<unknown>): void => {
        if (node.kind === "leaf") return;
        const axis = axisOf(node.orientation);
        const sashes = layout.sashSizes[node.id] ?? [];
        node.children.forEach((child, index) => {
            const next = node.children[index + 1];
            if (next !== undefined && resizable(child.id, axis) && resizable(next.id, axis)) {
                adjustable += 1;
                if ((sashes[index] ?? 0) > 0) visible += 1;
            }
            visit(child);
        });
    };
    if (root !== null) visit(root);
    return adjustable > 0 && visible === 0;
}

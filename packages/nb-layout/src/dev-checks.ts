/**
 * 开发模式的配置检查（Spec `ui/nested-grid` 输出 151）：几种会让网格“拖不动”却没有任何报错的接线错误，开关打开时在控制台警告。
 *
 * - 开关是模块级的、缺省关：库不读 `import.meta.env`。库模式构建会把它静态替换（提案标着“凭记忆，第二档发产物时核实”），
 *   宿主自己的开发构建才知道是不是开发模式，所以由宿主调 `setLayoutDevChecks(true)`。
 * - 状态放在全局符号上：发布产物里根入口与 `./vue` 入口如果各带一份本模块，宿主从根入口打开的开关仍然到得了 Vue 层的检查点。
 * - 每个检查点的“已经报过”按所属的组件或宿主记（`WeakMap`），寿命跟着它：一页里有几个网格时各报各的，`v-if` 摘掉再挂回的会再报一次。
 * - 只 `console.warn`，不走 `onIssues`：这是给写宿主的人看的接线错误，不是运行时诊断；被拒的提交照旧经 `issues` 事件交出。
 */

type DevCheckState = {enabled: boolean; reported: WeakMap<object, Set<string>>};

const STATE_KEY = Symbol.for("nb-layout.devChecks");

function state(): DevCheckState {
    const holder = globalThis as {[STATE_KEY]?: DevCheckState};
    holder[STATE_KEY] ??= {enabled: false, reported: new WeakMap()};
    return holder[STATE_KEY];
}

/** 打开或关闭开发模式的配置检查（缺省关）。宿主在自己的开发构建里打开，例如 `if (import.meta.env.DEV) setLayoutDevChecks(true)`。 */
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

/** 开关关着时不必算检查的条件。不从入口导出。 */
export function layoutDevChecksEnabled(): boolean {
    return state().enabled;
}

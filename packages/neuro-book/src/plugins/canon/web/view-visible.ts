/**
 * 视图组件收到的 `context`（docs/specs/workbench/views.md 的 `ViewContext`）里的 `visible`：停放、收起与加载中都不算可见。canon 的
 * 三个视图在不可见时不占着读取（docs/specs/canon/author-ui.md 输出 26）：读取层留着结果，回到前台时先显示旧的，同时重读。测试与
 * Lab 直接挂宿主、不给 `context` 时按可见算。窗口没有绑定项目时三个视图都只写一句“打开作品后可用”（`unboundView`）。
 */

import {computed, h} from "vue";
import type {ComputedRef, PropType, VNode} from "vue";

import type {ViewContext} from "nbook/plugins/workbench/web/contracts";

export const viewContextProp = {context: {type: Object as PropType<ViewContext>, required: false}} as const;

export function viewVisible(props: {readonly context?: ViewContext | undefined}): ComputedRef<boolean> {
    return computed(() => props.context?.visible.value ?? true);
}

/** 窗口没有绑定项目时视图里的那一句。`text` 是 `useCanonText()` 取到的。 */
export function unboundView(text: (key: "world.unbound") => string): VNode {
    return h("p", {class: "px-3 py-2 text-[length:var(--text-sm)] text-[var(--text-muted)]"}, text("world.unbound"));
}

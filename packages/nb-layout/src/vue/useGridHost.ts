/**
 * 宿主接线（Spec `ui/nested-grid` 输出 144 到 146）：把 `NestedGrid` 要的几样打成一包，宿主写
 * `<NestedGrid v-bind="host.bindings.value" …>` 就能接手势。
 *
 * - 尺寸来自 `NestedGrid` 自己量的根盒（`extent` 事件），宿主不另量；没量到可用尺寸时布局为空、手势停用。
 * - 提交的校验、诊断只发新增、落账后的通知照 `useGridLayout`（内部模块）的规则，这里只是把它接上尺寸与整包。
 * - 布局重算的诊断与 `NestedGrid` 的 `issues` 事件合到 `onIssues` 一个出口。
 * - `disabled`、`contextKey`、提交处理只经这里的选项给：模板里再写同名属性，前两个会静默覆盖包里的值（Vue 的 `mergeProps`
 *   后写的赢），提交处理会被换掉或合成数组。
 * - 为什么是组合式函数加整包，而不是包一层宿主组件：`NestedGrid` 仍是唯一的组件，宿主照常掌握模板（属性、插槽、事件），
 *   不必经过一个要透传二十来个属性与九个插槽的包装层。
 */

import {computed, shallowRef, toValue} from "vue";
import type {ComputedRef, MaybeRefOrGetter, Ref} from "vue";

import type {Grid} from "../grid";
import {usableExtent} from "../grid-geometry";
import type {GridGestureCommit} from "../grid-gesture";
import type {GridBranchesResizeResult, GridExtent, GridFailure, GridHostIssueCode, GridIssue, GridIssueCode, GridLayoutCommitResult, GridLayoutResult, GridNode} from "../grid-types";
import {useGridLayout} from "./useGridLayout";

/** 交给宿主的诊断：布局重算的、手势的、被拒的提交（带 `ok`）。 */
export type GridHostIssue = GridIssue<GridIssueCode | GridHostIssueCode> | GridFailure;

/** 整包绑到 `NestedGrid` 上的属性与事件处理。 */
export type GridHostBindings<T> = {
    readonly node: GridNode<T> | null;
    readonly layout: GridLayoutResult;
    readonly revision: number;
    readonly contextKey: string;
    readonly disabled: boolean;
    readonly onGestureCommit: (commit: GridGestureCommit) => GridLayoutCommitResult;
    readonly onExtent: (extent: GridExtent | null) => void;
    readonly onIssues: (issues: readonly GridHostIssue[]) => void;
};

export type GridHost<T> = {
    /** 当前树；结构变更后调用 `invalidate()` 重新读取。 */
    readonly node: ComputedRef<GridNode<T> | null>;
    /** 当前发布的布局；没量到可用尺寸时是空布局。 */
    readonly layout: Readonly<Ref<GridLayoutResult>>;
    /** 失效版本：树、尺寸或上下文变了递增。 */
    readonly revision: Readonly<Ref<number>>;
    /** `NestedGrid` 量到的承载盒；挂载前与卸载后是 null。 */
    readonly extent: Readonly<Ref<GridExtent | null>>;
    /** 宿主改了树的结构后调用：重算布局并递增版本。 */
    invalidate(): void;
    /** 整包绑到 `NestedGrid` 上。 */
    readonly bindings: ComputedRef<GridHostBindings<T>>;
};

export type GridHostOptions<T> = {
    /** 网格实例；建议放在 `shallowRef` 里（实例不该被深度代理）。为 null 时布局为空、拒绝提交。 */
    readonly grid: MaybeRefOrGetter<Grid<T> | null>;
    /** 副作用上下文（工作面、布局键）：提交时核对，换了上下文的旧手势不落账。缺省空串；包里与核对用的是同一个值。 */
    readonly contextKey?: MaybeRefOrGetter<string>;
    /** 宿主自己的停用条件；没量到可用尺寸时总是停用。 */
    readonly disabled?: MaybeRefOrGetter<boolean>;
    /** 提交已经落账之后的通知；它抛错只报诊断，不反悔已提交的几何。 */
    readonly onApplied?: (commit: GridGestureCommit, result: Extract<GridBranchesResizeResult, {ok: true}>) => void;
    /** 诊断的唯一出口（Spec 输出 139、140）。 */
    readonly onIssues?: (issues: readonly GridHostIssue[]) => void;
};

export function useGridHost<T>(options: GridHostOptions<T>): GridHost<T> {
    const extent = shallowRef<GridExtent | null>(null);
    const contextKey = (): string => toValue(options.contextKey) ?? "";
    const layoutHost = useGridLayout<T>({
        grid: computed(() => toValue(options.grid)),
        extent,
        contextKey,
        ...(options.onApplied === undefined ? {} : {onApplied: options.onApplied}),
        onIssues: (issues) => options.onIssues?.(issues),
    });
    const onExtent = (next: GridExtent | null): void => {
        extent.value = next;
    };
    const onIssues = (issues: readonly GridHostIssue[]): void => options.onIssues?.(issues);
    const bindings = computed<GridHostBindings<T>>(() => ({
        node: layoutHost.node.value,
        layout: layoutHost.layout.value,
        revision: layoutHost.revision.value,
        contextKey: contextKey(),
        disabled: toValue(options.disabled) === true || !usableExtent(extent.value),
        onGestureCommit: layoutHost.onGestureCommit,
        onExtent,
        onIssues,
    }));
    return {node: layoutHost.node, layout: layoutHost.layout, revision: layoutHost.revision, extent, invalidate: layoutHost.invalidate, bindings};
}

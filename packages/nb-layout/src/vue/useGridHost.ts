/**
 * 宿主接线（Spec `ui/nested-grid` 输出 144 到 146）：把 `NestedGrid` 要的几样打成一包，宿主写
 * `<NestedGrid v-bind="host.bindings.value" …>` 就能接手势。
 *
 * - 尺寸来自 `NestedGrid` 自己量的根盒（`extent` 事件），宿主不另量；没量到可用尺寸时布局为空、手势停用。
 * - 提交的校验、诊断只发新增、落账后的通知照 `useGridLayout`（内部模块）的规则，这里只是把它接上尺寸与整包。
 * - 布局重算的诊断与 `NestedGrid` 的 `issues` 事件合到 `onIssues` 一个出口。没给 `onIssues` 时库不把诊断打到控制台，只在开发检查打开时
 *   警告一次“没有出口”（Spec 输出 158）：缺省打印会绕过宿主自己的诊断出口，库也判断不了宿主接没接别的出口；生产构建的宿主
 *   不该收到库的控制台输出。
 * - `disabled`、`contextKey`、提交处理只经这里的选项给：模板里再写同名属性，前两个会静默覆盖包里的值（Vue 的 `mergeProps`
 *   后写的赢），提交处理会被换掉或合成数组。
 * - 为什么是组合式函数加整包，而不是包一层宿主组件：`NestedGrid` 仍是唯一的组件，宿主照常掌握模板（属性、插槽、事件），
 *   不必经过一个要透传二十来个属性与九个插槽的包装层。
 */

import {computed, shallowRef, toValue} from "vue";
import type {ComputedRef, MaybeRefOrGetter, Ref} from "vue";

import type {Grid} from "../grid";
import {commitFailure} from "../grid-failure";
import {usableExtent} from "../grid-geometry";
import type {GridGestureCommit, GridGestureStart} from "../grid-gesture";
import {layoutDevWarning} from "../dev-checks";
import type {GridCollapseOptions, GridCollapseResult, GridExtent, GridFailure, GridHostIssueCode, GridIssue, GridIssueCode, GridLayoutCommitResult, GridLayoutResult, GridNode, GridSetSizeResult} from "../grid-types";
import {useGridLayout, type GridHostChange} from "./useGridLayout";

export type {GridHostChange} from "./useGridLayout";

/**
 * 交给宿主的诊断：布局重算的、手势的、被拒的提交（带 `ok`）。
 * @experimental
 */
export type GridHostIssue = GridIssue<GridIssueCode | GridHostIssueCode> | GridFailure;

/**
 * 整包绑到 `NestedGrid` 上的属性与事件处理。
 * @experimental
 */
export type GridHostBindings<T> = {
    readonly node: GridNode<T> | null;
    readonly layout: GridLayoutResult;
    readonly revision: number;
    readonly contextKey: string;
    readonly disabled: boolean;
    readonly onGestureCommit: (commit: GridGestureCommit) => GridLayoutCommitResult;
    readonly onExtent: (extent: GridExtent | null) => void;
    readonly onIssues: (issues: readonly GridHostIssue[]) => void;
    /**
     * 开发模式的接线检查（Spec 输出 151）：手势开始时核对 `NestedGrid` 用的上下文与版本是不是包里的。模板里另写 `@gesture-start`
     * 会和它合成数组、两个都调；渲染函数里展开 `bindings` 时不要用同名的键覆盖它，也不要放在它前面被它覆盖。
     */
    readonly onGestureStart: (start: GridGestureStart) => void;
};

/** @experimental */
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
    /**
     * 收起或展开一块面板（Spec 输出 149）：调 `grid.setCollapsed`，`options` 同它（`locked` 同时改锁）。标记或锁变了就重发布局
     * （版本递增，进行中的手势提交因此被拒）并通知 `onApplied`（`kind: "collapse"`，输出 170）；没变不打断、不通知。
     * 没有网格时 `not-ready`。
     */
    setCollapsed(id: string, collapsed: boolean, options?: GridCollapseOptions): GridCollapseResult | GridFailure<"not-ready">;
    /**
     * 设一块保留像素的尺寸（Spec 输出 171）：调 `grid.setSize`，意图变了就重发布局并通知 `onApplied`（`kind: "size"`），
     * 没变不打断、不通知。没有网格时 `not-ready`。
     */
    setSize(id: string, px: number): GridSetSizeResult | GridFailure<"not-ready">;
    /** 整包绑到 `NestedGrid` 上。 */
    readonly bindings: ComputedRef<GridHostBindings<T>>;
};

/** @experimental */
export type GridHostOptions<T> = {
    /** 网格实例；建议放在 `shallowRef` 里（实例不该被深度代理）。为 null 时布局为空、拒绝提交。 */
    readonly grid: MaybeRefOrGetter<Grid<T> | null>;
    /** 副作用上下文（工作面、布局键）：提交时核对，换了上下文的旧手势不落账。缺省空串；包里与核对用的是同一个值。 */
    readonly contextKey?: MaybeRefOrGetter<string>;
    /** 宿主自己的停用条件；没量到可用尺寸时总是停用。 */
    readonly disabled?: MaybeRefOrGetter<boolean>;
    /**
     * 落账之后的通知，存档接这一处（Spec 输出 170）：手势提交、`setCollapsed`、`setSize` 各调一次，`change.kind` 分开三种；
     * 宿主直接改 `grid.*` 再 `invalidate()` 的不通知。它抛错只报诊断，不反悔已落账的几何。`before` 是落账之前发布的布局（输出 150）。
     */
    readonly onApplied?: (change: GridHostChange, before: GridLayoutResult) => void;
    /** 诊断的唯一出口（Spec 输出 139、140）；不给时开发检查警告一次（输出 158）。 */
    readonly onIssues?: (issues: readonly GridHostIssue[]) => void;
};

/** @experimental */
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
    /**
     * `gesture-start` 在按下时同步发出，那时宿主已经刷新：上下文或版本不等，只能是模板里另写的值盖住了包里的。
     * 不在提交处判：手势期间换了上下文或重发布局时，`NestedGrid` 自己把手势取消，到不了提交（t41 设计审查第 1 条）。
     */
    const devOwner = {};
    // 只判建立时这一次：`onIssues` 是选项里的普通函数，不是 ref，之后不会变。
    if (options.onIssues === undefined) {
        const context = contextKey();
        const grid = context === "" ? "the grid without a contextKey" : `grid "${context}"`;
        layoutDevWarning(devOwner, "no-issues-outlet", `[nb-layout/useGridHost] ${grid} has no onIssues, so layout diagnostics and rejected resizes are dropped silently. Pass onIssues; to ignore them on purpose, pass a function that does nothing.`);
    }
    const onGestureStart = (start: GridGestureStart): void => {
        const context = contextKey();
        const grid = context === "" ? "the grid without a contextKey" : `grid "${context}"`;
        if (start.contextKey !== context) {
            layoutDevWarning(devOwner, "context-mismatch", `[nb-layout/useGridHost] NestedGrid started a gesture with contextKey "${start.contextKey}", but the host's is "${context}", so the resize will be rejected. Do not override context-key in the template; pass contextKey to useGridHost.`);
        }
        if (start.revision !== layoutHost.revision.value) {
            layoutDevWarning(devOwner, "revision-mismatch", `[nb-layout/useGridHost] NestedGrid of ${grid} started a gesture at revision ${String(start.revision)}, but the host is at ${String(layoutHost.revision.value)}, so the resize will be rejected. Do not override revision in the template; bind host.bindings.value.`);
        }
    };
    const bindings = computed<GridHostBindings<T>>(() => ({
        node: layoutHost.node.value,
        layout: layoutHost.layout.value,
        revision: layoutHost.revision.value,
        contextKey: contextKey(),
        disabled: toValue(options.disabled) === true || !usableExtent(extent.value),
        onGestureCommit: layoutHost.onGestureCommit,
        onExtent,
        onIssues,
        onGestureStart,
    }));
    const setCollapsed = (id: string, collapsed: boolean, collapseOptions?: GridCollapseOptions): GridCollapseResult | GridFailure<"not-ready"> => {
        const grid = toValue(options.grid);
        if (grid === null) return commitFailure("not-ready", "The grid is not ready; nothing was collapsed", {missing: "grid"});
        // 改树之前留下发布着的布局与旧标记：结果里的 `collapse` 是调用之后的，分不出“标记变了”与“只改了锁”。
        const before = layoutHost.layout.value;
        const wasCollapsed = grid.find(id)?.collapse?.collapsed;
        const result = grid.setCollapsed(id, collapsed, collapseOptions);
        if (result.ok && result.changed) {
            layoutHost.applyChange({kind: "collapse", id, result, collapsed: wasCollapsed === collapsed ? {} : {[id]: collapsed}}, before);
        }
        return result;
    };
    const setSize = (id: string, px: number): GridSetSizeResult | GridFailure<"not-ready"> => {
        const grid = toValue(options.grid);
        if (grid === null) return commitFailure("not-ready", "The grid is not ready; nothing was resized", {missing: "grid"});
        const before = layoutHost.layout.value;
        const result = grid.setSize(id, px);
        if (result.ok && result.changed) layoutHost.applyChange({kind: "size", id, result, collapsed: {}}, before);
        return result;
    };
    return {node: layoutHost.node, layout: layoutHost.layout, revision: layoutHost.revision, extent, invalidate: layoutHost.invalidate, setCollapsed, setSize, bindings};
}

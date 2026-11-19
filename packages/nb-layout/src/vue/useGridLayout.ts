/**
 * 网格宿主的共享装配：把「树 + 容器尺寸 + 上下文」变成一次手势可用的 node/layout/revision，
 * 并在接纳一次提交时**只调用一次** `grid.resizeBranches`。
 *
 * 职责边界（`docs/specs/ui/nested-grid.md`）：
 * - 本 composable **不创建也不克隆业务树**、不读存储、不决定收起策略——那些属于宿主；
 * - 结构变更后宿主要显式 `invalidate()`：同一 `Grid` 实例原地改树时它的引用不会变，
 *   只有递增 revision 才能让 `node` 与渲染层的会话重新计算；
 * - 自身提交造成的新布局**不伪装成外部版本变化**：提交在会话结束后才到达，先进校验、后发布，
 *   不会把自己的预览判成过期；
 * - `onApplied` 是「已经落账」的通知，不是第二道拒绝门：它抛错只报 issues，不反悔已提交的几何，
 *   否则渲染层会以为树没改、回滚到旧预览。
 */
import {computed, ref, shallowRef, watch, type ComputedRef, type Ref} from "vue";
import type {Grid} from "../grid";
import {commitFailure} from "../grid-failure";
import {gridIssue} from "../grid-issue";
import {createIssueGate} from "../issue-gate";
import type {GridGestureCommit} from "../grid-gesture";
import type {GridBranchesResizeResult, GridExtent, GridIssue, GridIssueCode, GridLayoutCommitResult, GridLayoutResult, GridNode} from "../grid-types";

/** 没有可发布几何（未挂载 / 无尺寸 / 无网格）时的空布局。 */
export const EMPTY_GRID_LAYOUT: GridLayoutResult = {sizes: {}, constraints: {}, sashSizes: {}, issues: []};

/** 提交的结果（Spec `ui/nested-grid` 失败 6）；类型在根入口定义，`SashGestureBinding.onCommit` 也用它。 */
export type {GridLayoutCommitResult};

export type GridLayoutHost<T> = {
    /** 当前树；结构变更后调用 `invalidate()` 重新读取。 */
    node: ComputedRef<GridNode<T> | null>;
    /** 当前发布布局；没有可呈现空间时是空布局。 */
    layout: Readonly<Ref<GridLayoutResult>>;
    /** 失效版本：树、容器尺寸或上下文变化时递增，渲染层的会话与菜单据此作废。 */
    revision: Readonly<Ref<number>>;
    /** 宿主结构变更后调用：发布新布局并递增 revision。 */
    invalidate(): void;
    /** 接一次手势提交：校验冻结事实 → 一次 `resizeBranches` → 发布布局 → 通知一次。 */
    onGestureCommit(commit: GridGestureCommit): GridLayoutCommitResult;
};

export function useGridLayout<T>(options: {
    /** 当前网格实例；为 null 时发布空布局并拒绝提交。 */
    grid: Readonly<Ref<Grid<T> | null>>;
    /** 承载盒的布局尺寸（见 `useLayoutExtent`）；为 null、零尺寸或非有限时同 `grid` 为 null 处理。 */
    extent: Readonly<Ref<GridExtent | null>>;
    /** 副作用上下文（工作面 / 布局键）：提交时核对，避免把旧工作面的手势写进新工作面。 */
    contextKey: () => string;
    /** 已落账后的通知；抛错只报 issues。 */
    onApplied?: (commit: GridGestureCommit, result: Extract<GridBranchesResizeResult, {ok: true}>) => void;
    /**
     * 诊断出口（Spec `ui/nested-grid` 输出 139、140）：布局重算的诊断与 `notify-failed`。它抛出时异常照常冒出去，
     * 只有提交落账之后的那几次通知例外（见 `notifyAfterCommit`）。
     */
    onIssues?: (issues: readonly GridIssue<GridIssueCode | "notify-failed">[]) => void;
}): GridLayoutHost<T> {
    const revision = ref(0);
    const layout = shallowRef<GridLayoutResult>(EMPTY_GRID_LAYOUT);
    /** 上次发布布局所用的容器尺寸：提交时核对，尺寸变了就不接旧手势。 */
    let publishedExtent: GridExtent | null = null;
    /**
     * 布局重算的“只发新增”（Spec 输出 140）：和上一次重算比。发布空布局（承载盒隐藏、没有网格）不经它、不清空；
     * `contextKey` 变了先清空（换了工作面算重新开始）；`grid` 换实例不清空（宿主每次投影都可能换实例）。
     */
    const gate = createIssueGate();
    let gatedContext: string | null = null;

    const node = computed<GridNode<T> | null>(() => {
        // 读 revision：同一 Grid 实例原地改树时引用不变，只有版本能触发重算。
        revision.value;
        return options.grid.value?.root() ?? null;
    });

    /** 算布局并发布，交回这次要通知宿主的诊断；通知由调用方做（提交路径要接住宿主回调的异常，别处不接）。 */
    function publish(): readonly GridIssue<GridIssueCode | "notify-failed">[] {
        const grid = options.grid.value;
        const extent = options.extent.value;
        if (grid === null || extent === null
            || !Number.isFinite(extent.width) || !Number.isFinite(extent.height)
            || extent.width <= 0 || extent.height <= 0) {
            layout.value = EMPTY_GRID_LAYOUT;
            publishedExtent = null;
            revision.value += 1;
            return [];
        }
        const frozen = {width: extent.width, height: extent.height};
        const next = grid.layout(frozen);
        layout.value = next;
        publishedExtent = frozen;
        revision.value += 1;
        const context = options.contextKey();
        if (gatedContext !== null && gatedContext !== context) {
            gate.replace([]);
        }
        gatedContext = context;
        // 键集在交给宿主之前更新：宿主的回调抛出时，这一批不再重发。
        return gate.replace(next.issues);
    }

    function notify(batch: readonly GridIssue<GridIssueCode | "notify-failed">[]): void {
        if (batch.length > 0) {
            options.onIssues?.(batch);
        }
    }

    function recompute(): void {
        notify(publish());
    }

    /**
     * 提交已经落账之后的通知：宿主的回调抛出时不能冒到 `useSashGesture`，那边会把它当成提交处理器抛出、报成没落账。
     * 接住后交 `reportError`（浏览器标准，全局错误处理看得到），没有时 `console.error`。
     */
    function notifyAfterCommit(batch: readonly GridIssue<GridIssueCode | "notify-failed">[]): void {
        try {
            notify(batch);
        } catch (error) {
            if (typeof globalThis.reportError === "function") {
                globalThis.reportError(error);
            } else {
                console.error(error);
            }
        }
    }

    function onGestureCommit(commit: GridGestureCommit): GridLayoutCommitResult {
        const grid = options.grid.value;
        if (grid === null) {
            return commitFailure("not-ready", "The grid is not ready; the resize was not applied", {missing: "grid"});
        }
        const context = options.contextKey();
        const frozen = publishedExtent;
        if (frozen === null) {
            return commitFailure("not-ready", "The host size is unavailable; the resize was not applied", {missing: "host-size"});
        }
        if (commit.contextKey !== context) {
            return commitFailure("stale-context", `The context changed (${commit.contextKey || "empty"} -> ${context || "empty"}); the resize was not applied`, {
                expected: context,
                actual: commit.contextKey,
            });
        }
        if (commit.revision !== revision.value) {
            return commitFailure("stale-revision", `The layout changed (revision ${commit.revision} -> ${revision.value}); the resize was not applied`, {
                expected: revision.value,
                actual: commit.revision,
            });
        }
        if (frozen.width !== commit.extent.width || frozen.height !== commit.extent.height) {
            return commitFailure("stale-size", "The container size changed; the resize was not applied");
        }
        const result = grid.resizeBranches(commit.changes);
        if (!result.ok) {
            return result;
        }
        notifyAfterCommit(publish());
        if (options.onApplied !== undefined) {
            try {
                options.onApplied(commit, result);
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                notifyAfterCommit([gridIssue("notify-failed", `The resize was applied, but the host's onApplied threw: ${reason}`)]);
            }
        }
        return {ok: true};
    }

    watch([() => options.grid.value, () => options.extent.value, () => options.contextKey()], recompute, {immediate: true});

    return {node, layout, revision, invalidate: recompute, onGestureCommit};
}

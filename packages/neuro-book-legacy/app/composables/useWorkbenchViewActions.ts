/**
 * View 标题动作的宿主侧会话：唯一持有「哪个实例（代际）现在有什么句柄与状态」的地方。
 *
 * 分工：
 * - View 组件只通过明面事件上报（`actions-change` / `action-handle-ready`），不读命令注册表、不执行
 *   `commandId`——它不知道自己的动作叫什么命令，也不该知道；
 * - `WorkbenchViewInstances.vue` 给每个**真实实例**分配代际并转发成 `view-actions` /
 *   `view-handle-ready`（跨容器搬 DOM 不变代际，真释放才作废）；
 * - 本会话把句柄 / 状态与代际绑在一起，产出 `actionsByView`（已求值的展示项）；
 * - 点击经 canonical 命令（`executeCommand`：参数校验、`when`、只读与审计都在那一层），命令的 `run`
 *   闭包再经 `runAction` 命中**精确实例**的句柄。
 *
 * 代际只有一条规则：**每个 viewId 记住见过的最高代际**。低于它的回调一律丢弃（旧实例卸载后发的
 * `null` 不能抹掉新实例的句柄），它之上的回调接管这个 viewId（新实例覆盖旧实例）。释放只撤自己
 * 那一代际的句柄与状态，代际本身保留——否则迟到的旧回调又会被当成新的。
 */
import {computed, onScopeDispose, shallowRef, watch, type ComputedRef} from "vue";
import type {CommandFailureCode, CommandRegistry, CommandResult} from "nbook/app/utils/workbench/commands";
import {evaluateContextWhen, type ContextValues} from "nbook/app/utils/workbench/context-keys";
import type {WorkbenchViewEntry} from "nbook/app/utils/workbench/product-catalog";
import {
    resolveViewTitleActions,
    type ViewActionTarget,
    type ViewTitleActionContribution,
    type ViewTitleActionState,
    type WorkbenchTitleActionsByView,
    type WorkbenchViewActionHandle,
    type WorkbenchViewTitleActions,
} from "nbook/app/utils/workbench/view-title-actions";

export type WorkbenchViewActionsOptions = Readonly<{
    /** 命令注册表：求值（元数据 + `when`）与点击执行都走它。 */
    registry: CommandRegistry;
    /** 当前求值后的**全量**视图条目（`resolveViewPresentation(...).entries`）。 */
    entries: () => readonly WorkbenchViewEntry[];
    /** 命令 `titleKey` → 展示文案（i18n 归宿主）。 */
    titleOf: (metadata: {readonly titleKey: string}) => string;
    /** 环境事实：贡献自身的 `when` 用它求值；缺省当空上下文（谓词不满足即隐藏）。 */
    context?: () => ContextValues;
    /** 失败出口：宿主在这里展示**一次**（View 与工具栏不各报一遍）。 */
    onFailure?: (diagnosis: string) => void;
}>;

export type WorkbenchViewActionsConsumer = Readonly<{
    /** 已求值的展示项，按 viewId 索引（没有可见 View 时是空映射）。 */
    actionsByView: ComputedRef<WorkbenchTitleActionsByView>;
    /** 求值期诊断（未知命令、未登记的状态 id）：宿主一次展示。 */
    issues: ComputedRef<readonly string[]>;
    bindHandle(target: ViewActionTarget, handle: WorkbenchViewActionHandle | null): void;
    setStates(target: ViewActionTarget, states: readonly ViewTitleActionState[]): void;
    release(target: ViewActionTarget): void;
    /** 点击入口：经 canonical 命令执行（携带 `{viewId, generation}`），失败在这里报一次。 */
    run(target: ViewActionTarget, actionId: string): Promise<CommandResult<unknown>>;
    /** `registerViewTitleCommands` 的执行端口：命中该代际的句柄，自己不再报一次失败。 */
    runAction(target: ViewActionTarget, actionId: string): Promise<CommandResult<unknown>>;
}>;

/** 闸门结果：通过就给出 canonical 命令 id，不通过就给出结构化失败（码与原因分开，便于原样转交）。 */
type Audit =
    | Readonly<{ok: true; commandId: string}>
    | Readonly<{ok: false; code: CommandFailureCode; reason: string}>;

export function useWorkbenchViewActions(options: WorkbenchViewActionsOptions): WorkbenchViewActionsConsumer {
    /** 每个 viewId 见过的最高代际：迟到的回调靠它识别。 */
    const generations = shallowRef<Readonly<Record<string, number>>>({});
    const handles = shallowRef<Readonly<Record<string, WorkbenchViewActionHandle>>>({});
    const states = shallowRef<Readonly<Record<string, readonly ViewTitleActionState[]>>>({});

    const visibleEntries = computed(() => options.entries().filter((entry) => entry.visible));
    const visibleById = computed(() => new Map(visibleEntries.value.map((entry) => [entry.view.id, entry] as const)));

    /**
     * 实例真释放（视图不再可见）后清掉它的句柄与状态。
     *
     * 用**可见集合的指纹**做触发条件：呈现求值每次都会重建 `entries` 数组，
     * 直接 watch 数组会天天触发，而这里只关心「谁还在」。
     */
    const visibleKey = computed(() => visibleEntries.value.map((entry) => entry.view.id).sort().join("|"));
    watch(visibleKey, () => {
        const live = new Set(visibleEntries.value.map((entry) => entry.view.id));
        handles.value = Object.fromEntries(Object.entries(handles.value).filter(([viewId]) => live.has(viewId)));
        states.value = Object.fromEntries(Object.entries(states.value).filter(([viewId]) => live.has(viewId)));
    });

    /** 迟到的回调不能覆盖更新的代际：旧实例卸载时发的 `null` 不许抹掉新实例的句柄。 */
    function accept(target: ViewActionTarget): boolean {
        const current = generations.value[target.viewId];
        return current === undefined || target.generation >= current;
    }

    /** 接管这个 viewId：把见过的最高代际推进到本次回调的代际。 */
    function claim(target: ViewActionTarget): void {
        if (generations.value[target.viewId] !== target.generation) {
            generations.value = {...generations.value, [target.viewId]: target.generation};
        }
    }

    function bindHandle(target: ViewActionTarget, handle: WorkbenchViewActionHandle | null): void {
        if (!accept(target)) {
            return;
        }
        claim(target);
        const next = {...handles.value};
        if (handle === null) {
            delete next[target.viewId];
        } else {
            next[target.viewId] = handle;
        }
        handles.value = next;
    }

    function setStates(target: ViewActionTarget, next: readonly ViewTitleActionState[]): void {
        if (!accept(target)) {
            return;
        }
        claim(target);
        states.value = {...states.value, [target.viewId]: next};
    }

    function release(target: ViewActionTarget): void {
        // 只撤销自己那一次实例：代际保留，迟到的旧回调仍会被丢弃。
        if (generations.value[target.viewId] !== target.generation) {
            return;
        }
        if (handles.value[target.viewId] !== undefined) {
            const next = {...handles.value};
            delete next[target.viewId];
            handles.value = next;
        }
        if (states.value[target.viewId] !== undefined) {
            const next = {...states.value};
            delete next[target.viewId];
            states.value = next;
        }
    }

    /**
     * 贡献清单：从**求值条目**里读（`WorkbenchViewEntry.view` 就是 descriptor）。
     *
     * 求值结果已经是页面的唯一口径（位置 / 可见性 / authority 都在里面），这里不再去问第二个注册表；
     * 不可见的视图同样能查到它的贡献，好让「视图不可见」与「动作没登记」给出不同的诊断。
     */
    function contributionsOf(viewId: string): readonly ViewTitleActionContribution[] {
        return options.entries().find((entry) => entry.view.id === viewId)?.view.titleActions ?? [];
    }

    /**
     * 点击与执行的共用闸门：View 仍可见、动作仍登记、代际仍是当前实例、句柄就绪、状态允许、
     * authority 与贡献 `when` 都满足——任一条不成立就返回**结构化**失败，绝不落到句柄上。
     */
    function audit(target: ViewActionTarget, actionId: string): Audit {
        const entry = visibleById.value.get(target.viewId);
        if (entry === undefined) {
            return {ok: false, code: "stale-target", reason: `视图当前不可见或已释放：${target.viewId}`};
        }
        const contribution = contributionsOf(target.viewId).find((candidate) => candidate.id === actionId);
        if (contribution === undefined) {
            return {ok: false, code: "unavailable", reason: `视图没有登记这个标题动作：${target.viewId}/${actionId}`};
        }
        if (generations.value[target.viewId] !== target.generation) {
            return {ok: false, code: "stale-target", reason: `视图实例已切换：${target.viewId}`};
        }
        if (handles.value[target.viewId] === undefined) {
            return {ok: false, code: "unavailable", reason: "视图操作尚未就绪"};
        }
        const state = states.value[target.viewId]?.find((candidate) => candidate.id === actionId);
        if (state === undefined) {
            return {ok: false, code: "unavailable", reason: "视图操作尚未就绪"};
        }
        if (state.busy === true) {
            return {ok: false, code: "unavailable", reason: "视图操作正在执行"};
        }
        if (state.enabled !== true) {
            return {ok: false, code: "unavailable", reason: state.reason?.trim() ? state.reason : "视图操作当前不可用"};
        }
        if (!entry.actionable) {
            return {ok: false, code: "unavailable", reason: entry.authorityReasons.join("；") || "缺少执行该动作的 authority"};
        }
        const evaluation = options.registry.isCommandEnabled(contribution.commandId);
        if (!evaluation.ok) {
            return {ok: false, code: "unavailable", reason: evaluation.reason};
        }
        const when = evaluateContextWhen(contribution.when, options.context?.() ?? {});
        if (!when.ok) {
            return {ok: false, code: "unavailable", reason: when.reason};
        }
        if (!when.value.matches) {
            return {ok: false, code: "unavailable", reason: when.value.reasons.join("；")};
        }
        return {ok: true, commandId: contribution.commandId};
    }

    /** 目标还活着（同一个 viewId 的同一个代际、且仍可见）：失败展示前再确认一次。 */
    function isLive(target: ViewActionTarget): boolean {
        return visibleById.value.get(target.viewId) !== undefined
            && generations.value[target.viewId] === target.generation
            && handles.value[target.viewId] !== undefined;
    }

    const resolution = computed(() => {
        const byView: Record<string, WorkbenchViewTitleActions> = {};
        const problems: string[] = [];
        for (const entry of visibleEntries.value) {
            const viewId = entry.view.id;
            const evaluation = resolveViewTitleActions({
                viewId,
                contributions: contributionsOf(viewId),
                visible: entry.visible,
                actionable: entry.actionable,
                authorityReasons: entry.authorityReasons,
                context: options.context?.() ?? {},
                commandOf: (commandId) => {
                    const metadata = options.registry.getCommand(commandId);
                    return metadata.ok ? metadata.value : null;
                },
                commandUnavailableReason: (commandId) => {
                    const enabled = options.registry.isCommandEnabled(commandId);
                    return enabled.ok ? null : enabled.reason;
                },
                states: states.value[viewId] ?? [],
                hasHandle: handles.value[viewId] !== undefined,
                titleOf: options.titleOf,
            });
            problems.push(...evaluation.problems);
            byView[viewId] = {
                target: {viewId, generation: generations.value[viewId] ?? 0},
                primary: evaluation.primary,
                secondary: evaluation.secondary,
            };
        }
        return {byView: byView as WorkbenchTitleActionsByView, problems};
    });

    async function runAction(target: ViewActionTarget, actionId: string): Promise<CommandResult<unknown>> {
        const verdict = audit(target, actionId);
        if (!verdict.ok) {
            return {ok: false, code: verdict.code, reason: verdict.reason};
        }
        const handle = handles.value[target.viewId]!;
        try {
            return await handle.runAction(actionId);
        } catch (error) {
            return {ok: false, code: "execution-error", reason: error instanceof Error ? error.message : String(error)};
        }
    }

    onScopeDispose(() => {
        handles.value = {};
        states.value = {};
    });

    return {
        actionsByView: computed(() => resolution.value.byView),
        issues: computed(() => resolution.value.problems),
        bindHandle,
        setStates,
        release,
        async run(target, actionId) {
            const verdict = audit(target, actionId);
            if (!verdict.ok) {
                // 目标已经不在（切走 / 释放）时连提示都不发：那不是用户还能看到的那个实例的事。
                if (isLive(target)) {
                    options.onFailure?.(verdict.reason);
                }
                return {ok: false, code: verdict.code, reason: verdict.reason};
            }
            const result = await options.registry.executeCommand(verdict.commandId, {
                viewId: target.viewId,
                generation: target.generation,
            });
            if (!result.ok && isLive(target)) {
                // 切走之后回来的失败不算到新实例头上；还活着才算它自己的失败。
                options.onFailure?.(result.reason);
            }
            return result;
        },
        runAction,
    };
}

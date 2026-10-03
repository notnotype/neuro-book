/**
 * 工具视图与容器位置的记录会话：`workbench.views/customizations` 的**唯一写者**。
 *
 * 一条 user/local 单例记录同时承载容器落位、视图归属、活动容器、View 尺寸、显隐与面板状态，
 * 必须一起移动。任何一次移动/选择/尺寸手势都**一次合成**其中的相关字段，不写成两次独立保存，
 * 也不为缺省的默认值补字段。
 *
 * 与 `useUserRecordSession.display` 的关系是本模块最需要说清的一点：
 * - `display` 会跟随**外来订阅**的确认更新，而本窗口的呈现不能被别的窗口强制替换；
 * - 所以会话自己持有 `record`（本窗口呈现），只在**首读完成、自己的动作、放弃/恢复**时替换它；
 * - 外来订阅只推进 `confirmed`（合成底本）：下一次本地动作把补丁合成到最新底本上，不覆盖别人刚写的东西。
 *
 * 提交是**串行**的，且本地意图按序**累计**：失败或迟到的回执只清除它自己那一段（用序号切分），
 * 随后到达的意图不会因为一次失败而消失。补丁里不存算好的 order——目标位置序号在合成时的最新底本上算；
 * 来源与锚点则**保留到合成**，因此 CAS 冲突重读重放时会重新校验一次（已达到目标算幂等成功，
 * 第三方已经挪走则冲突跳过，不盲覆本地较早的位置）。
 *
 * 首读完成前不接受提交（**不排队重放**：那种意图基于产品默认值，重放会覆盖已确认记录），
 * 也不自动创建默认位置记录；失败时只在本窗口暂态呈现并留下诊断（`notice`）。
 *
 * 回执与重放（「保存回执与CAS」）：
 * - 冲突就是**这次实际合成**跳过的那几条（`ViewPlacementsComposition.conflicts`），不再拿新底本二次求值；
 * - 每次实际合成按补丁数组身份留下内存回执：写过的叶字段（丢应答后核对"是不是已经达成"）与冲突；
 * - 确认过的冲突是**终态**：不自动重放旧来源，诊断留在 `notice` 里直到 `dismissNotice()` 或下一个动作；
 * - 未确认的传输失败仍保留 pending 与 retry/abandon，`retry()` 返回真实回执（不再靠"没有可放弃的意图"猜）；
 * - 每批记下**首次接受时**的工作面：排队执行、CAS 重放、显式重试前复核，已切走的批次终态拒绝。
 */

import {computed, onScopeDispose, readonly, ref, shallowRef, watch, type ComputedRef, type Ref} from "vue";
import {
    VIEW_AUTHORITIES,
    type WorkbenchContext,
    type WorkbenchRegistry,
} from "nbook/app/utils/workbench/descriptors";
import type {LayoutRecordCommitResult, LayoutRecordIntent} from "nbook/app/utils/workbench/layout-session";
import {
    isShellPanelAlignment,
    isShellPanelPosition,
    resolvePanelPreferences,
    type ShellPanelAlignment,
    type ShellPanelPosition,
    type WorkbenchPanelPreferences,
} from "nbook/app/utils/workbench/panel-state";
import {productWorkbenchRegistry, resolveViewPresentation} from "nbook/app/utils/workbench/product-catalog";
import type {WorkbenchStorageAdapters} from "nbook/app/utils/workbench/storage-context";
import {
    useUserRecordSession,
    type UserRecordSessionNotice,
} from "nbook/app/utils/workbench/user-record-session";
import {
    composeViewPlacements,
    isContainerSuppressed,
    isToolPartId,
    placementCatalogOf,
    placementCatalogWithContainers,
    readEffectiveContainerPlacements,
    readViewPlacements,
    resolveContainerMerge,
    resolveContainerMove,
    resolveViewMove,
    suppressedContainerIds,
    toolPartOfLocation,
    viewPlacementPostconditions,
    viewPlacementPostconditionsHold,
    type ContainerMergeRequest,
    type ContainerMoveRequest,
    type PlacementCatalog,
    type ToolPartId,
    type ToolPartLocation,
    type ViewDetachRequest,
    type ViewMoveRequest,
    type ViewPlacementPostcondition,
    type ViewPlacementsPatch,
    type ViewSizePatch,
} from "nbook/app/utils/workbench/view-placements";
import {
    defineWorkbenchViewCustomizationsState,
    WORKBENCH_VIEW_CUSTOMIZATIONS_DEFAULT,
    isWorkbenchViewSize,
    type WorkbenchViewCustomizationsRecord,
} from "nbook/shared/storage/workbench-views";

/** 一次命令的回执：落盘结果 + 给用户的诊断（`saved` / `unchanged` 时诊断通常为空）。 */
export type ViewPlacementsOutcome = {
    readonly status: "saved" | "unchanged" | "pending" | "rejected";
    readonly diagnosis: string;
};

export type WorkbenchViewPlacementsOptions = {
    /** 环境事实（`when` 求值）：命令边界用它拒绝基于过期界面的移动与尺寸。 */
    readonly context: () => WorkbenchContext;
    /** 测试注入的产品注册表；缺省用产品注册表。 */
    readonly registry?: WorkbenchRegistry;
    /** 测试注入的 Storage 适配器。 */
    readonly adapters?: WorkbenchStorageAdapters;
};

/** 一场 View 尺寸手势：来源容器 + 发起时它的生效落位 + 发起时的上下文代际 + 本场全部 View 的尺寸。 */
export type ViewSizesInput = {
    readonly containerId: string;
    /** 发起手势时容器的生效落位：容器换 Part（= 换轴）后到达的批整批拒绝。 */
    readonly sourceLocation: ToolPartLocation;
    readonly contextKey: string;
    readonly patches: readonly ViewSizePatch[];
};

/**
 * Part 的显隐偏好。
 *
 * `hidden` 是**显式**隐藏（零占用、无边界），只有 left/right 接受它——Panel 的隐藏归
 * `setPanelState`，两条通道各写各的字段，不互相代理。`dragCollapsed` 是拖到零收起（保留 1px 边界），
 * 三个 Part 都接受。
 */
export type PartVisibilityInput = {
    readonly partId: ToolPartId;
    readonly hidden?: boolean;
    readonly dragCollapsed?: boolean;
};

export type WorkbenchViewPlacementsConsumer = {
    /**
     * 本窗口呈现所依据的记录（首读、自己的动作、放弃/恢复才替换）。
     *
     * 页面的统一呈现求值直接消费它：`resolveViewPresentation({overrides: record.placements, ...})`。
     */
    readonly record: Readonly<Ref<WorkbenchViewCustomizationsRecord>>;
    /**
     * 面板的位置 / 对齐 / 显隐 / 收起（呈现值；缺字段即产品默认 bottom/center/false/false）。
     *
     * 只回答"用户存了什么"，不含瞬时最大化和几何降级——那些由宿主与纯布局组件决定。
     */
    readonly panelState: ComputedRef<WorkbenchPanelPreferences>;
    /** 首读门禁：读取就绪前移动/尺寸/面板控件应当不可用。 */
    readonly loading: Readonly<Ref<boolean>>;
    /** 未保存 / 不可写 / 记录损坏的诊断；`null` 表示当前没有要展示的问题。 */
    readonly notice: Readonly<Ref<UserRecordSessionNotice | null>>;
    /**
     * 当前环境上下文的代际。`setViewSizes` 要求调用方传入**发起手势时**读到的值，
     * 会话据此拒绝跨越了工作面/可见性变化的尺寸批。
     */
    contextKey(): string;
    /** 移动一个视图（可选插在目标容器的某个成员之前）。 */
    moveView(request: ViewMoveRequest): Promise<ViewPlacementsOutcome>;
    /** 把单个 View 放到 Switcher 插入位：创建容器与成员转移同次保存。 */
    detachView(request: ViewDetachRequest): Promise<ViewPlacementsOutcome>;
    /** 整体移动一个容器（视图归属、顺序与高度都不变）。 */
    moveContainer(request: ContainerMoveRequest): Promise<ViewPlacementsOutcome>;
    /**
     * 把源容器的**全部**已登记生效成员并进目标容器，随后源容器消失。
     *
     * 一次意图、一次保存：整组要么全进，要么一条都不动。
     */
    mergeContainer(request: ContainerMergeRequest): Promise<ViewPlacementsOutcome>;
    /** 选择一个 Part 的活动容器，并显式打开该 Part（清显式隐藏与拖收起）。 */
    selectContainer(partId: ToolPartId, containerId: string): Promise<ViewPlacementsOutcome>;
    /** 一场手势里的 View 尺寸：整批接纳或**整批拒绝**，不保存一半。 */
    setViewSizes(input: ViewSizesInput): Promise<ViewPlacementsOutcome>;
    /** 某个 Part 的显式隐藏 / 拖收起。 */
    setPartVisibility(input: PartVisibilityInput): Promise<ViewPlacementsOutcome>;
    /** 一次写入本次真正改变的 panel 字段；切到侧向位置时同次清掉收起。 */
    setPanelState(patch: PanelStatePatch): Promise<ViewPlacementsOutcome>;
    /** 恢复某个视图的默认位置（删除它的位置覆盖）。 */
    restoreViewPlacement(viewId: string): Promise<ViewPlacementsOutcome>;
    /** 恢复某个容器的默认落位（删除它的落位覆盖并清抑制，容器以默认落位重新出现）。 */
    restoreContainerPlacement(containerId: string): Promise<ViewPlacementsOutcome>;
    /**
     * 重新打开一个被合并掉的容器：**只清抑制**并选中打开它的原落位，不把已并走的 View 拉回来。
     *
     * 与 `restoreContainerPlacement` 是两件事：后者是"恢复默认落位"，会连落位覆盖一起删掉。
     */
    reopenContainer(containerId: string): Promise<ViewPlacementsOutcome>;
    /** 揭示一个视图：选中它的容器、打开目标 Part、清掉 View 与 Panel 的内容收起。 */
    revealView(viewId: string): Promise<ViewPlacementsOutcome>;
    /**
     * 重试未确认的批次，回执与 `submit` 用同一份解析（不再靠"没有可放弃的意图"猜成功）。
     *
     * 重放同样先复核工作面：已经失效的批次**终态拒绝**并保留诊断，不沿新工作面重放。
     */
    retry(): Promise<ViewPlacementsOutcome>;
    /**
     * 只清掉产品这边的**终态**诊断（确认冲突），底层的未确认 / 不可写诊断不受影响。
     */
    dismissNotice(): void;
    abandon(): void;
    release(): Promise<void>;
};

/**
 * 面板状态补丁：只带本次改变的字段，缺省字段保持当前值。
 *
 * 运行时可能来自命令参数，因此每个字段都按取值域校验；非法值拒绝整次调用，不写进记录。
 */
export type PanelStatePatch = {
    readonly position?: ShellPanelPosition;
    readonly alignment?: ShellPanelAlignment;
    readonly hidden?: boolean;
    readonly collapsed?: boolean;
};

/** 面板补丁形状校验：返回诊断，`null` 表示通过。 */
function panelStateProblem(patch: PanelStatePatch): string | null {
    if (patch.position !== undefined && !isShellPanelPosition(patch.position)) {
        return `面板位置不是合法枚举值：${String(patch.position)}`;
    }
    if (patch.alignment !== undefined && !isShellPanelAlignment(patch.alignment)) {
        return `面板对齐不是合法枚举值：${String(patch.alignment)}`;
    }
    if (patch.hidden !== undefined && typeof patch.hidden !== "boolean") {
        return `面板隐藏标记不是布尔值：${String(patch.hidden)}`;
    }
    if (patch.collapsed !== undefined && typeof patch.collapsed !== "boolean") {
        return `面板收起标记不是布尔值：${String(patch.collapsed)}`;
    }
    return null;
}

/**
 * 环境上下文的代际串：凡影响"哪个视图可见 / 在哪个工作面"的事实都进它。
 *
 * 它只用来比较相等，没有别的语义；放进 `setViewSizes` 的边界检查，是为了不把一场在旧上下文里
 * 发起的手势写成新上下文的尺寸意图（尺寸本身是跨 Project 共用的，因此这里防的是"来源变了"，
 * 不是"记录归属变了"）。
 */
function contextSignature(context: WorkbenchContext): string {
    const authorities = context.authorities;
    const flags = VIEW_AUTHORITIES.map((authority) => authorities[authority] ? authority : `-${authority}`);
    return [
        context.projectRoot ?? "-",
        context.project ? "project" : "workspace",
        context["user-assets"] ? "user-assets" : "-",
        context.desktop ? "desktop" : "-",
        context.selection ? "selection" : "-",
        ...flags,
    ].join("|");
}

/** 累积的本地意图：`seq` 用来在回执到达时只清除已经提交的那一段。 */
type PendingPatch = {
    readonly seq: number;
    readonly patch: ViewPlacementsPatch;
};

/** 一条补丁指向的对象（只进诊断文案）：用户要能对上自己刚做的那件事。 */
function patchLabel(patch: ViewPlacementsPatch): string {
    switch (patch.kind) {
        case "move-view":
            return `视图 ${patch.viewId} 的移动`;
        case "detach-view":
            return `视图 ${patch.viewId} 的独立容器`;
        case "move-container":
            return `容器 ${patch.containerId} 的移动`;
        case "merge-container":
            return `容器 ${patch.sourceContainerId} 的整组并入`;
        case "select-container":
            return `容器 ${patch.containerId} 的选择`;
        case "restore-view-placement":
            return `视图 ${patch.viewId} 的恢复`;
        case "restore-container-placement":
            return `容器 ${patch.containerId} 的恢复`;
        case "reopen-container":
            return `容器 ${patch.containerId} 的重新打开`;
        case "set-view-sizes":
            return `容器 ${patch.containerId} 的 View 尺寸`;
        case "set-part-visibility":
            return `Part ${patch.partId} 的显隐`;
        case "reveal-view":
            return `视图 ${patch.viewId} 的揭示`;
        case "set-panel-state":
            return "面板状态";
    }
}

/**
 * 一批补丁**实际重放**的内存回执。
 *
 * `writes` 是这次合成真正改写/删除的叶字段（丢应答后核对"是不是已经达成"），`conflicts` 是这次重放
 * 真正跳过的那几条——冲突不再由"拿新底本再演一遍历史"二次求值推断。
 */
type CompositionReceipt = Readonly<{
    readonly writes: readonly ViewPlacementPostcondition[];
    readonly conflicts: readonly string[];
    readonly diagnosis: string;
    readonly changed: boolean;
    /** 这次合成是"重读后发现已经达成"的收口口径，不是本窗口真的写了盘。 */
    readonly achieved: boolean;
}>;

/**
 * 工具位置的 user/local 记录会话。
 *
 * 这是该记录的唯一写者：页面与宿主都不再直接读写这条记录，也不各自解释位置覆盖。
 */
export function useWorkbenchViewPlacements(options: WorkbenchViewPlacementsOptions): WorkbenchViewPlacementsConsumer {
    const registryResult = options.registry === undefined
        ? productWorkbenchRegistry()
        : {ok: true as const, value: options.registry};
    const registry = registryResult.ok ? registryResult.value : null;
    const registryProblem = registryResult.ok ? "" : `产品 Workbench 声明不可用：${registryResult.reason}`;
    const catalog: PlacementCatalog | null = registry === null ? null : placementCatalogOf(registry);

    /** 每次**实际**合成的回执，按补丁数组身份记（UI 的 `refreshRecord` 走的是另一条路径，不更新它）。 */
    const receipts = new WeakMap<readonly ViewPlacementsPatch[], CompositionReceipt>();
    /** 每条补丁被接受时的工作面：排队执行 / CAS 重放 / 显式重试前复核它。 */
    const acceptedSurfaces = new WeakMap<ViewPlacementsPatch, string>();
    let composedGeneration = 0;
    let lastComposed: {readonly patches: readonly ViewPlacementsPatch[]; readonly receipt: CompositionReceipt} | null = null;
    /** 产品这边的**终态**诊断（确认冲突）：保留到用户明确 dismiss 或下次明确操作。 */
    const lastConflict = ref<string | null>(null);

    /**
     * 一条补丁被接受时的工作面：`set-view-sizes` 自己带着它（意图可重放），其余按入队时记住的值。
     */
    function acceptedSurfaceOf(patch: ViewPlacementsPatch): string | undefined {
        return patch.kind === "set-view-sizes" ? patch.contextKey : acceptedSurfaces.get(patch);
    }

    /**
     * 传入记录会话的合成回调：**所有**实际重放（首次提交、CAS 重读重放、显式重试、丢应答核对）都经过它。
     *
     * - 同一个补丁数组再次被合成 = 重读路径：写集全部成立就是"已经达成"，直接返回无变更，
     *   并保留那次合成原有的 conflicts（不从已并入后的源成员反推新冲突）；
     * - 工作面已经切走的补丁在这里被跳过：整批不沿新工作面重放，诊断留在回执里；
     * - 回执按数组身份记录，`record.value` 的呈现求值不会碰它。
     */
    function composeBatch(
        base: WorkbenchViewCustomizationsRecord | null,
        patches: readonly ViewPlacementsPatch[],
    ): LayoutRecordIntent<WorkbenchViewCustomizationsRecord> {
        composedGeneration += 1;
        const recorded = receipts.get(patches);
        if (recorded !== undefined && recorded.changed && viewPlacementPostconditionsHold(recorded.writes, base)) {
            lastComposed = {patches, receipt: {...recorded, achieved: true}};
            // 写集全部成立：本批已经在新底本上达成，不重放、不重算冲突。
            return {value: base ?? WORKBENCH_VIEW_CUSTOMIZATIONS_DEFAULT, changed: false, diagnosis: recorded.diagnosis};
        }
        const surface = contextSignature(options.context());
        const stale: string[] = [];
        const live: ViewPlacementsPatch[] = [];
        for (const patch of patches) {
            const accepted = acceptedSurfaceOf(patch);
            if (accepted !== undefined && accepted !== surface) {
                stale.push(`${patchLabel(patch)}基于已经切走的工作面，没有落账，也不沿新工作面重放`);
                continue;
            }
            live.push(patch);
        }
        const composition = composeViewPlacements(catalog ?? EMPTY_CATALOG, base, live);
        const conflicts = stale.length === 0 ? composition.conflicts : [...stale, ...composition.conflicts];
        const intent: WorkbenchViewCustomizationsRecord = composition.value;
        const receipt: CompositionReceipt = {
            writes: viewPlacementPostconditions(base, intent),
            conflicts,
            diagnosis: conflicts.length === 0 ? composition.diagnosis : conflicts.join("；"),
            changed: composition.changed,
            achieved: false,
        };
        receipts.set(patches, receipt);
        lastComposed = {patches, receipt};
        return {
            value: intent,
            changed: receipt.changed,
            diagnosis: receipt.diagnosis,
        };
    }

    const session = useUserRecordSession<WorkbenchViewCustomizationsRecord, readonly ViewPlacementsPatch[]>({
        definition: defineWorkbenchViewCustomizationsState,
        compose: composeBatch,
        ...(options.adapters === undefined ? {} : {adapters: options.adapters}),
    });

    const record = shallowRef<WorkbenchViewCustomizationsRecord>(WORKBENCH_VIEW_CUSTOMIZATIONS_DEFAULT);
    const effectiveCatalog = computed(() => placementCatalogWithContainers(catalog ?? EMPTY_CATALOG, record.value.customContainers));
    let pendingPatches: PendingPatch[] = [];
    let patchSeq = 0;
    let commitTail: Promise<unknown> = Promise.resolve();

    /** 呈现 = 最新已确认底本 + 本窗口全部未确认补丁（外来订阅不主动重算）。 */
    function refreshRecord(): void {
        record.value = pendingPatches.length === 0 || catalog === null
            ? session.confirmed.value
            : composeViewPlacements(catalog, session.confirmed.value, pendingPatches.map((entry) => entry.patch)).value;
    }

    // 首读（以及失败后的重读恢复）是唯一"跟随记录"的时机；期间没有本地意图时它就是已确认值。
    watch(session.loading, (loading) => {
        if (!loading) {
            refreshRecord();
        }
    }, {immediate: true});

    /** 产品通知 = 底层通知 + 本次确认的终态冲突（冲突不随时间消失，等用户 dismiss 或下一个动作）。 */
    const notice = computed<UserRecordSessionNotice | null>(() => {
        const conflict = lastConflict.value;
        if (conflict === null) {
            return session.notice.value;
        }
        const base = session.notice.value;
        return {
            diagnosis: base === null ? conflict : `${base.diagnosis}；${conflict}`,
            retryable: base?.retryable ?? false,
            abandonable: base?.abandonable ?? false,
        };
    });

    function gatedOutcome(): ViewPlacementsOutcome | null {
        if (session.loading.value) {
            return {status: "rejected", diagnosis: "工具位置记录还没完成首次读取，本次调整没有保存"};
        }
        if (catalog === null || registry === null) {
            return {status: "rejected", diagnosis: registryProblem};
        }
        return null;
    }

    /** 当前上下文里可见的视图 id：与呈现同一套求值口径（不是权限）。 */
    function visibleViewIds(): readonly string[] {
        if (registry === null) {
            return [];
        }
        const presentation = resolveViewPresentation({
            registry,
            context: options.context(),
            overrides: record.value.placements,
            customContainers: record.value.customContainers,
        });
        return presentation.entries.filter((entry) => entry.visible).map((entry) => entry.view.id);
    }

    /** 生效的容器落位（含本窗口未确认意图与抑制）：命令边界与容器成员集合都用它。 */
    function containerPlacementReading() {
        return readEffectiveContainerPlacements(effectiveCatalog.value, record.value);
    }

    /**
     * 底层回执 → 产品回执：以**这次实际合成**的冲突为准。
     *
     * - `saved` / `unchanged`：只看回执里的冲突——有冲突就是终态拒绝（宁可按拒绝报，也不把被跳过的
     *   意图冒充成功）；重读核对发现"已经达成"的那次 saved 是本窗口没写盘的收口，报 unchanged；
     * - `unsaved`：未确认的传输失败仍保留 pending 与 retry/abandon，冲突由 `notice` 一起呈现；
     * - `rejected`：以底层诊断为准，冲突也一并带上。
     */
    function outcomeOf(result: LayoutRecordCommitResult, receipt: CompositionReceipt | null): ViewPlacementsOutcome {
        const conflicts = receipt === null ? [] : receipt.conflicts;
        switch (result.status) {
            case "saved":
                if (conflicts.length > 0) {
                    return {status: "rejected", diagnosis: conflicts.join("；")};
                }
                return receipt?.achieved === true
                    ? {status: "unchanged", diagnosis: receipt.diagnosis}
                    : {status: "saved", diagnosis: ""};
            case "unchanged":
                return conflicts.length > 0
                    ? {status: "rejected", diagnosis: conflicts.join("；")}
                    : {status: "unchanged", diagnosis: result.diagnosis};
            case "unsaved":
                return {status: "pending", diagnosis: result.diagnosis};
            case "rejected":
                return {status: "rejected", diagnosis: result.diagnosis};
        }
    }

    /** 收口一条回执：确认过的冲突变成保留到 dismiss 的终态诊断，返回值就是给调用方的回执。 */
    function settle(result: LayoutRecordCommitResult, receipt: CompositionReceipt | null): ViewPlacementsOutcome {
        if (receipt !== null && receipt.conflicts.length > 0) {
            lastConflict.value = receipt.conflicts.join("；");
        }
        return outcomeOf(result, receipt);
    }

    /**
     * 追加本地意图并排队提交：呈现立刻更新（补丁合成在最新底本上），提交串行；
     * 回执到达时只清除它提交过的那一段意图，期间的失败不会丢掉随后到达的意图。
     */
    function submit(patches: readonly ViewPlacementsPatch[]): Promise<ViewPlacementsOutcome> {
        // 每批记下**接受时**的工作面：`set-view-sizes` 自己带着它（意图可重放），其余在这里记住。
        const surface = contextSignature(options.context());
        for (const patch of patches) {
            if (patch.kind !== "set-view-sizes") {
                acceptedSurfaces.set(patch, surface);
            }
            pendingPatches.push({seq: ++patchSeq, patch});
        }
        // 明确操作清掉上一次的终态诊断：用户已经看最新的布局重新做了一次。
        lastConflict.value = null;
        refreshRecord();
        const run = commitTail.then(async (): Promise<ViewPlacementsOutcome> => {
            const submittedSeq = patchSeq;
            const batch = pendingPatches
                .filter((entry) => entry.seq <= submittedSeq)
                .map((entry) => entry.patch);
            const result = await session.commit(batch);
            if (result.status === "saved" || result.status === "unchanged") {
                pendingPatches = pendingPatches.filter((entry) => entry.seq > submittedSeq);
            }
            refreshRecord();
            return settle(result, lastComposed?.patches === batch ? lastComposed.receipt : null);
        });
        commitTail = run.catch(() => undefined);
        return run;
    }

    /** 命令边界共用的两步：门禁 + 目标容器必须可落位。 */
    function containerGate(containerId: string): ViewPlacementsOutcome | null {
        const gated = gatedOutcome();
        if (gated !== null) {
            return gated;
        }
        if (!effectiveCatalog.value.containers.includes(containerId)) {
            return {status: "rejected", diagnosis: `容器 ${containerId} 未登记或不可落位`};
        }
        return null;
    }

    /** 过期抑制目标不接收普通动作：要重新打开它得走 `reopenContainer`。 */
    function suppressedGate(containerId: string, action: string): ViewPlacementsOutcome | null {
        return isContainerSuppressed(effectiveCatalog.value, record.value, containerId)
            ? {status: "rejected", diagnosis: `容器 ${containerId} 已经被合并掉，${action}`}
            : null;
    }

    const consumer: WorkbenchViewPlacementsConsumer = {
        record: readonly(record) as Readonly<Ref<WorkbenchViewCustomizationsRecord>>,
        panelState: computed(() => resolvePanelPreferences({
            position: record.value.panelPosition,
            alignment: record.value.panelAlignment,
            hidden: record.value.panelHidden,
            collapsed: record.value.panelCollapsed,
        })),
        loading: session.loading,
        notice,

        contextKey(): string {
            return contextSignature(options.context());
        },

        async moveView(request: ViewMoveRequest): Promise<ViewPlacementsOutcome> {
            const gated = gatedOutcome();
            if (gated !== null) {
                return gated;
            }
            const suppressed = suppressedGate(request.targetContainerId, "不能作为移动目标");
            if (suppressed !== null) {
                return suppressed;
            }
            const reading = readViewPlacements(effectiveCatalog.value, record.value.placements);
            const decision = resolveViewMove({catalog: effectiveCatalog.value, reading, request, visibleViewIds: visibleViewIds()});
            if (decision.kind === "rejected") {
                return {status: "rejected", diagnosis: decision.diagnosis};
            }
            if (decision.kind === "noop") {
                return {status: "unchanged", diagnosis: decision.diagnosis};
            }
            return await submit([{
                kind: "move-view",
                viewId: decision.viewId,
                sourceContainerId: request.sourceContainerId,
                targetContainerId: decision.targetContainerId,
                ...(decision.beforeViewId === undefined ? {} : {beforeViewId: decision.beforeViewId}),
                ...(request.split === undefined ? {} : {split: request.split}),
            }]);
        },

        async detachView(request: ViewDetachRequest): Promise<ViewPlacementsOutcome> {
            const gated = gatedOutcome();
            if (gated !== null) return gated;
            if (request.contextKey !== contextSignature(options.context())) {
                return {status: "rejected", diagnosis: "工作面已经切换，这次视图移动没有落账"};
            }
            if (!visibleViewIds().includes(request.viewId)) {
                return {status: "rejected", diagnosis: `视图 ${request.viewId} 在当前上下文不可见，拒绝移动`};
            }
            return await submit([{
                kind: "detach-view",
                viewId: request.viewId,
                sourceContainerId: request.sourceContainerId,
                targetLocation: request.targetLocation,
                beforeContainerId: request.beforeContainerId,
                containerId: `custom:${crypto.randomUUID()}`,
            }]);
        },

        async mergeContainer(request: ContainerMergeRequest): Promise<ViewPlacementsOutcome> {
            const gated = gatedOutcome();
            if (gated !== null) {
                return gated;
            }
            const decision = resolveContainerMerge({
                catalog: effectiveCatalog.value,
                containers: containerPlacementReading(),
                views: readViewPlacements(effectiveCatalog.value, record.value.placements),
                suppressed: suppressedContainerIds(effectiveCatalog.value, record.value),
                request,
                currentContextKey: contextSignature(options.context()),
                visibleViewIds: visibleViewIds(),
            });
            if (decision.kind === "rejected") {
                return {status: "rejected", diagnosis: decision.diagnosis};
            }
            if (decision.kind === "noop") {
                return {status: "unchanged", diagnosis: decision.diagnosis};
            }
            return await submit([{
                kind: "merge-container",
                sourceContainerId: decision.sourceContainerId,
                sourceLocation: request.sourceLocation,
                targetContainerId: decision.targetContainerId,
                targetLocation: request.targetLocation,
                sourceViewIds: decision.sourceViewIds,
                ...(decision.beforeViewId === undefined ? {} : {beforeViewId: decision.beforeViewId}),
                ...(request.split === undefined ? {} : {split: request.split}),
            }]);
        },

        async moveContainer(request: ContainerMoveRequest): Promise<ViewPlacementsOutcome> {
            const gated = gatedOutcome();
            if (gated !== null) {
                return gated;
            }
            const suppressed = suppressedGate(request.containerId, "不能整体移动（先重新打开它）");
            if (suppressed !== null) {
                return suppressed;
            }
            const decision = resolveContainerMove({
                catalog: effectiveCatalog.value,
                reading: containerPlacementReading(),
                request,
            });
            if (decision.kind === "rejected") {
                return {status: "rejected", diagnosis: decision.diagnosis};
            }
            if (decision.kind === "noop") {
                return {status: "unchanged", diagnosis: decision.diagnosis};
            }
            return await submit([{
                kind: "move-container",
                containerId: decision.containerId,
                sourceLocation: request.sourceLocation,
                targetLocation: decision.targetLocation,
                ...(decision.beforeContainerId === undefined ? {} : {beforeContainerId: decision.beforeContainerId}),
            }]);
        },

        async selectContainer(partId: ToolPartId, containerId: string): Promise<ViewPlacementsOutcome> {
            const gated = containerGate(containerId);
            if (gated !== null) {
                return gated;
            }
            if (!isToolPartId(partId)) {
                return {status: "rejected", diagnosis: `未登记的工具 Part：${String(partId)}`};
            }
            const suppressed = suppressedGate(containerId, "不能选为活动容器（先重新打开它）");
            if (suppressed !== null) {
                return suppressed;
            }
            const placement = containerPlacementReading().placements
                .find((entry) => entry.containerId === containerId);
            if (placement === undefined || toolPartOfLocation(placement.location) !== partId) {
                return {
                    status: "rejected",
                    diagnosis: `容器 ${containerId} 当前不在 Part ${partId} 里，不能选为活动容器`,
                };
            }
            return await submit([{kind: "select-container", partId, containerId}]);
        },

        async setViewSizes(input: ViewSizesInput): Promise<ViewPlacementsOutcome> {
            const gated = containerGate(input.containerId);
            if (gated !== null) {
                return gated;
            }
            if (input.contextKey !== contextSignature(options.context())) {
                return {status: "rejected", diagnosis: "工作面已经切换，这场尺寸手势没有落账"};
            }
            if (input.patches.length === 0) {
                return {status: "unchanged", diagnosis: "没有需要保存的 View 尺寸"};
            }
            // 换 Part（= 换轴）或换位置后到达的批整批拒绝：上下排记下的高度不能写进左右排的宽度。
            const location = containerPlacementReading().placements
                .find((entry) => entry.containerId === input.containerId)?.location;
            if (location !== input.sourceLocation) {
                return {
                    status: "rejected",
                    diagnosis: `容器 ${input.containerId} 已经不在 ${input.sourceLocation}（换 Part 会换轴），这场尺寸手势没有落账`,
                };
            }
            const reading = readViewPlacements(effectiveCatalog.value, record.value.placements);
            const seen: Record<string, true> = {};
            for (const entry of input.patches) {
                if (seen[entry.viewId] === true) {
                    return {status: "rejected", diagnosis: `同一场手势里重复出现视图 ${entry.viewId}，整批没有落账`};
                }
                seen[entry.viewId] = true;
                if (entry.width !== undefined && !isWorkbenchViewSize(entry.width)) {
                    return {
                        status: "rejected",
                        diagnosis: `视图 ${entry.viewId} 的宽度意图不是正有限数：${String(entry.width)}，整批没有落账`,
                    };
                }
                if (entry.height !== undefined && !isWorkbenchViewSize(entry.height)) {
                    return {
                        status: "rejected",
                        diagnosis: `视图 ${entry.viewId} 的高度意图不是正有限数：${String(entry.height)}，整批没有落账`,
                    };
                }
                if (entry.collapsed !== undefined && typeof entry.collapsed !== "boolean") {
                    return {
                        status: "rejected",
                        diagnosis: `视图 ${entry.viewId} 的收起标记不是布尔值：${String(entry.collapsed)}，整批没有落账`,
                    };
                }
                const current = reading.placements.find((placement) => placement.viewId === entry.viewId);
                if (current === undefined || current.containerId !== input.containerId) {
                    return {
                        status: "rejected",
                        diagnosis: `视图 ${entry.viewId} 不在容器 ${input.containerId} 里，整批尺寸没有落账`,
                    };
                }
            }
            return await submit([{
                kind: "set-view-sizes",
                containerId: input.containerId,
                sourceLocation: input.sourceLocation,
                contextKey: input.contextKey,
                patches: input.patches,
            }]);
        },

        async setPartVisibility(input: PartVisibilityInput): Promise<ViewPlacementsOutcome> {
            const gated = gatedOutcome();
            if (gated !== null) {
                return gated;
            }
            if (!isToolPartId(input.partId)) {
                return {status: "rejected", diagnosis: `未登记的工具 Part：${String(input.partId)}`};
            }
            if (input.hidden === undefined && input.dragCollapsed === undefined) {
                return {status: "rejected", diagnosis: "没有指定要改变哪一项 Part 可见性"};
            }
            if (input.hidden !== undefined) {
                if (input.partId === "panel") {
                    return {status: "rejected", diagnosis: "Panel 的显隐归面板状态意图，hiddenSidebars 只记 left/right"};
                }
                if (typeof input.hidden !== "boolean") {
                    return {status: "rejected", diagnosis: `侧栏隐藏标记不是布尔值：${String(input.hidden)}`};
                }
            }
            if (input.dragCollapsed !== undefined && typeof input.dragCollapsed !== "boolean") {
                return {status: "rejected", diagnosis: `拖收起标记不是布尔值：${String(input.dragCollapsed)}`};
            }
            return await submit([{
                kind: "set-part-visibility",
                partId: input.partId,
                ...(input.hidden === undefined ? {} : {hidden: input.hidden}),
                ...(input.dragCollapsed === undefined ? {} : {dragCollapsed: input.dragCollapsed}),
            }]);
        },

        async setPanelState(patch: PanelStatePatch): Promise<ViewPlacementsOutcome> {
            const gated = gatedOutcome();
            if (gated !== null) {
                return gated;
            }
            const problem = panelStateProblem(patch);
            if (problem !== null) {
                return {status: "rejected", diagnosis: problem};
            }
            return await submit([{
                kind: "set-panel-state",
                ...(patch.position === undefined ? {} : {position: patch.position}),
                ...(patch.alignment === undefined ? {} : {alignment: patch.alignment}),
                ...(patch.hidden === undefined ? {} : {hidden: patch.hidden}),
                ...(patch.collapsed === undefined ? {} : {collapsed: patch.collapsed}),
            }]);
        },

        async restoreViewPlacement(viewId: string): Promise<ViewPlacementsOutcome> {
            const gated = gatedOutcome();
            if (gated !== null) {
                return gated;
            }
            if (catalog!.views[viewId] === undefined) {
                return {status: "rejected", diagnosis: `未登记的视图 ${viewId}，不能恢复默认位置`};
            }
            if (record.value.placements[viewId] === undefined) {
                return {status: "unchanged", diagnosis: `视图 ${viewId} 没有位置覆盖，无需恢复`};
            }
            return await submit([{kind: "restore-view-placement", viewId}]);
        },

        async restoreContainerPlacement(containerId: string): Promise<ViewPlacementsOutcome> {
            const gated = gatedOutcome();
            if (gated !== null) {
                return gated;
            }
            if (effectiveCatalog.value.containerDefaults[containerId] === undefined) {
                return {status: "rejected", diagnosis: `未登记的容器 ${containerId}，不能恢复默认落位`};
            }
            const suppressed = isContainerSuppressed(effectiveCatalog.value, record.value, containerId);
            if (record.value.containerPlacements?.[containerId] === undefined && !suppressed) {
                return {status: "unchanged", diagnosis: `容器 ${containerId} 没有落位覆盖，无需恢复`};
            }
            return await submit([{kind: "restore-container-placement", containerId}]);
        },

        async reopenContainer(containerId: string): Promise<ViewPlacementsOutcome> {
            const gated = containerGate(containerId);
            if (gated !== null) {
                return gated;
            }
            return await submit([{kind: "reopen-container", containerId}]);
        },

        async revealView(viewId: string): Promise<ViewPlacementsOutcome> {
            const gated = gatedOutcome();
            if (gated !== null) {
                return gated;
            }
            if (catalog!.views[viewId] === undefined) {
                return {status: "rejected", diagnosis: `未登记的视图 ${viewId}，无法揭示`};
            }
            const reading = readViewPlacements(effectiveCatalog.value, record.value.placements);
            const current = reading.placements.find((placement) => placement.viewId === viewId);
            const placement = current === undefined ? undefined : containerPlacementReading().placements
                .find((entry) => entry.containerId === current.containerId);
            if (placement === undefined || toolPartOfLocation(placement.location) === null) {
                return {
                    status: "rejected",
                    diagnosis: `视图 ${viewId} 的容器当前不可落位，无法揭示（它的显示条件或位置可能已经变了）`,
                };
            }
            return await submit([{kind: "reveal-view", viewId}]);
        },

        async retry(): Promise<ViewPlacementsOutcome> {
            const submittedSeq = patchSeq;
            const before = composedGeneration;
            const result = await session.retry();
            // 重试同样消费回执：这次调用真的合成过才谈"这次重放的冲突"（否则是"没有未确认意图"）。
            const receipt = composedGeneration > before ? lastComposed?.receipt ?? null : null;
            if (result.status === "saved" || result.status === "unchanged") {
                pendingPatches = pendingPatches.filter((entry) => entry.seq > submittedSeq);
            }
            refreshRecord();
            return settle(result, receipt);
        },

        dismissNotice(): void {
            lastConflict.value = null;
        },

        abandon(): void {
            session.abandon();
            pendingPatches = [];
            refreshRecord();
        },

        async release(): Promise<void> {
            pendingPatches = [];
            await session.release();
        },
    };

    onScopeDispose(() => {
        void consumer.release();
    });
    return consumer;
}

/** 注册表不可用时的空目录：位置求值跑得完（视图全在"未登记"一侧），命令在门禁处已被拒绝。 */
const EMPTY_CATALOG: PlacementCatalog = {views: {}, containers: [], containerDefaults: {}};

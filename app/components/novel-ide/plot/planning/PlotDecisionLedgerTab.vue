<script setup lang="ts">
// 决策记录(StoryDecision)账本 tab:左列表 + 右 ADR 详情,与承诺账本 tab 并排接线(组件契约一致)。
// 数据自加载:组件内部经 plot-planning-api 拉列表与详情,不从宿主传规划层数据;
// 宿主只传 projectRoot 与 chapters/threads/scenes(名称解析与编辑器选择器用),经 selectScene 事件跳回线程规划 tab。
// 生命周期动作:拍板(仅 open)/作废(强制填失效原因)/重开(decided|dropped)/物理删除(仅 UI/人工出口,93 D4)。
import {computed, ref, watch} from "vue";
import {storeToRefs} from "pinia";
import Dialog from "nbook/app/components/common/Dialog.vue";
import FormField from "nbook/app/components/common/form/FormField.vue";
import FormTextarea from "nbook/app/components/common/form/FormTextarea.vue";
import PlotDecisionAdrDetail from "nbook/app/components/novel-ide/plot/planning/PlotDecisionAdrDetail.vue";
import PlotDecisionDecideDialog from "nbook/app/components/novel-ide/plot/planning/PlotDecisionDecideDialog.vue";
import type {PlotDecisionDecideSave} from "nbook/app/components/novel-ide/plot/planning/PlotDecisionDecideDialog.vue";
import PlotDecisionEditorDialog from "nbook/app/components/novel-ide/plot/planning/PlotDecisionEditorDialog.vue";
import type {PlotDecisionEditorSave} from "nbook/app/components/novel-ide/plot/planning/PlotDecisionEditorDialog.vue";
import {
    buildPlanningNameMaps,
    decisionAnchorName,
    decisionDeadlineName,
} from "nbook/app/components/novel-ide/plot/planning/plot-decision-view";
import {
    createStoryDecision,
    deleteStoryDecision,
    getStoryDecision,
    listStoryDecisions,
    listStoryPromises,
    updateStoryDecision,
} from "nbook/app/components/novel-ide/plot/planning/plot-planning-api";
import {
    DECISION_ANCHOR_KIND_META,
    DECISION_STATUS_META,
    PLANNING_TONE_CLASSES,
} from "nbook/app/components/novel-ide/plot/planning/plot-planning.types";
import type {
    PlotThreadPanelChapter,
    PlotThreadPanelScene,
    PlotThreadPanelThread,
} from "nbook/app/components/novel-ide/plot/thread-panel/plot-thread-panel.types";
import {useDialog} from "nbook/app/composables/useDialog";
import {useNotification} from "nbook/app/composables/useNotification";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {StoryActDto, StoryDecisionDto, StoryPromiseDto} from "nbook/shared/dto/plot.dto";

// 组件契约:与承诺账本 tab 完全一致,便于工作台并排接线。
const props = defineProps<{
    projectRoot: string;
    // 锚点 kind=act 下拉与卷名解析(承载树卷实体)。
    acts: StoryActDto[];
    // 期限章下拉与章名显示。
    chapters: PlotThreadPanelChapter[];
    // 锚点选择器与名称解析。
    threads: PlotThreadPanelThread[];
    // 场景选择器与章序信息。
    scenes: PlotThreadPanelScene[];
}>();

const emit = defineEmits<{
    // 宿主负责切回线程规划 tab 并选中该场。
    (e: "selectScene", sceneId: string): void;
    // UI 写操作成功后的宿主同步信号:宿主刷新剧情树(侧栏「未决」计数)。决策不涉及场景级缓存,恒不带 sceneIds。
    (e: "mutated", payload: {sceneIds?: string[]}): void;
}>();

const novelIdeStore = useNovelIdeStore();
const {plotRefreshVersion, plotPlanningFocusId} = storeToRefs(novelIdeStore);
const dialogApi = useDialog();
const notification = useNotification();

// 账本数据。
const decisions = ref<StoryDecisionDto[]>([]);
// 承诺列表:仅用于锚点/引用名称解析与编辑器 kind=promise 选择器(自拉,失败静默回退显示 id)。
const promises = ref<StoryPromiseDto[]>([]);
// 当前选中的决策 id;为空表示未选中(右侧显示占位)。
const selectedId = ref<string | null>(null);
// 选中决策的详情;为空表示未选中或详情尚未加载完成。
const detail = ref<StoryDecisionDto | null>(null);
const loadingList = ref(false);
const listError = ref("");
const loadingDetail = ref(false);
const detailError = ref("");
// 已关闭组(superseded+dropped)的展开态,默认折叠。
const closedExpanded = ref(false);

// 请求竞态守卫(仿 NovelPlotPanel 的 treeRequestVersion 模式,组件实例内自增)。
let listRequestVersion = 0;
let detailRequestVersion = 0;
let promiseRequestVersion = 0;

// 编辑器对话框状态。
const editorVisible = ref(false);
const editorMode = ref<"create" | "edit">("create");
// 编辑目标快照(打开编辑时捕获,避免后台刷新替换 detail 后提交错对象);为空表示新建。
const editingDecision = ref<StoryDecisionDto | null>(null);
const savingEditor = ref(false);
const editorError = ref("");
// 拍板对话框状态。
const decideVisible = ref(false);
const savingDecide = ref(false);
const decideError = ref("");
// 作废小对话框状态(强制填失效原因)。
const dropVisible = ref(false);
const dropReason = ref("");
const savingDrop = ref(false);
const dropError = ref("");

// 名称索引:列表行 chip 与 ADR 详情共用。
const nameMaps = computed(() => buildPlanningNameMaps({
    acts: props.acts,
    chapters: props.chapters,
    threads: props.threads,
    scenes: props.scenes,
    promises: promises.value,
    decisions: decisions.value,
}));

/** 组内排序:按 updatedAt 倒序(ISO 字符串可直接比较)。 */
function byUpdatedAtDesc(left: StoryDecisionDto, right: StoryDecisionDto): number {
    return right.updatedAt.localeCompare(left.updatedAt);
}

// 列表分组:open 置顶展开(「未决」),decided 次之,superseded+dropped 合并为可折叠组;空组不渲染。
const listGroups = computed(() => {
    const open = decisions.value.filter((row) => row.status === "open").sort(byUpdatedAtDesc);
    const decided = decisions.value.filter((row) => row.status === "decided").sort(byUpdatedAtDesc);
    const closed = decisions.value.filter((row) => row.status === "superseded" || row.status === "dropped").sort(byUpdatedAtDesc);
    return [
        {key: "open", label: "未决", rows: open, collapsible: false},
        {key: "decided", label: "已拍板", rows: decided, collapsible: false},
        {key: "closed", label: "已关闭(取代/作废)", rows: closed, collapsible: true},
    ].filter((group) => group.rows.length > 0);
});

// 详情操作可用性:拍板仅 open;作废在 open/decided;重开在 decided/dropped。
const canDecide = computed(() => detail.value?.status === "open");
const canDrop = computed(() => detail.value?.status === "open" || detail.value?.status === "decided");
const canReopen = computed(() => detail.value?.status === "decided" || detail.value?.status === "dropped");

/** 时间戳显示:本地化短格式;解析失败回退原文。 */
function formatTime(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/** 拉取决策列表(带竞态守卫);选中项已被删除时清空选中。 */
async function loadDecisions(): Promise<void> {
    const requestVersion = ++listRequestVersion;
    loadingList.value = true;
    listError.value = "";
    try {
        const response = await listStoryDecisions(props.projectRoot);
        if (requestVersion !== listRequestVersion) {
            return;
        }
        decisions.value = response;
        if (selectedId.value && !response.some((row) => row.id === selectedId.value)) {
            selectedId.value = null;
            detail.value = null;
        }
    } catch (error) {
        if (requestVersion !== listRequestVersion) {
            return;
        }
        listError.value = resolveApiErrorMessage(error, "加载决策列表失败");
    } finally {
        if (requestVersion === listRequestVersion) {
            loadingList.value = false;
        }
    }
}

/** 拉取承诺列表(名称解析属锦上添花,失败静默,chip 回退显示 id)。 */
async function loadPromises(): Promise<void> {
    const requestVersion = ++promiseRequestVersion;
    try {
        const response = await listStoryPromises(props.projectRoot);
        if (requestVersion === promiseRequestVersion) {
            promises.value = response;
        }
    } catch {
        // 静默:不打扰账本主流程。
    }
}

/** 拉取选中决策详情(带竞态守卫);选中项落在折叠组时自动展开,保证列表高亮可见。 */
async function loadDetail(decisionId: string): Promise<void> {
    const requestVersion = ++detailRequestVersion;
    loadingDetail.value = true;
    detailError.value = "";
    try {
        const response = await getStoryDecision(props.projectRoot, decisionId);
        if (requestVersion !== detailRequestVersion || selectedId.value !== decisionId) {
            return;
        }
        detail.value = response;
        if (response.status === "superseded" || response.status === "dropped") {
            closedExpanded.value = true;
        }
    } catch (error) {
        if (requestVersion !== detailRequestVersion) {
            return;
        }
        detailError.value = resolveApiErrorMessage(error, "加载决策详情失败");
    } finally {
        if (requestVersion === detailRequestVersion) {
            loadingDetail.value = false;
        }
    }
}

/** 选中一条决策并拉取详情(取代链跳转也走这里,仅本 tab 内)。 */
function selectDecision(decisionId: string): void {
    selectedId.value = decisionId;
    void loadDetail(decisionId);
}

/** 打开新建决策对话框。 */
function openCreate(): void {
    editorMode.value = "create";
    editingDecision.value = null;
    editorError.value = "";
    editorVisible.value = true;
}

/** 打开编辑对话框(捕获当前详情快照为编辑目标)。 */
function openEdit(): void {
    if (!detail.value) {
        return;
    }
    editorMode.value = "edit";
    editingDecision.value = detail.value;
    editorError.value = "";
    editorVisible.value = true;
}

/** 打开拍板对话框(仅 open 态)。 */
function openDecide(): void {
    if (!canDecide.value) {
        return;
    }
    decideError.value = "";
    decideVisible.value = true;
}

/** 打开作废小对话框(强制填失效原因)。 */
function openDrop(): void {
    dropReason.value = "";
    dropError.value = "";
    dropVisible.value = true;
}

/** 编辑器保存:mode=create 走创建并选中新决策,否则按快照 id 走 PATCH(列表字段整体替换);失败写对话框局部 error。 */
async function handleEditorSave(payload: PlotDecisionEditorSave): Promise<void> {
    savingEditor.value = true;
    editorError.value = "";
    try {
        const baseBody = {
            name: payload.name,
            title: payload.title,
            question: payload.question,
            options: payload.options,
            deadlineChapterId: payload.deadlineChapterId,
            serves: payload.serves,
            dependsOn: payload.dependsOn,
            anchor: payload.anchor,
            note: payload.note,
        };
        if (editorMode.value === "create") {
            const created = await createStoryDecision(props.projectRoot, baseBody);
            selectedId.value = created.id;
            detail.value = created;
        } else if (editingDecision.value) {
            const updated = await updateStoryDecision(props.projectRoot, editingDecision.value.id, {
                ...baseBody,
                ...(payload.decidedFields ?? {}),
            });
            if (selectedId.value === updated.id) {
                detail.value = updated;
            }
        }
        editorVisible.value = false;
        emit("mutated", {});
        await loadDecisions();
    } catch (error) {
        editorError.value = resolveApiErrorMessage(error, "保存决策失败");
    } finally {
        savingEditor.value = false;
    }
}

/** 拍板提交:status=decided + 三段;选了候选传 chosenOption(原文匹配),「全新方案」不传;失败写拍板对话框局部 error。 */
async function handleDecideSave(payload: PlotDecisionDecideSave): Promise<void> {
    const target = detail.value;
    if (!target) {
        return;
    }
    savingDecide.value = true;
    decideError.value = "";
    try {
        const updated = await updateStoryDecision(props.projectRoot, target.id, {
            status: "decided",
            decision: payload.decision,
            motivation: payload.motivation,
            risk: payload.risk,
            ...(payload.chosenOption !== null ? {chosenOption: payload.chosenOption} : {}),
        });
        detail.value = updated;
        decideVisible.value = false;
        emit("mutated", {});
        await loadDecisions();
    } catch (error) {
        decideError.value = resolveApiErrorMessage(error, "拍板失败");
    } finally {
        savingDecide.value = false;
    }
}

/** 提交作废:status=dropped,note 承载失效原因(客户端强制非空,服务层还有一道);失败写作废对话框局部 error。 */
async function submitDrop(): Promise<void> {
    const target = detail.value;
    if (!target) {
        return;
    }
    const reason = dropReason.value.trim();
    if (!reason) {
        dropError.value = "必须填写失效原因(这个问题为何不再需要回答)";
        return;
    }
    savingDrop.value = true;
    dropError.value = "";
    try {
        const updated = await updateStoryDecision(props.projectRoot, target.id, {status: "dropped", note: reason});
        detail.value = updated;
        dropVisible.value = false;
        emit("mutated", {});
        await loadDecisions();
    } catch (error) {
        dropError.value = resolveApiErrorMessage(error, "作废失败");
    } finally {
        savingDrop.value = false;
    }
}

/** 重开决策(decided/dropped → open):choose 确认后 PATCH;失败走通知(确认框已关闭,无局部错误出口)。 */
async function reopenDecision(): Promise<void> {
    const target = detail.value;
    if (!target) {
        return;
    }
    const action = await dialogApi.choose(
        `将「${target.title}」重新置为未决?已有的结论、动机、风险与否决记录会保留,供重议时参考。`,
        [
            {label: "取消", value: "cancel"},
            {label: "重开", value: "reopen", tone: "primary"},
        ],
        "重开决策",
    );
    if (action !== "reopen") {
        return;
    }
    try {
        const updated = await updateStoryDecision(props.projectRoot, target.id, {status: "open"});
        detail.value = updated;
        emit("mutated", {});
        await loadDecisions();
    } catch (error) {
        notification.notify({tone: "error", title: "重开决策失败", message: resolveApiErrorMessage(error, "重开决策失败")});
    }
}

/** 物理删除决策(93 D4:物理删除只留给 UI/人工):danger 确认;失败走通知。 */
async function removeDecision(): Promise<void> {
    const target = detail.value;
    if (!target) {
        return;
    }
    const action = await dialogApi.choose(
        `确定删除决策「${target.title}」?这是物理删除,不可恢复;引用它的 decision:// 互指会变成死引用。`,
        [
            {label: "取消", value: "cancel"},
            {label: "删除", value: "delete", tone: "danger"},
        ],
        "删除决策",
    );
    if (action !== "delete") {
        return;
    }
    try {
        await deleteStoryDecision(props.projectRoot, target.id);
        if (selectedId.value === target.id) {
            selectedId.value = null;
            detail.value = null;
        }
        emit("mutated", {});
        await loadDecisions();
    } catch (error) {
        notification.notify({tone: "error", title: "删除决策失败", message: resolveApiErrorMessage(error, "删除决策失败")});
    }
}

// projectRoot 变化(含首挂):重置并拉全量。
watch(() => props.projectRoot, (projectRoot) => {
    decisions.value = [];
    promises.value = [];
    detail.value = null;
    selectedId.value = null;
    listError.value = "";
    detailError.value = "";
    if (!projectRoot) {
        return;
    }
    void loadDecisions();
    void loadPromises();
}, {immediate: true});

// Agent 改账本时(store 递增 plotRefreshVersion),打开着的工作台自动跟进:刷新列表与当前详情。
watch(plotRefreshVersion, (version, previousVersion) => {
    if (!version || version === previousVersion || !props.projectRoot) {
        return;
    }
    void loadDecisions();
    void loadPromises();
    if (selectedId.value) {
        void loadDetail(selectedId.value);
    }
});

// 激活(挂载)时消费一次跳转聚焦请求:选中该决策并把 store 置回 null(消费一次语义)。
watch(plotPlanningFocusId, (focusId) => {
    if (!focusId) {
        return;
    }
    plotPlanningFocusId.value = null;
    selectDecision(focusId);
}, {immediate: true});
</script>

<template>
    <!-- 决策记录 tab:左列表 + 右 ADR 详情 -->
    <div class="flex h-full min-h-0 text-[var(--text-secondary)]">
        <!-- 左:决策列表列 -->
        <div class="flex w-[320px] shrink-0 flex-col border-r border-[var(--border-color)] bg-[var(--bg-sidebar)]">
            <!-- 列表头:标题 + 新建入口 -->
            <div class="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border-color)] px-3 py-2">
                <div class="flex min-w-0 items-center gap-1.5">
                    <span class="i-lucide-gavel h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]"></span>
                    <span class="truncate text-[12px] font-semibold text-[var(--text-main)]">决策记录</span>
                    <span class="shrink-0 text-[11px] text-[var(--text-muted)]">{{ decisions.length }}</span>
                </div>
                <button type="button" class="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1 text-[11px] font-medium text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)]" @click="openCreate">
                    <span class="i-lucide-plus h-3 w-3"></span>
                    新建决策
                </button>
            </div>

            <!-- 列表加载错误(tab 局部 error) -->
            <div v-if="listError" class="border-b border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-[11px] text-[var(--status-danger)]">
                <div class="flex items-center justify-between gap-2">
                    <span class="min-w-0">{{ listError }}</span>
                    <button type="button" class="shrink-0 rounded-md border border-[var(--status-danger-border)] px-2 py-0.5 text-[10px] font-semibold text-[var(--status-danger)] transition-colors hover:bg-[var(--status-danger-bg)]" @click="loadDecisions()">重试</button>
                </div>
            </div>

            <!-- 列表主体:未决置顶,已关闭组折叠 -->
            <div class="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-2 py-2">
                <div v-if="loadingList && decisions.length === 0" class="flex items-center justify-center py-8 text-[var(--text-muted)]">
                    <span class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
                </div>
                <div v-else-if="decisions.length === 0 && !listError" class="px-2 py-8 text-center">
                    <span class="i-lucide-gavel mx-auto block h-7 w-7 text-[var(--text-muted)] opacity-50"></span>
                    <div class="mt-2 text-[12px] font-medium text-[var(--text-main)]">还没有决策记录</div>
                    <div class="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">用 ADR 式记录待决问题;拍板后留下结论、动机与风险,防止 writer 把未决问题写死。</div>
                    <button type="button" class="mt-3 inline-flex items-center gap-1 rounded-md border border-transparent bg-[var(--accent-main)] px-3 py-1.5 text-[11px] font-medium text-[var(--text-inverse)] transition-all hover:opacity-90" @click="openCreate">
                        <span class="i-lucide-plus h-3 w-3"></span>
                        新建决策
                    </button>
                </div>
                <template v-else>
                    <div v-for="group in listGroups" :key="group.key" class="mb-2">
                        <!-- 组头:折叠组用按钮切换展开 -->
                        <button v-if="group.collapsible" type="button" class="flex w-full items-center gap-1 px-1 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)] transition-colors hover:text-[var(--text-main)]" @click="closedExpanded = !closedExpanded">
                            <span class="i-lucide-chevron-right h-3 w-3 transition-transform" :class="closedExpanded ? 'rotate-90' : ''"></span>
                            <span>{{ group.label }}</span>
                            <span class="font-normal">{{ group.rows.length }}</span>
                        </button>
                        <div v-else class="flex items-center gap-1 px-1 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                            <span>{{ group.label }}</span>
                            <span class="font-normal">{{ group.rows.length }}</span>
                        </div>
                        <!-- 组内行:状态 pill + 标题 + question 截断 + 锚点 chip + 期限章 -->
                        <div v-if="!group.collapsible || closedExpanded" class="space-y-1">
                            <button
                                v-for="row in group.rows"
                                :key="row.id"
                                type="button"
                                class="w-full rounded-md border px-2.5 py-2 text-left transition-colors"
                                :class="selectedId === row.id ? 'border-[var(--accent-main)] bg-[var(--accent-bg)]' : 'border-transparent hover:border-[var(--border-color)] hover:bg-[var(--bg-hover)]'"
                                @click="selectDecision(row.id)"
                            >
                                <div class="flex items-center gap-1.5">
                                    <span class="shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium" :class="PLANNING_TONE_CLASSES[DECISION_STATUS_META[row.status].tone].chip">{{ DECISION_STATUS_META[row.status].label }}</span>
                                    <span class="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--text-main)]">{{ row.title }}</span>
                                </div>
                                <div class="mt-1 truncate text-[11px] text-[var(--text-muted)]">{{ row.question }}</div>
                                <div class="mt-1 flex flex-wrap items-center gap-1">
                                    <span class="inline-flex max-w-full items-center gap-1 rounded px-1.5 py-px text-[10px]" :class="PLANNING_TONE_CLASSES.muted.chip">
                                        <span class="i-lucide-anchor h-2.5 w-2.5 shrink-0"></span>
                                        <span class="truncate">{{ DECISION_ANCHOR_KIND_META[row.anchorKind].label }}<template v-if="decisionAnchorName(row, nameMaps) !== null"> · {{ decisionAnchorName(row, nameMaps) }}</template></span>
                                    </span>
                                    <template v-if="row.deadlineChapterId">
                                        <span v-if="row.deadlineChapter" class="inline-flex min-w-0 items-center gap-1 text-[10px] text-[var(--text-muted)]">
                                            <span class="i-lucide-flag h-2.5 w-2.5 shrink-0"></span>
                                            <span class="truncate">{{ decisionDeadlineName(row, nameMaps) }}</span>
                                        </span>
                                        <span v-else class="inline-flex items-center rounded px-1.5 py-px text-[10px]" :class="PLANNING_TONE_CLASSES.danger.chip">期限章已删除</span>
                                    </template>
                                </div>
                            </button>
                        </div>
                    </div>
                </template>
            </div>
        </div>

        <!-- 右:ADR 详情列 -->
        <div class="flex min-w-0 flex-1 flex-col bg-[var(--bg-main)]">
            <!-- 未选中占位 -->
            <div v-if="!selectedId" class="flex flex-1 items-center justify-center p-6">
                <div class="text-center">
                    <span class="i-lucide-gavel mx-auto block h-8 w-8 text-[var(--text-muted)] opacity-40"></span>
                    <div class="mt-2 text-[12px] text-[var(--text-muted)]">选择左侧决策查看 ADR 详情</div>
                </div>
            </div>
            <template v-else>
                <!-- 详情头:标题 + 状态 + 元信息 + 操作 -->
                <div class="shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-panel)] px-4 py-3">
                    <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                            <div class="flex min-w-0 items-center gap-2">
                                <span class="min-w-0 truncate text-[14px] font-semibold text-[var(--text-main)]">{{ detail?.title ?? "加载中…" }}</span>
                                <span v-if="detail" class="shrink-0 rounded-full px-2 py-px text-[10px] font-medium" :class="PLANNING_TONE_CLASSES[DECISION_STATUS_META[detail.status].tone].chip">{{ DECISION_STATUS_META[detail.status].label }}</span>
                            </div>
                            <div v-if="detail" class="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-[var(--text-muted)]">
                                <span class="font-mono">{{ detail.name }}</span>
                                <!-- 锚点 chip:kind=scene 时可点击跳回线程规划 -->
                                <button v-if="detail.anchorKind === 'scene' && detail.anchorTargetId" type="button" class="inline-flex min-w-0 items-center gap-1 rounded px-1.5 py-px text-[10px] transition-opacity hover:opacity-80" :class="PLANNING_TONE_CLASSES.info.chip" title="跳到该场景(切回线程规划)" @click="emit('selectScene', detail.anchorTargetId)">
                                    <span class="i-lucide-anchor h-2.5 w-2.5 shrink-0"></span>
                                    <span class="truncate">{{ DECISION_ANCHOR_KIND_META[detail.anchorKind].label }} · {{ decisionAnchorName(detail, nameMaps) }}</span>
                                </button>
                                <span v-else class="inline-flex min-w-0 items-center gap-1 rounded px-1.5 py-px text-[10px]" :class="PLANNING_TONE_CLASSES.muted.chip">
                                    <span class="i-lucide-anchor h-2.5 w-2.5 shrink-0"></span>
                                    <span class="truncate">{{ DECISION_ANCHOR_KIND_META[detail.anchorKind].label }}<template v-if="decisionAnchorName(detail, nameMaps) !== null"> · {{ decisionAnchorName(detail, nameMaps) }}</template></span>
                                </span>
                                <!-- 期限章:id 非空而实体为空 = 期限章已删除(danger) -->
                                <template v-if="detail.deadlineChapterId">
                                    <span v-if="detail.deadlineChapter" class="inline-flex items-center gap-1">
                                        <span class="i-lucide-flag h-3 w-3"></span>
                                        期限 {{ decisionDeadlineName(detail, nameMaps) }}
                                    </span>
                                    <span v-else class="inline-flex items-center gap-1 text-[var(--status-danger)]">
                                        <span class="i-lucide-flag-off h-3 w-3"></span>
                                        期限章已删除
                                    </span>
                                </template>
                                <span>更新于 {{ formatTime(detail.updatedAt) }}</span>
                            </div>
                        </div>
                        <!-- 操作栏:拍板(仅 open)/编辑/作废/重开/删除 -->
                        <div v-if="detail" class="flex shrink-0 items-center gap-1.5">
                            <button v-if="canDecide" type="button" class="inline-flex items-center gap-1 rounded-md border border-transparent bg-[var(--accent-main)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-inverse)] transition-all hover:opacity-90 hover:shadow-md active:scale-95" @click="openDecide">
                                <span class="i-lucide-gavel h-3 w-3"></span>
                                拍板
                            </button>
                            <button type="button" class="inline-flex items-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)]" @click="openEdit">
                                <span class="i-lucide-pencil h-3 w-3"></span>
                                编辑
                            </button>
                            <button v-if="canDrop" type="button" class="inline-flex items-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)]" @click="openDrop">
                                <span class="i-lucide-ban h-3 w-3"></span>
                                作废
                            </button>
                            <button v-if="canReopen" type="button" class="inline-flex items-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)]" @click="reopenDecision">
                                <span class="i-lucide-rotate-ccw h-3 w-3"></span>
                                重开
                            </button>
                            <button type="button" class="flex h-6.5 w-6.5 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-muted)] transition-colors hover:border-[var(--status-danger-border)] hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger)]" title="删除决策(物理删除)" @click="removeDecision">
                                <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
                            </button>
                        </div>
                    </div>
                </div>

                <!-- 详情主体:ADR 分段 -->
                <div class="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-3">
                    <!-- 详情加载错误(tab 局部 error) -->
                    <div v-if="detailError" class="rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-[11px] text-[var(--status-danger)]">
                        <div class="flex items-center justify-between gap-2">
                            <span class="min-w-0">{{ detailError }}</span>
                            <button type="button" class="shrink-0 rounded-md border border-[var(--status-danger-border)] px-2 py-0.5 text-[10px] font-semibold text-[var(--status-danger)] transition-colors hover:bg-[var(--status-danger-bg)]" @click="selectedId && loadDetail(selectedId)">重试</button>
                        </div>
                    </div>
                    <div v-else-if="loadingDetail && !detail" class="flex items-center justify-center py-10 text-[var(--text-muted)]">
                        <span class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
                    </div>
                    <div v-else-if="detail" class="max-w-[760px]">
                        <PlotDecisionAdrDetail :decision="detail" :name-maps="nameMaps" @select-scene="emit('selectScene', $event)" @select-decision="selectDecision" />
                    </div>
                </div>
            </template>
        </div>

        <!-- 决策编辑对话框(新建/编辑共用) -->
        <PlotDecisionEditorDialog
            v-model:visible="editorVisible"
            :mode="editorMode"
            :decision="editingDecision"
            :acts="props.acts"
            :chapters="props.chapters"
            :threads="props.threads"
            :scenes="props.scenes"
            :promises="promises"
            :saving="savingEditor"
            :error="editorError"
            @save="handleEditorSave"
        />

        <!-- 拍板对话框(仅 open 态可开) -->
        <PlotDecisionDecideDialog v-model:visible="decideVisible" :decision="detail" :saving="savingDecide" :error="decideError" @save="handleDecideSave" />

        <!-- 作废小对话框:强制填失效原因(写入 note) -->
        <Dialog
            :model-value="dropVisible"
            title="作废决策"
            width="480px"
            show-cancel
            overlay-type="opaque"
            :busy="savingDrop"
            @request-close="dropVisible = false"
            @update:model-value="dropVisible = $event"
        >
            <template #footer>
                <button class="inline-flex items-center justify-center h-8 px-4 rounded-md text-[13px] font-medium cursor-pointer border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-main)] transition-colors duration-200 hover:bg-[var(--bg-hover)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50" :disabled="savingDrop" @click="dropVisible = false">取消</button>
                <button class="inline-flex items-center justify-center h-8 min-w-[92px] px-4 rounded-md text-[13px] font-medium cursor-pointer border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger)] transition-colors duration-200 hover:bg-[var(--status-danger)] hover:text-[var(--text-inverse)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50" :disabled="savingDrop" @click="submitDrop">
                    <span v-if="savingDrop" class="flex items-center gap-1">
                        <span class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
                        作废中
                    </span>
                    <span v-else>确认作废</span>
                </button>
            </template>
            <div class="mt-1 space-y-3 px-1">
                <div class="text-[12px] text-[var(--text-secondary)]">作废「{{ detail?.title ?? "" }}」:问题因剧情改道不再需要回答。作废后仍可在详情中重开。</div>
                <div v-if="dropError" class="rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-2.5 py-1.5 text-[11px] text-[var(--status-danger)]">{{ dropError }}</div>
                <FormField label="失效原因(必填,写入备注)">
                    <FormTextarea v-model="dropReason" :rows="3" placeholder="为什么这个问题不再需要回答,如「该支线已在第 12 章改道删除」" />
                </FormField>
            </div>
        </Dialog>
    </div>
</template>

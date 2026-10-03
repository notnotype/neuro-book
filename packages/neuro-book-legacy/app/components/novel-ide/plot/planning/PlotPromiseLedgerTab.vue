<script setup lang="ts">
// 承诺账本 tab:左列表右详情(master-detail)。
// 数据自加载:组件内部经 plot-planning-api 拉列表与详情,不从工作台宿主传规划层数据;
// watch plotRefreshVersion 跟进 Agent 侧改动;plotPlanningFocusId 供 Scene 芯片等入口跳转聚焦(消费一次)。
import {computed, onMounted, ref, watch} from "vue";
import {storeToRefs} from "pinia";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import PlotPromiseBeatDialog from "nbook/app/components/novel-ide/plot/planning/PlotPromiseBeatDialog.vue";
import type {PlotPromiseBeatSave} from "nbook/app/components/novel-ide/plot/planning/PlotPromiseBeatDialog.vue";
import PlotPromiseDetailPane from "nbook/app/components/novel-ide/plot/planning/PlotPromiseDetailPane.vue";
import PlotPromiseEditorDialog from "nbook/app/components/novel-ide/plot/planning/PlotPromiseEditorDialog.vue";
import type {PlotPromiseEditorSave} from "nbook/app/components/novel-ide/plot/planning/PlotPromiseEditorDialog.vue";
import {
    createStoryPromise,
    deleteStoryPromise,
    getStoryPromiseDetail,
    listStoryPromises,
    removePromiseBeat,
    setPromiseBeat,
    updateStoryPromise,
} from "nbook/app/components/novel-ide/plot/planning/plot-planning-api";
import {
    PLANNING_TONE_CLASSES,
    PROMISE_BEAT_KIND_META,
    PROMISE_DERIVED_STAGE_META,
    PROMISE_IMPORTANCE_META,
    PROMISE_STATUS_META,
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
import type {
    StoryPromiseBeatKindDto,
    StoryPromiseDetailDto,
    StoryPromiseDto,
    StoryPromiseImportanceDto,
    StoryPromiseStatusDto,
} from "nbook/shared/dto/plot.dto";

const props = defineProps<{
    projectRoot: string;
    // 期限章下拉与章名显示。
    chapters: PlotThreadPanelChapter[];
    // 节拍对话框场景选择器的分组语义(线名)。
    threads: PlotThreadPanelThread[];
    // 场景选择器与章序信息。
    scenes: PlotThreadPanelScene[];
}>();

const emit = defineEmits<{
    // 宿主负责切回线程规划 tab 并选中该场。
    (e: "selectScene", sceneId: string): void;
    // UI 写操作成功后的宿主同步信号:宿主刷新剧情树(侧栏计数)并强刷受影响 Scene 详情缓存。
    // sceneIds 为节拍所在场景(节拍增删 / 删除承诺的级联);为空(不传)表示只影响计数,无场景级数据变化。
    (e: "mutated", payload: {sceneIds?: string[]}): void;
}>();

const novelIdeStore = useNovelIdeStore();
const {plotRefreshVersion, plotPlanningFocusId} = storeToRefs(novelIdeStore);
const dialog = useDialog();
const notification = useNotification();

// ---- 列表状态 ----
const promises = ref<StoryPromiseDto[]>([]);
const listLoading = ref(false);
// 为空表示列表加载正常;非空为可重试的加载错误。
const listError = ref("");
// 状态筛选:默认只看 open(进行中的读者债务)。
const statusFilter = ref<"open" | "all" | "fulfilled" | "abandoned">("open");
// importance 筛选:空串表示不过滤。
const importanceFilter = ref("");

// ---- 详情状态 ----
// 为空表示当前未选中承诺(右栏空态)。
const selectedPromiseId = ref<string | null>(null);
// 为空表示尚未加载出详情。
const detail = ref<StoryPromiseDetailDto | null>(null);
const detailLoading = ref(false);
// 为空表示详情加载正常。
const detailError = ref("");

// ---- 编辑 / 节拍对话框状态 ----
const editorVisible = ref(false);
const editorMode = ref<"create" | "edit">("create");
const savingEditor = ref(false);
// 为空表示编辑对话框无保存错误(错误留在对话框内,可改后重试)。
const editorError = ref("");
const beatDialogVisible = ref(false);
const savingBeat = ref(false);
// 为空表示节拍对话框无保存错误。
const beatError = ref("");

// 竞态守卫(仿 NovelPlotPanel 的 treeRequestVersion):只接受最新一次请求的结果。
let listRequestVersion = 0;
let detailRequestVersion = 0;

// importance 排序权重:high 优先。
const IMPORTANCE_RANK: Record<StoryPromiseImportanceDto, number> = {high: 0, medium: 1, low: 2};

// 状态筛选分段项。
const statusFilterItems: Array<{value: "open" | "all" | "fulfilled" | "abandoned"; label: string}> = [
    {value: "open", label: "进行中"},
    {value: "all", label: "全部"},
    {value: "fulfilled", label: "已兑现"},
    {value: "abandoned", label: "已放弃"},
];

// importance 筛选下拉项(空串=全部)。
const importanceFilterOptions: SelectOption[] = [
    {value: "", label: "全部重要性"},
    {value: "high", label: "仅看高"},
    {value: "medium", label: "仅看中"},
    {value: "low", label: "仅看低"},
];

// 节拍四类计数的渲染顺序(埋/推/挫/收),供列表行微标使用。
const beatKindEntries = Object.entries(PROMISE_BEAT_KIND_META) as Array<[StoryPromiseBeatKindDto, {label: string; iconClass: string}]>;

// 章 id → 「序号 标题」显示名(期限章列显示)。
const chapterLabelById = computed(() => new Map(props.chapters.map((chapter) => [chapter.id, `${chapter.numberLabel} ${chapter.title}`.trim()])));

/**
 * 筛选 + 排序后的可见列表:importance(high 先)→ updatedAt 降序。
 */
const visiblePromises = computed(() => {
    return promises.value
        .filter((promise) => (statusFilter.value === "all" || promise.status === statusFilter.value)
            && (!importanceFilter.value || promise.importance === importanceFilter.value))
        .sort((left, right) => IMPORTANCE_RANK[left.importance] - IMPORTANCE_RANK[right.importance]
            || right.updatedAt.localeCompare(left.updatedAt));
});

// 编辑目标快照(打开编辑时捕获,与决策侧对齐):避免 plotRefreshVersion 后台刷新替换 detail 后
// 重置对话框草稿或提交到错误对象;为空表示新建模式。
const editingPromise = ref<StoryPromiseDetailDto | null>(null);

/**
 * 拉取承诺列表;竞态守卫,只接受最新请求。
 * selectId 非空时优先选中该承诺(跳转聚焦用),否则保持当前选中并刷新其详情,无选中时默认取可见首行。
 */
async function loadPromises(selectId?: string): Promise<void> {
    if (!props.projectRoot) {
        return;
    }
    const requestVersion = ++listRequestVersion;
    listLoading.value = true;
    listError.value = "";
    try {
        const response = await listStoryPromises(props.projectRoot);
        if (requestVersion !== listRequestVersion) {
            return;
        }
        promises.value = response;
        syncSelection(selectId);
    } catch (error) {
        if (requestVersion !== listRequestVersion) {
            return;
        }
        listError.value = resolveApiErrorMessage(error, "加载承诺账本失败");
    } finally {
        if (requestVersion === listRequestVersion) {
            listLoading.value = false;
        }
    }
}

/**
 * 修正选中态:优先 preferredId(必要时放宽筛选保证目标行可见);
 * 其次保持仍存在的当前选中(并重拉详情跟进最新数据);否则默认选可见首行;全空则清空详情。
 */
function syncSelection(preferredId?: string): void {
    if (preferredId && promises.value.some((item) => item.id === preferredId)) {
        // 聚焦目标可能被当前筛选挡住(如已兑现承诺被 open 筛选过滤),重置筛选保证可见。
        if (!visiblePromises.value.some((item) => item.id === preferredId)) {
            statusFilter.value = "all";
            importanceFilter.value = "";
        }
        selectPromise(preferredId);
        return;
    }
    if (selectedPromiseId.value && promises.value.some((item) => item.id === selectedPromiseId.value)) {
        void loadDetail(selectedPromiseId.value);
        return;
    }
    const first = visiblePromises.value[0];
    if (first) {
        selectPromise(first.id);
        return;
    }
    selectedPromiseId.value = null;
    detail.value = null;
}

/**
 * 选中承诺并拉取详情。
 */
function selectPromise(promiseId: string): void {
    selectedPromiseId.value = promiseId;
    void loadDetail(promiseId);
}

/**
 * 拉取选中承诺详情;竞态守卫,只接受最新请求。
 */
async function loadDetail(promiseId: string): Promise<void> {
    const requestVersion = ++detailRequestVersion;
    detailLoading.value = true;
    detailError.value = "";
    try {
        const response = await getStoryPromiseDetail(props.projectRoot, promiseId);
        if (requestVersion !== detailRequestVersion) {
            return;
        }
        detail.value = response;
    } catch (error) {
        if (requestVersion !== detailRequestVersion) {
            return;
        }
        detailError.value = resolveApiErrorMessage(error, "加载承诺详情失败");
    } finally {
        if (requestVersion === detailRequestVersion) {
            detailLoading.value = false;
        }
    }
}

/**
 * 把写操作返回的最新详情同步到详情区与列表行(免整表重拉)。
 */
function applyDetail(nextDetail: StoryPromiseDetailDto): void {
    detail.value = nextDetail;
    selectedPromiseId.value = nextDetail.id;
    const exists = promises.value.some((item) => item.id === nextDetail.id);
    promises.value = exists
        ? promises.value.map((item) => item.id === nextDetail.id ? nextDetail : item)
        : [...promises.value, nextDetail];
}

/**
 * 打开新建承诺对话框。
 */
function openCreateEditor(): void {
    editorMode.value = "create";
    editingPromise.value = null;
    editorError.value = "";
    editorVisible.value = true;
}

/**
 * 打开编辑承诺对话框(捕获当前详情快照为编辑目标)。
 */
function openEditEditor(): void {
    if (!detail.value) {
        return;
    }
    editorMode.value = "edit";
    editingPromise.value = detail.value;
    editorError.value = "";
    editorVisible.value = true;
}

/**
 * 保存编辑对话框:create 走 POST,edit 走 PATCH(可空字段 null=显式清空)。
 * edit 提交按打开对话框时捕获的快照 id,不受后台刷新替换 detail 影响。
 * 保存错误写 editorError(留在对话框内可改后重试),不打全局通知。
 */
async function saveEditor(payload: PlotPromiseEditorSave): Promise<void> {
    const editingId = editingPromise.value?.id ?? null;
    if (savingEditor.value || (editorMode.value === "edit" && !editingId)) {
        return;
    }
    savingEditor.value = true;
    editorError.value = "";
    const body = {
        name: payload.name,
        title: payload.title,
        importance: payload.importance,
        summary: payload.summary,
        payoffExpectation: payload.payoffExpectation,
        cadenceChapters: payload.cadenceChapters,
        deadlineChapterId: payload.deadlineChapterId,
        tags: payload.tags,
    };
    try {
        const saved = editorMode.value === "create"
            ? await createStoryPromise(props.projectRoot, body)
            : await updateStoryPromise(props.projectRoot, editingId ?? "", body);
        applyDetail(saved);
        editorVisible.value = false;
        emit("mutated", {});
    } catch (error) {
        editorError.value = resolveApiErrorMessage(error, "保存承诺失败");
    } finally {
        savingEditor.value = false;
    }
}

// 生命周期动作文案表:确认弹窗与失败通知共用。
const STATUS_ACTION_TEXT: Record<StoryPromiseStatusDto, {verb: string; message: string}> = {
    fulfilled: {verb: "兑现", message: "确认把该承诺标记为已兑现?通常由 payoff 节拍自动完成,手动标记用于补账。"},
    abandoned: {verb: "放弃", message: "确认放弃该承诺?账本仍保留记录(可随时重开),但不再计入进行中的读者债务。"},
    open: {verb: "重开", message: "确认重开该承诺?它将回到进行中状态,重新计入读者债务。"},
};

/**
 * 生命周期转换(兑现 / 放弃 / 重开):choose 确认后 PATCH status。
 * 后台动作失败走通知(useNotification),不占详情局部错误位。
 */
async function changeStatus(nextStatus: StoryPromiseStatusDto): Promise<void> {
    const current = detail.value;
    if (!current) {
        return;
    }
    const text = STATUS_ACTION_TEXT[nextStatus];
    const action = await dialog.choose(`「${current.title}」:${text.message}`, [
        {label: "取消", value: "cancel"},
        {label: text.verb, value: "confirm", tone: "primary"},
    ], `${text.verb}承诺`);
    if (action !== "confirm") {
        return;
    }
    try {
        applyDetail(await updateStoryPromise(props.projectRoot, current.id, {status: nextStatus}));
        emit("mutated", {});
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, `${text.verb}承诺失败`));
    }
}

/**
 * 物理删除承诺(93 D4:物理删除只留给 UI / 人工),节拍级联删除;danger 确认。
 */
async function deletePromise(): Promise<void> {
    const current = detail.value;
    if (!current) {
        return;
    }
    const action = await dialog.choose(
        `确认删除承诺「${current.title}」?这是物理删除,${current.beats.length} 条节拍将一并删除,不可恢复。`,
        [
            {label: "取消", value: "cancel"},
            {label: "删除", value: "confirm", tone: "danger"},
        ],
        "删除承诺",
    );
    if (action !== "confirm") {
        return;
    }
    try {
        await deleteStoryPromise(props.projectRoot, current.id);
        promises.value = promises.value.filter((item) => item.id !== current.id);
        selectedPromiseId.value = null;
        detail.value = null;
        syncSelection();
        notification.success(`已删除承诺「${current.title}」`);
        // 级联删除了全部节拍:让宿主强刷这些场景的详情缓存(promiseBeats 芯片)。
        emit("mutated", {sceneIds: current.beats.map((beat) => beat.sceneId)});
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "删除承诺失败"));
    }
}

/**
 * 打开添加节拍对话框。
 */
function openBeatDialog(): void {
    if (!detail.value) {
        return;
    }
    beatError.value = "";
    beatDialogVisible.value = true;
}

/**
 * 保存节拍(PUT upsert,同场同线仅一条):若服务层因 autoFulfill 把承诺置为已兑现,弹通知告知。
 * 保存错误写 beatError(留在对话框内)。
 */
async function saveBeat(payload: PlotPromiseBeatSave): Promise<void> {
    const current = detail.value;
    if (!current || savingBeat.value) {
        return;
    }
    savingBeat.value = true;
    beatError.value = "";
    try {
        const wasFulfilled = current.status === "fulfilled";
        const saved = await setPromiseBeat(props.projectRoot, current.id, {
            sceneId: payload.sceneId,
            kind: payload.kind,
            note: payload.note,
            // autoFulfill 仅对 payoff 生效,其余 kind 不发送该字段。
            ...(payload.kind === "payoff" ? {autoFulfill: payload.autoFulfill} : {}),
        });
        applyDetail(saved);
        beatDialogVisible.value = false;
        emit("mutated", {sceneIds: [payload.sceneId]});
        if (!wasFulfilled && saved.status === "fulfilled") {
            notification.success("已自动标记为已兑现");
        }
    } catch (error) {
        beatError.value = resolveApiErrorMessage(error, "保存节拍失败");
    } finally {
        savingBeat.value = false;
    }
}

/**
 * 删除一条节拍(确认后 DELETE;服务层自带 fulfilled 回退检查)。失败走通知。
 */
async function removeBeat(sceneId: string): Promise<void> {
    const current = detail.value;
    if (!current) {
        return;
    }
    const beat = current.beats.find((item) => item.sceneId === sceneId);
    const action = await dialog.choose(
        `确认删除场景「${beat?.scene.title || "未命名 Scene"}」上的「${beat ? PROMISE_BEAT_KIND_META[beat.kind].label : "节拍"}」节拍?若删除的是兑现节拍,承诺状态会自动回退。`,
        [
            {label: "取消", value: "cancel"},
            {label: "删除", value: "confirm", tone: "danger"},
        ],
        "删除节拍",
    );
    if (action !== "confirm") {
        return;
    }
    try {
        applyDetail(await removePromiseBeat(props.projectRoot, current.id, sceneId));
        emit("mutated", {sceneIds: [sceneId]});
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "删除节拍失败"));
    }
}

/**
 * 期限章列显示名:优先面板 chapters(带序号),回退接口自带章标题;
 * deadlineChapterId 非空而 deadlineChapter 为空 = 期限章已被删除。
 */
function deadlineLabel(promise: StoryPromiseDto): string {
    if (!promise.deadlineChapterId) {
        return "";
    }
    if (!promise.deadlineChapter) {
        return "期限章已删除";
    }
    return chapterLabelById.value.get(promise.deadlineChapterId) ?? promise.deadlineChapter.title;
}

/**
 * 取走并清空 store 中待消费的聚焦 id;返回空表示没有待消费的跳转请求。
 */
function consumeFocusId(): string | null {
    const focusId = plotPlanningFocusId.value;
    if (focusId) {
        plotPlanningFocusId.value = null;
    }
    return focusId;
}

// 激活(挂载)时消费一次聚焦请求,再拉列表。
onMounted(() => {
    void loadPromises(consumeFocusId() ?? undefined);
});

// tab 已打开时又收到聚焦请求(如 Scene 芯片再次跳转):消费并定位。
watch(plotPlanningFocusId, (focusId) => {
    if (!focusId) {
        return;
    }
    plotPlanningFocusId.value = null;
    void loadPromises(focusId);
});

// Agent 改账本时(SSE 推进 plotRefreshVersion),打开着的账本自动刷新列表与当前详情。
watch(plotRefreshVersion, () => {
    void loadPromises();
});
</script>

<template>
    <!-- 承诺账本 tab 主体:左列表右详情 -->
    <div class="flex min-h-0 min-w-0 flex-1" data-testid="plot-promise-ledger">
        <!-- 左:承诺列表 -->
        <aside class="flex min-h-0 w-[360px] shrink-0 flex-col border-r border-[var(--border-color)] bg-[var(--bg-panel)]/78">
            <div class="shrink-0 space-y-2.5 border-b border-[var(--border-color)] px-3 py-3">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-main)]">
                        <span>承诺账本({{ visiblePromises.length }})</span>
                        <span v-if="listLoading" class="i-lucide-loader-circle h-3 w-3 animate-spin text-[var(--text-muted)]"></span>
                    </div>
                    <button type="button" data-testid="plot-promise-create" class="inline-flex h-6 items-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--accent-text)]" @click="openCreateEditor">
                        <span class="i-lucide-plus h-3 w-3"></span>
                        新建承诺
                    </button>
                </div>
                <!-- 筛选:状态分段(默认进行中) + 重要性下拉 -->
                <div class="flex items-center gap-1.5">
                    <div class="flex flex-1 items-center gap-0.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-0.5">
                        <button v-for="item in statusFilterItems" :key="item.value" type="button" class="flex-1 rounded px-1 py-1 text-[11px] transition-colors" :class="statusFilter === item.value ? 'bg-[var(--accent-bg)] font-semibold text-[var(--accent-text)]' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'" @click="statusFilter = item.value">{{ item.label }}</button>
                    </div>
                    <div class="w-[104px] shrink-0">
                        <FormSelect v-model="importanceFilter" :options="importanceFilterOptions" size="sm" />
                    </div>
                </div>
            </div>

            <!-- 列表主体:错误 / 空态 / 行 -->
            <div class="min-h-0 flex-1 overflow-y-auto px-2 py-2 custom-scrollbar">
                <div v-if="listError" class="space-y-2 rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2.5 text-[11px] text-[var(--status-danger)]">
                    <div>{{ listError }}</div>
                    <button type="button" class="rounded-md border border-[var(--status-danger-border)] px-2 py-1 text-[10px] font-semibold transition-colors hover:bg-[var(--status-danger-bg)]" @click="loadPromises()">重试</button>
                </div>

                <div v-else-if="listLoading && promises.length === 0" class="flex items-center justify-center gap-2 px-4 py-10 text-[11px] text-[var(--text-muted)]">
                    <span class="i-lucide-loader-circle h-3.5 w-3.5 animate-spin"></span>
                    正在加载承诺账本...
                </div>

                <!-- 空账本 / 筛选无结果 -->
                <div v-else-if="visiblePromises.length === 0" class="flex flex-col items-center gap-2 px-4 py-10 text-center">
                    <span class="i-lucide-scroll-text h-7 w-7 text-[var(--text-muted)] opacity-50"></span>
                    <div class="text-[12px] text-[var(--text-secondary)]">{{ promises.length === 0 ? "账本还是空的" : "当前筛选下没有承诺" }}</div>
                    <div class="text-[11px] leading-relaxed text-[var(--text-muted)]">{{ promises.length === 0 ? "承诺是对读者的债务:许下 → 埋设 → 推进 → 兑现。" : "换一个状态或重要性筛选试试。" }}</div>
                    <button v-if="promises.length === 0" type="button" class="mt-1 inline-flex h-7 items-center gap-1 rounded-md border border-transparent bg-[var(--accent-main)] px-3 text-[11px] font-medium text-[var(--text-inverse)] transition-all hover:opacity-90" @click="openCreateEditor">
                        <span class="i-lucide-plus h-3 w-3"></span>
                        许下第一个承诺
                    </button>
                </div>

                <div v-else class="space-y-1">
                    <button
                        v-for="promise in visiblePromises"
                        :key="promise.id"
                        type="button"
                        class="w-full rounded-md border px-2.5 py-2 text-left transition-colors"
                        :class="selectedPromiseId === promise.id ? 'border-[var(--border-accent)] bg-[var(--accent-bg)]' : 'border-transparent hover:border-[var(--border-color)] hover:bg-[var(--bg-hover)]'"
                        @click="selectPromise(promise.id)"
                    >
                        <!-- 行首:状态点 + 标题 + 派生阶段 + 重要性 -->
                        <div class="flex min-w-0 items-center gap-2">
                            <span class="h-2 w-2 shrink-0 rounded-full" :class="PLANNING_TONE_CLASSES[PROMISE_STATUS_META[promise.status].tone].dot" :title="PROMISE_STATUS_META[promise.status].label"></span>
                            <span class="min-w-0 flex-1 truncate text-[12px] font-semibold text-[var(--text-main)]">{{ promise.title }}</span>
                            <span class="shrink-0 rounded-full px-1.5 py-0.5 text-[10px]" :class="PLANNING_TONE_CLASSES[PROMISE_DERIVED_STAGE_META[promise.derivedStage].tone].chip">{{ PROMISE_DERIVED_STAGE_META[promise.derivedStage].label }}</span>
                            <span class="shrink-0 rounded-full px-1.5 py-0.5 text-[10px]" :class="PLANNING_TONE_CLASSES[PROMISE_IMPORTANCE_META[promise.importance].tone].chip">{{ PROMISE_IMPORTANCE_META[promise.importance].label }}</span>
                        </div>
                        <!-- 行尾:节拍四类计数 + planned/factual 分色微标 + 期限章 -->
                        <div class="mt-1.5 flex min-w-0 items-center gap-2.5 text-[10px] text-[var(--text-muted)]">
                            <span class="flex shrink-0 items-center gap-1.5">
                                <span v-for="[kind, meta] in beatKindEntries" :key="kind" class="inline-flex items-center gap-0.5" :class="promise.beatStats[kind] === 0 ? 'opacity-40' : ''" :title="`${meta.label} × ${promise.beatStats[kind]}`">
                                    <span class="h-3 w-3" :class="meta.iconClass"></span>
                                    {{ promise.beatStats[kind] }}
                                </span>
                            </span>
                            <span class="inline-flex shrink-0 items-center gap-0.5 text-[var(--status-warning)]" :class="promise.beatStats.planned === 0 ? 'opacity-40' : ''" :title="`计划节拍 × ${promise.beatStats.planned}`">
                                <span class="h-1.5 w-1.5 rounded-full bg-[var(--status-warning)]"></span>
                                {{ promise.beatStats.planned }}
                            </span>
                            <span class="inline-flex shrink-0 items-center gap-0.5 text-[var(--status-success)]" :class="promise.beatStats.factual === 0 ? 'opacity-40' : ''" :title="`事实节拍 × ${promise.beatStats.factual}`">
                                <span class="h-1.5 w-1.5 rounded-full bg-[var(--status-success)]"></span>
                                {{ promise.beatStats.factual }}
                            </span>
                            <span v-if="promise.deadlineChapterId" class="ml-auto inline-flex min-w-0 items-center gap-0.5" :class="promise.deadlineChapter ? '' : 'text-[var(--status-danger)]'" :title="`兑现期限:${deadlineLabel(promise)}`">
                                <span class="i-lucide-flag h-3 w-3 shrink-0"></span>
                                <span class="truncate">{{ deadlineLabel(promise) }}</span>
                            </span>
                        </div>
                    </button>
                </div>
            </div>
        </aside>

        <!-- 右:详情区 -->
        <PlotPromiseDetailPane
            :detail="detail"
            :loading="detailLoading"
            :error="detailError"
            :chapters="props.chapters"
            @edit="openEditEditor"
            @add-beat="openBeatDialog"
            @change-status="changeStatus"
            @delete="deletePromise"
            @remove-beat="removeBeat"
            @select-scene="(sceneId) => emit('selectScene', sceneId)"
        />

        <!-- 承诺编辑 / 节拍对话框 -->
        <PlotPromiseEditorDialog
            :visible="editorVisible"
            :mode="editorMode"
            :promise="editingPromise"
            :chapters="props.chapters"
            :saving="savingEditor"
            :error="editorError"
            @update:visible="editorVisible = $event"
            @save="saveEditor"
        />
        <PlotPromiseBeatDialog
            :visible="beatDialogVisible"
            :promise="detail"
            :threads="props.threads"
            :scenes="props.scenes"
            :chapters="props.chapters"
            :saving="savingBeat"
            :error="beatError"
            @update:visible="beatDialogVisible = $event"
            @save="saveBeat"
        />
    </div>
</template>

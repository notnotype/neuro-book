<script setup lang="ts">
import {computed, onMounted, ref, watch} from "vue";
import type {SubjectStateDto, WorldStateDto, WorldSubjectDto} from "nbook/app/components/novel-ide/world-engine/world-engine-workbench.types";
import RpCharacterPanel from "nbook/app/components/novel-ide/rp/RpCharacterPanel.vue";
import RpEventPanel from "nbook/app/components/novel-ide/rp/RpEventPanel.vue";
import RpMapPanel from "nbook/app/components/novel-ide/rp/RpMapPanel.vue";
import RpStatusPanel from "nbook/app/components/novel-ide/rp/RpStatusPanel.vue";
import RpTimelineWindow from "nbook/app/components/novel-ide/rp/RpTimelineWindow.vue";
import RpUpdateWindow from "nbook/app/components/novel-ide/rp/RpUpdateWindow.vue";
import {buildRpMapGraph, buildRpRelationGraph} from "nbook/app/components/novel-ide/rp/rp-graph";
import {useNotification} from "nbook/app/composables/useNotification";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {formatStateValue} from "nbook/app/utils/world-engine-state-view";
import type {JsonValue} from "nbook/app/utils/world-engine-preview";
import type {RpConsistencyLevelDto, RpConsistencyReportDto, RpEventActionRequestDto, RpIntakeOverviewDto, RpRunIntensityDto, RpRuntimeOverviewDto} from "nbook/shared/dto/rp-runtime.dto";

/** RP 左侧运行中心：聚合运行状态、事件、地图与角色四个玩家视图。 */
const props = defineProps<{
    projectPath: string;
}>();

const emit = defineEmits<{
    (e: "timeline-restored"): void;
    (e: "intake-confirmed", payload: {version: number}): void;
}>();

type RpSidebarTab = "status" | "events" | "map" | "characters";

const notification = useNotification();
const activeTab = ref<RpSidebarTab>("status");
const loading = ref(false);
const loadError = ref("");
const eventBusy = ref(false);
const intensityBusy = ref(false);
const intakeConfirmBusy = ref(false);
const consistencyBusy = ref(false);
const updateWindowOpen = ref(false);
const timelineWindowOpen = ref(false);
const runtime = ref<RpRuntimeOverviewDto | null>(null);
/** null 表示尚未完成状态查询；false 是引导期的正常状态。 */
const rpInitialized = ref<boolean | null>(null);
const rpMissing = ref<string[]>([]);
const rpConfigErrors = ref<Array<{path: string; message: string}>>([]);
const stateResult = ref<WorldStateDto | null>(null);
const subjects = ref<WorldSubjectDto[]>([]);

/** 同时刷新 RP 运行聚合与 World Engine 客观状态。 */
async function refresh(): Promise<void> {
    if (!props.projectPath) return;
    loading.value = true;
    loadError.value = "";
    const errors: string[] = [];
    try {
        runtime.value = await $fetch<RpRuntimeOverviewDto>("/api/projects/rp/overview", {query: {projectPath: props.projectPath}});
    } catch (error) {
        runtime.value = null;
        errors.push(resolveApiErrorMessage(error, "RP 运行概况加载失败"));
    }
    try {
        const query = {projectPath: props.projectPath, worldKey: "rp"};
        const status = await $fetch<{initialized: boolean; missing: string[]; errors: Array<{path: string; message: string}>}>("/api/projects/world-engine/status", {query});
        rpInitialized.value = status.initialized;
        rpMissing.value = status.missing;
        rpConfigErrors.value = status.errors;
        errors.push(...status.errors.map((problem) => `${problem.path}：${problem.message}`));
        if (status.initialized) {
            const [nextState, nextSubjects] = await Promise.all([
                $fetch<WorldStateDto>("/api/projects/world-engine/state", {query}),
                $fetch<WorldSubjectDto[]>("/api/projects/world-engine/subjects", {query}),
            ]);
            stateResult.value = nextState;
            subjects.value = nextSubjects;
        } else {
            stateResult.value = null;
            subjects.value = [];
        }
    } catch (error) {
        rpInitialized.value = null;
        rpConfigErrors.value = [];
        stateResult.value = null;
        subjects.value = [];
        errors.push(resolveApiErrorMessage(error, "RP 世界状态加载失败"));
    } finally {
        loadError.value = errors.join("；");
        loading.value = false;
    }
}

onMounted(() => void refresh());
watch(() => props.projectPath, () => void refresh());
defineExpose({refresh});

const subjectNameMap = computed(() => new Map(subjects.value.map((subject) => [subject.id, subject.name || subject.id])));
const worldState = computed<SubjectStateDto | null>(() => stateResult.value?.subjects.find((state) => state.type === "world") ?? null);
const subjectCounts = computed(() => {
    const counts = new Map<string, number>();
    for (const subject of subjects.value) counts.set(subject.type, (counts.get(subject.type) ?? 0) + 1);
    return [...counts].map(([type, count]) => ({type, count}));
});
const worldAttrs = computed(() => worldState.value ? visibleAttrs(worldState.value) : []);
const mapGraph = computed(() => buildRpMapGraph(runtime.value?.map ?? null));
const relationGraph = computed(() => buildRpRelationGraph(runtime.value?.characters ?? [], runtime.value?.relations ?? []));

/** 提取玩家可见的 World Engine 属性。 */
function visibleAttrs(state: SubjectStateDto): Array<{name: string; text: string}> {
    return Object.entries(state.attrs)
        .filter(([name]) => name !== "secret")
        .map(([name, value]) => ({name, text: renderAttrText(value)}));
}

/** 将 World Engine 值压缩成侧栏文本。 */
function renderAttrText(value: JsonValue | undefined): string {
    if (Array.isArray(value)) {
        const parts = value.slice(0, 6).map((item) => typeof item === "string" ? subjectNameMap.value.get(stripRef(item)) ?? item : formatStateValue(item));
        return parts.join("、") + (value.length > 6 ? ` 等${value.length}项` : "");
    }
    if (typeof value === "string") return subjectNameMap.value.get(stripRef(value)) ?? value;
    return formatStateValue(value);
}

/** 解除 World Engine subject 引用前缀。 */
function stripRef(value: string): string {
    return value.startsWith("subject://") ? value.slice("subject://".length) : value;
}

/** 不调用 Agent，直接写入下一回合读取的运行强度变量。 */
async function changeIntensity(intensity: RpRunIntensityDto): Promise<void> {
    if (intensityBusy.value || runtime.value?.intensity === intensity) return;
    intensityBusy.value = true;
    try {
        await $fetch("/api/projects/rp/intensity", {method: "PATCH", query: {projectPath: props.projectPath}, body: {intensity}});
        if (runtime.value) runtime.value = {...runtime.value, intensity};
        notification.success("运行强度已切换");
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "运行强度切换失败"), {title: "切换失败"});
    } finally {
        intensityBusy.value = false;
    }
}

/**
 * 从左侧状态页确认玩家当前看到的企划版本。
 * 成功后只记录确认并通知宿主续跑 leader；Bootstrap 仍由 leader 通过硬门禁执行。
 */
async function confirmIntake(version: number): Promise<void> {
    if (intakeConfirmBusy.value || runtime.value?.intake.phase !== "reviewing") return;
    intakeConfirmBusy.value = true;
    try {
        const intake = await $fetch<RpIntakeOverviewDto>("/api/projects/rp/intake-confirm", {
            method: "POST",
            query: {projectPath: props.projectPath},
            body: {version, confirmed: true},
        });
        if (runtime.value) runtime.value = {...runtime.value, intake};
        notification.success(`开团企划 v${version} 已确认`, {title: "确认成功"});
        emit("intake-confirmed", {version});
    } catch (error) {
        await refresh();
        notification.error(resolveApiErrorMessage(error, "开团企划确认失败"), {title: "确认失败"});
    } finally {
        intakeConfirmBusy.value = false;
    }
}

/** 执行玩家对候选事件的明确操作，成功后重新读取服务端真相源。 */
async function runEventAction(action: RpEventActionRequestDto): Promise<void> {
    if (eventBusy.value) return;
    eventBusy.value = true;
    try {
        await $fetch("/api/projects/rp/events", {method: "POST", query: {projectPath: props.projectPath}, body: action});
        await refresh();
        const messages: Record<RpEventActionRequestDto["op"], string> = {save: "事件已保留", discard: "事件已放弃", select: "已选择事件入口", random_select: "已完成随机选择"};
        notification.success(messages[action.op]);
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "事件操作失败"), {title: "操作失败"});
    } finally {
        eventBusy.value = false;
    }
}

/** 按玩家选择运行一致性检查；报告正文留在项目文件，侧栏只更新摘要。 */
async function runConsistency(level: RpConsistencyLevelDto): Promise<void> {
    if (consistencyBusy.value) return;
    consistencyBusy.value = true;
    try {
        const report = await $fetch<RpConsistencyReportDto>("/api/projects/rp/consistency", {
            method: "POST", query: {projectPath: props.projectPath}, body: {level, repairSafe: true},
        });
        if (runtime.value) runtime.value = {...runtime.value, consistency: report};
        const message = report.status === "healthy" ? "世界一致性检查通过" : report.status === "warning" ? "一致性检查发现警告" : "一致性检查发现阻断问题";
        report.status === "healthy" ? notification.success(message) : report.status === "warning" ? notification.warning(message) : notification.error(message, {title: "需要处理"});
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "一致性检查失败"), {title: "检查失败"});
    } finally {
        consistencyBusy.value = false;
    }
}

const TABS: Array<{key: RpSidebarTab; label: string; icon: string}> = [
    {key: "status", label: "状态", icon: "i-lucide-activity"},
    {key: "events", label: "事件", icon: "i-lucide-sparkles"},
    {key: "map", label: "地图", icon: "i-lucide-map"},
    {key: "characters", label: "角色", icon: "i-lucide-users"},
];
</script>

<template>
    <!-- RP 侧栏：四个玩家视图共用同一运行聚合 -->
    <div class="flex h-full min-h-0 flex-col bg-[var(--bg-panel)]">
        <div class="flex shrink-0 items-center gap-0.5 border-b border-[var(--border-color)] px-1.5 py-1.5">
            <button v-for="tab in TABS" :key="tab.key" type="button" class="inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-md text-[11px] transition-colors" :class="activeTab === tab.key ? 'bg-[var(--accent-bg)] font-medium text-[var(--accent-text)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'" @click="activeTab = tab.key">
                <span :class="tab.icon" class="h-3.5 w-3.5 shrink-0"></span><span class="truncate">{{ tab.label }}</span>
                <span v-if="tab.key === 'events' && runtime?.events.items.some((event) => event.origin === 'candidate' && ['available', 'saved'].includes(event.status))" class="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--status-warning)]"></span>
            </button>
            <button type="button" class="inline-flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" title="刷新" @click="void refresh()"><span :class="loading ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-refresh-cw'" class="h-3.5 w-3.5"></span></button>
        </div>

        <div v-if="loadError" class="shrink-0 border-b border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-[10px] text-[var(--status-danger)]">{{ loadError }}</div>
        <div v-if="rpInitialized === false && rpConfigErrors.length === 0" class="shrink-0 border-b border-[var(--status-info-border)] bg-[var(--status-info-bg)] px-3 py-2 text-[10px] leading-relaxed text-[var(--status-info)]">
            {{ runtime?.intake.phase === "reviewing" ? "开团企划已完成，请在状态页确认后开始。" : runtime?.intake.phase === "confirmed" || runtime?.intake.phase === "bootstrapping" ? "开团企划已确认，正在建立 RP 世界线。" : "RP 世界线尚未初始化，可继续在对话中完成开局引导。" }}<span v-if="rpMissing.length">；待创建：{{ rpMissing.join("、") }}</span>
        </div>

        <RpStatusPanel v-if="activeTab === 'status'" :overview="runtime" :current-time="stateResult?.time ?? null" :world-attrs="worldAttrs" :subject-counts="subjectCounts" :intake-confirm-busy="intakeConfirmBusy" :consistency-busy="consistencyBusy" @confirm-intake="void confirmIntake($event)" @change-intensity="void changeIntensity($event)" @run-consistency="void runConsistency($event)" @open-updates="updateWindowOpen = true" @open-timeline="timelineWindowOpen = true" />
        <RpEventPanel v-else-if="activeTab === 'events'" :events="runtime?.events ?? null" :busy="eventBusy" @action="void runEventAction($event)" />
        <RpMapPanel v-else-if="activeTab === 'map'" :map="runtime?.map ?? null" :graph="mapGraph" />
        <RpCharacterPanel v-else :roster="runtime?.roster ?? null" :characters="runtime?.characters ?? []" :graph="relationGraph" />

        <RpUpdateWindow v-model="updateWindowOpen" :project-path="projectPath" />
        <RpTimelineWindow v-model="timelineWindowOpen" :project-path="projectPath" @restored="emit('timeline-restored')" />
    </div>
</template>

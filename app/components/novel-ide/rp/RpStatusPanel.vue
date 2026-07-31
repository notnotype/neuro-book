<script setup lang="ts">
import {computed} from "vue";
import type {RpConsistencyLevelDto, RpRunIntensityDto, RpRuntimeOverviewDto} from "nbook/shared/dto/rp-runtime.dto";

const props = defineProps<{
    overview: RpRuntimeOverviewDto | null;
    currentTime: string | null;
    worldAttrs: Array<{name: string; text: string}>;
    subjectCounts: Array<{type: string; count: number}>;
    intakeConfirmBusy: boolean;
    consistencyBusy: boolean;
}>();

const emit = defineEmits<{
    (e: "change-intensity", intensity: RpRunIntensityDto): void;
    (e: "open-updates"): void;
    (e: "open-timeline"): void;
    (e: "confirm-intake", version: number): void;
    (e: "run-consistency", level: RpConsistencyLevelDto): void;
}>();

const intensityItems: Array<{value: RpRunIntensityDto; label: string; description: string}> = [
    {value: "light", label: "轻量", description: "更少的后台推演"},
    {value: "standard", label: "标准", description: "平衡推进与细节"},
    {value: "deep", label: "深入", description: "更多角色与世界演算"},
];

const stageLabels: Record<string, string> = {
    action_understanding: "理解行动",
    world_snapshot: "读取世界",
    condition_check: "条件检查",
    screenwriter_plan: "编排事件",
    actor_proposals: "角色反应",
    conflict_resolution: "解决冲突",
    adjudication: "规则裁定",
    narrative: "生成叙事",
    world_commit: "提交世界",
    ui_update: "更新界面",
};

const focusCounts = computed(() => {
    const counts = {current: 0, active_background: 0, low_frequency: 0, dormant: 0, pinned: 0};
    for (const object of props.overview?.focusObjects ?? []) {
        counts[object.level] += 1;
        if (object.pinned) counts.pinned += 1;
    }
    return counts;
});

const unresolvedFailures = computed(() => props.overview?.pipeline?.failures.filter((failure) => !failure.resolved) ?? []);

const intakePhaseLabels: Record<string, string> = {
    empty: "尚未开始",
    source_selected: "已选择来源",
    premise_ready: "世界前提已确定",
    avatar_ready: "化身已确定",
    play_style_ready: "游玩方式已确定",
    systems_ready: "系统规则已确定",
    boundaries_ready: "内容边界已确定",
    opening_ready: "等待最终审阅",
    reviewing: "等待玩家确认",
    confirmed: "企划已确认",
    bootstrapping: "正在初始化",
    active: "冒险进行中",
};

const intakePhaseLabel = computed(() => {
    const phase = props.overview?.intake.phase;
    return phase ? intakePhaseLabels[phase] ?? phase : "未初始化";
});

const bootstrapStageLabels: Record<string, string> = {
    config: "配置与世界材料",
    world: "世界状态",
    map: "初始地图",
    characters: "角色档案",
    opening_event: "开场事件",
    narrative: "开场正文",
    ready_to_activate: "最终验收",
    complete: "已完成",
};

const bootstrapStageLabel = computed(() => {
    const stage = props.overview?.intake.bootstrap.stage;
    return stage ? bootstrapStageLabels[stage] ?? stage : "尚未开始";
});

/** 将 ISO 时间压缩成侧栏可读格式。 */
function formatDateTime(value: string | null | undefined): string {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
</script>

<template>
    <!-- RP 状态总览 -->
    <div class="min-h-0 flex-1 overflow-y-auto p-3 custom-scrollbar">
        <div class="mb-3 grid grid-cols-2 gap-2">
            <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2">
                <div class="text-[10px] text-[var(--text-muted)]">世界时间</div>
                <div class="mt-1 truncate font-mono text-[12px] text-[var(--text-main)]" :title="currentTime ?? ''">{{ currentTime ?? "尚未记录" }}</div>
            </div>
            <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2">
                <div class="text-[10px] text-[var(--text-muted)]">引导状态</div>
                <div class="mt-1 truncate text-[12px] text-[var(--text-main)]">{{ intakePhaseLabel }}</div>
            </div>
        </div>

        <!-- 玩家专属开团确认：由持久 reviewing + version 驱动，不依赖 Agent pending 表单。 -->
        <section v-if="overview?.intake.phase === 'reviewing'" class="mb-3 rounded-md border border-[var(--accent-main)] bg-[var(--accent-bg)] p-3">
            <div class="flex items-start gap-2.5">
                <span class="i-lucide-flag h-4 w-4 shrink-0 text-[var(--accent-main)]"></span>
                <div class="min-w-0 flex-1">
                    <div class="text-[12px] font-semibold text-[var(--text-main)]">开团企划已完成</div>
                    <div class="mt-1 text-[10px] leading-relaxed text-[var(--text-secondary)]">请确认聊天中展示的企划 v{{ overview.intake.version }}。确认后，主持才会开始建立正式世界与开场。</div>
                    <button
                        type="button"
                        data-testid="rp-confirm-intake-button"
                        class="mt-2.5 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-[var(--accent-main)] px-3 text-[11px] font-semibold text-[var(--text-inverse)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                        :disabled="intakeConfirmBusy"
                        @click="emit('confirm-intake', overview.intake.version)"
                    >
                        <span :class="intakeConfirmBusy ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-play'" class="h-3.5 w-3.5"></span>
                        <span>{{ intakeConfirmBusy ? "正在确认…" : "确认并开团" }}</span>
                    </button>
                </div>
            </div>
        </section>

        <section v-else-if="overview?.intake.phase === 'confirmed'" class="mb-3 rounded-md border border-[var(--status-success-border)] bg-[var(--status-success-bg)] p-2.5">
            <div class="text-[11px] font-semibold text-[var(--status-success)]">企划 v{{ overview.intake.version }} 已由玩家确认</div>
            <div v-if="overview.intake.bootstrap.error" class="mt-1 text-[10px] leading-relaxed text-[var(--text-secondary)]">初始化在“{{ overview.intake.bootstrap.error.stage }}”阶段失败：{{ overview.intake.bootstrap.error.message }}。主持可按原版本重试。</div>
            <div v-else class="mt-1 text-[10px] text-[var(--text-secondary)]">正在等待主持继续初始化，无需重复确认。</div>
        </section>

        <section v-else-if="overview?.intake.phase === 'bootstrapping'" class="mb-3 rounded-md border border-[var(--status-info-border)] bg-[var(--status-info-bg)] p-2.5">
            <div class="flex items-center justify-between gap-2">
                <div class="text-[11px] font-semibold" :class="overview.intake.bootstrap.status === 'failed' ? 'text-[var(--status-danger)]' : 'text-[var(--status-info)]'">{{ overview.intake.bootstrap.status === 'failed' ? '初始化需要修正' : '正在建立 RP 世界线' }}</div>
                <div class="font-mono text-[9px] text-[var(--text-muted)]">{{ overview.intake.bootstrap.completedStages.length }} / 6</div>
            </div>
            <div class="mt-1 text-[10px] text-[var(--text-secondary)]">当前阶段：{{ bootstrapStageLabel }}</div>
            <div v-if="overview.intake.bootstrap.error" class="mt-1.5 rounded border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-2 py-1.5 text-[10px] leading-relaxed text-[var(--status-danger)]">{{ overview.intake.bootstrap.error.message }}。主持修正当前阶段后会直接重试，无需重新确认。</div>
            <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--bg-input)]"><div class="h-full rounded-full bg-[var(--status-info)] transition-[width]" :style="{width: `${overview.intake.bootstrap.completedStages.length / 6 * 100}%`}"></div></div>
            <div class="mt-1.5 text-[9px] leading-relaxed text-[var(--text-muted)]">开场正文会在全部阶段通过服务端验收后发布。</div>
        </section>

        <!-- 当前运行进度 -->
        <section class="mb-3 rounded-md border border-[var(--border-color)] p-2.5">
            <div class="flex items-center justify-between gap-2">
                <div class="text-[12px] font-semibold text-[var(--text-main)]">运行进度</div>
                <span v-if="overview?.currentTurn" class="font-mono text-[10px] text-[var(--text-muted)]">#{{ overview.currentTurn.sequence }} · {{ overview.currentTurn.status }}</span>
            </div>
            <div v-if="overview?.pipeline" class="mt-2">
                <div class="mb-1 flex items-center justify-between text-[11px]">
                    <span class="text-[var(--accent-text)]">{{ stageLabels[overview.pipeline.stage] ?? overview.pipeline.stage }}</span>
                    <span class="text-[var(--text-muted)]">{{ overview.pipeline.stageIndex }} / {{ overview.pipeline.stageCount }}</span>
                </div>
                <div class="h-1.5 overflow-hidden rounded-full bg-[var(--bg-input)]">
                    <div class="h-full rounded-full bg-[var(--accent-main)] transition-[width]" :style="{width: `${overview.pipeline.stageIndex / overview.pipeline.stageCount * 100}%`}"></div>
                </div>
                <div v-if="overview.pipeline.stageHistory.length" class="mt-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                    {{ overview.pipeline.stageHistory.at(-1)?.publicSummary }}
                </div>
            </div>
            <div v-else class="mt-2 text-[11px] text-[var(--text-muted)]">当前没有正在运行的回合。</div>
            <div v-if="overview?.currentTurn" class="mt-2 border-t border-[var(--border-color)] pt-2 text-[11px] text-[var(--text-secondary)]">
                <div class="line-clamp-2">{{ overview.currentTurn.inputSummary }}</div>
                <div class="mt-1 text-[10px] text-[var(--text-muted)]">更新于 {{ formatDateTime(overview.currentTurn.updatedAt) }}</div>
            </div>
        </section>

        <!-- 可恢复失败 -->
        <section v-if="unresolvedFailures.length" class="mb-3 rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] p-2.5">
            <div class="text-[12px] font-semibold text-[var(--status-danger)]">运行遇到问题</div>
            <div v-for="failure in unresolvedFailures" :key="failure.id" class="mt-2 text-[11px] text-[var(--text-secondary)]">
                <div>{{ stageLabels[failure.stage] ?? failure.stage }}：{{ failure.message }}</div>
                <div v-if="failure.recoveryOptions.length" class="mt-1 text-[var(--text-muted)]">可选处理：{{ failure.recoveryOptions.join("；") }}</div>
            </div>
        </section>

        <!-- P9 一致性状态：详细更新落盘，侧栏只保留可操作摘要。 -->
        <section class="mb-3 rounded-md border border-[var(--border-color)] p-2.5">
            <div class="flex items-center justify-between gap-2">
                <div class="text-[12px] font-semibold text-[var(--text-main)]">世界一致性</div>
                <span
                    v-if="overview?.consistency"
                    class="rounded px-1.5 py-0.5 text-[9px]"
                    :class="overview.consistency.status === 'healthy' ? 'bg-[var(--status-success-bg)] text-[var(--status-success)]' : overview.consistency.status === 'warning' ? 'bg-[var(--status-warning-bg)] text-[var(--status-warning)]' : 'bg-[var(--status-danger-bg)] text-[var(--status-danger)]'"
                >{{ overview.consistency.status === "healthy" ? "正常" : overview.consistency.status === "warning" ? "有警告" : "已阻断" }}</span>
                <span v-else class="text-[9px] text-[var(--text-muted)]">尚未检查</span>
            </div>
            <div v-if="overview?.consistency" class="mt-1.5 text-[10px] leading-relaxed text-[var(--text-secondary)]">
                {{ overview.consistency.level }} · {{ overview.consistency.issues.length }} 个问题 · {{ overview.consistency.repaired.length }} 个安全修复
                <div v-if="overview.consistency.issues.length" class="mt-1 line-clamp-2 text-[var(--text-muted)]">{{ overview.consistency.issues[0]?.message }}</div>
                <div v-if="overview.consistency.issues[0]?.resolutionOptions?.length" class="mt-1 text-[var(--status-warning)]">需玩家选择：{{ overview.consistency.issues[0].resolutionOptions?.join(" / ") }}</div>
            </div>
            <div class="mt-2 grid grid-cols-3 gap-1.5">
                <button v-for="level in (['light', 'standard', 'deep'] as const)" :key="level" type="button" class="rounded border border-[var(--border-color)] py-1 text-[9px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40" :disabled="consistencyBusy" @click="emit('run-consistency', level)">{{ level === "light" ? "轻量" : level === "standard" ? "标准" : "深入" }}</button>
            </div>
        </section>

        <!-- 运行强度 -->
        <section class="mb-3 rounded-md border border-[var(--border-color)] p-2.5">
            <div class="mb-2 text-[12px] font-semibold text-[var(--text-main)]">运行强度</div>
            <div class="grid grid-cols-3 gap-1.5">
                <button
                    v-for="item in intensityItems"
                    :key="item.value"
                    type="button"
                    class="rounded-md border px-1.5 py-1.5 text-center transition-colors"
                    :class="overview?.intensity === item.value ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'"
                    :title="item.description"
                    :disabled="!overview"
                    @click="emit('change-intensity', item.value)"
                >
                    <span class="text-[11px]">{{ item.label }}</span>
                </button>
            </div>
        </section>

        <!-- 运行概况 -->
        <section class="mb-3 rounded-md border border-[var(--border-color)] p-2.5">
            <div class="mb-2 flex items-center justify-between">
                <div class="text-[12px] font-semibold text-[var(--text-main)]">运行概况</div>
                <div class="flex items-center gap-2"><button type="button" class="text-[10px] text-[var(--accent-text)] hover:underline" @click="emit('open-updates')">世界更新</button><button type="button" class="text-[10px] text-[var(--accent-text)] hover:underline" @click="emit('open-timeline')">切片树</button></div>
            </div>
            <div class="grid grid-cols-3 gap-1.5 text-center">
                <div class="rounded bg-[var(--bg-input)] px-1 py-1.5"><div class="text-[13px] text-[var(--text-main)]">{{ overview?.counts.committedTurns ?? 0 }}</div><div class="text-[9px] text-[var(--text-muted)]">已完成</div></div>
                <div class="rounded bg-[var(--bg-input)] px-1 py-1.5"><div class="text-[13px] text-[var(--text-main)]">{{ overview?.counts.incompleteTurns ?? 0 }}</div><div class="text-[9px] text-[var(--text-muted)]">处理中</div></div>
                <div class="rounded bg-[var(--bg-input)] px-1 py-1.5"><div class="text-[13px] text-[var(--text-main)]">{{ overview?.counts.failedTurns ?? 0 }}</div><div class="text-[9px] text-[var(--text-muted)]">失败</div></div>
            </div>
            <div class="mt-2 flex flex-wrap gap-1 text-[10px] text-[var(--text-secondary)]">
                <span class="rounded bg-[var(--bg-input)] px-1.5 py-0.5">当前 {{ focusCounts.current }}</span>
                <span class="rounded bg-[var(--bg-input)] px-1.5 py-0.5">后台 {{ focusCounts.active_background }}</span>
                <span class="rounded bg-[var(--bg-input)] px-1.5 py-0.5">低频 {{ focusCounts.low_frequency }}</span>
                <span class="rounded bg-[var(--bg-input)] px-1.5 py-0.5">休眠 {{ focusCounts.dormant }}</span>
                <span v-if="focusCounts.pinned" class="rounded bg-[var(--accent-bg)] px-1.5 py-0.5 text-[var(--accent-text)]">固定 {{ focusCounts.pinned }}</span>
            </div>
        </section>

        <!-- 资源与世界摘要 -->
        <section v-if="overview?.resources.length" class="mb-3 rounded-md border border-[var(--border-color)] p-2.5">
            <div class="mb-1.5 text-[12px] font-semibold text-[var(--text-main)]">资源</div>
            <div v-for="resource in overview.resources" :key="resource.accountId" class="flex items-center justify-between gap-2 py-0.5 text-[11px]">
                <span class="truncate text-[var(--text-secondary)]">{{ resource.label }}</span>
                <span class="font-mono text-[var(--text-main)]">{{ resource.value }} {{ resource.unit }}<span v-if="resource.band" class="ml-1 text-[var(--text-muted)]">· {{ resource.band }}</span></span>
            </div>
        </section>

        <section v-if="worldAttrs.length || subjectCounts.length" class="rounded-md border border-[var(--border-color)] p-2.5">
            <div class="mb-1.5 text-[12px] font-semibold text-[var(--text-main)]">世界状态</div>
            <div v-for="attr in worldAttrs" :key="attr.name" class="flex items-baseline gap-2 py-0.5 text-[11px]"><span class="shrink-0 text-[var(--text-muted)]">{{ attr.name }}</span><span class="min-w-0 truncate text-[var(--text-main)]" :title="attr.text">{{ attr.text }}</span></div>
            <div class="mt-2 flex flex-wrap gap-1">
                <span v-for="item in subjectCounts" :key="item.type" class="rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">{{ item.type }} × {{ item.count }}</span>
            </div>
        </section>
    </div>
</template>

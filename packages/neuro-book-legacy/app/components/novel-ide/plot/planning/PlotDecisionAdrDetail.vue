<script setup lang="ts">
// 决策 ADR 详情主体:按 ADR 阅读顺序分段渲染 —— 待决问题 → 候选方案 → 结论/动机/风险 → 否决记录 → 引用 → 取代链 → 备注。
// 只做只读展示与 tab 内跳转(取代链)/跨 tab 跳转(scene 引用),操作按钮在宿主 tab 的详情头部。
import {computed} from "vue";
import {
    refTargetDisplayName,
    refTargetSceneId,
    type PlanningNameMaps,
} from "nbook/app/components/novel-ide/plot/planning/plot-decision-view";
import {PLANNING_TONE_CLASSES} from "nbook/app/components/novel-ide/plot/planning/plot-planning.types";
import type {StoryDecisionDto} from "nbook/shared/dto/plot.dto";

const props = defineProps<{
    decision: StoryDecisionDto;
    // 实体 id → 可读名索引(宿主 tab 构建,列表行与详情共用)。
    nameMaps: PlanningNameMaps;
}>();

const emit = defineEmits<{
    // 跨 tab 跳转:宿主负责切回线程规划 tab 并选中该场。
    (e: "selectScene", sceneId: string): void;
    // tab 内跳转:选中取代者决策。
    (e: "selectDecision", decisionId: string): void;
}>();

// 分段标题的统一样式(小型大写字距标签)。
const SECTION_LABEL_CLASS = "flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]";

// 拍板三段是否展示:数据驱动(任一非空)。decided 态恒非空;superseded 态保留拍板时的记录,同样可读。
const hasDecidedTrio = computed(() => {
    return props.decision.decision !== null || props.decision.motivation !== null || props.decision.risk !== null;
});

// serves/dependsOn 分组视图(空组不渲染)。
const refGroups = computed(() => {
    return [
        {label: "服务对象(serves)", icon: "i-lucide-target", rows: props.decision.serves},
        {label: "依赖前置(dependsOn)", icon: "i-lucide-git-branch", rows: props.decision.dependsOn},
    ].filter((group) => group.rows.length > 0);
});

// 「已被取代」链接目标;为空表示未被取代。取代者不在本地列表时回退显示 id。
const supersededBy = computed(() => {
    const targetId = props.decision.supersededById;
    if (!targetId) {
        return null;
    }
    return {id: targetId, title: props.nameMaps.decisionNames.get(targetId) ?? targetId};
});
</script>

<template>
    <!-- ADR 分段详情主体 -->
    <div class="space-y-4">
        <!-- §待决问题:ADR 的核心段,突出显示 -->
        <section class="rounded-lg border border-[var(--border-color)] border-l-[3px] border-l-[var(--accent-main)] bg-[var(--bg-panel)] px-3.5 py-3">
            <div :class="SECTION_LABEL_CLASS">
                <span class="i-lucide-circle-help h-3 w-3"></span>
                <span>待决问题</span>
            </div>
            <div class="mt-1.5 whitespace-pre-wrap text-[13px] font-medium leading-relaxed text-[var(--text-main)]">{{ props.decision.question }}</div>
        </section>

        <!-- §候选方案 -->
        <section v-if="props.decision.options.length > 0" class="space-y-1.5">
            <div :class="SECTION_LABEL_CLASS">
                <span class="i-lucide-list h-3 w-3"></span>
                <span>候选方案</span>
                <span class="font-normal normal-case tracking-normal">{{ props.decision.options.length }}</span>
            </div>
            <div v-for="(option, index) in props.decision.options" :key="index" class="flex items-start gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2">
                <span class="mt-px flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded bg-[var(--bg-hover)] text-[10px] font-semibold text-[var(--text-muted)]">{{ index + 1 }}</span>
                <div class="min-w-0">
                    <div class="text-[12px] leading-5 text-[var(--text-main)]">{{ option.option }}</div>
                    <div v-if="option.note" class="mt-0.5 text-[11px] leading-4 text-[var(--text-muted)]">{{ option.note }}</div>
                </div>
            </div>
        </section>

        <!-- §拍板三段:结论 / 动机 / 风险(risk=writer 刹车点,warning 色块) -->
        <template v-if="hasDecidedTrio">
            <section class="space-y-1.5">
                <div :class="SECTION_LABEL_CLASS">
                    <span class="i-lucide-gavel h-3 w-3"></span>
                    <span>结论(decision)</span>
                </div>
                <div class="whitespace-pre-wrap rounded-md border border-[var(--border-color)] border-l-[3px] border-l-[var(--status-success)] bg-[var(--bg-panel)] px-3 py-2 text-[12px] leading-5 text-[var(--text-main)]">{{ props.decision.decision ?? "(未填写)" }}</div>
            </section>
            <section class="space-y-1.5">
                <div :class="SECTION_LABEL_CLASS">
                    <span class="i-lucide-lightbulb h-3 w-3"></span>
                    <span>动机(motivation)</span>
                </div>
                <div class="whitespace-pre-wrap rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2 text-[12px] leading-5 text-[var(--text-secondary)]">{{ props.decision.motivation ?? "(未填写)" }}</div>
            </section>
            <section class="space-y-1.5">
                <div class="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--status-warning)]">
                    <span class="i-lucide-triangle-alert h-3 w-3"></span>
                    <span>风险(risk · writer 的刹车点)</span>
                </div>
                <div class="whitespace-pre-wrap rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-2 text-[12px] leading-5 text-[var(--status-warning)]">{{ props.decision.risk ?? "(未填写)" }}</div>
            </section>
        </template>

        <!-- §否决记录:whyRejected 为空的骨架条目标「待补理由」 -->
        <section v-if="props.decision.rejectedAlternatives.length > 0" class="space-y-1.5">
            <div :class="SECTION_LABEL_CLASS">
                <span class="i-lucide-circle-slash h-3 w-3"></span>
                <span>否决记录</span>
                <span class="font-normal normal-case tracking-normal">{{ props.decision.rejectedAlternatives.length }}</span>
            </div>
            <div v-for="(alternative, index) in props.decision.rejectedAlternatives" :key="index" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2">
                <div class="text-[12px] leading-5 text-[var(--text-main)]">{{ alternative.option }}</div>
                <div v-if="alternative.whyRejected" class="mt-1 text-[11px] leading-4 text-[var(--text-muted)]">{{ alternative.whyRejected }}</div>
                <span v-else class="mt-1 inline-flex items-center gap-1 rounded px-1.5 py-px text-[10px]" :class="PLANNING_TONE_CLASSES.warning.chip">
                    <span class="i-lucide-pen-line h-2.5 w-2.5"></span>
                    待补理由
                </span>
            </div>
        </section>

        <!-- §引用:serves / dependsOn(死引用删除线 + danger;scene:// 可跳回线程规划) -->
        <section v-for="refGroup in refGroups" :key="refGroup.label" class="space-y-1.5">
            <div :class="SECTION_LABEL_CLASS">
                <span class="h-3 w-3" :class="refGroup.icon"></span>
                <span>{{ refGroup.label }}</span>
                <span class="font-normal normal-case tracking-normal">{{ refGroup.rows.length }}</span>
            </div>
            <div v-for="refItem in refGroup.rows" :key="refItem.target" class="flex items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-1.5">
                <span class="i-lucide-link-2 h-3 w-3 shrink-0" :class="refItem.valid ? 'text-[var(--text-muted)]' : 'text-[var(--status-danger)]'"></span>
                <!-- scene:// 有效引用可点击跳转;其余按原文展示,死引用画删除线 -->
                <button v-if="refTargetSceneId(refItem.target, refItem.valid) !== null" type="button" class="min-w-0 truncate text-left font-mono text-[11px] text-[var(--accent-text)] underline decoration-dotted underline-offset-2 transition-opacity hover:opacity-80" title="跳到该场景(切回线程规划)" @click="emit('selectScene', refItem.target.slice('scene://'.length))">{{ refItem.target }}</button>
                <span v-else class="min-w-0 truncate font-mono text-[11px]" :class="refItem.valid ? 'text-[var(--text-secondary)]' : 'text-[var(--status-danger)] line-through'">{{ refItem.target }}</span>
                <span v-if="refTargetDisplayName(refItem.target, props.nameMaps)" class="min-w-0 truncate text-[11px] text-[var(--text-muted)]">{{ refTargetDisplayName(refItem.target, props.nameMaps) }}</span>
                <span v-if="!refItem.valid" class="ml-auto shrink-0 rounded px-1.5 py-px text-[10px]" :class="PLANNING_TONE_CLASSES.danger.chip">引用目标已删除</span>
            </div>
        </section>

        <!-- §取代链:v1 只读展示,点击在本 tab 内跳到取代者 -->
        <section v-if="supersededBy" class="space-y-1.5">
            <div :class="SECTION_LABEL_CLASS">
                <span class="i-lucide-corner-up-right h-3 w-3"></span>
                <span>已被取代</span>
            </div>
            <button type="button" class="flex w-full items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2 text-left transition-colors hover:border-[var(--accent-main)] hover:bg-[var(--bg-hover)]" @click="emit('selectDecision', supersededBy.id)">
                <span class="i-lucide-corner-up-right h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]"></span>
                <span class="min-w-0 truncate text-[12px] text-[var(--accent-text)] underline decoration-dotted underline-offset-2">{{ supersededBy.title }}</span>
                <span class="ml-auto shrink-0 text-[10px] text-[var(--text-muted)]">查看取代者</span>
            </button>
        </section>

        <!-- §备注:dropped 态承载失效原因 -->
        <section v-if="props.decision.note" class="space-y-1.5">
            <div :class="SECTION_LABEL_CLASS">
                <span class="i-lucide-sticky-note h-3 w-3"></span>
                <span>{{ props.decision.status === "dropped" ? "失效原因" : "备注" }}</span>
            </div>
            <div class="whitespace-pre-wrap rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2 text-[12px] leading-5 text-[var(--text-secondary)]">{{ props.decision.note }}</div>
        </section>
    </div>
</template>

<script setup lang="ts">
/** 资源管理器的结果区（同名 .md）。 */
import {IconButton} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";
import {computed} from "vue";

import type {BatchAction, Notice, OperationReport, Unknown} from "../controller";
import {actionText, itemText, noticeText} from "../feedback-text";
import {useExplorerText} from "../text";

const props = defineProps<{
    notice: Notice | null;
    /** 最近一次批量的逐项结果；全部成功时为 null。 */
    report?: OperationReport | null;
    /** 正在进行的批量：动作与项数。 */
    running?: {readonly action: BatchAction; readonly count: number} | null;
    /** 结果未知的批量：在放弃之前挡住批量动作。 */
    unknown?: Unknown | null;
}>();

const emit = defineEmits<{
    (event: "dismiss"): void;
    (event: "dismiss-report"): void;
    (event: "cancel"): void;
    (event: "recheck"): void;
    (event: "abandon"): void;
}>();

const port = useText();
const text = useExplorerText();

const noticeLine = computed(() => (props.notice === null ? "" : noticeText(port, props.notice)));

const reportView = computed(() => {
    const report = props.report;
    if (report == null) return null;
    const done = report.items.filter((item) => item.result.status === "done").length;
    return {
        title: text("feedback.report.title", {action: actionText(port, report.action), done, other: report.items.length - done}),
        items: report.items.map((item) => {
            const lines = [itemText(port, item.result)];
            if (item.result.status === "failed" && item.result.partial !== undefined) {
                for (const [key, range] of [["feedback.item.removed", item.result.partial.removed], ["feedback.item.residual", item.result.partial.residual]] as const) {
                    if (range === undefined) continue;
                    lines.push(range.truncated ? `${text(key, {paths: ""})}${text("feedback.item.omitted")}` : text(key, {paths: range.paths.join("、")}));
                }
            }
            return {address: item.target === null ? item.address : `${item.address} → ${item.target}`, status: item.result.status, lines};
        }),
        manifests: report.manifests.map((issue) => text("feedback.manifestNotUpdated", {action: actionText(port, report.action), path: issue.path, reason: issue.detail})),
        truncated: report.truncated,
    };
});
</script>

<template>
    <div v-if="notice !== null || reportView !== null || running || unknown" class="flex max-h-full min-h-0 flex-col gap-2 overflow-y-auto border-t border-[var(--divider)] px-3 py-2 text-xs text-[var(--text-secondary)]" data-explorer-feedback>
        <div v-if="running" class="flex items-center gap-2" role="status" data-explorer-running>
            <span class="i-lucide-loader-circle h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true"></span>
            <span class="min-w-0 flex-1">{{ text("feedback.running", {action: actionText(port, running.action), count: running.count}) }}</span>
            <button type="button" class="nb-ui-focus-ring rounded px-1.5 py-0.5 text-[var(--accent-text)] hover:bg-[var(--bg-hover)]" @click="emit('cancel')">{{ text("common.cancel") }}</button>
        </div>
        <div v-if="unknown" class="flex flex-col gap-1" role="alert" data-explorer-unknown>
            <div class="flex items-start gap-2">
                <span class="i-lucide-circle-help mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--status-warning)]" aria-hidden="true"></span>
                <p class="min-w-0 flex-1 break-words text-[var(--text-main)]">{{ text("feedback.unknown.title", {action: actionText(port, unknown.action), count: unknown.items.length}) }}</p>
            </div>
            <!-- 按钮紧跟说明：受影响项多时列表在限高的结果区里滚动，动作不被推出视野。 -->
            <p class="pl-5">{{ text("feedback.unknown.hint") }}</p>
            <div class="flex flex-wrap gap-2 pl-5">
                <button type="button" class="nb-ui-focus-ring rounded px-1.5 py-0.5 text-[var(--accent-text)] hover:bg-[var(--bg-hover)]" data-explorer-recheck @click="emit('recheck')">{{ text("feedback.unknown.recheck") }}</button>
                <button type="button" class="nb-ui-focus-ring rounded px-1.5 py-0.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" data-explorer-abandon @click="emit('abandon')">{{ text("feedback.unknown.abandon") }}</button>
            </div>
            <ul class="flex flex-col gap-0.5 pl-5">
                <li v-for="item in unknown.items" :key="item.address" class="break-words">{{ item.target === null ? item.address : `${item.address} → ${item.target}` }}</li>
            </ul>
        </div>
        <div v-if="notice !== null" class="flex items-start gap-2" data-explorer-notice>
            <span class="i-lucide-info mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true"></span>
            <p class="min-w-0 flex-1 whitespace-pre-line break-words select-text" role="status">{{ noticeLine }}</p>
            <IconButton size="sm" icon-class="i-lucide-x" :aria-label="text('feedback.dismiss')" :title="text('feedback.dismiss')" @click="emit('dismiss')" />
        </div>
        <section v-if="reportView !== null" class="flex flex-col gap-1 select-text" data-explorer-report :aria-label="reportView.title">
            <div class="flex items-start gap-2">
                <span class="i-lucide-triangle-alert mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--status-warning)]" aria-hidden="true"></span>
                <p class="min-w-0 flex-1 font-medium text-[var(--text-main)]" role="status">{{ reportView.title }}</p>
                <IconButton size="sm" icon-class="i-lucide-x" :aria-label="text('feedback.dismiss')" :title="text('feedback.dismiss')" @click="emit('dismiss-report')" />
            </div>
            <ul class="flex flex-col gap-1 pl-5">
                <li v-for="item in reportView.items" :key="item.address" class="break-words" :data-explorer-report-item="item.status">
                    <span class="text-[var(--text-main)]">{{ item.address }}</span>
                    <span v-for="line in item.lines" :key="line" class="block">{{ line }}</span>
                </li>
            </ul>
            <p v-for="line in reportView.manifests" :key="line" class="break-words pl-5">{{ line }}</p>
            <p v-if="reportView.truncated" class="pl-5">{{ text("feedback.report.truncated") }}</p>
        </section>
    </div>
</template>

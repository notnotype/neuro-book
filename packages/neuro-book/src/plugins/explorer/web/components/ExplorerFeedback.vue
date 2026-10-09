<script setup lang="ts">
/** 资源管理器的结果区（同名 .md）。 */
import {IconButton} from "@notnotype/nb-ui/components";
import {computed} from "vue";

import type {DisplayLocale} from "nbook/shared/localized-text";

import type {BatchAction, Notice, OperationReport, Unknown} from "../controller";
import {actionText, itemText, noticeText} from "../feedback-text";
import {explorerText} from "../messages";

const props = defineProps<{
    locale: DisplayLocale;
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

const text = computed(() => (props.notice === null ? "" : noticeText(props.locale, props.notice)));

const reportView = computed(() => {
    const report = props.report;
    if (report == null) return null;
    const done = report.items.filter((item) => item.result.status === "done").length;
    return {
        title: explorerText(props.locale, "reportTitle", {action: actionText(props.locale, report.action), done, other: report.items.length - done}),
        items: report.items.map((item) => {
            const lines = [itemText(props.locale, item.result)];
            if (item.result.status === "failed" && item.result.partial !== undefined) {
                for (const [key, range] of [["itemRemoved", item.result.partial.removed], ["itemResidual", item.result.partial.residual]] as const) {
                    if (range === undefined) continue;
                    lines.push(range.truncated ? `${explorerText(props.locale, key, {paths: ""})}${explorerText(props.locale, "itemOmitted")}` : explorerText(props.locale, key, {paths: range.paths.join("、")}));
                }
            }
            return {address: item.target === null ? item.address : `${item.address} → ${item.target}`, status: item.result.status, lines};
        }),
        manifests: report.manifests.map((issue) => explorerText(props.locale, "manifestNotUpdated", {action: actionText(props.locale, report.action), path: issue.path, reason: issue.detail})),
        truncated: report.truncated,
    };
});
</script>

<template>
    <div v-if="notice !== null || reportView !== null || running || unknown" class="flex max-h-[40%] min-h-0 flex-col gap-2 overflow-y-auto border-t border-[var(--divider)] px-3 py-2 text-xs text-[var(--text-secondary)]" data-explorer-feedback>
        <div v-if="running" class="flex items-center gap-2" role="status" data-explorer-running>
            <span class="i-lucide-loader-circle h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true"></span>
            <span class="min-w-0 flex-1">{{ explorerText(locale, "running", {action: actionText(locale, running.action), count: running.count}) }}</span>
            <button type="button" class="nb-ui-focus-ring rounded px-1.5 py-0.5 text-[var(--accent-text)] hover:bg-[var(--bg-hover)]" @click="emit('cancel')">{{ explorerText(locale, "cancel") }}</button>
        </div>
        <div v-if="unknown" class="flex flex-col gap-1" role="alert" data-explorer-unknown>
            <div class="flex items-start gap-2">
                <span class="i-lucide-circle-help mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--status-warning)]" aria-hidden="true"></span>
                <p class="min-w-0 flex-1 break-words text-[var(--text-main)]">{{ explorerText(locale, "unknownTitle", {action: actionText(locale, unknown.action), count: unknown.items.length}) }}</p>
            </div>
            <ul class="flex flex-col gap-0.5 pl-5">
                <li v-for="item in unknown.items" :key="item.address" class="break-words">{{ item.target === null ? item.address : `${item.address} → ${item.target}` }}</li>
            </ul>
            <p class="pl-5">{{ explorerText(locale, "abandonHint") }}</p>
            <div class="flex flex-wrap gap-2 pl-5">
                <button type="button" class="nb-ui-focus-ring rounded px-1.5 py-0.5 text-[var(--accent-text)] hover:bg-[var(--bg-hover)]" data-explorer-recheck @click="emit('recheck')">{{ explorerText(locale, "recheck") }}</button>
                <button type="button" class="nb-ui-focus-ring rounded px-1.5 py-0.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" data-explorer-abandon @click="emit('abandon')">{{ explorerText(locale, "abandon") }}</button>
            </div>
        </div>
        <div v-if="notice !== null" class="flex items-start gap-2" data-explorer-notice>
            <span class="i-lucide-info mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true"></span>
            <p class="min-w-0 flex-1 whitespace-pre-line break-words" role="status">{{ text }}</p>
            <IconButton size="sm" icon-class="i-lucide-x" :aria-label="explorerText(locale, 'dismiss')" :title="explorerText(locale, 'dismiss')" @click="emit('dismiss')" />
        </div>
        <section v-if="reportView !== null" class="flex flex-col gap-1" data-explorer-report :aria-label="reportView.title">
            <div class="flex items-start gap-2">
                <span class="i-lucide-triangle-alert mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--status-warning)]" aria-hidden="true"></span>
                <p class="min-w-0 flex-1 font-medium text-[var(--text-main)]" role="status">{{ reportView.title }}</p>
                <IconButton size="sm" icon-class="i-lucide-x" :aria-label="explorerText(locale, 'dismiss')" :title="explorerText(locale, 'dismiss')" @click="emit('dismiss-report')" />
            </div>
            <ul class="flex flex-col gap-1 pl-5">
                <li v-for="item in reportView.items" :key="item.address" class="break-words" :data-explorer-report-item="item.status">
                    <span class="text-[var(--text-main)]">{{ item.address }}</span>
                    <span v-for="line in item.lines" :key="line" class="block">{{ line }}</span>
                </li>
            </ul>
            <p v-for="line in reportView.manifests" :key="line" class="break-words pl-5">{{ line }}</p>
            <p v-if="reportView.truncated" class="pl-5">{{ explorerText(locale, "truncated") }}</p>
        </section>
    </div>
</template>

<script setup lang="ts">
/**
 * 命令场景的只读检视：当前上下文、已登记命令的描述、`when` 求值与实际的 Agent 暴露。
 *
 * 渲染在 fixture 的底部控制抽屉里，不进画布。这里不执行命令、也不改上下文；执行记录走 Lab 的事件 tab，
 * 失败只在下面唯一的 `role="alert"` 区域显示，可以手动清掉。
 */
import {computed} from "vue";

import JsonViewer from "nbook/ui/JsonViewer.vue";
import {DISPLAY_LOCALE, localize} from "nbook/shared/localized-text";
import {contextTable, evaluateContextWhen} from "nbook/plugins/commands/shared/context-keys";
import type {CommandMetadata} from "nbook/plugins/commands/shared/contracts";
import {effectiveAgentExposure} from "nbook/plugins/commands/shared/registry";

import {LAB_CONTEXT_KEYS} from "./lab-context-keys";
import type {LabCommandScene} from "./lab-command-scene";

const props = defineProps<{scene: LabCommandScene}>();

const failure = props.scene.failure;

interface CommandRow {
    readonly command: CommandMetadata;
    readonly title: string;
    readonly whenText: string;
    readonly exposeText: string;
}

function exposeTextOf(command: CommandMetadata): string {
    const hints = command.expose?.hints ?? {};
    const flags = (["readOnly", "destructive", "idempotent"] as const).filter((flag) => hints[flag] === true);
    return [`human=${command.expose?.human === false ? "false" : "true"}`, `agent=${effectiveAgentExposure(command.expose)}`, ...flags].join(" · ");
}

const rows = computed<readonly CommandRow[]>(() => {
    void props.scene.palette.revision.value;
    return props.scene.registry.list().map((command) => {
        const requires = command.when?.requires ?? [];
        const evaluation = evaluateContextWhen(contextTable(LAB_CONTEXT_KEYS, () => props.scene.context.value), command.when);
        const verdict = evaluation.ok ? (evaluation.value.matches ? "满足" : `缺少：${evaluation.value.reasons.join("；")}`) : `求值失败：${evaluation.reason}`;
        return {
            command,
            title: localize(command.title, DISPLAY_LOCALE),
            whenText: requires.length === 0 ? "无 requires" : `${requires.join("、")} → ${verdict}`,
            exposeText: exposeTextOf(command),
        };
    });
});
</script>

<template>
    <section class="mt-2 flex flex-col gap-2 text-[var(--text-xs)] text-[var(--text-muted)]" data-lab-command-inspector>
        <div
            v-if="failure !== ''"
            role="alert"
            class="flex items-center gap-2 rounded-[var(--radius-control)] border-[length:var(--border-w)] border-[color:var(--divider)] px-2 py-1"
        >
            <span class="i-lucide-triangle-alert h-3.5 w-3.5 shrink-0 text-[var(--status-danger)]" aria-hidden="true"></span>
            <span class="min-w-0 flex-1 truncate text-[var(--text-main)]" :title="failure">{{ failure }}</span>
            <button type="button" class="shrink-0 cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-main)]" @click="failure = ''">关闭</button>
        </div>

        <details>
            <summary class="cursor-pointer select-none">当前上下文与 {{ rows.length }} 条命令</summary>
            <div class="mt-2 grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                <JsonViewer :value="props.scene.context.value" :read-only="true" :max-height="180" />
                <div class="flex min-w-0 flex-col gap-1.5">
                    <p v-if="rows.length === 0">当前场景没有登记命令。</p>
                    <div
                        v-for="row in rows"
                        :key="row.command.id"
                        class="min-w-0 rounded-[var(--radius-control)] border-[length:var(--border-w)] border-[color:var(--divider)] px-2 py-1"
                        :data-lab-command-row="row.command.id"
                    >
                        <div class="flex items-baseline justify-between gap-2">
                            <code class="min-w-0 break-all font-mono text-[var(--text-main)]">{{ row.command.id }}</code>
                            <span class="shrink-0 text-[var(--text-secondary)]">{{ row.title }}</span>
                        </div>
                        <p class="break-words">
                            {{ row.command.effect }} · when {{ row.whenText }} · {{ row.exposeText }} · 键位 <span class="font-mono">{{ row.command.keybinding ?? "—" }}</span>
                        </p>
                    </div>
                </div>
            </div>
        </details>
    </section>
</template>

<script setup lang="ts">
/**
 * 命令场景的只读检视：当前 context、已注册命令的 canonical metadata、共享 `when` 求值与有效 expose。
 *
 * 渲染在 fixture 的底部控制抽屉里，不进画布。这里不执行命令、也不改 context；执行记录走
 * Lab 事件 tab，失败只在下面唯一的 `role="alert"` 区域显示并可手动清掉。
 */
import {computed} from "vue";
import JsonViewer from "nbook/app/components/common/JsonViewer.vue";
import {effectiveAgentExposure, type CommandMetadata} from "nbook/app/utils/workbench/commands";
import {evaluateContextWhen} from "nbook/app/utils/workbench/context-keys";
import type {LabCommandScene} from "./lab-command-scene";

const props = defineProps<{scene: LabCommandScene}>();

const host = props.scene.host;
const failure = props.scene.failure;

function clearFailure(): void {
    failure.value = "";
}

type CommandRow = Readonly<{
    command: CommandMetadata;
    title: string;
    whenText: string;
    exposeText: string;
}>;

const rows = computed<readonly CommandRow[]>(() => {
    void host.revision.value;
    return host.registry.getAllCommands().map((command) => {
        const requires = command.when?.requires ?? [];
        const evaluation = evaluateContextWhen(command.when, host.context.value);
        const verdict = evaluation.ok
            ? (evaluation.value.matches ? "满足" : `缺少：${evaluation.value.reasons.join("；")}`)
            : `求值失败：${evaluation.reason}`;
        return {
            command,
            title: props.scene.titleOf(command.titleKey),
            whenText: requires.length === 0 ? "无 requires" : `${requires.join("、")} → ${verdict}`,
            exposeText: exposeTextOf(command),
        };
    });
});

function exposeTextOf(command: CommandMetadata): string {
    const hints = command.expose?.hints;
    const flags = hints === undefined
        ? []
        : [
            hints.readOnly === true ? "readOnly" : "",
            hints.destructive === true ? "destructive" : "",
            hints.idempotent === true ? "idempotent" : "",
        ].filter((flag) => flag !== "");
    return [
        `human=${command.expose?.human === false ? "false" : "true"}`,
        `agent=${effectiveAgentExposure(command.expose)}`,
        ...flags,
    ].join(" · ");
}
</script>

<template>
    <section class="mt-2 flex flex-col gap-2 text-[11px] text-[var(--text-muted)]" data-lab-command-inspector>
        <div
            v-if="failure !== ''"
            role="alert"
            class="flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--divider)] px-2 py-1"
        >
            <span class="i-lucide-triangle-alert h-3.5 w-3.5 shrink-0 text-[var(--status-danger)]" aria-hidden="true"></span>
            <span class="min-w-0 flex-1 truncate text-[var(--text-main)]" :title="failure">{{ failure }}</span>
            <button type="button" class="shrink-0 cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-main)]" @click="clearFailure">关闭</button>
        </div>

        <details>
            <summary class="cursor-pointer select-none">当前 context 与 {{ rows.length }} 条命令</summary>
            <div class="mt-2 grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                <JsonViewer :value="host.context.value" :read-only="true" :max-height="180" />
                <div class="flex min-w-0 flex-col gap-1.5">
                    <p v-if="rows.length === 0">当前场景没有注册命令。</p>
                    <div
                        v-for="row in rows"
                        :key="row.command.id"
                        class="min-w-0 rounded-[var(--radius-control)] border border-[var(--divider)] px-2 py-1"
                        :data-lab-command-row="row.command.id"
                    >
                        <div class="flex items-baseline justify-between gap-2">
                            <code class="min-w-0 break-all font-mono text-[var(--text-main)]">{{ row.command.id }}</code>
                            <span class="shrink-0 text-[var(--text-secondary)]">{{ row.title }}</span>
                        </div>
                        <p class="break-words">
                            {{ row.command.effect }} · when {{ row.whenText }} · {{ row.exposeText }} · 键位 <span class="font-mono">{{ row.command.defaultKeybinding ?? "—" }}</span>
                        </p>
                    </div>
                </div>
            </div>
        </details>
    </section>
</template>

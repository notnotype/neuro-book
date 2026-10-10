<script setup lang="ts">
/**
 * 检视面板的“变量”页签：按分组列出设计变量与它们此刻的取值，可以逐项覆盖、全部清除、导出与导入覆盖集
 * （docs/specs/ui/component-lab.md 的输出“变量 tab”）。覆盖由 LabShell 的 `useLabOverrides` 持有，这里只呈现、校验
 * 失败时给出原因。
 *
 * 操作用函数 prop 而不是事件：单项校验与原子导入都要拿到同步的返回值与异常，事件的返回值拿不到，异常也会被 Vue 的
 * 错误处理吞掉。
 */
import {computed, ref} from "vue";
import {FormInput as NbFormInput} from "@notnotype/nb-ui/components";

import type {LabTokenGroup} from "./lab-tokens";

const props = defineProps<{
    groups: readonly LabTokenGroup[];
    /** 每个变量此刻在文档根上的计算值。 */
    resolved: Readonly<Record<string, string>>;
    overrides: Readonly<Record<string, string>>;
    count: number;
    onSet: (name: string, value: string) => void;
    onReset: (name: string) => void;
    onResetAll: () => void;
    onImport: (raw: string) => number;
    onExport: () => string;
}>();

const query = ref("");
const status = ref<{ok: boolean; text: string} | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

const filtered = computed(() => {
    const needle = query.value.trim().toLowerCase();
    if (needle === "") return props.groups;
    return props.groups
        .map((group) => ({...group, tokens: group.tokens.filter((token) => token.toLowerCase().includes(needle))}))
        .filter((group) => group.tokens.length > 0);
});

function fail(error: unknown, prefix = ""): void {
    status.value = {ok: false, text: `${prefix}${error instanceof Error ? error.message : String(error)}`};
}

function set(name: string, value: string): void {
    try {
        props.onSet(name, value);
        status.value = null;
    } catch (error) {
        fail(error);
    }
}

function exportSnapshot(): void {
    const url = URL.createObjectURL(new Blob([props.onExport()], {type: "application/json"}));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "nb-lab-variable-overrides.json";
    anchor.click();
    URL.revokeObjectURL(url);
    status.value = {ok: true, text: "覆盖集已导出"};
}

async function importFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // 同一个文件再选一次也要生效
    input.value = "";
    if (!file) return;
    try {
        status.value = {ok: true, text: `已导入 ${String(props.onImport(await file.text()))} 项覆盖`};
    } catch (error) {
        fail(error, "导入被拒绝：");
    }
}
</script>

<template>
    <div class="lab-pad flex flex-col gap-[var(--space-4)]" data-lab-variables>
        <div class="flex items-center justify-between gap-[var(--space-3)]">
            <span class="lab-note" :class="count > 0 ? 'text-[var(--accent-text)]' : ''" data-lab-override-count>{{ count }} 项覆盖</span>
            <div class="flex items-center gap-[var(--space-2)]">
                <button type="button" class="lab-btn" :disabled="count === 0" @click="onResetAll()">全部清除</button>
                <button type="button" class="lab-btn" @click="fileInput?.click()">导入</button>
                <button type="button" class="lab-btn" @click="exportSnapshot">导出</button>
            </div>
            <input ref="fileInput" type="file" accept="application/json,.json" class="hidden" data-lab-override-file @change="importFile">
        </div>
        <p v-if="status" role="status" class="lab-note" :class="status.ok ? '' : 'text-[var(--status-danger)]'" data-lab-override-status>{{ status.text }}</p>
        <NbFormInput v-model="query" type="search" size="sm" placeholder="筛选变量" icon-class="i-lucide-search" aria-label="筛选变量" />
        <p v-if="filtered.length === 0" class="lab-note">没有匹配的变量</p>
        <section v-for="group in filtered" :key="group.id">
            <p class="lab-panel-label">{{ group.label }}</p>
            <div v-for="token in group.tokens" :key="token" class="lab-var-row" :class="{'lab-var-row--on': token in overrides}">
                <span class="lab-var-swatch" :style="{background: overrides[token] ?? resolved[token] ?? 'transparent'}" aria-hidden="true"></span>
                <code class="lab-chip min-w-0 truncate" :title="token">{{ token }}</code>
                <input
                    class="nb-ui-control nb-ui-control-h-sm lab-var-input"
                    type="text"
                    :value="overrides[token] ?? ''"
                    :placeholder="resolved[token] || '未定义'"
                    :aria-label="`${token} 覆盖值`"
                    @change="set(token, ($event.target as HTMLInputElement).value)"
                    @keydown.enter="($event.target as HTMLInputElement).blur()"
                >
                <button v-if="token in overrides" type="button" class="lab-btn lab-btn--icon" :aria-label="`撤掉 ${token} 的覆盖`" @click="onReset(token)">
                    <span class="i-lucide-rotate-ccw h-3.5 w-3.5" aria-hidden="true"></span>
                </button>
            </div>
        </section>
    </div>
</template>

<style scoped>
.lab-var-row {
    display: grid;
    grid-template-columns: 14px minmax(0, 1fr) minmax(0, 9rem) auto;
    align-items: center;
    gap: var(--space-2);
    padding: 2px 0;
}

.lab-var-row--on .lab-chip {
    color: var(--accent-text);
}

.lab-var-swatch {
    width: 14px;
    height: 14px;
    border-radius: 3px;
    border: var(--border-w) solid var(--divider);
}

.lab-var-input {
    min-width: 0;
    padding: 0 var(--space-2);
    border-radius: var(--radius-control);
    border: var(--border-w) solid var(--border-color);
    background: var(--control-surface);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
}
</style>

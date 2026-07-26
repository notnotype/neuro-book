<script setup lang="ts">
import {computed, nextTick, ref, watch} from "vue";
import type {JsonValue} from "nbook/app/utils/world-engine-preview";
import type {ResolvedAttrView} from "nbook/app/utils/world-engine-state-view";
import {formatStateValue} from "nbook/app/utils/world-engine-state-view";
import type {WorldSubjectDto} from "nbook/app/components/novel-ide/world-engine/world-engine-workbench.types";

const props = defineProps<{
    view: ResolvedAttrView;
    value: JsonValue | undefined;
    /** 已暂存的新值（未保存）；undefined 表示无暂存。 */
    stagedValue: JsonValue | undefined;
    subjects: WorldSubjectDto[];
    subjectNameMap: Map<string, string>;
    readonly?: boolean;
}>();

const emit = defineEmits<{
    stage: [value: JsonValue];
    unstage: [];
}>();

const editing = ref(false);
const draftText = ref("");
const draftError = ref("");
const inputEl = ref<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>(null);

const hasStaged = computed(() => props.stagedValue !== undefined);
const effectiveValue = computed(() => hasStaged.value ? props.stagedValue : props.value);

const displayText = computed(() => {
    const value = effectiveValue.value;
    if (props.view.widget === "ref" && typeof value === "string" && props.subjectNameMap.has(value)) {
        return `${props.subjectNameMap.get(value)} (${value})`;
    }
    return formatStateValue(value ?? props.view.attr.default ?? undefined);
});

const isDefaultFallback = computed(() => effectiveValue.value === undefined && props.view.attr.default !== undefined);

const progressPercent = computed(() => {
    const value = effectiveValue.value;
    const max = props.view.max ?? 100;
    if (typeof value !== "number" || !Number.isFinite(value) || max <= 0) return 0;
    return Math.max(0, Math.min(100, (value / max) * 100));
});

const chipItems = computed(() => {
    const value = effectiveValue.value;
    if (!Array.isArray(value)) return [];
    return value.map((item) => typeof item === "string" || typeof item === "number" ? String(item) : JSON.stringify(item));
});

const listItems = computed(() => {
    const value = effectiveValue.value;
    if (!Array.isArray(value)) return [];
    return value.map((item) => {
        if (typeof item === "object" && item !== null && !Array.isArray(item)) {
            const record = item as Record<string, JsonValue>;
            const name = typeof record.name === "string" ? record.name : typeof record.title === "string" ? record.title : typeof record.id === "string" ? record.id : JSON.stringify(item);
            const count = typeof record.count === "number" ? record.count : typeof record.数量 === "number" ? record.数量 : undefined;
            return {name, count};
        }
        return {name: String(item), count: undefined};
    });
});

const refOptions = computed(() => {
    if (props.view.widget !== "ref") return [];
    const refType = props.view.refType;
    return props.subjects.filter((subject) => !refType || subject.type === refType);
});

const colorVar = computed(() => {
    switch (props.view.color) {
        case "danger": return "var(--we-danger, #ef4444)";
        case "warning": return "var(--we-warning, #f59e0b)";
        case "success": return "var(--we-success, #22c55e)";
        default: return "var(--we-accent, var(--accent-main))";
    }
});

/** 进入编辑：按 widget 准备草稿文本。 */
async function startEdit(): Promise<void> {
    if (props.readonly || !props.view.editable) return;
    const value = effectiveValue.value;
    if (props.view.widget === "chips" || props.view.widget === "item-list" || props.view.widget === "json") {
        draftText.value = JSON.stringify(value ?? defaultDraftForCollection(), null, 2);
    } else if (value === undefined || value === null) {
        draftText.value = "";
    } else {
        draftText.value = typeof value === "string" ? value : String(value);
    }
    draftError.value = "";
    editing.value = true;
    await nextTick();
    inputEl.value?.focus();
    if (inputEl.value instanceof HTMLInputElement) inputEl.value.select();
}

function defaultDraftForCollection(): JsonValue {
    return props.view.widget === "json" && props.view.attr.kind === "object" ? {} : [];
}

function cancelEdit(): void {
    editing.value = false;
    draftError.value = "";
}

/** 确认草稿 → 解析为 JsonValue 并 stage。 */
function confirmEdit(): void {
    const widget = props.view.widget;
    let next: JsonValue;
    if (widget === "number" || widget === "progress") {
        const parsed = Number(draftText.value.trim());
        if (draftText.value.trim() === "" || !Number.isFinite(parsed)) {
            draftError.value = "需要数值";
            return;
        }
        next = parsed;
    } else if (widget === "chips" || widget === "item-list" || widget === "json") {
        try {
            next = JSON.parse(draftText.value) as JsonValue;
        } catch {
            draftError.value = "JSON 格式错误";
            return;
        }
    } else if (widget === "badge" && props.view.attr.type === "boolean") {
        next = draftText.value === "true";
    } else {
        next = draftText.value;
    }
    editing.value = false;
    draftError.value = "";
    if (jsonEquals(next, props.value)) {
        emit("unstage");
        return;
    }
    emit("stage", next);
}

function confirmSelect(value: string): void {
    editing.value = false;
    let next: JsonValue = value;
    if (props.view.attr.type === "boolean") {
        next = value === "true";
    } else if (props.view.attr.enum?.some((item) => typeof item === "number") && Number.isFinite(Number(value))) {
        next = Number(value);
    }
    if (jsonEquals(next, props.value)) {
        emit("unstage");
        return;
    }
    emit("stage", next);
}

function jsonEquals(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

const badgeOptions = computed(() => {
    if (props.view.attr.type === "boolean") return ["true", "false"];
    return (props.view.attr.enum ?? []).map((item) => String(item));
});

const isMultilineEditor = computed(() => props.view.widget === "chips" || props.view.widget === "item-list" || props.view.widget === "json");

watch(() => props.value, () => {
    if (editing.value) cancelEdit();
});
</script>

<template>
    <div class="group/value flex min-w-0 flex-col gap-0.5" :data-staged="hasStaged || undefined">
        <div class="flex items-center gap-1.5">
            <span class="truncate text-[11px] text-[var(--we-text-muted)]" :title="view.attr.name">{{ view.label }}</span>
            <span v-if="hasStaged" class="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--we-warning)]" title="有未保存修改"></span>
        </div>

        <!-- 编辑态 -->
        <div v-if="editing" class="flex min-w-0 flex-col gap-1">
            <!-- 枚举/布尔：下拉 -->
            <select
                v-if="view.widget === 'badge'"
                ref="inputEl"
                class="h-7 w-full rounded border border-[var(--we-accent-border)] bg-[var(--we-bg-input,var(--bg-input))] px-1.5 text-[12px] text-[var(--we-text-main)] focus:outline-none"
                :value="String(effectiveValue ?? '')"
                @change="confirmSelect(($event.target as HTMLSelectElement).value)"
                @keydown.esc.stop="cancelEdit"
            >
                <option v-for="option in badgeOptions" :key="option" :value="option">{{ option }}</option>
            </select>
            <!-- ref：从 subject 列表选择 -->
            <select
                v-else-if="view.widget === 'ref'"
                ref="inputEl"
                class="h-7 w-full rounded border border-[var(--we-accent-border)] bg-[var(--we-bg-input,var(--bg-input))] px-1.5 text-[12px] text-[var(--we-text-main)] focus:outline-none"
                :value="typeof effectiveValue === 'string' ? effectiveValue : ''"
                @change="confirmSelect(($event.target as HTMLSelectElement).value)"
                @keydown.esc.stop="cancelEdit"
            >
                <option v-for="option in refOptions" :key="option.id" :value="option.id">{{ option.name }} ({{ option.id }})</option>
            </select>
            <!-- 集合/对象：JSON textarea -->
            <textarea
                v-else-if="isMultilineEditor"
                ref="inputEl"
                v-model="draftText"
                rows="4"
                class="w-full resize-y rounded border border-[var(--we-accent-border)] bg-[var(--we-bg-input,var(--bg-input))] p-1.5 font-mono text-[11px] text-[var(--we-text-main)] focus:outline-none"
                @keydown.esc.stop="cancelEdit"
                @keydown.ctrl.enter.prevent="confirmEdit"
            ></textarea>
            <!-- 标量：单行输入 -->
            <input
                v-else
                ref="inputEl"
                v-model="draftText"
                :type="view.widget === 'number' || view.widget === 'progress' ? 'number' : 'text'"
                class="h-7 w-full rounded border border-[var(--we-accent-border)] bg-[var(--we-bg-input,var(--bg-input))] px-1.5 text-[12px] text-[var(--we-text-main)] focus:outline-none"
                @keydown.enter.prevent="confirmEdit"
                @keydown.esc.stop="cancelEdit"
                @blur="confirmEdit"
            />
            <div class="flex items-center gap-1.5">
                <span v-if="draftError" class="text-[10px] text-[var(--we-danger)]">{{ draftError }}</span>
                <template v-if="isMultilineEditor || view.widget === 'badge' || view.widget === 'ref'">
                    <button v-if="isMultilineEditor" type="button" class="rounded border border-[var(--we-accent-border)] px-1.5 py-0.5 text-[10px] text-[var(--we-accent-strong,var(--we-accent))] hover:bg-[var(--we-bg-hover)]" @mousedown.prevent @click="confirmEdit">确认</button>
                    <button type="button" class="rounded border border-[var(--we-border)] px-1.5 py-0.5 text-[10px] text-[var(--we-text-muted)] hover:bg-[var(--we-bg-hover)]" @mousedown.prevent @click="cancelEdit">取消</button>
                </template>
            </div>
        </div>

        <!-- 展示态 -->
        <button
            v-else
            type="button"
            class="flex min-w-0 items-center gap-1.5 rounded px-0.5 py-0.5 text-left transition-colors"
            :class="[readonly || !view.editable ? 'cursor-default' : 'hover:bg-[var(--we-bg-hover)] cursor-pointer', hasStaged ? 'bg-[color-mix(in_srgb,var(--we-warning)_12%,transparent)]' : '']"
            :title="readonly || !view.editable ? undefined : '点击编辑'"
            @click="startEdit"
        >
            <!-- progress -->
            <template v-if="view.widget === 'progress'">
                <div class="flex min-w-0 flex-1 items-center gap-1.5">
                    <div class="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--we-bg-hover,rgba(127,127,127,0.2))]">
                        <div class="h-full rounded-full transition-all" :style="{width: `${progressPercent}%`, backgroundColor: colorVar}"></div>
                    </div>
                    <span class="shrink-0 font-mono text-[12px] text-[var(--we-text-main)]">{{ formatStateValue(effectiveValue) }}<span v-if="view.max !== undefined" class="text-[var(--we-text-muted)]">/{{ view.max }}</span></span>
                </div>
            </template>
            <!-- chips -->
            <template v-else-if="view.widget === 'chips'">
                <div class="flex min-w-0 flex-wrap items-center gap-1">
                    <span v-if="!chipItems.length" class="text-[12px] text-[var(--we-text-muted)]">空</span>
                    <span v-for="(chip, index) in chipItems.slice(0, 8)" :key="`${chip}:${index}`" class="max-w-[140px] truncate rounded border border-[var(--we-border)] bg-[var(--we-bg-panel)] px-1.5 py-0.5 text-[11px] text-[var(--we-text-main)]">{{ chip }}</span>
                    <span v-if="chipItems.length > 8" class="text-[10px] text-[var(--we-text-muted)]">+{{ chipItems.length - 8 }}</span>
                </div>
            </template>
            <!-- item-list -->
            <template v-else-if="view.widget === 'item-list'">
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span v-if="!listItems.length" class="text-[12px] text-[var(--we-text-muted)]">空</span>
                    <div v-for="(item, index) in listItems.slice(0, 5)" :key="`${item.name}:${index}`" class="flex items-center justify-between gap-2 text-[12px]">
                        <span class="min-w-0 truncate text-[var(--we-text-main)]">{{ item.name }}</span>
                        <span v-if="item.count !== undefined" class="shrink-0 font-mono text-[11px] text-[var(--we-text-muted)]">×{{ item.count }}</span>
                    </div>
                    <span v-if="listItems.length > 5" class="text-[10px] text-[var(--we-text-muted)]">+{{ listItems.length - 5 }} 项</span>
                </div>
            </template>
            <!-- badge -->
            <template v-else-if="view.widget === 'badge'">
                <span class="rounded-full border border-[var(--we-border)] bg-[var(--we-bg-panel)] px-2 py-0.5 text-[11px] text-[var(--we-text-main)]" :class="{'opacity-50': effectiveValue === undefined && !isDefaultFallback}">{{ displayText }}</span>
            </template>
            <!-- ref -->
            <template v-else-if="view.widget === 'ref'">
                <span class="i-lucide-link h-3 w-3 shrink-0 text-[var(--we-text-muted)]"></span>
                <span class="min-w-0 truncate text-[12px] text-[var(--we-text-main)]" :class="{'opacity-50': effectiveValue === undefined}">{{ displayText }}</span>
            </template>
            <!-- text / number / json -->
            <template v-else>
                <span class="min-w-0 truncate text-[12px]" :class="[effectiveValue === undefined && !isDefaultFallback ? 'italic text-[var(--we-text-muted)]' : 'text-[var(--we-text-main)]', view.widget === 'number' ? 'font-mono' : '']" :title="displayText">{{ displayText }}<span v-if="isDefaultFallback" class="ml-1 text-[10px] italic text-[var(--we-text-muted)]">(默认)</span></span>
            </template>
            <span v-if="!readonly && view.editable" class="i-lucide-pencil h-3 w-3 shrink-0 text-[var(--we-text-muted)] opacity-0 transition-opacity group-hover/value:opacity-60"></span>
        </button>
    </div>
</template>

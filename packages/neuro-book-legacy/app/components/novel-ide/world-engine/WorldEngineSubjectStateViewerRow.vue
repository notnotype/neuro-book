<script setup lang="ts">
import {computed, ref} from "vue";
import type {WorldPreviewSchemaAttr} from "nbook/app/utils/world-engine-preview";
import type {WorkbenchJsonValue} from "nbook/app/components/novel-ide/world-engine/world-engine-workbench.types";

const props = withDefaults(defineProps<{
    attr: WorldPreviewSchemaAttr;
    value?: WorkbenchJsonValue;
    depth?: number;
    subjectNameMap?: Map<string, string>;
}>(), {
    depth: 0,
});

const expanded = ref(true);

const hasChildren = computed(() => props.attr.kind === "object" && props.attr.fields && Object.keys(props.attr.fields).length > 0);

const childEntries = computed(() => {
    if (!hasChildren.value) return [];
    const fields = props.attr.fields || {};
    const valObj = (typeof props.value === "object" && props.value !== null && !Array.isArray(props.value)) ? props.value : {};
    return Object.values(fields).map(childAttr => ({
        attr: childAttr,
        value: (valObj as Record<string, WorkbenchJsonValue>)[childAttr.name],
    }));
});

function formatValue(val: WorkbenchJsonValue | undefined, kind: string): string {
    if (val === undefined) return "";
    if (kind === "object") {
        if (typeof val === "object" && val !== null) {
            const keys = Object.keys(val);
            return `{ ${keys.length} ${keys.length === 1 ? 'field' : 'fields'} }`;
        }
        return "{}";
    }
    if (Array.isArray(val)) {
        if (val.length === 0) return "[]";
        const first = formatValue(val[0], "scalar");
        return `[${first}${val.length > 1 ? ', ...' : ''}] (${val.length})`;
    }
    if (typeof val === "string") {
        if (props.attr.desc?.startsWith("ref:") && props.subjectNameMap?.has(val)) {
            const name = props.subjectNameMap.get(val);
            return `"${val}" (${name})`;
        }
        return `"${val}"`;
    }
    return String(val);
}

const hasValue = computed(() => props.value !== undefined);
const hasDefault = computed(() => props.attr.default !== undefined);
const displayValue = computed(() => {
    if (hasValue.value) {
        return formatValue(props.value, props.attr.kind);
    }
    if (hasDefault.value) {
        return formatValue(props.attr.default, props.attr.kind);
    }
    return "";
});

const isRef = computed(() => props.attr.desc?.startsWith("ref:"));
const cleanDesc = computed(() => {
    if (isRef.value) {
        return `引用: ${props.attr.desc!.slice(4)}`;
    }
    return props.attr.desc || "";
});

function toggle() {
    if (hasChildren.value) {
        expanded.value = !expanded.value;
    }
}
</script>

<template>
    <div class="group flex flex-col text-[12px]">
        <div class="flex items-center gap-2 px-2 py-1.5 transition-colors hover:bg-[var(--bg-hover)]" :style="{ paddingLeft: `${props.depth * 16 + 8}px` }">
            <!-- Name -->
            <div class="flex w-[180px] shrink-0 items-center gap-1 font-mono text-[var(--text-secondary)]">
                <button v-if="hasChildren" type="button" class="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded hover:bg-[var(--bg-hover)]" @click.stop="toggle">
                    <span :class="expanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="h-3 w-3 text-[var(--text-muted)]"></span>
                </button>
                <div v-else class="h-4 w-4 shrink-0"></div>
                <span class="truncate" :title="props.attr.name">{{ props.attr.name }}</span>
            </div>
            
            <!-- Value -->
            <div class="min-w-0 flex-1 truncate font-mono text-[var(--text-main)]" :class="{'opacity-50': !hasValue}">
                <span v-if="!hasValue && !hasDefault" class="text-[10px] italic">undefined</span>
                <span v-else-if="!hasValue && hasDefault" :title="displayValue">{{ displayValue }} <span class="text-[10px] opacity-60 italic">(default)</span></span>
                <span v-else :title="displayValue">{{ displayValue }}</span>
            </div>
            
            <!-- Desc -->
            <div class="w-[180px] shrink-0 truncate text-[11px] text-[var(--text-muted)]" :title="cleanDesc">
                <span v-if="isRef" class="i-lucide-link h-3 w-3 mr-1 inline-block align-text-bottom"></span>
                {{ cleanDesc }}
            </div>
            
            <!-- Kind -->
            <div class="w-[64px] shrink-0 text-right">
                <span class="rounded bg-[var(--bg-input)] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-[var(--text-muted)]" :title="props.attr.kind">{{ props.attr.kind }}</span>
            </div>
        </div>
        
        <div v-if="hasChildren && expanded" class="flex flex-col">
            <WorldEngineSubjectStateViewerRow
                v-for="entry in childEntries"
                :key="entry.attr.name"
                :attr="entry.attr"
                :value="entry.value"
                :depth="props.depth + 1"
                :subject-name-map="props.subjectNameMap"
            />
        </div>
    </div>
</template>

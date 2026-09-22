<script setup lang="ts">
import SharedDiffEditor from "nbook/app/components/common/diff/SharedDiffEditor.vue";
import SharedMergeEditor from "nbook/app/components/common/diff/SharedMergeEditor.vue";
import type {DiffWorkbenchDocument, DiffWorkbenchMode} from "nbook/app/components/common/diff/diff-workbench.types";

const props = withDefaults(defineProps<{
    document: DiffWorkbenchDocument;
    mode?: DiffWorkbenchMode;
    availableModes?: DiffWorkbenchMode[];
    initialMode?: DiffWorkbenchMode;
    mergeReadonly?: boolean;
    renderSideBySide?: boolean;
    showWhitespace?: boolean;
}>(), {
    mergeReadonly: false,
    renderSideBySide: true,
    showWhitespace: false,
});

const emit = defineEmits<{
    (e: "update:mode", value: DiffWorkbenchMode): void;
    (e: "update:resultContent", value: string): void;
    (e: "save-request"): void;
}>();

const localMode = ref<DiffWorkbenchMode>(props.mode ?? props.initialMode ?? "diff");
const activeMode = computed({
    get: () => props.mode ?? localMode.value,
    set: (value: DiffWorkbenchMode) => {
        localMode.value = value;
        emit("update:mode", value);
    },
});

const resultContent = computed({
    get: () => props.document.resultContent ?? props.document.currentContent,
    set: (value: string) => emit("update:resultContent", value),
});

const language = computed(() => props.document.language ?? "markdown");
const currentLabel = computed(() => props.document.currentLabel ?? "Current");
const incomingLabel = computed(() => props.document.incomingLabel ?? "Incoming");
const baseLabel = computed(() => props.document.baseLabel ?? "Base");
const resultLabel = computed(() => props.document.resultLabel ?? "Result");
const hasBase = computed(() => typeof props.document.baseContent === "string");
const isDiffable = computed(() => props.document.diffable !== false);
const allowedModes = computed(() => new Set(props.availableModes ?? ["diff", "merge", "current-base", "incoming-base"]));

const tabs = computed<Array<{id: DiffWorkbenchMode; label: string; enabled: boolean}>>(() => [
    {id: "diff", label: "Diff", enabled: isDiffable.value && allowedModes.value.has("diff")},
    {id: "merge", label: "Merge", enabled: isDiffable.value && allowedModes.value.has("merge")},
    {id: "current-base", label: `${currentLabel.value} vs ${baseLabel.value}`, enabled: isDiffable.value && allowedModes.value.has("current-base") && hasBase.value},
    {id: "incoming-base", label: `${incomingLabel.value} vs ${baseLabel.value}`, enabled: isDiffable.value && allowedModes.value.has("incoming-base") && hasBase.value},
]);

const visibleTabs = computed(() => tabs.value.filter((tab) => tab.enabled));
const fallbackMode = computed<DiffWorkbenchMode>(() => visibleTabs.value[0]?.id ?? "diff");
const effectiveMode = computed<DiffWorkbenchMode>(() => visibleTabs.value.some((tab) => tab.id === activeMode.value)
    ? activeMode.value
    : fallbackMode.value);
const unavailableReasonLabel = computed(() => {
    if (props.document.unavailableReason === "missing") {
        return "文件缺失";
    }
    if (props.document.unavailableReason === "binary") {
        return "二进制文件";
    }
    if (props.document.unavailableReason === "too_large") {
        return "文件过大";
    }
    return "暂不支持 diff";
});

function normalizeMode(): void {
    if (!visibleTabs.value.some((tab) => tab.id === activeMode.value)) {
        activeMode.value = fallbackMode.value;
    }
}

watch(() => props.mode, (mode) => {
    if (mode) {
        localMode.value = mode;
        normalizeMode();
    }
});

watch(() => props.document.id, () => {
    activeMode.value = props.initialMode ?? fallbackMode.value;
});

watch(() => [
    props.initialMode,
    props.availableModes?.join(","),
    props.document.baseContent,
    props.document.diffable,
], () => normalizeMode(), {immediate: true});
</script>

<template>
    <div class="diff-workbench">
        <header class="diff-workbench__header">
            <div class="min-w-0">
                <div class="truncate text-sm font-semibold text-[var(--text-main)]">{{ document.title }}</div>
                <div v-if="document.path" class="mt-1 truncate font-mono text-xs text-[var(--text-muted)]">{{ document.path }}</div>
            </div>
            <div v-if="visibleTabs.length" class="diff-workbench__tabs">
                <button
                    v-for="tab in visibleTabs"
                    :key="tab.id"
                    type="button"
                    class="diff-workbench__tab"
                    :class="effectiveMode === tab.id ? 'is-active' : ''"
                    @click="activeMode = tab.id"
                >
                    {{ tab.label }}
                </button>
            </div>
        </header>

        <section class="diff-workbench__body">
            <div v-if="!isDiffable" class="diff-workbench__unavailable">
                <div class="diff-workbench__unavailable-icon">
                    <span class="i-lucide-file-warning h-5 w-5"></span>
                </div>
                <div class="min-w-0">
                    <div class="text-sm font-semibold text-[var(--text-main)]">{{ unavailableReasonLabel }}</div>
                    <p v-if="document.notice" class="mt-2 max-w-[720px] text-xs leading-6 text-[var(--text-secondary)]">{{ document.notice }}</p>
                    <dl class="diff-workbench__metadata">
                        <template v-if="document.metadata?.currentBytes !== undefined">
                            <dt>{{ currentLabel }} size</dt>
                            <dd>{{ document.metadata.currentBytes }} bytes</dd>
                        </template>
                        <template v-if="document.metadata?.incomingBytes !== undefined">
                            <dt>{{ incomingLabel }} size</dt>
                            <dd>{{ document.metadata.incomingBytes }} bytes</dd>
                        </template>
                        <template v-if="document.metadata?.currentSha256">
                            <dt>{{ currentLabel }} sha256</dt>
                            <dd>{{ document.metadata.currentSha256 }}</dd>
                        </template>
                        <template v-if="document.metadata?.incomingSha256">
                            <dt>{{ incomingLabel }} sha256</dt>
                            <dd>{{ document.metadata.incomingSha256 }}</dd>
                        </template>
                    </dl>
                </div>
            </div>
            <SharedDiffEditor
                v-else-if="effectiveMode === 'diff'"
                :model-key="`${document.id}:diff`"
                :original-content="document.currentContent"
                :modified-content="document.incomingContent"
                :original-label="currentLabel"
                :modified-label="incomingLabel"
                :language="language"
                :render-side-by-side="renderSideBySide"
                :show-whitespace="showWhitespace"
            />
            <SharedMergeEditor
                v-else-if="effectiveMode === 'merge'"
                v-model="resultContent"
                :model-key="`${document.id}:merge`"
                :current-content="document.currentContent"
                :current-label="currentLabel"
                :incoming-content="document.incomingContent"
                :incoming-label="incomingLabel"
                :language="language"
                :readonly="mergeReadonly"
                :show-whitespace="showWhitespace"
                :result-label="resultLabel"
                @save-request="emit('save-request')"
            />
            <SharedDiffEditor
                v-else-if="effectiveMode === 'current-base' && document.baseContent !== undefined"
                :model-key="`${document.id}:current-base`"
                :original-content="document.baseContent"
                :modified-content="document.currentContent"
                :original-label="baseLabel"
                :modified-label="currentLabel"
                :language="language"
                :render-side-by-side="renderSideBySide"
                :show-whitespace="showWhitespace"
            />
            <SharedDiffEditor
                v-else-if="effectiveMode === 'incoming-base' && document.baseContent !== undefined"
                :model-key="`${document.id}:incoming-base`"
                :original-content="document.baseContent"
                :modified-content="document.incomingContent"
                :original-label="baseLabel"
                :modified-label="incomingLabel"
                :language="language"
                :render-side-by-side="renderSideBySide"
                :show-whitespace="showWhitespace"
            />
        </section>
    </div>
</template>

<style scoped>
.diff-workbench {
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    gap: 10px;
}

.diff-workbench__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}

.diff-workbench__tabs {
    display: inline-flex;
    max-width: 100%;
    overflow: hidden;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-input);
}

.diff-workbench__tab {
    height: 30px;
    border: 0;
    border-right: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 12px;
    padding: 0 12px;
    white-space: nowrap;
}

.diff-workbench__tab:last-child {
    border-right: 0;
}

.diff-workbench__tab.is-active {
    background: var(--accent-bg);
    color: var(--accent-main);
}

.diff-workbench__body {
    display: flex;
    min-height: 0;
    flex: 1;
    overflow: hidden;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--panel-surface);
    padding: 8px;
}

.diff-workbench__unavailable {
    display: flex;
    width: 100%;
    align-items: flex-start;
    gap: 12px;
    padding: 18px;
}

.diff-workbench__unavailable-icon {
    display: inline-flex;
    height: 34px;
    width: 34px;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--status-warning-border);
    border-radius: 8px;
    background: var(--status-warning-bg);
    color: var(--status-warning);
}

.diff-workbench__metadata {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 6px 10px;
    margin-top: 12px;
    color: var(--text-muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    font-size: 11px;
}

.diff-workbench__metadata dt {
    color: var(--text-secondary);
}

.diff-workbench__metadata dd {
    min-width: 0;
    overflow-wrap: anywhere;
}
</style>

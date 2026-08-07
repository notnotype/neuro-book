<script setup lang="ts">
import Dialog from "nbook/app/components/common/Dialog.vue";
import DiffWorkbench from "nbook/app/components/common/diff/DiffWorkbench.vue";
import type {
    DiffWorkbenchAction,
    DiffWorkbenchActionPayload,
    DiffWorkbenchDocument,
    DiffWorkbenchMode,
} from "nbook/app/components/common/diff/diff-workbench.types";
import type {IdeTheme} from "nbook/app/utils/theme/theme-tokens";

const props = withDefaults(defineProps<{
    modelValue: boolean;
    document: DiffWorkbenchDocument | null;
    theme?: IdeTheme;
    actions?: DiffWorkbenchAction[];
    availableModes?: DiffWorkbenchMode[];
    initialMode?: DiffWorkbenchMode;
    mergeReadonly?: boolean;
    renderSideBySide?: boolean;
    showWhitespace?: boolean;
    title?: string;
    subtitle?: string;
}>(), {
    theme: "sepia",
    actions: () => [
        {id: "cancel", label: "取消"},
        {id: "use-incoming", label: "使用 Incoming"},
        {id: "save-result", label: "保存结果", tone: "primary"},
    ],
    mergeReadonly: false,
    renderSideBySide: true,
    showWhitespace: false,
    title: "Diff",
    subtitle: "",
});

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "action", value: DiffWorkbenchActionPayload): void;
}>();

const mode = ref<DiffWorkbenchMode>("diff");
const resultContent = ref("");

watch(() => props.document, (document) => {
    mode.value = props.initialMode ?? "diff";
    resultContent.value = document?.resultContent ?? document?.currentContent ?? "";
}, {immediate: true});

function actionLabel(action: DiffWorkbenchAction): string {
    if (action.label) {
        return action.label;
    }
    return action.id === "cancel"
        ? "取消"
        : action.id === "use-current"
            ? "使用 Current"
            : action.id === "use-incoming"
                ? "使用 Incoming"
                : action.id === "save-result"
                    ? "保存结果"
                    : action.id === "open-file"
                        ? "打开文件"
                        : action.id;
}

function closeDialog(): void {
    emit("update:modelValue", false);
}

function handleAction(action: DiffWorkbenchAction): void {
    if (!props.document) {
        return;
    }
    const nextResultContent = action.id === "use-current"
        ? props.document.currentContent
        : action.id === "use-incoming"
            ? props.document.incomingContent
            : resultContent.value;
    emit("action", {
        actionId: action.id,
        resultContent: nextResultContent,
        document: {
            ...props.document,
            resultContent: nextResultContent,
        },
    });
    if (action.closeOnAction ?? action.id === "cancel") {
        closeDialog();
    }
}
</script>

<template>
    <Dialog
        :model-value="modelValue"
        :title="title"
        width="92vw"
        height="82vh"
        :closable="false"
        :close-on-overlay="false"
        :close-on-esc="false"
        overlay-type="opaque"
        body-class="min-h-0"
        @update:model-value="emit('update:modelValue', $event)"
    >
        <div v-if="document" class="diff-workbench-dialog">
            <p v-if="subtitle" class="m-0 text-xs text-[var(--text-muted)]">{{ subtitle }}</p>
            <DiffWorkbench
                :document="{...document, resultContent}"
                :theme="theme"
                :mode="mode"
                :available-modes="availableModes"
                :initial-mode="initialMode"
                :merge-readonly="mergeReadonly"
                :render-side-by-side="renderSideBySide"
                :show-whitespace="showWhitespace"
                @update:mode="mode = $event"
                @update:result-content="resultContent = $event"
                @save-request="handleAction({id: 'save-result', label: '保存结果', tone: 'primary'})"
            />
        </div>

        <template #footer>
            <button
                v-for="action in actions"
                :key="action.id"
                type="button"
                class="diff-workbench-dialog__button"
                :class="action.tone === 'primary' ? 'primary' : action.tone === 'danger' ? 'danger' : ''"
                :disabled="action.disabled"
                @click="handleAction(action)"
            >
                {{ actionLabel(action) }}
            </button>
        </template>
    </Dialog>
</template>

<style scoped>
.diff-workbench-dialog {
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    gap: 10px;
}

.diff-workbench-dialog__button {
    display: inline-flex;
    height: 32px;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-input);
    color: var(--text-main);
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    padding: 0 12px;
}

.diff-workbench-dialog__button:hover {
    background: var(--bg-hover);
}

.diff-workbench-dialog__button:disabled {
    cursor: not-allowed;
    opacity: 0.5;
}

.diff-workbench-dialog__button.primary {
    border-color: transparent;
    background: var(--accent-main);
    color: var(--text-inverse);
}

.diff-workbench-dialog__button.danger {
    border-color: var(--status-danger-border);
    background: var(--status-danger-bg);
    color: var(--status-danger);
}
</style>

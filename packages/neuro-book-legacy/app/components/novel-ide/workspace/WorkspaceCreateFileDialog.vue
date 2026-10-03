<script setup lang="ts">
import Dialog from "nbook/app/components/common/Dialog.vue";

export type WorkspaceCreateKind = "file" | "directory" | "lorebook";
export type WorkspaceCreateLorebookType = "location" | "character" | "item" | "rule" | "note";

export interface WorkspaceCreatePayload {
    kind: WorkspaceCreateKind;
    path: string;
    lorebookType: WorkspaceCreateLorebookType | null;
}

const LOREBOOK_ENTRY_TYPES: WorkspaceCreateLorebookType[] = ["location", "character", "item", "rule", "note"];

const props = withDefaults(defineProps<{
    /** 控制 Dialog 显隐 */
    modelValue: boolean;
    /** 当前创建类型 */
    kind: WorkspaceCreateKind;
    /** 打开 Dialog 时填入的默认路径 */
    defaultPath: string;
    /** Lorebook 模式是否限制在 lorebook/ 下 */
    restrictLorebookScope?: boolean;
    /** 创建请求忙碌态 */
    busy?: boolean;
}>(), {
    restrictLorebookScope: false,
    busy: false,
});

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "submit", payload: WorkspaceCreatePayload): void;
}>();

const {t} = useI18n();
const pathInputRef = ref<HTMLInputElement | null>(null);
const pathValue = ref("");
const lorebookType = ref<WorkspaceCreateLorebookType>("location");
const localError = ref("");

const dialogTitle = computed(() => {
    if (props.kind === "directory") {
        return t("ide.workspace.filePanel.createDirectoryTitle");
    }
    if (props.kind === "lorebook") {
        return t("ide.workspace.filePanel.createLorebookTitle");
    }
    return t("ide.workspace.filePanel.createFileTitle");
});

/**
 * 返回 Lorebook 类型的展示文案。
 */
function lorebookTypeLabel(type: WorkspaceCreateLorebookType): string {
    const labels: Record<WorkspaceCreateLorebookType, string> = {
        location: t("ide.workspace.filePanel.lorebookLocation"),
        character: t("ide.workspace.filePanel.lorebookCharacter"),
        item: t("ide.workspace.filePanel.lorebookItem"),
        rule: t("ide.workspace.filePanel.lorebookRule"),
        note: t("ide.workspace.filePanel.lorebookNote"),
    };
    return labels[type];
}

/**
 * 重置表单到当前打开上下文。
 */
function resetForm(): void {
    pathValue.value = props.defaultPath;
    lorebookType.value = inferLorebookType(props.defaultPath) ?? "location";
    localError.value = "";
}

/**
 * 关闭 Dialog。
 */
function closeDialog(): void {
    emit("update:modelValue", false);
}

/**
 * 提交创建表单。
 */
function submitForm(): void {
    const nextPath = pathValue.value.trim();
    if (!nextPath) {
        localError.value = t("ide.workspace.filePanel.createPathRequired");
        return;
    }
    if (props.kind === "lorebook" && props.restrictLorebookScope && !nextPath.replace(/\\/g, "/").startsWith("lorebook/")) {
        localError.value = t("ide.workspace.filePanel.newLorebookScopeError");
        return;
    }

    localError.value = "";
    emit("submit", {
        kind: props.kind,
        path: nextPath,
        lorebookType: props.kind === "lorebook" ? lorebookType.value : null,
    });
}

/**
 * 从 lorebook/<type>/... 路径推断默认条目类型。
 */
function inferLorebookType(filePath: string): WorkspaceCreateLorebookType | null {
    const segments = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
    const candidate = segments[0] === "lorebook" ? segments[1] : null;
    if (candidate && LOREBOOK_ENTRY_TYPES.includes(candidate as WorkspaceCreateLorebookType)) {
        return candidate as WorkspaceCreateLorebookType;
    }
    return null;
}

watch(() => props.modelValue, async (visible) => {
    if (!visible) {
        return;
    }

    resetForm();
    await nextTick();
    pathInputRef.value?.focus();
    pathInputRef.value?.select();
});
</script>

<template>
    <Dialog
        :model-value="props.modelValue"
        width="420px"
        :show-header="false"
        :show-footer="false"
        body-class="!gap-0 !overflow-visible !p-0"
        :busy="props.busy"
        @cancel="closeDialog"
        @request-close="closeDialog"
        @update:model-value="emit('update:modelValue', $event)"
    >
        <!-- 极简新建面板 -->
        <form class="p-3" @submit.prevent="submitForm">
            <div class="mb-2 flex items-center gap-2">
                <span
                    class="h-4 w-4 shrink-0 text-[var(--accent-main)]"
                    :class="props.kind === 'directory' ? 'i-lucide-folder-plus' : props.kind === 'lorebook' ? 'i-lucide-book-plus' : 'i-lucide-file-plus'"
                ></span>
                <h2 class="min-w-0 flex-1 truncate text-[13px] font-medium leading-5 text-[var(--text-main)]">{{ dialogTitle }}</h2>
                <button class="flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" type="button" :disabled="props.busy" @click="closeDialog">
                    <span class="i-lucide-x h-4 w-4"></span>
                </button>
            </div>

            <label class="block">
                <input
                    ref="pathInputRef"
                    v-model="pathValue"
                    type="text"
                    class="block h-9 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-[13px] text-[var(--text-main)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--accent-main)]"
                    :disabled="props.busy"
                    :placeholder="t('ide.workspace.filePanel.createPathPlaceholder')"
                    @input="localError = ''"
                    @keydown.enter.prevent="submitForm"
                >
            </label>

            <!-- Lorebook 类型选择 -->
            <label v-if="props.kind === 'lorebook'" class="mt-2 flex items-center gap-2">
                <span class="w-12 shrink-0 text-[12px] text-[var(--text-muted)]">{{ t("ide.workspace.filePanel.createLorebookTypeLabel") }}</span>
                <select
                    v-model="lorebookType"
                    class="h-8 min-w-0 flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[12px] text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]"
                    :disabled="props.busy"
                >
                    <option
                        v-for="type in LOREBOOK_ENTRY_TYPES"
                        :key="type"
                        :value="type"
                    >
                        {{ lorebookTypeLabel(type) }}
                    </option>
                </select>
            </label>

            <p v-if="localError" class="mb-0 mt-2 text-[12px] leading-4 text-[var(--status-danger)]">{{ localError }}</p>

            <div class="mt-3 flex items-center justify-end gap-2">
                <button class="h-7 rounded-md border border-[var(--border-color)] bg-transparent px-3 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-50" type="button" :disabled="props.busy" @click="closeDialog">
                    {{ t("common.cancel") }}
                </button>
                <button class="h-7 rounded-md border border-transparent bg-[var(--accent-main)] px-3 text-[12px] font-medium text-[var(--text-inverse)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50" type="submit" :disabled="props.busy">
                    {{ t("common.confirm") }}
                </button>
            </div>
        </form>
    </Dialog>
</template>

<script lang="ts">
export type WorkspaceFileConflictResolution =
    | {action: "reload-remote"}
    | {action: "overwrite-local"}
    | {action: "save-merged"; content: string}
    | {action: "cancel"};
</script>

<script setup lang="ts">
import DiffWorkbenchDialog from "nbook/app/components/common/diff/DiffWorkbenchDialog.vue";
import type {DiffWorkbenchActionPayload, DiffWorkbenchDocument} from "nbook/app/components/common/diff/diff-workbench.types";
import type {WorkspaceWriteConflictDto} from "nbook/shared/dto/workspace-file-conflict.dto";

const props = defineProps<{
    modelValue: boolean;
    conflict: WorkspaceWriteConflictDto | null;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "resolve", value: WorkspaceFileConflictResolution): void;
}>();

const {t} = useI18n();
const dialogTitle = computed(() => props.conflict?.remoteExists === false ? t("ide.workspace.conflict.deletedTitle") : t("ide.workspace.conflict.saveConflictTitle"));
const remoteActionLabel = computed(() => props.conflict?.remoteExists === false ? t("ide.workspace.conflict.closeDeletedFile") : t("ide.workspace.conflict.useRemoteFile"));
const subtitle = computed(() => props.conflict?.remoteExists === false
    ? t("ide.workspace.conflict.deletedSubtitle")
    : t("ide.workspace.conflict.conflictSubtitle"));

const document = computed<DiffWorkbenchDocument | null>(() => {
    const conflict = props.conflict;
    if (!conflict) {
        return null;
    }
    return {
        id: `workspace-conflict:${conflict.path}:${String(conflict.actualMtimeMs ?? "missing")}`,
        title: conflict.path,
        path: conflict.path,
        language: "markdown",
        baseContent: conflict.baseContent,
        currentContent: conflict.localContent,
        incomingContent: conflict.remoteContent,
        resultContent: conflict.mergedContent,
        baseLabel: t("ide.workspace.conflict.baseLabel"),
        currentLabel: t("ide.workspace.conflict.currentLabel"),
        incomingLabel: t("ide.workspace.conflict.incomingLabel"),
        resultLabel: t("ide.workspace.conflict.resultLabel"),
    };
});

function closeDialog(): void {
    emit("update:modelValue", false);
}

function resolveConflict(value: WorkspaceFileConflictResolution): void {
    emit("resolve", value);
    closeDialog();
}

function handleAction(payload: DiffWorkbenchActionPayload): void {
    if (payload.actionId === "cancel") {
        resolveConflict({action: "cancel"});
        return;
    }
    if (payload.actionId === "reload-remote") {
        resolveConflict({action: "reload-remote"});
        return;
    }
    if (payload.actionId === "overwrite-local") {
        resolveConflict({action: "overwrite-local"});
        return;
    }
    if (payload.actionId === "save-result") {
        resolveConflict({action: "save-merged", content: payload.resultContent});
    }
}
</script>

<template>
    <DiffWorkbenchDialog
        :model-value="modelValue"
        :document="document"
        :title="dialogTitle"
        :subtitle="subtitle"
        :available-modes="['diff', 'merge', 'current-base', 'incoming-base']"
        initial-mode="diff"
        :actions="[
            {id: 'cancel', label: t('ide.workspace.common.cancel')},
            {id: 'reload-remote', label: remoteActionLabel},
            {id: 'overwrite-local', label: t('ide.workspace.conflict.overwriteRemote'), tone: 'danger'},
            {id: 'save-result', label: t('ide.workspace.conflict.saveMerged'), tone: 'primary'},
        ]"
        @update:model-value="emit('update:modelValue', $event)"
        @action="handleAction"
    />
</template>

<script setup lang="ts">
import {computed} from "vue";
import {DragDropProvider, DragOverlay} from "@dnd-kit/vue";
import {DropFeedbackOverlay, DropIndicatorLabel} from "@notnotype/nb-ui/components";
import type {EditorTabDropPosition} from "./editor-view.types";
import type {EditorSplitPayload, TabTransferPayload} from "./editor-intents";
import type {EditorDragGroup} from "./editor-tab-drop";
import {editorDragSensors, provideEditorTabDrag} from "./useEditorTabDrag";

const props = withDefaults(defineProps<{
    groups: readonly EditorDragGroup[];
    allowSplit?: boolean;
    contextKey?: string;
    revision?: number;
}>(), {allowSplit: false, contextKey: "", revision: 0});
const emit = defineEmits<{
    (e: "move-tab", groupId: string, path: string, targetPath: string | null, targetPinned: boolean, position: EditorTabDropPosition): void;
    (e: "transfer-tab", payload: TabTransferPayload): void;
    (e: "split-tab", payload: EditorSplitPayload): void;
}>();
const {t} = useI18n();
const drag = provideEditorTabDrag({
    groups: () => props.groups,
    allowSplit: () => props.allowSplit,
    contextKey: () => props.contextKey,
    revision: () => props.revision,
    commit(action) {
        if (action.kind === "split") emit("split-tab", action.request);
        else if (action.kind === "transfer") emit("transfer-tab", action.request);
        else {
            const request = action.request;
            emit("move-tab", request.sourceGroupId, request.path, request.targetPath, request.targetPinned, request.position);
        }
    },
});
const sensors = editorDragSensors();
const sourceTitle = computed(() => {
    const source = drag.source.value;
    return source ? props.groups.find(group => group.id === source.groupId)?.tabs.find(tab => tab.path === source.path)?.title ?? source.path : "";
});
const preview = computed(() => drag.decision.value?.preview ?? null);
const label = computed(() => drag.decision.value ? t(drag.decision.value.labelKey) : "");
const iconClass = computed(() => drag.decision.value?.iconClass);
</script>

<template>
    <DragDropProvider :manager="drag.manager" :sensors="sensors">
        <slot />
        <DragOverlay :drop-animation="null">
            <DropIndicatorLabel :label="sourceTitle" icon-class="i-lucide-file-text" />
        </DragOverlay>
        <DropFeedbackOverlay :preview="preview" :label="label" :icon-class="iconClass" data-editor-drop-feedback />
    </DragDropProvider>
</template>

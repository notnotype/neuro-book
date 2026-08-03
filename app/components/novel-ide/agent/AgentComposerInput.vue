<script setup lang="ts">
import ReferencePlainTextEditor from "nbook/app/components/common/form/ReferencePlainTextEditor.vue";
import type {
    AgentTriggerMenuContext,
    AgentTriggerMenuState,
} from "nbook/app/components/novel-ide/agent/trigger-menu";
import type {ComposerImageNode} from "nbook/app/components/novel-ide/agent/composer-image-transaction";
import type {PlainImageNodeAttrs} from "nbook/app/utils/plain-reference-text";

const props = withDefaults(defineProps<{
    modelValue: string;
    placeholder?: string;
    ariaLabel?: string;
    menuRefreshKey?: string | number;
    resolveMenu: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    onSkillTriggerStart?: () => void;
    borderless?: boolean;
    expanded?: boolean;
    readonly?: boolean;
    generation?: number;
    enableImageFiles?: boolean;
    minHeight?: number;
    maxHeight?: number;
    submitOnEnter?: boolean;
    /** 为 true 时，Ctrl/Meta+Enter 在展开输入框中也提交。 */
    submitOnModifierEnter?: boolean;
}>(), {
    placeholder: "",
    ariaLabel: "",
    menuRefreshKey: "",
    onSkillTriggerStart: () => {},
    borderless: false,
    expanded: false,
    readonly: false,
    generation: 0,
    enableImageFiles: true,
    submitOnEnter: true,
    submitOnModifierEnter: false,
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
    (e: "submit", payload?: {ctrlKey?: boolean; metaKey?: boolean}): void;
    (e: "cycle-mode"): void;
    (e: "image-files", payload: {files: File[]; position?: number}): void;
    (e: "pending-image-retry", uploadId: string): void;
    (e: "pending-image-remove", uploadId: string): void;
    (e: "image-document", nodes: ComposerImageNode[]): void;
    (e: "image-files-blocked"): void;
}>();

const editorRef = ref<InstanceType<typeof ReferencePlainTextEditor> | null>(null);
const {t} = useI18n();
const editorMinHeight = computed(() => props.minHeight ?? (props.expanded ? 220 : 44));
const editorMaxHeight = computed(() => props.maxHeight ?? (props.expanded ? 420 : 150));

/**
 * 聚焦编辑器。
 */
const focus = (): void => {
    editorRef.value?.focus();
};

/**
 * 插入普通文本。
 */
const insertText = (text: string): void => {
    editorRef.value?.insertText(text);
};

/**
 * 获取当前纯文本。
 */
const getText = (): string => editorRef.value?.getText() ?? props.modelValue;

const insertImage = (image: PlainImageNodeAttrs, position?: number): void => {
    editorRef.value?.insertImage(image, position);
};

const insertPendingImages = (items: Array<{uploadId: string; name: string}>, position?: number): void => {
    editorRef.value?.insertPendingImages(items, position);
};

const replacePendingImage = (uploadId: string, image: PlainImageNodeAttrs): void => {
    editorRef.value?.replacePendingImage(uploadId, image);
};

const failPendingImage = (uploadId: string, error: string): void => {
    editorRef.value?.failPendingImage(uploadId, error);
};

const startPendingImage = (uploadId: string): void => {
    editorRef.value?.startPendingImage(uploadId);
};

const removePendingImage = (uploadId: string): void => {
    editorRef.value?.removePendingImage(uploadId);
};

const clearPendingImages = (): void => {
    editorRef.value?.clearPendingImages();
};

const removeImageAt = (imageIndex: number): void => {
    editorRef.value?.removeImageAt(imageIndex);
};

const hydrateImages = (items: readonly PlainImageNodeAttrs[]): void => {
    editorRef.value?.hydrateImages(items);
};

defineExpose({
    clearPendingImages,
    failPendingImage,
    focus,
    insertImage,
    insertPendingImages,
    insertText,
    getText,
    hydrateImages,
    removePendingImage,
    removeImageAt,
    replacePendingImage,
    startPendingImage,
});
</script>

<template>
    <ReferencePlainTextEditor
        :key="`${String(props.generation)}:${props.placeholder}`"
        ref="editorRef"
        :model-value="props.modelValue"
        :placeholder="props.placeholder || t('agent.composer.messagePlaceholder')"
        :aria-label="props.ariaLabel || props.placeholder || t('agent.composer.messagePlaceholder')"
        :min-height="editorMinHeight"
        :max-height="editorMaxHeight"
        :submit-on-enter="props.submitOnEnter && !props.expanded"
        :submit-on-modifier-enter="props.submitOnModifierEnter"
        :enable-quick-triggers="true"
        :readonly="props.readonly"
        :match-popover-width="true"
        :menu-refresh-key="props.menuRefreshKey"
        :resolve-menu="props.resolveMenu"
        :on-skill-trigger-start="props.onSkillTriggerStart"
        :borderless="props.borderless"
        :enable-image-files="props.enableImageFiles"
        @update:model-value="emit('update:modelValue', $event)"
        @submit="emit('submit', $event)"
        @shift-tab="emit('cycle-mode')"
        @image-files="emit('image-files', $event)"
        @image-files-blocked="emit('image-files-blocked')"
        @pending-image-retry="emit('pending-image-retry', $event)"
        @pending-image-remove="emit('pending-image-remove', $event)"
        @image-document="emit('image-document', $event)"
    />
</template>

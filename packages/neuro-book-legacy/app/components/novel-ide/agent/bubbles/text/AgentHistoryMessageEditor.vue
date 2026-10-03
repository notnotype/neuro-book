<script setup lang="ts">
import ReferencePlainTextEditor from "nbook/app/components/common/form/ReferencePlainTextEditor.vue";
import type {AgentSessionAttachmentItemDto} from "nbook/shared/dto/agent-session.dto";
import type {
    AgentTriggerMenuContext,
    AgentTriggerMenuState,
} from "nbook/app/components/novel-ide/agent/trigger-menu";
import {useComposerImageTransaction} from "nbook/app/components/novel-ide/agent/useComposerImageTransaction";

const props = defineProps<{
    modelValue: string;
    sessionId: number | null;
    sessionAttachments: AgentSessionAttachmentItemDto[];
    canRegisterAttachments: boolean;
    canInsertAttachments: boolean;
    readonly: boolean;
    saving: boolean;
    menuRefreshKey?: string | number;
    resolveMenu?: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    onSkillTriggerStart?: () => void;
    projectRoot: string | null;
    modelSupportsImages: boolean;
    attachmentInsertRequest?: {
        id: number;
        item: AgentSessionAttachmentItemDto;
    } | null;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
    (e: "cancel"): void;
    (e: "save"): void;
    (e: "attachment-registered", item: AgentSessionAttachmentItemDto): void;
}>();

const editorRef = ref<InstanceType<typeof ReferencePlainTextEditor> | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const {t} = useI18n();
const images = useComposerImageTransaction({
    editor: () => editorRef.value,
    sessionId: () => props.sessionId,
    value: () => props.modelValue,
    sessionAttachments: () => props.sessionAttachments,
    canRegister: () => props.canRegisterAttachments,
    canInsert: () => props.canInsertAttachments,
    blockedReason: () => "当前 Session 状态不允许在历史消息中上传或插入图片。",
    unsupportedAttachmentMessage: () => t("agent.attachments.imageInsertUnsupported"),
    projectRoot: () => props.projectRoot,
    onAttachmentRegistered: (item) => emit("attachment-registered", item),
});
const saveDisabled = computed(() => props.saving
    || props.readonly
    || !props.modelValue.trim()
    || images.pendingImages.value.length > 0
    || images.usage.value.unresolvedStable > 0
    || Boolean(images.metadataError.value)
    || Boolean(images.budgetError.value));
const imageWarning = computed(() => images.stableImages.value.length > 0 && !props.modelSupportsImages);
const menuKey = computed(() => `${String(props.menuRefreshKey ?? "")}:${images.menuRefreshKey.value}`);

/** 在基础引用菜单上叠加 Session 附件、Project 图片快照和绝对路径图片。 */
function resolveEditorMenu(context: AgentTriggerMenuContext): AgentTriggerMenuState {
    const state = props.resolveMenu?.(context) ?? {title: "", prefix: "", sections: []};
    return images.decorateMenu(context, state);
}

/** 打开多选图片文件框。 */
function selectFiles(): void {
    if (!images.canRegister.value) {
        images.notifyBlocked();
        return;
    }
    fileInputRef.value?.click();
}

/** 文件框选择与 paste/drop 进入同一 transaction 队列。 */
function handleFileSelection(event: Event): void {
    const input = event.target as HTMLInputElement;
    images.queueFiles({files: Array.from(input.files ?? [])});
    input.value = "";
}

/** 保存前再次应用前端 pending、metadata 与预算门禁。 */
function save(): void {
    if (!saveDisabled.value) {
        emit("save");
    }
}

watch(() => props.attachmentInsertRequest, (request, previous) => {
    if (request && request.id !== previous?.id) {
        images.insertAttachment(request.item);
    }
});
watch(() => props.readonly, (readonly) => {
    if (readonly) {
        images.reset();
    }
});
</script>

<template>
    <!-- 历史用户消息图片感知编辑器 -->
    <div class="space-y-3">
        <div class="flex items-center gap-2">
            <input ref="fileInputRef" class="hidden" type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp" @change="handleFileSelection" />
            <button type="button" class="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40" :disabled="!images.canRegister.value" @click="selectFiles">
                <span class="i-lucide-image-plus h-3.5 w-3.5"></span>
                添加图片
            </button>
            <span v-if="images.pendingImages.value.length" class="text-[10px] text-[var(--status-warning)]">{{ images.failed.value ? "存在上传失败图片，请重试或移除" : "图片上传中" }}</span>
            <span v-else-if="images.metadataError.value" class="inline-flex items-center gap-1 text-[10px] text-[var(--status-danger)]">
                {{ images.metadataError.value }}
                <button type="button" class="rounded p-1 hover:bg-[var(--bg-hover)]" title="重新校验图片附件" @click="images.retryMetadata"><span class="i-lucide-refresh-cw h-3 w-3"></span></button>
            </span>
            <span v-else-if="images.budgetError.value" class="text-[10px] text-[var(--status-danger)]">{{ images.budgetError.value }}</span>
            <span v-else-if="imageWarning" class="text-[10px] text-[var(--status-warning)]">当前模型未声明图片输入能力；发送时将保留原位置文本占位。</span>
        </div>

        <ReferencePlainTextEditor
            :key="images.generation.value"
            ref="editorRef"
            :model-value="props.modelValue"
            :placeholder="t('agent.textBubble.editPlaceholder')"
            :min-height="180"
            :max-height="420"
            :submit-on-enter="false"
            :readonly="props.readonly"
            :enable-quick-triggers="true"
            :match-popover-width="true"
            :menu-refresh-key="menuKey"
            :resolve-menu="resolveEditorMenu"
            :on-skill-trigger-start="props.onSkillTriggerStart"
            :enable-image-files="images.canRegister.value"
            @update:model-value="emit('update:modelValue', $event)"
            @image-files="images.queueFiles"
            @image-files-blocked="images.notifyBlocked"
            @pending-image-retry="images.retry"
            @pending-image-remove="images.remove"
            @image-document="images.applyDocument"
        />

        <div class="flex items-center justify-end gap-2">
            <button class="inline-flex h-7 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-[11px] text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50" :disabled="props.saving" @click="emit('cancel')">
                {{ t("agent.textBubble.cancel") }}
            </button>
            <button class="inline-flex h-7 items-center justify-center rounded-md border border-transparent bg-[var(--accent-main)] px-2.5 text-[11px] text-[var(--text-inverse)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50" :disabled="saveDisabled" @click="save">
                {{ props.saving ? t("agent.textBubble.saving") : t("agent.textBubble.save") }}
            </button>
        </div>
    </div>
</template>

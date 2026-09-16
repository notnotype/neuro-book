<script setup lang="ts">
import {ref, watch, nextTick} from "vue";
import {Button, DialogWindow} from "@notnotype/nb-ui/components";
import {useCreateProjectWindowSize} from "nbook/app/utils/workbench/window-size-session";
import {WORKBENCH_CREATE_PROJECT_WINDOW_MIN_SIZE} from "nbook/shared/storage/workbench-window-sizes";
import ProjectCreateForm from "./ProjectCreateForm.vue";

const props = withDefaults(defineProps<{
    isOpen: boolean;
    isCreating?: boolean;
    recoveryNotice?: string;
    recoveryError?: string;
    teleportTarget?: string | boolean;
}>(), {
    isCreating: false,
    recoveryNotice: "",
    recoveryError: "",
    teleportTarget: ".novel-ide-theme",
});

const emit = defineEmits<{
    (e: "cancel"): void;
    (e: "submit", payload: {title: string; summary: string; genre?: string}): void;
    (e: "retry-recovery"): void;
}>();

const {t} = useI18n();

/** 窗口尺寸是本机偏好（user/local），唯一写者是记录会话：旧裸键 `nbook.projectCreateDialog.size.v2` 已迁入并删除。 */
const windowSizeRecord = useCreateProjectWindowSize();
const windowSize = windowSizeRecord.size;
const windowSizeNotice = windowSizeRecord.notice;

function updateWindowWidth(width: number): void {
    void windowSizeRecord.commit({...windowSize.value, width});
}

function updateWindowHeight(height: number): void {
    void windowSizeRecord.commit({...windowSize.value, height});
}

const formRef = ref<InstanceType<typeof ProjectCreateForm> | null>(null);
let submitDebounce = false;

watch(() => props.isOpen, async (open) => {
    if (open) {
        await nextTick();
        formRef.value?.reset();
    }
});

function handleCancel(): void {
    if (props.isCreating || props.recoveryError) return;
    emit("cancel");
}

function handleSubmit(payload: {title: string; summary: string; genre?: string}): void {
    if (submitDebounce || props.isCreating || props.recoveryError) return;
    submitDebounce = true;
    emit("submit", {title: payload.title, summary: payload.summary, genre: payload.genre});
    Promise.resolve().then(() => {
        submitDebounce = false;
    });
}

function handleFooterSubmit(): void {
    if (submitDebounce || props.isCreating || props.recoveryError) return;
    const titleVal = formRef.value?.title?.trim() || t("ide.bookshelf.defaultTitle");
    const summaryVal = formRef.value?.summary?.trim() || "";
    const genreVal = formRef.value?.genre || "general";
    handleSubmit({title: titleVal, summary: summaryVal, genre: genreVal});
}
</script>

<template>
    <DialogWindow
        :model-value="props.isOpen"
        :title="t('ide.bookshelf.createBook')"
        :width="windowSize.width"
        :height="windowSize.height"
        :min-width="WORKBENCH_CREATE_PROJECT_WINDOW_MIN_SIZE.width"
        :min-height="WORKBENCH_CREATE_PROJECT_WINDOW_MIN_SIZE.height"
        resizable
        :busy="props.isCreating"
        :teleport-target="props.teleportTarget"
        body-class="p-4 sm:px-5 sm:py-4 flex-1 flex flex-col min-h-0"
        @update:width="updateWindowWidth"
        @update:height="updateWindowHeight"
        @update:model-value="!$event && handleCancel()"
    >
        <div
            v-if="windowSizeNotice"
            data-testid="project-create-window-size-notice"
            class="mb-3 flex shrink-0 items-start gap-2 rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-2 text-[11px] leading-4 text-[var(--status-warning)]"
        >
            <span class="min-w-0 flex-1">窗口尺寸记录未就绪：{{ windowSizeNotice.diagnosis }}</span>
            <button v-if="windowSizeNotice.retryable" type="button" class="shrink-0 underline" @click="void windowSizeRecord.retry()">重试</button>
            <button v-if="windowSizeNotice.retryable" type="button" class="shrink-0 underline" @click="windowSizeRecord.abandon()">放弃</button>
        </div>

        <ProjectCreateForm
            ref="formRef"
            :is-creating="props.isCreating"
            :recovery-notice="props.recoveryNotice"
            :recovery-error="props.recoveryError"
            class="flex-1 flex flex-col min-h-0"
            @submit="handleSubmit"
            @retry-recovery="emit('retry-recovery')"
        />

        <template #footer>
            <Button
                type="button"
                variant="secondary"
                size="sm"
                :disabled="isCreating || Boolean(recoveryError)"
                @click="handleCancel"
            >
                {{ t("ide.bookshelf.cancel") }}
            </Button>
            <Button
                type="submit"
                form="create-project-form"
                variant="primary"
                size="sm"
                :icon-class="isCreating ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-check'"
                :disabled="isCreating || Boolean(recoveryError)"
                :loading="isCreating"
                @click="handleFooterSubmit"
            >
                {{ isCreating ? t("ide.bookshelf.creating") : t("ide.bookshelf.create") }}
            </Button>
        </template>
    </DialogWindow>
</template>

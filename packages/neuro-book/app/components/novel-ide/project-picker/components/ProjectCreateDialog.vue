<script setup lang="ts">
import {ref, watch, nextTick} from "vue";
import {Button, DialogWindow} from "@notnotype/nb-ui/components";
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

const CREATE_PROJECT_WINDOW_SIZE_KEY = "nbook.projectCreateDialog.size.v2";
type WindowSize = {width: number; height: number};
const DEFAULT_WINDOW_SIZE: WindowSize = {width: 580, height: 360};
const MIN_WINDOW_SIZE: WindowSize = {width: 320, height: 330};

function readStoredWindowSize(): WindowSize {
    if (!import.meta.client) {
        return {...DEFAULT_WINDOW_SIZE};
    }
    try {
        const raw = window.localStorage.getItem(CREATE_PROJECT_WINDOW_SIZE_KEY);
        if (!raw) return {...DEFAULT_WINDOW_SIZE};
        const parsed = JSON.parse(raw) as Partial<WindowSize>;
        const width = Math.round(Number(parsed.width));
        const height = Math.round(Number(parsed.height));
        if (!Number.isFinite(width) || !Number.isFinite(height)) {
            return {...DEFAULT_WINDOW_SIZE};
        }
        return {
            width: Math.max(width, MIN_WINDOW_SIZE.width),
            height: Math.max(height, MIN_WINDOW_SIZE.height),
        };
    } catch {
        return {...DEFAULT_WINDOW_SIZE};
    }
}

function persistWindowSize(size: WindowSize): void {
    if (!import.meta.client) return;
    try {
        window.localStorage.setItem(CREATE_PROJECT_WINDOW_SIZE_KEY, JSON.stringify(size));
    } catch {
        // 静默放弃偏好存储
    }
}

const windowSize = ref<WindowSize>(readStoredWindowSize());

function updateWindowWidth(width: number): void {
    windowSize.value = {...windowSize.value, width};
    persistWindowSize(windowSize.value);
}

function updateWindowHeight(height: number): void {
    windowSize.value = {...windowSize.value, height};
    persistWindowSize(windowSize.value);
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
        :min-width="MIN_WINDOW_SIZE.width"
        :min-height="MIN_WINDOW_SIZE.height"
        resizable
        :busy="props.isCreating"
        :teleport-target="props.teleportTarget"
        body-class="p-4 sm:px-5 sm:py-4 flex-1 flex flex-col min-h-0"
        @update:width="updateWindowWidth"
        @update:height="updateWindowHeight"
        @update:model-value="!$event && handleCancel()"
    >
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

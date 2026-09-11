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
    teleportTarget: "body",
});

const emit = defineEmits<{
    (e: "cancel"): void;
    (e: "submit", payload: {title: string; summary: string}): void;
    (e: "retry-recovery"): void;
}>();

const {t} = useI18n();

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

function handleSubmit(payload: {title: string; summary: string}): void {
    if (submitDebounce || props.isCreating || props.recoveryError) return;
    submitDebounce = true;
    emit("submit", payload);
    Promise.resolve().then(() => {
        submitDebounce = false;
    });
}

function handleFooterSubmit(): void {
    if (submitDebounce || props.isCreating || props.recoveryError) return;
    const titleVal = formRef.value?.title?.trim() || t("ide.bookshelf.defaultTitle");
    const summaryVal = formRef.value?.summary?.trim() || "";
    handleSubmit({title: titleVal, summary: summaryVal});
}
</script>

<template>
    <DialogWindow
        :model-value="props.isOpen"
        :title="t('ide.bookshelf.createBook')"
        :width="540"
        :min-width="320"
        :min-height="240"
        resizable
        :busy="props.isCreating"
        :teleport-target="props.teleportTarget"
        body-class="p-4 sm:p-5"
        @update:model-value="!$event && handleCancel()"
    >
        <ProjectCreateForm
            ref="formRef"
            :is-creating="props.isCreating"
            :recovery-notice="props.recoveryNotice"
            :recovery-error="props.recoveryError"
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

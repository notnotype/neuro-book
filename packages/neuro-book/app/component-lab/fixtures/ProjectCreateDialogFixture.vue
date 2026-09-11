<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {Button} from "@notnotype/nb-ui/components";
import ProjectCreateDialog from "nbook/app/components/novel-ide/project-picker/components/ProjectCreateDialog.vue";

const props = defineProps<{
    scene?: string;
    sceneId?: string;
    data?: unknown;
}>();

const emit = defineEmits<{
    (e: "event", name: string, payload?: unknown): void;
}>();

const currentScene = computed(() => props.scene ?? props.sceneId ?? "open");

const isOpen = ref(true);
const isCreating = ref(false);
const recoveryNotice = ref("");
const recoveryError = ref("");

watch(currentScene, (scene) => {
    isOpen.value = true;
    isCreating.value = false;
    recoveryNotice.value = "";
    recoveryError.value = "";

    if (scene === "creating") {
        isCreating.value = true;
    } else if (scene === "with-recovery") {
        recoveryNotice.value = "检测到上一次创建未完成，准备恢复...";
        recoveryError.value = "网络超时，无法与工作区守护进程通信。";
    }
}, {immediate: true});

function handleSubmit(payload: {title: string; summary: string; genre?: string}): void {
    emit("event", "submit", payload);
    isCreating.value = true;
    setTimeout(() => {
        isCreating.value = false;
        isOpen.value = false;
    }, 1000);
}

function handleCancel(): void {
    emit("event", "cancel");
    isOpen.value = false;
}

function handleRetryRecovery(): void {
    emit("event", "retry-recovery");
    recoveryError.value = "";
}
</script>

<template>
    <div class="relative flex h-full min-h-[500px] w-full items-center justify-center p-6" data-lab-subject>
        <div v-if="!isOpen" class="text-center">
            <p class="mb-4 text-sm text-[var(--text-secondary)]">弹窗已关闭</p>
            <Button variant="primary" @click="isOpen = true">重新打开对话框</Button>
        </div>

        <ProjectCreateDialog
            :is-open="isOpen"
            :is-creating="isCreating"
            :recovery-notice="recoveryNotice"
            :recovery-error="recoveryError"
            :teleport-target="false"
            @submit="handleSubmit"
            @cancel="handleCancel"
            @retry-recovery="handleRetryRecovery"
        />
    </div>
</template>

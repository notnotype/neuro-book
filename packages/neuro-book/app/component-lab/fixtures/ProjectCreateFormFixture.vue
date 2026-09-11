<script setup lang="ts">
import {computed, ref, watch} from "vue";
import ProjectCreateForm from "nbook/app/components/novel-ide/project-picker/components/ProjectCreateForm.vue";

const props = defineProps<{
    scene?: string;
    sceneId?: string;
    data?: unknown;
}>();

const emit = defineEmits<{
    (e: "event", name: string, payload?: unknown): void;
}>();

const currentScene = computed(() => props.scene ?? props.sceneId ?? "default");

const isCreating = ref(false);
const recoveryNotice = ref("");
const recoveryError = ref("");
const initialTitle = ref("");
const initialSummary = ref("");
const initialGenre = ref("general");

watch(currentScene, (scene) => {
    isCreating.value = false;
    recoveryNotice.value = "";
    recoveryError.value = "";
    initialTitle.value = "";
    initialSummary.value = "";
    initialGenre.value = "general";

    if (scene === "filled") {
        initialTitle.value = "黑夜之光：星际边境实录";
        initialSummary.value = "一部关于星系边缘流亡者与古老智械文明纠缠的长篇史诗。";
        initialGenre.value = "scifi";
    } else if (scene === "creating") {
        isCreating.value = true;
    } else if (scene === "recovery-error") {
        recoveryNotice.value = "检测到上一次创建作品时网络中断，正在尝试恢复...";
        recoveryError.value = "工作区元数据写入失败：磁盘空间不足或权限受限（EACCES）。";
    }
}, {immediate: true});

function handleSubmit(payload: {title: string; summary: string; genre?: string}): void {
    emit("event", "submit", payload);
}

function handleRetryRecovery(): void {
    emit("event", "retry-recovery");
    recoveryError.value = "";
    recoveryNotice.value = "正在重新同步工作区状态...";
}
</script>

<template>
    <div
        class="flex h-full w-full items-center justify-center p-4 sm:p-8"
        :class="currentScene === 'phone' ? 'max-w-[390px] mx-auto' : 'max-w-[640px] mx-auto'"
        data-lab-subject
    >
        <div class="w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-5 sm:p-6 shadow-sm">
            <ProjectCreateForm
                :is-creating="isCreating"
                :recovery-notice="recoveryNotice"
                :recovery-error="recoveryError"
                :initial-title="initialTitle"
                :initial-summary="initialSummary"
                :initial-genre="initialGenre"
                @submit="handleSubmit"
                @retry-recovery="handleRetryRecovery"
            />
        </div>
    </div>
</template>

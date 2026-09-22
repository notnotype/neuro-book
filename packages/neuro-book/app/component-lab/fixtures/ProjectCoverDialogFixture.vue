<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {Button} from "@notnotype/nb-ui/components";
import ProjectCoverDialog from "nbook/app/components/novel-ide/project-picker/components/ProjectCoverDialog.vue";
import type {ProjectMetadataDto} from "nbook/shared/dto/project.dto";

const props = defineProps<{
    scene?: string;
    sceneId?: string;
    data?: unknown;
}>();

const emit = defineEmits<{
    (e: "event", name: string, payload?: unknown): void;
}>();

const currentScene = computed(() => props.scene ?? props.sceneId ?? "default");

const isOpen = ref(true);
const busy = ref(false);
const recoveryNotice = ref("");
const recoveryError = ref("");
const coverUrl = ref("");

const project = ref<ProjectMetadataDto>({
    projectRoot: "workspace/projects/cyber-city",
    kind: "novel",
    title: "赛博霓虹：仿生纪元",
    summary: "在全自动化的人形都市中，一名记忆修复师偶然发现了一具被删除了所有情感模块的古老合成人。",
    cover: undefined,
    manifestUpdatedAt: "2026-09-10T14:32:00Z",
});

watch(currentScene, (scene) => {
    isOpen.value = true;
    busy.value = false;
    recoveryNotice.value = "";
    recoveryError.value = "";
    coverUrl.value = "";

    if (scene === "with-cover") {
        coverUrl.value = "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=400&q=80";
        project.value.cover = "workspace/projects/cyber-city/cover.jpg";
    } else if (scene === "busy") {
        busy.value = true;
    }
}, {immediate: true});

function handleUpload(file: File): void {
    emit("event", "upload", {fileName: file.name, size: file.size});
    busy.value = true;
    setTimeout(() => {
        busy.value = false;
        coverUrl.value = URL.createObjectURL(file);
        project.value.cover = "uploaded-cover.png";
    }, 1000);
}

function handleClear(): void {
    emit("event", "clear");
    coverUrl.value = "";
    project.value.cover = undefined;
}
</script>

<template>
    <div class="flex h-full min-h-[500px] w-full items-center justify-center p-6" data-lab-subject>
        <div v-if="!isOpen" class="text-center">
            <p class="mb-4 text-sm text-[var(--text-secondary)]">封面对话框已关闭</p>
            <Button variant="primary" @click="isOpen = true">重新打开对话框</Button>
        </div>

        <ProjectCoverDialog
            v-model="isOpen"
            :project="project"
            :busy="busy"
            :recovery-notice="recoveryNotice"
            :recovery-error="recoveryError"
            :cover-url="coverUrl"
            :teleport-target="false"
            @upload="handleUpload"
            @clear="handleClear"
            @preview-original="emit('event', 'preview-original')"
            @retry-recovery="recoveryError = ''"
        />
    </div>
</template>

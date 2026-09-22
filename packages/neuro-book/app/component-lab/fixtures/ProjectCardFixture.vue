<script setup lang="ts">
import {computed, ref, watch} from "vue";
import ProjectCard from "nbook/app/components/novel-ide/project-picker/components/ProjectCard.vue";
import type {ProjectMetadataDto} from "nbook/shared/dto/project.dto";
import type {ProjectPickerRecoveryEntry} from "nbook/app/utils/project-picker-recovery";

const props = defineProps<{
    scene?: string;
    sceneId?: string;
    data?: unknown;
}>();

const emit = defineEmits<{
    (e: "event", name: string, payload?: unknown): void;
}>();

const currentScene = computed(() => props.scene ?? props.sceneId ?? "fallback");

const baseProject: ProjectMetadataDto = {
    projectRoot: "workspace/projects/star-odyssey",
    kind: "novel",
    title: "群星尽头的低语：流浪观测站实录",
    summary: "跃迁引擎熄灭的第十年，深空探测员在潮汐锁定行星上收到了来自地球的最后一封电波信。",
    cover: undefined,
    manifestUpdatedAt: "2026-09-10T15:30:00Z",
};

const project = ref<ProjectMetadataDto>({...baseProject});
const tags = ref<string[]>(["硬科幻", "深空探索"]);
const deleteBusy = ref(false);
const deleteRecovery = ref<ProjectPickerRecoveryEntry | undefined>(undefined);

watch(currentScene, (scene) => {
    project.value = {...baseProject};
    tags.value = ["硬科幻", "深空探索"];
    deleteBusy.value = false;
    deleteRecovery.value = undefined;

    if (scene === "with-cover") {
        project.value.cover = "workspace/projects/star-odyssey/cover.jpg";
    } else if (scene === "delete-busy") {
        deleteBusy.value = true;
    } else if (scene === "delete-recovery") {
        deleteRecovery.value = {
            attempt: 1,
            commitState: "unknown",
            error: "文件被其他进程占用，删除操作已中止。请点击重试恢复。",
        };
    }
}, {immediate: true});

function handleOpen(root: string): void {
    emit("event", "open", {projectRoot: root});
}

function handleDelete(item: ProjectMetadataDto): void {
    emit("event", "delete", item);
    deleteBusy.value = true;
    setTimeout(() => {
        deleteBusy.value = false;
    }, 1200);
}

function handleRetryDeleteRecovery(root: string): void {
    emit("event", "retry-delete-recovery", {projectRoot: root});
    deleteRecovery.value = undefined;
}

function handleOpenCoverDialog(item: ProjectMetadataDto): void {
    emit("event", "open-cover-dialog", item);
}

function fakeResolveCoverUrl(): string {
    return "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=400&q=80";
}
</script>

<template>
    <div class="p-6">
        <ProjectCard
            data-lab-subject
            class="w-full"
            :project="project"
            :tags="tags"
            :delete-busy="deleteBusy"
            :delete-recovery="deleteRecovery"
            :resolve-cover-url="currentScene === 'with-cover' ? fakeResolveCoverUrl : undefined"
            @open="handleOpen"
            @delete="handleDelete"
            @retry-delete-recovery="handleRetryDeleteRecovery"
            @open-cover-dialog="handleOpenCoverDialog"
        />
    </div>
</template>

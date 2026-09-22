<script setup lang="ts">
import {computed} from "vue";
import ProjectCreateCoverPreview from "nbook/app/components/novel-ide/project-picker/components/ProjectCreateCoverPreview.vue";

const props = defineProps<{
    scene?: string;
    sceneId?: string;
    data?: unknown;
}>();

const currentScene = computed(() => props.scene ?? props.sceneId ?? "default");

const sceneData = computed(() => {
    switch (currentScene.value) {
        case "long-title":
            return {
                title: "关于我在异界重构代码并试图拯救整个星系的这档事：终焉纪元序章",
                genre: "scifi",
            };
        case "xuanhuan":
            return {
                title: "九天剑魄凌霄录",
                genre: "xuanhuan",
            };
        case "scifi":
            return {
                title: "仿生人的量子深渊",
                genre: "scifi",
            };
        case "mystery":
            return {
                title: "第十三号暗夜档案馆",
                genre: "mystery",
            };
        default:
            return {
                title: "未命名作品",
                genre: "general",
            };
    }
});
</script>

<template>
    <div class="flex h-full w-full items-center justify-center p-8" data-lab-subject>
        <div class="rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-6 shadow-sm">
            <ProjectCreateCoverPreview
                :title="sceneData.title"
                :genre="sceneData.genre"
            />
        </div>
    </div>
</template>

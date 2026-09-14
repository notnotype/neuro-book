<script setup lang="ts">
import {ref, computed, watch} from "vue";
import ProjectPickerView from "nbook/app/components/novel-ide/project-picker/ProjectPickerView.vue";
import type {ProjectMetadataDto} from "nbook/shared/dto/project.dto";
import type {ProjectPickerCreatePayload} from "nbook/app/components/novel-ide/project-picker/ProjectPickerView.types";

const props = defineProps<{
    scene?: string;
    sceneId?: string;
    data?: unknown;
}>();

const currentScene = computed(() => props.scene ?? props.sceneId ?? "default");

const emit = defineEmits<{
    (e: "event", eventName: string, payload?: unknown): void;
}>();

const SAMPLE_PROJECTS: ProjectMetadataDto[] = [
    {
        projectRoot: "workspace/projects/cyber-city",
        kind: "novel",
        title: "赛博霓虹：仿生纪元",
        summary: "在全自动化的人形都市中，一名记忆修复师偶然发现了一具被删除了所有情感模块的古老合成人。",
        cover: "workspace/projects/cyber-city/cover.jpg",
        manifestUpdatedAt: "2026-09-10T14:32:00Z",
    },
    {
        projectRoot: "workspace/projects/stellar-odyssey",
        kind: "novel",
        title: "群星尽头的低语",
        summary: "跃迁引擎故障后，科考船坠落在一颗处于双星系统潮汐锁定带的死寂行星上。",
        cover: undefined,
        manifestUpdatedAt: "2026-09-08T09:15:00Z",
    },
    {
        projectRoot: "workspace/projects/magic-chronicles",
        kind: "novel",
        title: "深渊炼金手册",
        summary: "一本记录禁忌炼金术的古旧手抄本，指引着学徒走向帝国最深的地底迷宫。",
        cover: "workspace/projects/magic-chronicles/cover.png",
        manifestUpdatedAt: "2026-09-05T18:40:00Z",
    },
    {
        projectRoot: "workspace/projects/ancient-blade",
        kind: "novel",
        title: "折戟沉沙录",
        summary: "剑修末世，天道崩碎，少年背负半截断剑踏上寻找上古遗迹的复仇长路。",
        cover: undefined,
        manifestUpdatedAt: "2026-08-30T11:20:00Z",
    },
    {
        projectRoot: "workspace/projects/urban-mystery",
        kind: "novel",
        title: "第七诊疗室的异常记录",
        summary: "深夜接诊的患者们，总在诉说着关于同一间不存在的电梯的噩梦。",
        cover: undefined,
        manifestUpdatedAt: "2026-08-25T22:10:00Z",
    },
];

const sampleProjectTags: Record<string, readonly string[]> = {
    "workspace/projects/cyber-city": ["赛博朋克", "科幻未来"],
    "workspace/projects/stellar-odyssey": ["硬科幻", "深空探索"],
    "workspace/projects/magic-chronicles": ["西幻", "炼金魔法"],
    "workspace/projects/ancient-blade": ["玄幻修真", "热血"],
    "workspace/projects/urban-mystery": ["悬疑惊悚", "都市怪谈"],
};

const projectTagsMap = ref<Record<string, readonly string[]>>({...sampleProjectTags});
const projects = ref<ProjectMetadataDto[]>([...SAMPLE_PROJECTS]);
const isCreateFormOpen = ref(false);
const isCreating = ref(false);
const isLoading = ref(false);
const loadError = ref("");
const deleteBusyRoots = ref<Set<string>>(new Set());
const layoutMode = ref<"grid" | "spotlight" | "tactile">("grid");

watch(currentScene, (scene) => {
    projects.value = [...SAMPLE_PROJECTS];
    projectTagsMap.value = {...sampleProjectTags};
    isCreateFormOpen.value = false;
    isCreating.value = false;
    isLoading.value = false;
    loadError.value = "";
    deleteBusyRoots.value = new Set();
    layoutMode.value = "grid";

    if (scene === "empty") {
        projects.value = [];
    } else if (scene === "spotlight" || scene === "spotlight-studio") {
        layoutMode.value = "spotlight";
    } else if (scene === "tactile" || scene === "tactile-library") {
        layoutMode.value = "tactile";
    } else if (scene === "create-dialog" || scene === "create-open") {
        isCreateFormOpen.value = true;
    } else if (scene === "creating") {
        isCreateFormOpen.value = true;
        isCreating.value = true;
    } else if (scene === "loading") {
        isLoading.value = true;
    } else if (scene === "load-error") {
        loadError.value = "无法连接到本地工作区存储服务（503 Service Unavailable）";
    }
}, {immediate: true});

function handleOpen(projectRoot: string): void {
    emit("event", "open", {projectRoot});
}

function handleOpenCreateForm(): void {
    isCreateFormOpen.value = true;
    emit("event", "open-create-form");
}

function handleCancelCreateForm(): void {
    isCreateFormOpen.value = false;
    emit("event", "cancel-create-form");
}

function handleCreate(payload: ProjectPickerCreatePayload): void {
    emit("event", "create", payload);
    const newRoot = `workspace/projects/${payload.title.toLowerCase().replace(/\s+/g, "-")}`;
    const genreMap: Record<string, string> = {
        scifi: "科幻未来",
        xuanhuan: "玄幻修真",
        urban: "都市职场",
        mystery: "悬疑惊悚",
        world: "世界设定",
        general: "通用创作",
    };
    const genreTag = payload.genre ? genreMap[payload.genre] : undefined;
    if (genreTag) {
        projectTagsMap.value = {
            ...projectTagsMap.value,
            [newRoot]: [genreTag],
        };
    }
    projects.value.unshift({
        projectRoot: newRoot,
        kind: "novel",
        title: payload.title,
        summary: payload.summary,
        cover: undefined,
        manifestUpdatedAt: new Date().toISOString(),
    });
    isCreateFormOpen.value = false;
}

function handleDelete(project: ProjectMetadataDto): void {
    emit("event", "delete", {projectRoot: project.projectRoot});
    projects.value = projects.value.filter((item) => item.projectRoot !== project.projectRoot);
}

function handleRetryLoad(): void {
    emit("event", "retry-load");
    loadError.value = "";
    isLoading.value = true;
    setTimeout(() => {
        isLoading.value = false;
        projects.value = [...SAMPLE_PROJECTS];
    }, 500);
}
</script>

<template>
    <div
        class="h-full w-full overflow-hidden"
        :class="currentScene === 'phone' ? 'max-w-[390px] mx-auto border-x border-[var(--border-color)]' : ''"
        data-lab-subject
    >
        <ProjectPickerView
            :projects="projects"
            :project-tags="projectTagsMap"
            :is-loading="isLoading"
            :load-error="loadError"
            :is-creating="isCreating"
            :is-create-form-open="isCreateFormOpen"
            :delete-busy-roots="deleteBusyRoots"
            :layout-mode="layoutMode"
            teleport-target="body"
            @open="handleOpen"
            @open-user-assets="emit('event', 'open-user-assets')"
            @open-create-form="handleOpenCreateForm"
            @cancel-create-form="handleCancelCreateForm"
            @create="handleCreate"
            @delete="handleDelete"
            @retry-load="handleRetryLoad"
        />
    </div>
</template>

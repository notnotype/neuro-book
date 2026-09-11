<script setup lang="ts">
import {ref, computed, watch} from "vue";
import ProjectPickerView from "nbook/app/components/novel-ide/project-picker/ProjectPickerView.vue";
import type {ProjectMetadataDto} from "nbook/shared/dto/project.dto";
import type {AgentSessionSummaryDto} from "nbook/shared/dto/agent-session.dto";
import type {
    ProjectPickerCreatePayload,
    ProjectPickerRecoverSessionPayload,
} from "nbook/app/components/novel-ide/project-picker/ProjectPickerView.types";

const props = defineProps<{
    sceneId: string;
}>();

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

const SAMPLE_SESSIONS: AgentSessionSummaryDto[] = [
    {
        sessionId: 101,
        sessionIdentity: "00000000-0000-0000-0000-000000000101",
        profileKey: "writer.narrative",
        title: "第十二章 暴风雨前夜细化",
        summary: "针对主角潜入敌营前的心理状态进行描写扩展",
        status: "idle",
        archived: false,
        updatedAt: Date.now() - 1000 * 60 * 30,
        lastMessagePreview: "窗外的雷鸣渐渐低沉下去，他攥紧了怀里的羊皮卷...",
    },
    {
        sessionId: 102,
        sessionIdentity: "00000000-0000-0000-0000-000000000102",
        profileKey: "editor.polish",
        title: "第三章 对话节奏润色",
        summary: "删减冗长说明，提升对话张力与潜台词",
        status: "idle",
        archived: false,
        updatedAt: Date.now() - 1000 * 3600 * 3,
        lastMessagePreview: "“你以为你还能走得出去？”林彻的声音没有任何起伏。",
    },
];

const projects = ref<ProjectMetadataDto[]>([...SAMPLE_PROJECTS]);
const isCreateFormOpen = ref(false);
const isCreating = ref(false);
const isLoading = ref(false);
const loadError = ref("");
const recoveryExpanded = ref(false);
const recoverySessions = ref<AgentSessionSummaryDto[]>([...SAMPLE_SESSIONS]);
const deleteBusyRoots = ref<Set<string>>(new Set());

watch(() => props.sceneId, (scene) => {
    projects.value = [...SAMPLE_PROJECTS];
    isCreateFormOpen.value = false;
    isCreating.value = false;
    isLoading.value = false;
    loadError.value = "";
    recoveryExpanded.value = false;
    recoverySessions.value = [...SAMPLE_SESSIONS];
    deleteBusyRoots.value = new Set();

    if (scene === "empty") {
        projects.value = [];
    } else if (scene === "create-open") {
        isCreateFormOpen.value = true;
    } else if (scene === "creating") {
        isCreateFormOpen.value = true;
        isCreating.value = true;
    } else if (scene === "loading") {
        isLoading.value = true;
    } else if (scene === "load-error") {
        loadError.value = "无法连接到本地工作区存储服务（503 Service Unavailable）";
    } else if (scene === "recovery") {
        recoveryExpanded.value = true;
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
    projects.value.unshift({
        projectRoot: `workspace/projects/${payload.title.toLowerCase().replace(/\s+/g, "-")}`,
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

function handleRecoverSession(payload: ProjectPickerRecoverSessionPayload): void {
    emit("event", "recover-session", payload);
    recoverySessions.value = recoverySessions.value.filter((s) => s.sessionId !== payload.session.sessionId);
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
        class="h-full w-full overflow-hidden bg-[var(--bg-main)]"
        :class="props.sceneId === 'phone' ? 'max-w-[390px] mx-auto border-x border-[var(--border-color)]' : ''"
        data-lab-subject
    >
        <ProjectPickerView
            :projects="projects"
            :is-loading="isLoading"
            :load-error="loadError"
            :is-creating="isCreating"
            :is-create-form-open="isCreateFormOpen"
            :delete-busy-roots="deleteBusyRoots"
            :recovery-expanded="recoveryExpanded"
            :recovery-loaded="true"
            :recovery-sessions="recoverySessions"
            :recovery-total="recoverySessions.length"
            @open="handleOpen"
            @open-user-assets="emit('event', 'open-user-assets')"
            @open-create-form="handleOpenCreateForm"
            @cancel-create-form="handleCancelCreateForm"
            @create="handleCreate"
            @delete="handleDelete"
            @retry-load="handleRetryLoad"
            @toggle-recovery="recoveryExpanded = !recoveryExpanded"
            @recover-session="handleRecoverSession"
        />
    </div>
</template>

<script setup lang="ts">
import {ref, computed, watch} from "vue";
import ProjectPickerView from "nbook/app/components/novel-ide/project-picker/ProjectPickerView.vue";
import type {ProjectMetadataDto} from "nbook/shared/dto/project.dto";
import type {
    ProjectPickerCreatePayload,
    ProjectPickerLayoutMode,
} from "nbook/app/components/novel-ide/project-picker/ProjectPickerView.types";

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
    {
        projectRoot: "workspace/projects/echoes-of-chronos",
        kind: "novel",
        title: "时光回响：跨纪元编年史",
        summary: "时间锚点发生偏移，两个相隔三千年的文明在同一个时空奇点中开始产生干涉。",
        cover: undefined,
        manifestUpdatedAt: "2026-08-20T16:05:00Z",
    },
    {
        projectRoot: "workspace/projects/crimson-abyss",
        kind: "novel",
        title: "血月降临夜",
        summary: "当绯红之月笼罩旧伦敦街头，皇家猎魔巡警在下水道发现了失落百年的古老炼金法阵。",
        cover: "workspace/projects/crimson-abyss/cover.jpg",
        manifestUpdatedAt: "2026-08-15T10:30:00Z",
    },
    {
        projectRoot: "workspace/projects/nine-dragons",
        kind: "novel",
        title: "九霄龙渊志",
        summary: "少年偶得一枚龙骨逆鳞，踏破九州风云，重开天门飞升之路。",
        cover: undefined,
        manifestUpdatedAt: "2026-08-11T08:50:00Z",
    },
    {
        projectRoot: "workspace/projects/foggy-avenue",
        kind: "novel",
        title: "迷雾街区 42 号",
        summary: "暴风雨孤岛上的老牌旅馆，每当午夜钟声敲响，总有一间客房的门牌号会离奇变动。",
        cover: undefined,
        manifestUpdatedAt: "2026-08-05T23:15:00Z",
    },
    {
        projectRoot: "workspace/projects/desert-dynasty",
        kind: "novel",
        title: "沙海古国遗卷",
        summary: "探险队穿越无尽死海风暴，发掘沉睡于流沙千尺之下的机械黄金古城。",
        cover: "workspace/projects/desert-dynasty/cover.png",
        manifestUpdatedAt: "2026-07-28T14:20:00Z",
    },
    {
        projectRoot: "workspace/projects/quantum-ghost",
        kind: "novel",
        title: "量子幽灵调查录",
        summary: "在全息脑机网络普及的社会，网络幽灵开始以非因果律的形式在物理世界显形。",
        cover: undefined,
        manifestUpdatedAt: "2026-07-20T19:45:00Z",
    },
    {
        projectRoot: "workspace/projects/sword-frost",
        kind: "novel",
        title: "独钓寒江雪",
        summary: "十年闭关，一剑出鞘。雪山之巅的残局，等待最后一位入局之人。",
        cover: undefined,
        manifestUpdatedAt: "2026-07-12T11:00:00Z",
    },
    {
        projectRoot: "workspace/projects/neon-syndicate",
        kind: "novel",
        title: "地下城黑客备忘录",
        summary: "隐藏在废弃地铁线路深处的地下黑市，数据贩子在追踪一份被加密的脑神经蓝图。",
        cover: undefined,
        manifestUpdatedAt: "2026-07-01T15:30:00Z",
    },
    {
        projectRoot: "workspace/projects/greenhouse-witch",
        kind: "novel",
        title: "温室最后的草药学徒",
        summary: "在被灰烬与永冬覆盖的荒原边境，一座玻璃温室守护着世间最后的魔法植物幼苗。",
        cover: "workspace/projects/greenhouse-witch/cover.jpg",
        manifestUpdatedAt: "2026-06-25T09:10:00Z",
    },
];

const sampleProjectTags: Record<string, readonly string[]> = {
    "workspace/projects/cyber-city": ["赛博朋克", "科幻未来"],
    "workspace/projects/stellar-odyssey": ["硬科幻", "深空探索"],
    "workspace/projects/magic-chronicles": ["西幻", "炼金魔法"],
    "workspace/projects/ancient-blade": ["玄幻修真", "热血"],
    "workspace/projects/urban-mystery": ["悬疑惊悚", "都市怪谈"],
    "workspace/projects/echoes-of-chronos": ["硬科幻", "时间穿越", "史诗编年"],
    "workspace/projects/crimson-abyss": ["西幻", "维多利亚", "吸血鬼"],
    "workspace/projects/nine-dragons": ["东方仙侠", "热血", "升级"],
    "workspace/projects/foggy-avenue": ["悬疑解谜", "暴风雪山庄", "古典侦探"],
    "workspace/projects/desert-dynasty": ["奇幻探险", "失落文明", "考古"],
    "workspace/projects/quantum-ghost": ["赛博朋克", "心理惊悚", "脑机接口"],
    "workspace/projects/sword-frost": ["传统武侠", "冷峻剑客", "江湖宿命"],
    "workspace/projects/neon-syndicate": ["都市异能", "黑客智斗", "赛博犯罪"],
    "workspace/projects/greenhouse-witch": ["治愈奇幻", "魔法日常", "温馨治愈"],
};

const projectTagsMap = ref<Record<string, readonly string[]>>({...sampleProjectTags});
const projects = ref<ProjectMetadataDto[]>([...SAMPLE_PROJECTS]);
const isCreateFormOpen = ref(false);
const isCreating = ref(false);
const isLoading = ref(false);
const loadError = ref("");
const deleteBusyRoots = ref<Set<string>>(new Set());
const failedCoverRoots = ref<Set<string>>(new Set());
const layoutMode = ref<ProjectPickerLayoutMode>("grid");

watch(currentScene, (scene) => {
    projects.value = [...SAMPLE_PROJECTS];
    projectTagsMap.value = {...sampleProjectTags};
    isCreateFormOpen.value = false;
    isCreating.value = false;
    isLoading.value = false;
    loadError.value = "";
    deleteBusyRoots.value = new Set();
    failedCoverRoots.value = new Set();
    layoutMode.value = "grid";

    if (scene === "empty") {
        projects.value = [];
    } else if (scene === "compact" || scene === "classic-compact") {
        layoutMode.value = "compact";
    } else if (scene === "editorial" || scene === "classic-editorial") {
        layoutMode.value = "editorial";
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
            :failed-cover-roots="failedCoverRoots"
            :layout-mode="layoutMode"
            teleport-target="body"
            @update:layout-mode="layoutMode = $event"
            @cover-error="failedCoverRoots.add($event)"
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

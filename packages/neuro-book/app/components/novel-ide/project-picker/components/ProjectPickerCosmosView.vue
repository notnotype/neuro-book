<script setup lang="ts">
import {ref, computed, watch} from "vue";
import {Badge, Button, IconButton} from "@notnotype/nb-ui/components";
import type {ProjectMetadataDto} from "nbook/shared/dto/project.dto";
import type {ProjectPickerRecoveryEntry} from "nbook/app/utils/project-picker-recovery";
import {getProjectCreativeStats} from "./project-stats";

const props = withDefaults(defineProps<{
    projects?: readonly ProjectMetadataDto[];
    projectTags?: Record<string, readonly string[]> | ((project: ProjectMetadataDto) => readonly string[] | undefined);
    deleteBusyRoots?: ReadonlySet<string>;
    failedCoverRoots?: ReadonlySet<string>;
    coverRefreshVersions?: Record<string, number>;
    pickerRecoveries?: Readonly<{
        create?: ProjectPickerRecoveryEntry | null;
        deletes: ReadonlyMap<string, ProjectPickerRecoveryEntry>;
    }>;
    resolveCoverUrl?: (projectRoot: string) => string;
    formatDate?: (dateString?: string | null) => string;
}>(), {
    projects: () => [],
    deleteBusyRoots: () => new Set<string>(),
    failedCoverRoots: () => new Set<string>(),
    formatDate: (d?: string | null) => d ?? "",
});

const emit = defineEmits<{
    (e: "open", projectRoot: string): void;
    (e: "delete", project: ProjectMetadataDto): void;
    (e: "retry-delete-recovery", projectRoot: string): void;
    (e: "open-cover-dialog", project: ProjectMetadataDto): void;
    (e: "cover-error", projectRoot: string): void;
    (e: "create-book"): void;
}>();

const {t} = useI18n();

const selectedRoot = ref<string>(props.projects[0]?.projectRoot ?? "");

watch(() => props.projects, (newProjects) => {
    if (newProjects && newProjects.length > 0) {
        const first = newProjects[0];
        if (first && !newProjects.some((p) => p.projectRoot === selectedRoot.value)) {
            selectedRoot.value = first.projectRoot;
        }
    }
}, {immediate: true});

const activeProject = computed(() => {
    return props.projects.find((p) => p.projectRoot === selectedRoot.value) || props.projects[0];
});

function getTagsFor(project: ProjectMetadataDto): readonly string[] | undefined {
    if (!props.projectTags) return undefined;
    if (typeof props.projectTags === "function") {
        return props.projectTags(project);
    }
    return props.projectTags[project.projectRoot];
}

const activeStats = computed(() => {
    if (!activeProject.value) return null;
    return getProjectCreativeStats(activeProject.value, getTagsFor(activeProject.value));
});

function getProjectCoverSrc(project: ProjectMetadataDto): string {
    if (!project.cover) return "";
    const base = props.resolveCoverUrl
        ? props.resolveCoverUrl(project.projectRoot)
        : `/api/projects/cover?${new URLSearchParams({projectRoot: project.projectRoot, preset: "project-cover"}).toString()}`;
    const v = props.coverRefreshVersions?.[project.projectRoot] ?? 0;
    return v > 0 ? `${base}&v=${v}` : base;
}
</script>

<template>
    <div class="cosmos-atlas-view space-y-6 select-none" data-cosmos-atlas-view>
        <!-- 罗盘坐标控制台顶部标头 -->
        <div class="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--border-color)] bg-[color-mix(in_srgb,var(--bg-panel)_70%,transparent)] px-4 py-3 backdrop-blur-md">
            <div class="flex items-center gap-3">
                <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--accent-main)_15%,transparent)] text-[var(--accent-main)] border border-[color-mix(in_srgb,var(--accent-main)_30%,transparent)]">
                    <span class="i-lucide-compass h-4 w-4 animate-spin [animation-duration:18s]"></span>
                </div>
                <div>
                    <h3 class="font-mono text-xs font-bold tracking-wider text-[var(--text-main)] uppercase">
                        ATLAS // 世界观引力罗盘
                    </h3>
                    <p class="text-[10px] font-mono text-[var(--text-muted)]">
                        ORBIT: ACTIVE · {{ activeStats?.cosmosCoordinates ?? "SEC-00 // 00°N 00°E" }}
                    </p>
                </div>
            </div>

            <div class="flex items-center gap-3 text-xs font-mono text-[var(--text-secondary)]">
                <span class="inline-flex items-center gap-1.5 rounded-full bg-[var(--control-surface)] px-2.5 py-1 text-[11px] border border-[var(--border-color)]">
                    <span class="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    已编织世界: {{ projects.length }}
                </span>
                <Button
                    size="sm"
                    variant="secondary"
                    icon-class="i-lucide-plus"
                    @click="emit('create-book')"
                >
                    探索新世界
                </Button>
            </div>
        </div>

        <!-- 主体区域：左侧星系节点网格 / 右侧全息世界档案卡 -->
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <!-- 左侧：世界星座网格 (8 Cols) -->
            <div class="lg:col-span-7 flex flex-col gap-3.5">
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div
                        v-for="(project, index) in projects"
                        :key="project.projectRoot"
                        class="group relative overflow-hidden rounded-xl border p-4 transition-all duration-300 cursor-pointer"
                        :class="[
                            project.projectRoot === selectedRoot
                                ? 'border-[var(--accent-main)] bg-[color-mix(in_srgb,var(--accent-main)_10%,var(--bg-panel))] shadow-lg ring-1 ring-[var(--accent-main)]'
                                : 'border-[var(--border-color)] bg-[var(--bg-panel)] hover:border-[var(--text-secondary)] hover:shadow-md'
                        ]"
                        @click="selectedRoot = project.projectRoot"
                        @dblclick="emit('open', project.projectRoot)"
                    >
                        <!-- 背景极简星轨细线装饰 -->
                        <div class="absolute -right-8 -top-8 h-24 w-24 rounded-full border border-white/5 pointer-events-none group-hover:scale-125 transition-transform duration-500"></div>

                        <div class="flex items-start gap-3">
                            <!-- 星体核心节点 -->
                            <div class="relative flex shrink-0 items-center justify-center">
                                <div
                                    class="h-11 w-11 rounded-full flex items-center justify-center shadow-md transition-transform duration-300 group-hover:scale-110 border"
                                    :style="{
                                        background: `radial-gradient(circle at 30% 30%, ${getProjectCreativeStats(project, getTagsFor(project)).accentColor} 0%, #050811 100%)`,
                                        borderColor: getProjectCreativeStats(project, getTagsFor(project)).accentColor,
                                    }"
                                >
                                    <span class="font-mono text-xs font-bold text-white drop-shadow">
                                        {{ (index + 1).toString().padStart(2, "0") }}
                                    </span>
                                </div>
                                <div
                                    v-if="project.projectRoot === selectedRoot"
                                    class="absolute -inset-1 rounded-full border border-[var(--accent-main)] animate-ping opacity-60 pointer-events-none"
                                ></div>
                            </div>

                            <!-- 世界信息 -->
                            <div class="min-w-0 flex-1">
                                <div class="flex items-center justify-between gap-1">
                                    <span class="font-mono text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
                                        {{ getProjectCreativeStats(project, getTagsFor(project)).genreKey }}
                                    </span>
                                    <span class="font-mono text-[10px] text-[var(--accent-main)]">
                                        {{ getProjectCreativeStats(project, getTagsFor(project)).wordCount }}
                                    </span>
                                </div>

                                <h4 class="mt-0.5 truncate font-serif text-sm font-semibold text-[var(--text-main)] group-hover:text-[var(--accent-main)] transition-colors">
                                    {{ project.title }}
                                </h4>

                                <p class="mt-1 line-clamp-1 text-[11px] text-[var(--text-secondary)]">
                                    {{ getProjectCreativeStats(project, getTagsFor(project)).cosmosEra }}
                                </p>
                            </div>
                        </div>

                        <!-- 底部状态指示行 -->
                        <div class="mt-3 flex items-center justify-between border-t border-[var(--divider)] pt-2 text-[10px] font-mono text-[var(--text-muted)]">
                            <span>大纲演进 {{ getProjectCreativeStats(project, getTagsFor(project)).outlineProgress }}%</span>
                            <span class="group-hover:text-[var(--text-main)] transition-colors">跃迁就绪 ↵</span>
                        </div>
                    </div>

                    <!-- 虚线新探索星域插槽 -->
                    <div
                        class="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-[var(--border-color)] hover:border-[var(--accent-main)] bg-[color-mix(in_srgb,var(--bg-panel)_30%,transparent)] hover:bg-[color-mix(in_srgb,var(--accent-main)_6%,transparent)] p-5 text-center transition-all cursor-pointer min-h-[110px]"
                        @click="emit('create-book')"
                    >
                        <div class="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--control-surface)] text-[var(--text-secondary)] group-hover:text-[var(--accent-main)] group-hover:scale-110 transition-all border border-[var(--border-color)]">
                            <span class="i-lucide-sparkles h-4 w-4"></span>
                        </div>
                        <span class="mt-2 font-mono text-xs font-medium text-[var(--text-secondary)]">未探索星域</span>
                        <span class="text-[10px] text-[var(--text-muted)] font-mono">+ 拓展世界坐标</span>
                    </div>
                </div>
            </div>

            <!-- 右侧：全息世界档案卡 (5 Cols) -->
            <div
                v-if="activeProject && activeStats"
                class="lg:col-span-5 relative overflow-hidden rounded-2xl border border-[var(--panel-outline)] bg-[var(--bg-panel)] p-6 shadow-xl space-y-5"
                :style="{
                    boxShadow: `0 12px 36px -8px ${activeStats.themeGradient.glow}`,
                }"
            >
                <!-- 顶部题材与代号 -->
                <div class="flex items-center justify-between">
                    <Badge size="sm" variant="outline" tone="accent" class="font-mono">
                        {{ activeStats.cosmosCoordinates }}
                    </Badge>
                    <span class="text-xs font-mono text-[var(--text-muted)]">
                        {{ activeStats.genreLabel }}
                    </span>
                </div>

                <!-- 封面图与标题区 -->
                <div class="flex gap-4 items-center">
                    <div
                        class="relative aspect-[2/3] w-20 shrink-0 rounded-md overflow-hidden shadow-md border border-[var(--border-color)]"
                        :class="`bg-gradient-to-br ${activeStats.themeGradient.from} ${activeStats.themeGradient.to}`"
                    >
                        <img
                            v-if="activeProject.cover && !failedCoverRoots.has(activeProject.projectRoot)"
                            :src="getProjectCoverSrc(activeProject)"
                            :alt="activeProject.title"
                            class="h-full w-full object-cover"
                        />
                        <div v-else class="flex h-full w-full items-center justify-center p-2 text-center text-[10px] font-serif text-white/80">
                            {{ activeProject.title.slice(0, 4) }}
                        </div>
                    </div>

                    <div class="min-w-0 flex-1 space-y-1">
                        <h3
                            class="font-serif text-xl font-bold text-[var(--text-main)] hover:text-[var(--accent-main)] cursor-pointer transition-colors"
                            @click="emit('open', activeProject.projectRoot)"
                        >
                            {{ activeProject.title }}
                        </h3>
                        <p class="text-xs text-[var(--accent-main)] font-mono">
                            {{ activeStats.cosmosEra }}
                        </p>
                        <p v-if="activeProject.summary" class="line-clamp-2 text-xs text-[var(--text-secondary)] leading-relaxed">
                            {{ activeProject.summary }}
                        </p>
                    </div>
                </div>

                <!-- 四格世界观核心参数 HUD -->
                <div class="grid grid-cols-2 gap-2.5">
                    <div class="rounded-lg border border-[var(--divider)] bg-[var(--control-surface)] p-2.5 space-y-0.5">
                        <span class="block text-[10px] font-mono text-[var(--text-muted)]">登场势力阵营</span>
                        <span class="font-mono text-sm font-bold text-[var(--text-main)]">{{ activeStats.cosmosFactionCount }} 大派系</span>
                    </div>
                    <div class="rounded-lg border border-[var(--divider)] bg-[var(--control-surface)] p-2.5 space-y-0.5">
                        <span class="block text-[10px] font-mono text-[var(--text-muted)]">在册人物谱系</span>
                        <span class="font-mono text-sm font-bold text-[var(--text-main)]">{{ activeStats.cosmosCharacterCount }} 位角色</span>
                    </div>
                    <div class="rounded-lg border border-[var(--divider)] bg-[var(--control-surface)] p-2.5 space-y-0.5">
                        <span class="block text-[10px] font-mono text-[var(--text-muted)]">累计编织字数</span>
                        <span class="font-mono text-sm font-bold text-[var(--text-main)]">{{ activeStats.wordCount }}</span>
                    </div>
                    <div class="rounded-lg border border-[var(--divider)] bg-[var(--control-surface)] p-2.5 space-y-0.5">
                        <span class="block text-[10px] font-mono text-[var(--text-muted)]">连载章节推进</span>
                        <span class="font-mono text-sm font-bold text-[var(--text-main)]">{{ activeStats.chapterCount }} 章</span>
                    </div>
                </div>

                <!-- 上次驻留观测点 -->
                <div class="rounded-xl border border-[var(--divider)] bg-[color-mix(in_srgb,var(--bg-panel)_40%,transparent)] p-3 space-y-1">
                    <div class="flex items-center gap-1.5 text-[11px] font-mono text-[var(--accent-main)]">
                        <span class="i-lucide-bookmark h-3.5 w-3.5"></span>
                        <span>上次落笔驻留点</span>
                    </div>
                    <p class="font-serif text-xs font-semibold text-[var(--text-main)]">
                        {{ activeStats.lastChapterTitle }}
                    </p>
                </div>

                <!-- 跃迁行动栏 -->
                <div class="flex items-center gap-2 pt-2 border-t border-[var(--divider)]">
                    <IconButton
                        size="md"
                        icon-class="i-lucide-image"
                        :title="t('ide.picker.changeCover')"
                        @click="emit('open-cover-dialog', activeProject)"
                    />
                    <IconButton
                        size="md"
                        variant="danger"
                        icon-class="i-lucide-trash-2"
                        :title="t('ide.picker.deleteProject')"
                        @click="emit('delete', activeProject)"
                    />
                    <Button
                        variant="primary"
                        size="md"
                        icon-class="i-lucide-orbit"
                        class="flex-1 shadow-md"
                        @click="emit('open', activeProject.projectRoot)"
                    >
                        跃迁入轨 (执笔创作)
                        <span class="ml-1 text-[10px] font-mono opacity-70">↵</span>
                    </Button>
                </div>
            </div>
        </div>
    </div>
</template>

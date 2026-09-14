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

// 确保选择的项目始终有效
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

const activeCoverSrc = computed(() => {
    if (!activeProject.value) return "";
    return getProjectCoverSrc(activeProject.value);
});
</script>

<template>
    <div class="spotlight-studio-view space-y-8 select-none" data-spotlight-studio-view>
        <!-- 主聚焦区：Hero 创作剧场 -->
        <section
            v-if="activeProject && activeStats"
            class="spotlight-hero-card relative overflow-hidden rounded-2xl border border-[var(--panel-outline)] p-6 sm:p-8 transition-all duration-500 shadow-xl"
            :style="{
                background: `radial-gradient(ellipse at 20% 30%, ${activeStats.themeGradient.glow} 0%, color-mix(in srgb, var(--bg-panel) 92%, transparent) 75%)`,
            }"
        >
            <div class="relative z-10 flex flex-col md:flex-row gap-6 sm:gap-10 items-center md:items-stretch">
                <!-- 左侧：大画幅精装书封 -->
                <div class="relative flex shrink-0 justify-center">
                    <div
                        class="relative aspect-[2/3] w-44 sm:w-52 rounded-r-md rounded-l-xs overflow-hidden shadow-2xl border border-white/20 transition-transform duration-300 hover:scale-[1.02] cursor-pointer"
                        :class="`bg-gradient-to-br ${activeStats.themeGradient.from} ${activeStats.themeGradient.to}`"
                        @click="emit('open', activeProject.projectRoot)"
                    >
                        <img
                            v-if="activeProject.cover && !failedCoverRoots.has(activeProject.projectRoot)"
                            :src="activeCoverSrc"
                            :alt="activeProject.title"
                            class="h-full w-full object-cover"
                        />
                        <div v-else class="relative h-full w-full flex flex-col justify-between p-4 text-white/90">
                            <div class="flex items-center justify-between text-[11px] text-white/60">
                                <span class="font-mono tracking-widest uppercase">{{ activeStats.genreKey }}</span>
                                <span class="h-2 w-2 rounded-full" :style="{backgroundColor: activeStats.accentColor}"></span>
                            </div>
                            <div class="my-auto text-center space-y-2 px-1">
                                <h3 class="font-serif text-lg font-bold leading-snug drop-shadow-md">
                                    {{ activeProject.title }}
                                </h3>
                                <div class="flex justify-center">
                                    <span class="inline-block h-px w-12 bg-white/30"></span>
                                </div>
                                <p class="text-[10px] text-white/70 font-mono tracking-wider">
                                    {{ activeStats.genreLabel }}
                                </p>
                            </div>
                            <div class="flex items-center justify-between text-[10px] text-white/60 border-t border-white/10 pt-2 font-mono">
                                <span>{{ activeStats.wordCount }}</span>
                                <span>{{ activeStats.chapterCount }} 章</span>
                            </div>
                        </div>

                        <!-- 真实书脊反光与阴影条 -->
                        <div class="absolute inset-y-0 left-0 w-3 bg-gradient-to-r from-black/45 via-transparent to-transparent pointer-events-none"></div>
                        <div class="absolute inset-y-0 left-3 w-px bg-white/20 pointer-events-none"></div>
                        <!-- 底部微露出书签 -->
                        <div
                            class="absolute -bottom-1 left-8 w-3 h-5 rounded-b-xs shadow"
                            :style="{backgroundColor: activeStats.accentColor}"
                        ></div>
                    </div>
                </div>

                <!-- 右侧：作者创作驾驶舱与心流数据 -->
                <div class="min-w-0 flex-1 flex flex-col justify-between space-y-4">
                    <!-- 顶部状态栏 -->
                    <div>
                        <div class="flex flex-wrap items-center gap-2 mb-2">
                            <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] text-[var(--accent-main)] border border-[color-mix(in_srgb,var(--accent-main)_25%,transparent)]">
                                <span class="h-1.5 w-1.5 rounded-full bg-[var(--accent-main)] animate-pulse"></span>
                                主力创作进行中
                            </span>
                            <Badge
                                v-for="tag in (getTagsFor(activeProject) ?? [])"
                                :key="tag"
                                size="sm"
                                variant="outline"
                                tone="neutral"
                            >
                                {{ tag }}
                            </Badge>
                        </div>

                        <h2
                            class="font-serif text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text-main)] hover:text-[var(--accent-main)] transition-colors cursor-pointer"
                            @click="emit('open', activeProject.projectRoot)"
                        >
                            {{ activeProject.title }}
                        </h2>

                        <p v-if="activeProject.summary" class="mt-2 line-clamp-2 text-sm text-[var(--text-secondary)] leading-relaxed">
                            {{ activeProject.summary }}
                        </p>
                    </div>

                    <!-- 上次停笔章节里程碑卡片 -->
                    <div class="rounded-xl border border-[var(--divider)] bg-[color-mix(in_srgb,var(--bg-panel)_50%,transparent)] p-3.5 backdrop-blur-sm space-y-1.5">
                        <div class="flex items-center gap-2 text-xs font-semibold text-[var(--accent-main)]">
                            <span class="i-lucide-bookmark h-3.5 w-3.5"></span>
                            <span>上次停笔进度</span>
                        </div>
                        <p class="font-serif text-sm font-medium text-[var(--text-main)]">
                            {{ activeStats.lastChapterTitle }}
                        </p>
                        <div class="flex items-center justify-between text-[11px] text-[var(--text-muted)] pt-1">
                            <span>资料更新于 {{ props.formatDate(activeProject.manifestUpdatedAt) }}</span>
                            <span class="font-mono">大纲推进 {{ activeStats.outlineProgress }}%</span>
                        </div>
                        <!-- 微型进度条 -->
                        <div class="h-1 w-full rounded-full bg-[var(--control-surface)] overflow-hidden">
                            <div
                                class="h-full rounded-full transition-all duration-500"
                                :style="{
                                    width: `${activeStats.outlineProgress}%`,
                                    backgroundColor: activeStats.accentColor,
                                }"
                            ></div>
                        </div>
                    </div>

                    <!-- 创作指标统计与主操作栏 -->
                    <div class="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-[var(--divider)]">
                        <!-- 核心指标 -->
                        <div class="flex items-center gap-6">
                            <div>
                                <span class="block text-[11px] text-[var(--text-muted)]">总字数</span>
                                <span class="font-mono text-base font-bold text-[var(--text-main)]">{{ activeStats.wordCount }}</span>
                            </div>
                            <div class="h-6 w-px bg-[var(--divider)]"></div>
                            <div>
                                <span class="block text-[11px] text-[var(--text-muted)]">连载章节</span>
                                <span class="font-mono text-base font-bold text-[var(--text-main)]">{{ activeStats.chapterCount }} 章</span>
                            </div>
                        </div>

                        <!-- 主副操作按钮 -->
                        <div class="flex items-center gap-2.5">
                            <IconButton
                                size="md"
                                icon-class="i-lucide-image"
                                :title="t('ide.picker.changeCover')"
                                @click="emit('open-cover-dialog', activeProject)"
                            />
                            <Button
                                variant="primary"
                                size="md"
                                icon-class="i-lucide-pen-tool"
                                class="shadow-md hover:shadow-lg transition-all"
                                @click="emit('open', activeProject.projectRoot)"
                            >
                                继续执笔
                                <span class="ml-1.5 rounded px-1 text-[10px] font-mono bg-black/15 text-white/80">↵</span>
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </section>

        <!-- 次级书架：全部作品流与聚焦切换 -->
        <section class="space-y-4">
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">藏书阁 · 全部作品</h3>
                    <span class="text-xs font-mono text-[var(--text-muted)]">({{ projects.length }})</span>
                </div>
                <span class="text-xs text-[var(--text-muted)]">点击卡片可在上方聚光灯快速检视</span>
            </div>

            <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                <div
                    v-for="project in projects"
                    :key="project.projectRoot"
                    class="group relative flex flex-col rounded-xl border p-3 transition-all duration-200 cursor-pointer"
                    :class="[
                        project.projectRoot === selectedRoot
                            ? 'border-[var(--accent-main)] bg-[color-mix(in_srgb,var(--accent-main)_8%,transparent)] shadow-md ring-1 ring-[var(--accent-main)]'
                            : 'border-[var(--panel-outline)] bg-[var(--bg-panel)] hover:border-[var(--text-secondary)] hover:shadow-sm'
                    ]"
                    @click="selectedRoot = project.projectRoot"
                    @dblclick="emit('open', project.projectRoot)"
                >
                    <!-- 卡片顶部小封面与标题 -->
                    <div class="flex gap-3 items-center">
                        <div
                            class="relative aspect-[2/3] w-12 shrink-0 rounded-xs overflow-hidden shadow-sm border border-[var(--border-color)]"
                            :class="`bg-gradient-to-br ${getProjectCreativeStats(project, getTagsFor(project)).themeGradient.from} ${getProjectCreativeStats(project, getTagsFor(project)).themeGradient.to}`"
                        >
                            <img
                                v-if="project.cover && !failedCoverRoots.has(project.projectRoot)"
                                :src="getProjectCoverSrc(project)"
                                :alt="project.title"
                                class="h-full w-full object-cover"
                            />
                            <div v-else class="flex h-full w-full items-center justify-center p-1 text-center text-[8px] text-white/80 font-serif leading-tight">
                                {{ project.title.slice(0, 4) }}
                            </div>
                        </div>

                        <div class="min-w-0 flex-1">
                            <h4 class="truncate font-serif text-xs font-semibold text-[var(--text-main)] group-hover:text-[var(--accent-main)] transition-colors">
                                {{ project.title }}
                            </h4>
                            <p class="text-[10px] text-[var(--text-muted)] font-mono mt-0.5">
                                {{ getProjectCreativeStats(project, getTagsFor(project)).wordCount }}
                            </p>
                            <div class="mt-1 flex gap-1">
                                <Badge
                                    v-if="getTagsFor(project)?.[0]"
                                    size="sm"
                                    variant="soft"
                                    tone="accent"
                                    class="text-[9px] px-1 py-0 scale-90 origin-left"
                                >
                                    {{ getTagsFor(project)![0] }}
                                </Badge>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 尾部新建入口卡片 -->
                <div
                    class="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-[var(--border-color)] hover:border-[var(--accent-main)] bg-[color-mix(in_srgb,var(--bg-panel)_30%,transparent)] hover:bg-[color-mix(in_srgb,var(--accent-main)_6%,transparent)] p-3 text-center transition-all cursor-pointer min-h-[74px]"
                    @click="emit('create-book')"
                >
                    <span class="i-lucide-plus h-4 w-4 text-[var(--text-secondary)] group-hover:text-[var(--accent-main)]"></span>
                    <span class="mt-1 text-xs font-medium text-[var(--text-secondary)]">新长篇</span>
                </div>
            </div>
        </section>
    </div>
</template>

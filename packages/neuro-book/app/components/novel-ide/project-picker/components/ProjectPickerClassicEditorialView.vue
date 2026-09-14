<script setup lang="ts">
import {ref, computed, watch} from "vue";
import {Badge, Button, IconButton} from "@notnotype/nb-ui/components";
import type {ProjectMetadataDto} from "nbook/shared/dto/project.dto";
import type {ProjectPickerRecoveryEntry} from "nbook/app/utils/project-picker-recovery";
import {getProjectClassicStats} from "./project-stats";

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

const localFailedRoots = ref<Set<string>>(new Set());

watch(() => [props.projects, props.coverRefreshVersions], () => {
    localFailedRoots.value.clear();
}, {deep: true});

function isCoverFailed(projectRoot: string): boolean {
    return Boolean(props.failedCoverRoots?.has(projectRoot) || localFailedRoots.value.has(projectRoot));
}

function handleImageError(projectRoot: string): void {
    localFailedRoots.value.add(projectRoot);
    emit("cover-error", projectRoot);
}

function getTagsFor(project: ProjectMetadataDto): readonly string[] | undefined {
    if (!props.projectTags) return undefined;
    if (typeof props.projectTags === "function") {
        return props.projectTags(project);
    }
    return props.projectTags[project.projectRoot];
}

function getProjectCoverSrc(project: ProjectMetadataDto): string {
    if (!project.cover) return "";
    if (props.resolveCoverUrl) {
        return props.resolveCoverUrl(project.projectRoot);
    }
    const query = new URLSearchParams({projectRoot: project.projectRoot, preset: "project-cover"});
    const v = props.coverRefreshVersions?.[project.projectRoot] ?? 0;
    if (v > 0) {
        query.set("refresh", String(v));
    }
    return `/api/projects/cover?${query.toString()}`;
}
</script>

<template>
    <div class="classic-editorial-view space-y-6 select-none" data-classic-editorial-view>
        <!-- 双列宽幅杂志图文对开网格 -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div
                v-for="project in projects"
                :key="project.projectRoot"
                class="group relative flex flex-col sm:flex-row items-stretch rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-4 sm:p-5 gap-4 sm:gap-5 shadow-sm hover:shadow-xl hover:border-[var(--accent-main)] transition-all duration-300 cursor-pointer overflow-hidden"
                @click="emit('open', project.projectRoot)"
            >
                <!-- 左侧：经典 2:3 书封 -->
                <div class="relative aspect-[2/3] w-28 sm:w-32 shrink-0 rounded-xl overflow-hidden border border-[var(--border-color)] shadow-md mx-auto sm:mx-0 bg-[var(--bg-card)]">
                    <img
                        v-if="project.cover && !isCoverFailed(project.projectRoot)"
                        :key="`${project.projectRoot}:${String(coverRefreshVersions?.[project.projectRoot] ?? 0)}`"
                        :src="getProjectCoverSrc(project)"
                        :alt="project.title"
                        loading="lazy"
                        decoding="async"
                        class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                        @error="handleImageError(project.projectRoot)"
                    />
                    <div
                        v-else
                        class="h-full w-full flex flex-col justify-between p-3 text-center text-white"
                        :class="`bg-gradient-to-br ${getProjectClassicStats(project, getTagsFor(project)).themeGradient.from} ${getProjectClassicStats(project, getTagsFor(project)).themeGradient.to}`"
                    >
                        <span class="text-[9px] font-mono text-white/50 uppercase">
                            {{ getProjectClassicStats(project, getTagsFor(project)).genreKey }}
                        </span>
                        <h4 class="font-serif text-sm font-bold leading-tight drop-shadow line-clamp-3 my-auto">
                            {{ project.title }}
                        </h4>
                        <span class="text-[9px] font-mono text-white/60">
                            {{ getProjectClassicStats(project, getTagsFor(project)).genreLabel }}
                        </span>
                    </div>

                    <!-- 封面左侧微型书脊高光 -->
                    <div class="absolute inset-y-0 left-0 w-1 border-r border-white/10 bg-black/10"></div>
                </div>

                <!-- 右侧：文学排印、大纲进度与操作 -->
                <div class="flex flex-col flex-1 justify-between gap-3 text-left min-w-0">
                    <div class="space-y-1.5">
                        <div class="flex items-start justify-between gap-2">
                            <h3 class="font-serif text-base sm:text-lg font-bold text-[var(--text-main)] group-hover:text-[var(--accent-main)] transition-colors line-clamp-1">
                                {{ project.title }}
                            </h3>
                            <span class="font-mono text-xs font-semibold text-[var(--accent-main)] shrink-0">
                                {{ getProjectClassicStats(project, getTagsFor(project)).wordCount }}
                            </span>
                        </div>

                        <!-- 标签 -->
                        <div v-if="getTagsFor(project)?.length" class="flex flex-wrap gap-1">
                            <Badge
                                v-for="tag in getTagsFor(project)?.slice(0, 3)"
                                :key="tag"
                                size="sm"
                                variant="soft"
                                tone="neutral"
                                class="text-[9px] px-1.5 py-0"
                            >
                                {{ tag }}
                            </Badge>
                        </div>

                        <!-- 简介 -->
                        <p v-if="project.summary" class="text-xs text-[var(--text-secondary)] line-clamp-2 leading-relaxed">
                            {{ project.summary }}
                        </p>
                    </div>

                    <!-- 创作进度与停笔节点 -->
                    <div class="rounded-xl border border-[var(--divider)] bg-[var(--control-surface)] p-2.5 space-y-1.5 text-xs">
                        <div class="flex items-center justify-between text-[11px]">
                            <span class="text-[var(--text-muted)] truncate max-w-[170px]">
                                {{ getProjectClassicStats(project, getTagsFor(project)).lastChapterTitle }}
                            </span>
                            <span class="font-mono text-[10px] text-[var(--text-secondary)]">
                                大纲 {{ getProjectClassicStats(project, getTagsFor(project)).outlineProgress }}%
                            </span>
                        </div>
                        <div class="h-1 w-full rounded-full bg-[var(--border-color)] overflow-hidden">
                            <div
                                class="h-full rounded-full bg-[var(--accent-main)] transition-all duration-300"
                                :style="{width: `${getProjectClassicStats(project, getTagsFor(project)).outlineProgress}%`}"
                            ></div>
                        </div>
                    </div>

                    <!-- 底部操作栏 -->
                    <div class="flex items-center justify-between gap-2 pt-1 border-t border-[var(--divider)]" @click.stop>
                        <span class="text-[10px] font-mono text-[var(--text-muted)]">
                            {{ props.formatDate(project.manifestUpdatedAt) || "正在创作" }}
                        </span>

                        <div class="flex items-center gap-1.5">
                            <IconButton
                                size="sm"
                                icon-class="i-lucide-image"
                                :title="t('ide.picker.changeCover')"
                                @click="emit('open-cover-dialog', project)"
                            />
                            <IconButton
                                size="sm"
                                variant="danger"
                                icon-class="i-lucide-trash-2"
                                :title="t('ide.picker.deleteProject')"
                                @click="emit('delete', project)"
                            />
                            <Button
                                variant="primary"
                                size="sm"
                                icon-class="i-lucide-pen-tool"
                                @click="emit('open', project.projectRoot)"
                            >
                                执笔创作
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 新建书籍插槽卡片 -->
            <div
                class="group flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[var(--border-color)] hover:border-[var(--accent-main)] bg-[color-mix(in_srgb,var(--bg-panel)_40%,transparent)] hover:bg-[color-mix(in_srgb,var(--accent-main)_6%,transparent)] p-6 text-center transition-all cursor-pointer min-h-[190px]"
                @click="emit('create-book')"
            >
                <div class="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--control-surface)] text-[var(--text-secondary)] group-hover:text-[var(--accent-main)] group-hover:scale-110 transition-all border border-[var(--border-color)] shadow-sm">
                    <span class="i-lucide-plus h-5 w-5"></span>
                </div>
                <h4 class="mt-3 font-serif text-sm font-semibold text-[var(--text-main)]">立项新长篇作品</h4>
                <p class="mt-1 text-[11px] text-[var(--text-muted)] font-mono">开启新的小说章节与大纲</p>
            </div>
        </div>
    </div>
</template>

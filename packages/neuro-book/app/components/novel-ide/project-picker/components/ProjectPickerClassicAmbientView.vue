<script setup lang="ts">
import {ref, computed} from "vue";
import {Badge, IconButton} from "@notnotype/nb-ui/components";
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
    <div class="classic-ambient-view space-y-6 select-none" data-classic-ambient-view>
        <!-- 沉浸网格陈列 -->
        <div class="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            <div
                v-for="project in projects"
                :key="project.projectRoot"
                class="group relative flex flex-col rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-3 shadow-sm hover:shadow-xl hover:border-[var(--accent-main)] transition-all duration-300 cursor-pointer"
                @click="emit('open', project.projectRoot)"
            >
                <!-- 封面容器 (含悬停漫射光晕与立体圆角) -->
                <div class="relative aspect-[2/3] w-full overflow-hidden rounded-xl border border-[var(--border-color)] bg-neutral-900 transition-transform duration-300 group-hover:-translate-y-1.5 shadow-md">
                    <img
                        v-if="project.cover && !failedCoverRoots.has(project.projectRoot)"
                        :src="getProjectCoverSrc(project)"
                        :alt="project.title"
                        class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                    <!-- 排版回退书封 -->
                    <div
                        v-else
                        class="h-full w-full flex flex-col justify-between p-3.5 text-center text-white"
                        :class="`bg-gradient-to-br ${getProjectClassicStats(project, getTagsFor(project)).themeGradient.from} ${getProjectClassicStats(project, getTagsFor(project)).themeGradient.to}`"
                    >
                        <div class="flex items-center justify-between text-[10px] text-white/50 font-mono">
                            <span class="uppercase tracking-wider">{{ getProjectClassicStats(project, getTagsFor(project)).genreKey }}</span>
                            <span class="i-lucide-feather h-3 w-3"></span>
                        </div>

                        <div class="my-auto space-y-1 px-1">
                            <h4 class="font-serif text-sm sm:text-base font-bold leading-snug drop-shadow line-clamp-3">
                                {{ project.title }}
                            </h4>
                            <div class="h-0.5 w-6 rounded-full bg-[var(--accent-main)] mx-auto opacity-70"></div>
                        </div>

                        <div class="text-[9px] font-mono text-white/60">
                            {{ getProjectClassicStats(project, getTagsFor(project)).genreLabel }}
                        </div>
                    </div>

                    <!-- 封面右下角字数与章节徽章 -->
                    <div class="absolute bottom-1.5 right-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[9px] font-mono text-white/90 backdrop-blur-md border border-white/10">
                        {{ getProjectClassicStats(project, getTagsFor(project)).wordCount }}
                    </div>

                    <!-- 悬浮快捷操作胶囊 (毛玻璃) -->
                    <div
                        class="absolute top-1.5 right-1.5 flex items-center gap-1 rounded-full bg-black/60 p-1 backdrop-blur-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 border border-white/15"
                        @click.stop
                    >
                        <IconButton
                            size="sm"
                            icon-class="i-lucide-image"
                            :title="t('ide.picker.changeCover')"
                            class="text-white hover:text-[var(--accent-main)]"
                            @click="emit('open-cover-dialog', project)"
                        />
                        <IconButton
                            size="sm"
                            variant="danger"
                            icon-class="i-lucide-trash-2"
                            :title="t('ide.picker.deleteProject')"
                            @click="emit('delete', project)"
                        />
                    </div>
                </div>

                <!-- 封面下方元数据与标题 -->
                <div class="mt-3 flex flex-col flex-1 justify-between gap-2 text-left">
                    <div>
                        <h3 class="font-serif text-sm font-bold text-[var(--text-main)] group-hover:text-[var(--accent-main)] transition-colors line-clamp-1">
                            {{ project.title }}
                        </h3>

                        <!-- 标签徽章 -->
                        <div v-if="getTagsFor(project)?.length" class="mt-1 flex flex-wrap gap-1">
                            <Badge
                                v-for="tag in getTagsFor(project)?.slice(0, 2)"
                                :key="tag"
                                size="sm"
                                variant="soft"
                                tone="neutral"
                                class="text-[9px] px-1 py-0"
                            >
                                {{ tag }}
                            </Badge>
                        </div>

                        <p v-if="project.summary" class="mt-1 text-[11px] text-[var(--text-secondary)] line-clamp-2 leading-relaxed">
                            {{ project.summary }}
                        </p>
                    </div>

                    <!-- 底部停笔章节与更新时间 -->
                    <div class="flex items-center justify-between pt-1 text-[10px] text-[var(--text-muted)] border-t border-[var(--divider)]">
                        <span class="truncate max-w-[120px]">{{ getProjectClassicStats(project, getTagsFor(project)).lastChapterTitle }}</span>
                        <span class="i-lucide-arrow-right h-3 w-3 text-[var(--accent-main)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0"></span>
                    </div>
                </div>
            </div>

            <!-- 新建书籍展台插槽 -->
            <div
                class="group relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[var(--border-color)] hover:border-[var(--accent-main)] bg-[color-mix(in_srgb,var(--bg-panel)_40%,transparent)] hover:bg-[color-mix(in_srgb,var(--accent-main)_6%,transparent)] p-6 text-center transition-all cursor-pointer min-h-[260px]"
                @click="emit('create-book')"
            >
                <div class="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--control-surface)] text-[var(--text-secondary)] group-hover:text-[var(--accent-main)] group-hover:scale-110 transition-all border border-[var(--border-color)] shadow-sm">
                    <span class="i-lucide-plus h-5 w-5"></span>
                </div>
                <h4 class="mt-3 font-serif text-sm font-semibold text-[var(--text-main)]">新建长篇作品</h4>
                <p class="mt-1 text-[10px] text-[var(--text-muted)] font-mono">开启新的创作世界</p>
            </div>
        </div>
    </div>
</template>

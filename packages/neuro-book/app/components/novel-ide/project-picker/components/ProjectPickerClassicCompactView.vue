<script setup lang="ts">
import {ref, computed} from "vue";
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
    <div class="classic-compact-view space-y-4 select-none" data-classic-compact-view>
        <!-- 列表容器 -->
        <div class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] overflow-hidden shadow-sm divide-y divide-[var(--divider)]">
            <div
                v-for="project in projects"
                :key="project.projectRoot"
                class="group flex flex-col sm:flex-row items-start sm:items-center justify-between p-3.5 sm:p-4 gap-4 hover:bg-[color-mix(in_srgb,var(--accent-main)_4%,var(--bg-panel))] transition-colors cursor-pointer"
                @click="emit('open', project.projectRoot)"
            >
                <!-- 左侧：微型书封与核心书目信息 -->
                <div class="flex items-center gap-3.5 min-w-0 flex-1">
                    <!-- 微型书封 (40px × 60px) -->
                    <div class="relative aspect-[2/3] w-10 sm:w-11 shrink-0 rounded-md overflow-hidden border border-[var(--border-color)] shadow-xs">
                        <img
                            v-if="project.cover && !failedCoverRoots.has(project.projectRoot)"
                            :src="getProjectCoverSrc(project)"
                            :alt="project.title"
                            class="h-full w-full object-cover"
                        />
                        <div
                            v-else
                            class="h-full w-full flex items-center justify-center p-1 text-center text-[7px] text-white font-serif leading-tight"
                            :class="`bg-gradient-to-br ${getProjectClassicStats(project, getTagsFor(project)).themeGradient.from} ${getProjectClassicStats(project, getTagsFor(project)).themeGradient.to}`"
                        >
                            {{ project.title.slice(0, 4) }}
                        </div>
                    </div>

                    <!-- 标题、简介与停笔进度 -->
                    <div class="min-w-0 flex-1 space-y-0.5">
                        <div class="flex items-center gap-2 flex-wrap">
                            <h3 class="font-serif text-sm sm:text-base font-bold text-[var(--text-main)] group-hover:text-[var(--accent-main)] transition-colors truncate">
                                {{ project.title }}
                            </h3>
                            <Badge
                                v-if="getTagsFor(project)?.[0]"
                                size="sm"
                                variant="soft"
                                tone="neutral"
                                class="text-[9px] px-1.5 py-0"
                            >
                                {{ getTagsFor(project)![0] }}
                            </Badge>
                        </div>

                        <p v-if="project.summary" class="text-xs text-[var(--text-secondary)] line-clamp-1">
                            {{ project.summary }}
                        </p>

                        <div class="flex items-center gap-2 text-[10px] text-[var(--text-muted)] font-mono">
                            <span class="truncate">上次停笔：{{ getProjectClassicStats(project, getTagsFor(project)).lastChapterTitle }}</span>
                        </div>
                    </div>
                </div>

                <!-- 右侧：指标参数与操作按键组 -->
                <div class="flex items-center justify-between sm:justify-end gap-4 sm:gap-6 w-full sm:w-auto shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-[var(--divider)]">
                    <!-- 字数与篇幅指标 -->
                    <div class="flex items-center gap-5 text-right font-mono text-xs">
                        <div>
                            <span class="block text-[10px] text-[var(--text-muted)]">累计字数</span>
                            <span class="font-bold text-[var(--text-main)]">{{ getProjectClassicStats(project, getTagsFor(project)).wordCount }}</span>
                        </div>
                        <div>
                            <span class="block text-[10px] text-[var(--text-muted)]">连载章节</span>
                            <span class="font-bold text-[var(--text-main)]">{{ getProjectClassicStats(project, getTagsFor(project)).chapterCount }} 章</span>
                        </div>
                        <div class="hidden md:block">
                            <span class="block text-[10px] text-[var(--text-muted)]">更新时间</span>
                            <span class="text-[11px] text-[var(--text-secondary)]">{{ props.formatDate(project.manifestUpdatedAt) || "正在创作" }}</span>
                        </div>
                    </div>

                    <!-- 操作按钮组 -->
                    <div class="flex items-center gap-1.5" @click.stop>
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
                            variant="secondary"
                            size="sm"
                            icon-class="i-lucide-edit-3"
                            class="ml-1"
                            @click="emit('open', project.projectRoot)"
                        >
                            继续执笔
                        </Button>
                    </div>
                </div>
            </div>
        </div>

        <!-- 底部快速新建按钮 -->
        <button
            type="button"
            class="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border-color)] hover:border-[var(--accent-main)] py-3 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-main)] hover:bg-[color-mix(in_srgb,var(--accent-main)_4%,transparent)] transition-all cursor-pointer"
            @click="emit('create-book')"
        >
            <span class="i-lucide-plus h-4 w-4"></span>
            <span>开启一部新小说作品</span>
        </button>
    </div>
</template>

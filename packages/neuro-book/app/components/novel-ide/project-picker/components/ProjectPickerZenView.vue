<script setup lang="ts">
import {ref, computed, watch} from "vue";
import {Button, IconButton} from "@notnotype/nb-ui/components";
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

const expandedRoot = ref<string>(props.projects[0]?.projectRoot ?? "");

watch(() => props.projects, (newProjects) => {
    if (newProjects && newProjects.length > 0) {
        const first = newProjects[0];
        if (first && !newProjects.some((p) => p.projectRoot === expandedRoot.value)) {
            expandedRoot.value = first.projectRoot;
        }
    }
}, {immediate: true});

function getTagsFor(project: ProjectMetadataDto): readonly string[] | undefined {
    if (!props.projectTags) return undefined;
    if (typeof props.projectTags === "function") {
        return props.projectTags(project);
    }
    return props.projectTags[project.projectRoot];
}

function toggleExpand(projectRoot: string): void {
    expandedRoot.value = expandedRoot.value === projectRoot ? "" : projectRoot;
}

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
    <div class="zen-manuscript-view space-y-6 select-none max-w-4xl mx-auto" data-zen-manuscript-view>
        <!-- 瑞士排印极简页眉 -->
        <div class="flex items-baseline justify-between border-b border-[var(--text-main)] pb-3">
            <div class="flex items-baseline gap-3">
                <span class="font-mono text-xl font-bold tracking-tight text-[var(--text-main)]">01</span>
                <span class="font-mono text-xs font-semibold tracking-widest text-[var(--text-muted)] uppercase">
                    / MANUSCRIPTS ARCHIVE
                </span>
            </div>
            <div class="flex items-center gap-4 text-xs font-mono text-[var(--text-secondary)]">
                <span>卷册: {{ projects.length }}</span>
                <span class="hidden sm:inline text-[var(--divider)]">|</span>
                <span class="hidden sm:inline text-[var(--text-muted)]">点击条目展开手稿摘录</span>
            </div>
        </div>

        <!-- 手稿手风琴风琴流 -->
        <div class="divide-y divide-[var(--divider)] border-b border-[var(--divider)]">
            <div
                v-for="(project, index) in projects"
                :key="project.projectRoot"
                class="transition-colors duration-200"
                :class="project.projectRoot === expandedRoot ? 'bg-[color-mix(in_srgb,var(--bg-panel)_60%,transparent)]' : 'hover:bg-[color-mix(in_srgb,var(--bg-panel)_30%,transparent)]'"
            >
                <!-- 折叠条目头 -->
                <div
                    class="flex items-center justify-between py-4 sm:py-5 px-3 sm:px-4 cursor-pointer gap-4"
                    @click="toggleExpand(project.projectRoot)"
                    @dblclick="emit('open', project.projectRoot)"
                >
                    <div class="flex items-baseline gap-4 sm:gap-6 min-w-0 flex-1">
                        <!-- 编号 -->
                        <span class="font-mono text-xs text-[var(--text-muted)] shrink-0 w-6">
                            {{ (index + 1).toString().padStart(2, "0") }}
                        </span>

                        <!-- 标题与副题 -->
                        <div class="min-w-0 flex-1">
                            <div class="flex flex-wrap items-baseline gap-2">
                                <h3 class="font-serif text-base sm:text-lg font-bold text-[var(--text-main)] hover:text-[var(--accent-main)] transition-colors">
                                    {{ project.title }}
                                </h3>
                                <span class="hidden sm:inline font-mono text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
                                    {{ getProjectCreativeStats(project, getTagsFor(project)).zenSubtitle }}
                                </span>
                            </div>
                            <div class="mt-0.5 flex items-center gap-3 text-xs font-mono text-[var(--text-muted)]">
                                <span>{{ getProjectCreativeStats(project, getTagsFor(project)).genreLabel }}</span>
                                <span>·</span>
                                <span>{{ getProjectCreativeStats(project, getTagsFor(project)).wordCount }}</span>
                            </div>
                        </div>
                    </div>

                    <!-- 右侧日期与展开图标 -->
                    <div class="flex items-center gap-4 shrink-0 font-mono text-xs text-[var(--text-muted)]">
                        <span class="hidden md:inline">{{ props.formatDate(project.manifestUpdatedAt) || "正在创作" }}</span>
                        <span
                            class="i-lucide-chevron-down h-4 w-4 transition-transform duration-300"
                            :class="project.projectRoot === expandedRoot ? 'rotate-180 text-[var(--text-main)]' : 'text-[var(--text-muted)]'"
                        ></span>
                    </div>
                </div>

                <!-- 展开内容区：文豪手稿金句折页 -->
                <div
                    v-if="project.projectRoot === expandedRoot"
                    class="px-4 sm:px-6 pb-6 pt-1 space-y-5 animate-in fade-in slide-in-from-top-2 duration-300"
                >
                    <!-- 金句手稿引用块 -->
                    <div class="relative pl-5 sm:pl-6 border-l-2 border-[var(--text-main)] py-2">
                        <p class="font-serif text-sm sm:text-base italic leading-relaxed text-[var(--text-main)]">
                            {{ getProjectCreativeStats(project, getTagsFor(project)).zenQuote }}
                        </p>
                        <span class="mt-2 block font-mono text-[11px] text-[var(--text-muted)]">
                            —— 上次停笔驻足点 · {{ getProjectCreativeStats(project, getTagsFor(project)).lastChapterTitle }}
                        </span>
                    </div>

                    <!-- 简介概要 -->
                    <p v-if="project.summary" class="text-xs text-[var(--text-secondary)] leading-relaxed max-w-2xl">
                        {{ project.summary }}
                    </p>

                    <!-- 手稿参数与行动栏 -->
                    <div class="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-[var(--divider)]">
                        <!-- 状态指标 -->
                        <div class="flex items-center gap-6 text-xs font-mono text-[var(--text-secondary)]">
                            <div>
                                <span class="text-[var(--text-muted)]">连载章节：</span>
                                <span class="font-bold text-[var(--text-main)]">{{ getProjectCreativeStats(project, getTagsFor(project)).chapterCount }} 章</span>
                            </div>
                            <div>
                                <span class="text-[var(--text-muted)]">大纲完成：</span>
                                <span class="font-bold text-[var(--text-main)]">{{ getProjectCreativeStats(project, getTagsFor(project)).outlineProgress }}%</span>
                            </div>
                        </div>

                        <!-- 极简高反差操作按钮组 -->
                        <div class="flex items-center gap-2">
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
                                icon-class="i-lucide-feather"
                                @click="emit('open', project.projectRoot)"
                            >
                                展卷落笔 (Enter)
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- 开启新手稿卷轴按钮 -->
        <div class="pt-2">
            <button
                type="button"
                class="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border-color)] hover:border-[var(--text-main)] py-3.5 text-xs font-mono text-[var(--text-secondary)] hover:text-[var(--text-main)] hover:bg-[color-mix(in_srgb,var(--bg-panel)_50%,transparent)] transition-all"
                @click="emit('create-book')"
            >
                <span class="i-lucide-plus h-3.5 w-3.5"></span>
                <span>+ 开启新手稿卷轴 (START NEW MANUSCRIPT)</span>
            </button>
        </div>
    </div>
</template>

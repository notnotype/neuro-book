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

const scrollContainer = ref<HTMLElement | null>(null);

function scrollLeft(): void {
    if (scrollContainer.value) {
        scrollContainer.value.scrollBy({left: -320, behavior: "smooth"});
    }
}

function scrollRight(): void {
    if (scrollContainer.value) {
        scrollContainer.value.scrollBy({left: 320, behavior: "smooth"});
    }
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
    const base = props.resolveCoverUrl
        ? props.resolveCoverUrl(project.projectRoot)
        : `/api/projects/cover?${new URLSearchParams({projectRoot: project.projectRoot, preset: "project-cover"}).toString()}`;
    const v = props.coverRefreshVersions?.[project.projectRoot] ?? 0;
    return v > 0 ? `${base}&v=${v}` : base;
}
</script>

<template>
    <div class="chronicle-film-view space-y-6 select-none" data-chronicle-film-view>
        <!-- 胶卷时间走廊标头与左右滑轨操作 -->
        <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
                <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--accent-main)_15%,transparent)] text-[var(--accent-main)] border border-[color-mix(in_srgb,var(--accent-main)_30%,transparent)]">
                    <span class="i-lucide-film h-4 w-4"></span>
                </div>
                <div>
                    <h3 class="font-mono text-xs font-bold tracking-wider text-[var(--text-main)] uppercase">
                        CHRONICLE // 创作时间走廊
                    </h3>
                    <p class="text-[10px] font-mono text-[var(--text-muted)]">
                        FILM REEL ARCHIVE · 左右平移回溯叙事旅程
                    </p>
                </div>
            </div>

            <div class="flex items-center gap-2">
                <IconButton
                    size="sm"
                    icon-class="i-lucide-chevron-left"
                    title="向左平移胶卷"
                    @click="scrollLeft"
                />
                <IconButton
                    size="sm"
                    icon-class="i-lucide-chevron-right"
                    title="向右平移胶卷"
                    @click="scrollRight"
                />
                <Button
                    size="sm"
                    variant="secondary"
                    icon-class="i-lucide-plus"
                    class="ml-2"
                    @click="emit('create-book')"
                >
                    装填新胶卷
                </Button>
            </div>
        </div>

        <!-- 横向连续胶卷滑轨容器 -->
        <div
            ref="scrollContainer"
            class="flex items-stretch gap-6 overflow-x-auto pb-4 pt-1 scrollbar-none snap-x snap-mandatory"
            style="scroll-behavior: smooth;"
        >
            <!-- 胶卷卡片 -->
            <div
                v-for="project in projects"
                :key="project.projectRoot"
                class="group relative flex w-[290px] sm:w-[320px] shrink-0 flex-col overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-md hover:shadow-xl hover:border-[var(--accent-main)] transition-all duration-300 snap-start cursor-pointer"
                @dblclick="emit('open', project.projectRoot)"
            >
                <!-- 顶部电影胶片齿孔行 (Film Sprockets) -->
                <div class="flex items-center justify-between bg-black/40 px-3 py-1.5 border-b border-white/10 text-white/60">
                    <div class="flex items-center gap-1.5">
                        <span class="h-2 w-1.5 rounded-xs bg-white/25"></span>
                        <span class="h-2 w-1.5 rounded-xs bg-white/25"></span>
                        <span class="h-2 w-1.5 rounded-xs bg-white/25"></span>
                    </div>
                    <span class="font-mono text-[10px] tracking-widest uppercase">
                        {{ getProjectCreativeStats(project, getTagsFor(project)).chronicleReelNo }} · 35MM
                    </span>
                    <div class="flex items-center gap-1.5">
                        <span class="h-2 w-1.5 rounded-xs bg-white/25"></span>
                        <span class="h-2 w-1.5 rounded-xs bg-white/25"></span>
                        <span class="h-2 w-1.5 rounded-xs bg-white/25"></span>
                    </div>
                </div>

                <!-- 宽银幕电影封面画幅 (16:9) -->
                <div
                    class="relative aspect-[16/9] w-full overflow-hidden border-b border-[var(--border-color)] bg-slate-900"
                    :class="`bg-gradient-to-br ${getProjectCreativeStats(project, getTagsFor(project)).themeGradient.from} ${getProjectCreativeStats(project, getTagsFor(project)).themeGradient.to}`"
                >
                    <img
                        v-if="project.cover && !failedCoverRoots.has(project.projectRoot)"
                        :src="getProjectCoverSrc(project)"
                        :alt="project.title"
                        class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                    <div v-else class="flex h-full w-full flex-col items-center justify-center p-4 text-center text-white">
                        <span class="font-mono text-[10px] text-white/50 uppercase tracking-widest">
                            {{ getProjectCreativeStats(project, getTagsFor(project)).genreKey }}
                        </span>
                        <h4 class="font-serif text-lg font-bold drop-shadow mt-1">
                            {{ project.title }}
                        </h4>
                    </div>

                    <!-- 浮动时间刻度标 -->
                    <div class="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-mono text-white/80 backdrop-blur-sm border border-white/10">
                        {{ getProjectCreativeStats(project, getTagsFor(project)).chronicleTimelineDate }}
                    </div>
                </div>

                <!-- 胶片信息主体 -->
                <div class="p-4 flex flex-col flex-1 justify-between gap-4">
                    <div class="space-y-1.5">
                        <div class="flex items-center justify-between">
                            <h4 class="truncate font-serif text-base font-bold text-[var(--text-main)] group-hover:text-[var(--accent-main)] transition-colors">
                                {{ project.title }}
                            </h4>
                            <span class="font-mono text-xs font-semibold text-[var(--accent-main)]">
                                {{ getProjectCreativeStats(project, getTagsFor(project)).wordCount }}
                            </span>
                        </div>
                        <p v-if="project.summary" class="line-clamp-2 text-xs text-[var(--text-secondary)] leading-relaxed">
                            {{ project.summary }}
                        </p>
                    </div>

                    <!-- 核心特色：灵感热力电波 (Sparkline Waveform) -->
                    <div class="rounded-xl border border-[var(--divider)] bg-[var(--control-surface)] p-3 space-y-2">
                        <div class="flex items-center justify-between text-[10px] font-mono text-[var(--text-muted)]">
                            <span class="flex items-center gap-1">
                                <span class="i-lucide-activity h-3 w-3 text-[var(--accent-main)]"></span>
                                灵感产出心电图
                            </span>
                            <span class="text-[var(--accent-main)] font-semibold">
                                {{ getProjectCreativeStats(project, getTagsFor(project)).chronicleWeeklyWords }}
                            </span>
                        </div>

                        <!-- 7日产出柱状波形 -->
                        <div class="flex items-end justify-between gap-1.5 h-8 px-1">
                            <div
                                v-for="(val, barIdx) in getProjectCreativeStats(project, getTagsFor(project)).chronicleActivitySparkline"
                                :key="barIdx"
                                class="flex-1 rounded-xs bg-[var(--accent-main)] transition-all duration-300"
                                :style="{
                                    height: `${Math.max(15, (val / 120) * 100)}%`,
                                    opacity: 0.35 + (barIdx * 0.1),
                                }"
                            ></div>
                        </div>
                    </div>

                    <!-- 上次停笔分镜 -->
                    <div class="flex items-center gap-2 text-xs text-[var(--text-muted)] font-mono">
                        <span class="i-lucide-clapperboard h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)]"></span>
                        <span class="truncate">停笔：{{ getProjectCreativeStats(project, getTagsFor(project)).lastChapterTitle }}</span>
                    </div>

                    <!-- 胶片底部操作栏 -->
                    <div class="flex items-center justify-between gap-2 pt-2 border-t border-[var(--divider)]">
                        <div class="flex items-center gap-1">
                            <IconButton
                                size="sm"
                                icon-class="i-lucide-image"
                                :title="t('ide.picker.changeCover')"
                                @click.stop="emit('open-cover-dialog', project)"
                            />
                            <IconButton
                                size="sm"
                                variant="danger"
                                icon-class="i-lucide-trash-2"
                                :title="t('ide.picker.deleteProject')"
                                @click.stop="emit('delete', project)"
                            />
                        </div>

                        <Button
                            variant="primary"
                            size="sm"
                            icon-class="i-lucide-play"
                            @click.stop="emit('open', project.projectRoot)"
                        >
                            开机推进 ▶
                        </Button>
                    </div>
                </div>

                <!-- 底部电影胶片齿孔行 -->
                <div class="flex items-center justify-between bg-black/40 px-3 py-1 border-t border-white/10">
                    <div class="flex items-center gap-1.5">
                        <span class="h-1.5 w-1.5 rounded-full bg-white/20"></span>
                        <span class="h-1.5 w-1.5 rounded-full bg-white/20"></span>
                    </div>
                    <span class="font-mono text-[9px] text-white/40 tracking-widest uppercase">
                        NEUROBOOK FILM ARCHIVE
                    </span>
                    <div class="flex items-center gap-1.5">
                        <span class="h-1.5 w-1.5 rounded-full bg-white/20"></span>
                        <span class="h-1.5 w-1.5 rounded-full bg-white/20"></span>
                    </div>
                </div>
            </div>

            <!-- 装填新胶卷卡片 -->
            <div
                class="flex w-[240px] shrink-0 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[var(--border-color)] hover:border-[var(--accent-main)] bg-[color-mix(in_srgb,var(--bg-panel)_30%,transparent)] hover:bg-[color-mix(in_srgb,var(--accent-main)_6%,transparent)] p-6 text-center transition-all cursor-pointer snap-start"
                @click="emit('create-book')"
            >
                <div class="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--control-surface)] text-[var(--text-secondary)] group-hover:text-[var(--accent-main)] group-hover:scale-110 transition-all border border-[var(--border-color)] shadow-sm">
                    <span class="i-lucide-film h-6 w-6"></span>
                </div>
                <span class="mt-3 font-mono text-sm font-semibold text-[var(--text-main)]">装填新长篇胶卷</span>
                <span class="mt-1 text-[11px] text-[var(--text-muted)] font-mono">+ 开启全新篇章分镜</span>
            </div>
        </div>
    </div>
</template>

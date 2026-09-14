<script setup lang="ts">
import {ref, computed, watch} from "vue";
import {Button, IconButton} from "@notnotype/nb-ui/components";
import type {ProjectMetadataDto} from "nbook/shared/dto/project.dto";
import type {ProjectPickerRecoveryEntry} from "nbook/app/utils/project-picker-recovery";
import {getCollectorBookStats} from "./project-stats";

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
    const base = props.resolveCoverUrl
        ? props.resolveCoverUrl(project.projectRoot)
        : `/api/projects/cover?${new URLSearchParams({projectRoot: project.projectRoot, preset: "project-cover"}).toString()}`;
    const v = props.coverRefreshVersions?.[project.projectRoot] ?? 0;
    return v > 0 ? `${base}&v=${v}` : base;
}
</script>

<template>
    <div class="gilded-folio-collector-view space-y-8 select-none py-2" data-gilded-folio-collector-view>
        <!-- 档案馆顶部标头 -->
        <div class="flex items-center justify-between border-b border-[#2d251d] pb-3">
            <div class="flex items-center gap-3">
                <div class="flex h-9 w-9 items-center justify-center rounded bg-[#261e17] border border-[#c5a059]/50 shadow text-[#e8c872]">
                    <span class="i-lucide-library h-4 w-4"></span>
                </div>
                <div>
                    <h3 class="font-serif text-base font-bold text-[var(--text-main)] tracking-wider">
                        皇家特藏密室 · 烫金函套典籍
                    </h3>
                    <p class="text-[10px] font-mono text-[#c5a059]/80 uppercase tracking-widest">
                        ARCHIVUM REGALIS · 手工函套对开本
                    </p>
                </div>
            </div>

            <Button
                variant="secondary"
                size="sm"
                icon-class="i-lucide-plus"
                class="border-[#c5a059]/40 hover:border-[#c5a059]"
                @click="emit('create-book')"
            >
                立项新函套
            </Button>
        </div>

        <!-- 对开函套卡片网格 (Slipcase Folio Grid) -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div
                v-for="(project, idx) in projects"
                :key="project.projectRoot"
                class="group relative flex flex-col rounded-2xl border-2 border-[#3d3124] hover:border-[#c5a059] bg-[#14100c] shadow-xl hover:shadow-2xl transition-all duration-300 overflow-hidden cursor-pointer"
                @dblclick="emit('open', project.projectRoot)"
            >
                <!-- 函套外封顶边金色铭文 (Slipcase Spine Top) -->
                <div class="flex items-center justify-between bg-gradient-to-r from-[#201812] to-[#17110c] px-4 py-2 border-b border-[#362a1e] text-[10px] font-mono">
                    <span class="text-[#c5a059] font-bold tracking-widest">
                        {{ getCollectorBookStats(project, idx).tomeRoman }} · {{ getCollectorBookStats(project, idx).catalogCode }}
                    </span>
                    <span class="text-[var(--text-muted)]">
                        {{ getCollectorBookStats(project, idx).wordCount }}
                    </span>
                </div>

                <!-- 函套抽出视窗主体：大理石花纹背景 + 半抽出精装书封 -->
                <div class="relative p-5 space-y-4">
                    <!-- 大理石花纹背衬微弱光影 -->
                    <div
                        class="absolute inset-0 opacity-10 pointer-events-none"
                        :style="{background: getCollectorBookStats(project, idx).marbledBg}"
                    ></div>

                    <!-- 函套内抽出的硬壳精装本书本外观 -->
                    <div class="relative flex gap-4 items-center">
                        <!-- 典藏封面 -->
                        <div
                            class="relative aspect-[2/3] w-24 sm:w-28 shrink-0 rounded-r-md rounded-l-xs overflow-hidden shadow-2xl border border-[#c5a059]/60 transition-transform duration-300 group-hover:scale-105"
                            :style="{
                                background: getCollectorBookStats(project, idx).leatherGradient,
                                boxShadow: '0 12px 24px rgba(0,0,0,0.8), 0 0 16px rgba(197,160,89,0.2)',
                            }"
                            @click="emit('open', project.projectRoot)"
                        >
                            <!-- 烫金细框 -->
                            <div class="absolute inset-1 border border-[#f3cc69]/30 pointer-events-none"></div>

                            <img
                                v-if="project.cover && !failedCoverRoots.has(project.projectRoot)"
                                :src="getProjectCoverSrc(project)"
                                :alt="project.title"
                                class="h-full w-full object-cover"
                            />
                            <div v-else class="h-full w-full flex flex-col justify-between p-2.5 text-center text-[#f3cc69]">
                                <span class="font-mono text-[8px] opacity-70">LIBER</span>
                                <h4 class="font-serif text-xs font-bold leading-tight line-clamp-3 my-auto">
                                    {{ project.title }}
                                </h4>
                                <span class="font-mono text-[7px] opacity-60">
                                    {{ getCollectorBookStats(project, idx).volumeName }}
                                </span>
                            </div>

                            <!-- 底部微型书签丝带 -->
                            <div
                                class="absolute -bottom-2 left-1/2 -translate-x-1/2 w-2 h-4 rounded-b shadow"
                                :style="{backgroundColor: getCollectorBookStats(project, idx).ribbonColor}"
                            ></div>
                        </div>

                        <!-- 右侧铭牌与停笔卷标 -->
                        <div class="min-w-0 flex-1 space-y-2">
                            <div>
                                <h3 class="font-serif text-lg font-bold text-[var(--text-main)] group-hover:text-[#f3cc69] transition-colors truncate">
                                    {{ project.title }}
                                </h3>
                                <p class="font-serif text-[11px] italic text-[#c5a059]/80 truncate">
                                    {{ getCollectorBookStats(project, idx).exLibrisMotto }}
                                </p>
                            </div>

                            <p v-if="project.summary" class="text-xs text-[var(--text-secondary)] line-clamp-2 leading-relaxed">
                                {{ project.summary }}
                            </p>

                            <!-- 停笔章节微型古典标签 -->
                            <div class="rounded-lg border border-[#3b2d1f] bg-[#1a140f] p-2 text-xs space-y-0.5">
                                <span class="block text-[9px] font-mono text-[var(--text-muted)]">上次停笔驻留点</span>
                                <p class="font-serif text-[11px] font-semibold text-[var(--text-main)] truncate">
                                    {{ getCollectorBookStats(project, idx).lastChapterTitle }}
                                </p>
                            </div>
                        </div>
                    </div>

                    <!-- 古典刻度进度条 (大纲篇幅编目) -->
                    <div class="space-y-1 pt-1">
                        <div class="flex items-center justify-between text-[10px] font-mono text-[var(--text-muted)]">
                            <span>卷帙推进度</span>
                            <span class="text-[#c5a059] font-bold">{{ getCollectorBookStats(project, idx).outlineProgress }}%</span>
                        </div>
                        <div class="h-1 w-full rounded-full bg-[#201812] overflow-hidden border border-[#3b2d1f]">
                            <div
                                class="h-full rounded-full bg-gradient-to-r from-[#9c7a2f] to-[#e8c872]"
                                :style="{width: `${getCollectorBookStats(project, idx).outlineProgress}%`}"
                            ></div>
                        </div>
                    </div>

                    <!-- 函套底部行动栏 -->
                    <div class="flex items-center justify-between gap-2 pt-2 border-t border-[#2d2319]">
                        <div class="flex items-center gap-1">
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
                        </div>

                        <Button
                            variant="primary"
                            size="sm"
                            icon-class="i-lucide-feather"
                            class="bg-gradient-to-r from-[#9c7a2f] to-[#c5a059] text-black font-bold border-[#fff2a8] shadow"
                            @click="emit('open', project.projectRoot)"
                        >
                            展卷启封 ↵
                        </Button>
                    </div>
                </div>
            </div>

            <!-- 空置函套盒插槽 (添置新书) -->
            <div
                class="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#3d3124] hover:border-[#c5a059] bg-black/20 hover:bg-[#c5a059]/5 p-8 text-center transition-all cursor-pointer min-h-[260px]"
                @click="emit('create-book')"
            >
                <div class="h-12 w-12 rounded-full border border-[#c5a059]/50 flex items-center justify-center text-[#c5a059] shadow group-hover:scale-110 transition-transform">
                    <span class="i-lucide-plus h-5 w-5"></span>
                </div>
                <h4 class="mt-4 font-serif text-sm font-bold text-[var(--text-main)]">定做新函套</h4>
                <p class="mt-1 text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-wider">
                    NOVA CODEX SLIPCASE
                </p>
            </div>
        </div>
    </div>
</template>

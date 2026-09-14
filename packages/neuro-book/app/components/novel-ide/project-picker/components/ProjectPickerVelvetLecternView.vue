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

const activeIndex = computed(() => {
    if (!activeProject.value) return 0;
    const idx = props.projects.findIndex((p) => p.projectRoot === activeProject.value?.projectRoot);
    return idx >= 0 ? idx : 0;
});

const activeStats = computed(() => {
    if (!activeProject.value) return null;
    return getCollectorBookStats(activeProject.value, activeIndex.value);
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
    <div class="velvet-lectern-collector-view space-y-8 select-none py-2" data-velvet-lectern-collector-view>
        <!-- 特藏展馆顶部 -->
        <div class="flex items-center justify-between border-b border-[#3b1218] pb-3">
            <div class="flex items-center gap-3">
                <div class="flex h-9 w-9 items-center justify-center rounded-full bg-[#52131b] border border-[#d4af37]/60 shadow-lg text-[#f3cc69]">
                    <span class="i-lucide-gem h-4 w-4"></span>
                </div>
                <div>
                    <h3 class="font-serif text-base font-bold text-[var(--text-main)] tracking-wider">
                        孤本珍藏馆 · 丝绒阅览讲台
                    </h3>
                    <p class="text-[10px] font-mono text-[#d4af37]/80 uppercase tracking-widest">
                        CODEX ILLUMINATUS · 恒温珍本展托
                    </p>
                </div>
            </div>

            <Button
                variant="secondary"
                size="sm"
                icon-class="i-lucide-plus"
                class="border-[#d4af37]/40 hover:border-[#d4af37]"
                @click="emit('create-book')"
            >
                入馆新典籍
            </Button>
        </div>

        <!-- 丝绒斜面展台核心焦点区 (Burgundy Velvet Showcase) -->
        <div
            v-if="activeProject && activeStats"
            class="relative rounded-3xl border-2 border-[#571922] bg-gradient-to-b from-[#2d0a10] via-[#1c060a] to-[#0d0204] p-8 sm:p-10 shadow-2xl overflow-hidden"
            :style="{
                boxShadow: '0 24px 60px -12px rgba(0,0,0,0.9), 0 0 32px rgba(212,175,55,0.15)',
            }"
        >
            <!-- 柔光射灯氛围光晕 -->
            <div class="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(212,175,55,0.12),transparent_70%)] pointer-events-none"></div>

            <div class="relative z-10 flex flex-col lg:flex-row items-center gap-8 sm:gap-12">
                <!-- 丝绒展台托垫与精装珍本 -->
                <div class="relative flex shrink-0 justify-center">
                    <!-- 暗红丝绒托垫边框 -->
                    <div class="relative rounded-2xl bg-gradient-to-b from-[#470f16] to-[#2b080d] p-5 shadow-2xl border border-[#7a1b26]/50">
                        <!-- 典藏精装硬壳书本 -->
                        <div
                            class="relative aspect-[2/3] w-52 sm:w-60 rounded-r-md rounded-l-xs overflow-hidden shadow-2xl border-2 border-[#d4af37]/80 cursor-pointer transition-transform duration-300 hover:scale-[1.02]"
                            :style="{
                                background: activeStats.leatherGradient,
                                boxShadow: '0 16px 36px rgba(0,0,0,0.8), 0 0 20px rgba(212,175,55,0.25)',
                            }"
                            @click="emit('open', activeProject.projectRoot)"
                        >
                            <!-- 烫金金属包角 -->
                            <div class="absolute top-1 left-1 h-7 w-7 border-t-2 border-l-2 border-[#f5d378] rounded-tl-sm pointer-events-none"></div>
                            <div class="absolute top-1 right-1 h-7 w-7 border-t-2 border-r-2 border-[#f5d378] rounded-tr-sm pointer-events-none"></div>
                            <div class="absolute bottom-1 left-1 h-7 w-7 border-b-2 border-l-2 border-[#f5d378] rounded-bl-sm pointer-events-none"></div>
                            <div class="absolute bottom-1 right-1 h-7 w-7 border-b-2 border-r-2 border-[#f5d378] rounded-br-sm pointer-events-none"></div>

                            <!-- 封面图片或古典烫金排印 -->
                            <img
                                v-if="activeProject.cover && !failedCoverRoots.has(activeProject.projectRoot)"
                                :src="getProjectCoverSrc(activeProject)"
                                :alt="activeProject.title"
                                class="h-full w-full object-cover"
                            />
                            <div v-else class="h-full w-full flex flex-col justify-between p-6 text-center" :style="{color: activeStats.gildedColor}">
                                <div class="font-mono text-[10px] tracking-widest uppercase opacity-80">
                                    {{ activeStats.tomeRoman }} · 孤本手抄
                                </div>
                                <div class="my-auto space-y-2">
                                    <h2 class="font-serif text-2xl font-bold leading-tight drop-shadow">
                                        {{ activeProject.title }}
                                    </h2>
                                    <div class="flex items-center justify-center gap-1.5 opacity-60">
                                        <span class="h-px w-8 bg-current"></span>
                                        <span class="text-sm font-serif">❖</span>
                                        <span class="h-px w-8 bg-current"></span>
                                    </div>
                                    <p class="font-mono text-[11px] opacity-75">
                                        {{ activeStats.volumeName }}
                                    </p>
                                </div>
                                <div class="font-mono text-[10px] border-t border-current/20 pt-2 opacity-75">
                                    {{ activeStats.wordCount }} · 典藏存档
                                </div>
                            </div>
                        </div>

                        <!-- 垂落出展托的加长丝绸缎带 -->
                        <div
                            class="absolute -bottom-6 left-1/2 -translate-x-1/2 w-4 h-12 rounded-b shadow-2xl"
                            :style="{backgroundColor: activeStats.ribbonColor}"
                        ></div>
                    </div>
                </div>

                <!-- 展台右侧：羊皮纸藏书档案与品鉴详情 -->
                <div class="flex-1 flex flex-col justify-between gap-6 text-left w-full">
                    <div class="space-y-4">
                        <div class="flex items-center justify-between">
                            <div class="flex items-center gap-2">
                                <!-- 火漆印章实体 -->
                                <div
                                    class="h-7 px-3 rounded-full flex items-center justify-center font-serif text-xs font-bold text-white shadow-md border border-white/20"
                                    :style="{backgroundColor: activeStats.waxSealColor}"
                                >
                                    {{ activeStats.waxSealText }}
                                </div>
                                <span class="font-mono text-xs text-[#d4af37] font-semibold">
                                    {{ activeStats.catalogCode }}
                                </span>
                            </div>
                            <span class="font-mono text-xs text-[var(--text-muted)]">
                                羊皮手订 · {{ activeStats.tomeRoman }}
                            </span>
                        </div>

                        <div>
                            <h2
                                class="font-serif text-3xl sm:text-4xl font-bold text-[var(--text-main)] hover:text-[#f3cc69] transition-colors cursor-pointer"
                                @click="emit('open', activeProject.projectRoot)"
                            >
                                {{ activeProject.title }}
                            </h2>
                            <p class="mt-1 font-serif text-xs italic text-[#d4af37]/80">
                                {{ activeStats.exLibrisMotto }}
                            </p>
                            <p v-if="activeProject.summary" class="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed line-clamp-3">
                                {{ activeProject.summary }}
                            </p>
                        </div>

                        <!-- 羊皮纸质感停笔记录栏 -->
                        <div class="rounded-xl border border-[#d4af37]/30 bg-[#2b0c11]/80 p-4 space-y-1.5 shadow-inner">
                            <div class="flex items-center gap-1.5 text-xs font-serif font-bold text-[#f5d378]">
                                <span class="i-lucide-feather h-4 w-4"></span>
                                <span>笔墨驻足点</span>
                            </div>
                            <p class="font-serif text-sm font-semibold text-[var(--text-main)]">
                                {{ activeStats.lastChapterTitle }}
                            </p>
                            <div class="flex items-center justify-between text-[11px] font-mono text-[var(--text-muted)] pt-1">
                                <span>大纲篇幅推演 {{ activeStats.outlineProgress }}%</span>
                                <span>最后手书：{{ props.formatDate(activeProject.manifestUpdatedAt) || "正在创作" }}</span>
                            </div>
                        </div>
                    </div>

                    <!-- 展台操作栏 -->
                    <div class="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-[#47121b]">
                        <div class="flex items-center gap-6 font-mono text-xs text-[var(--text-secondary)]">
                            <div>
                                <span class="text-[var(--text-muted)] block text-[10px]">累计字数</span>
                                <span class="text-base font-bold text-[var(--text-main)]">{{ activeStats.wordCount }}</span>
                            </div>
                            <div class="h-6 w-px bg-[#47121b]"></div>
                            <div>
                                <span class="text-[var(--text-muted)] block text-[10px]">卷内篇章</span>
                                <span class="text-base font-bold text-[var(--text-main)]">{{ activeStats.chapterCount }} 章</span>
                            </div>
                        </div>

                        <div class="flex items-center gap-2">
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
                                icon-class="i-lucide-scroll"
                                class="bg-gradient-to-r from-[#c59b27] to-[#e5c158] text-black font-bold border-[#fff2a8] shadow-lg hover:shadow-xl"
                                @click="emit('open', activeProject.projectRoot)"
                            >
                                翻阅落笔 ↵
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- 底部微缩展托陈列 (切换当前展台孤本) -->
        <div class="space-y-3">
            <div class="flex items-center justify-between">
                <span class="font-serif text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">
                    其他在册孤本展托 ({{ projects.length }})
                </span>
                <span class="text-[11px] font-mono text-[var(--text-muted)]">点击更换中央展台典籍</span>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5">
                <div
                    v-for="(project, idx) in projects"
                    :key="project.projectRoot"
                    class="group relative rounded-xl border p-3 cursor-pointer transition-all duration-300"
                    :class="project.projectRoot === selectedRoot
                        ? 'border-[#d4af37] bg-[#3d0f16]/90 shadow-md ring-1 ring-[#d4af37]'
                        : 'border-[#3b1218] bg-[#1a0508]/80 hover:border-[#7d1c28] hover:bg-[#28090e]'"
                    @click="selectedRoot = project.projectRoot"
                    @dblclick="emit('open', project.projectRoot)"
                >
                    <div class="flex items-center gap-3">
                        <div
                            class="relative aspect-[2/3] w-10 shrink-0 rounded-xs overflow-hidden shadow border border-[#d4af37]/40"
                            :style="{background: getCollectorBookStats(project, idx).leatherGradient}"
                        >
                            <img
                                v-if="project.cover && !failedCoverRoots.has(project.projectRoot)"
                                :src="getProjectCoverSrc(project)"
                                :alt="project.title"
                                class="h-full w-full object-cover"
                            />
                            <div v-else class="h-full w-full flex items-center justify-center text-[7px] font-serif text-white/80 p-0.5 text-center">
                                {{ project.title.slice(0, 4) }}
                            </div>
                        </div>

                        <div class="min-w-0 flex-1">
                            <h4 class="font-serif text-xs font-bold text-[var(--text-main)] truncate group-hover:text-[#f3cc69] transition-colors">
                                {{ project.title }}
                            </h4>
                            <p class="font-mono text-[10px] text-[#d4af37]/80 mt-0.5">
                                {{ getCollectorBookStats(project, idx).tomeRoman }} · {{ getCollectorBookStats(project, idx).wordCount }}
                            </p>
                        </div>
                    </div>
                </div>

                <!-- 添置新典籍入口 -->
                <div
                    class="flex items-center justify-center gap-2 rounded-xl border border-dashed border-[#571922] hover:border-[#d4af37] p-3 text-center transition-colors cursor-pointer bg-black/20 hover:bg-[#d4af37]/5 min-h-[58px]"
                    @click="emit('create-book')"
                >
                    <span class="i-lucide-plus h-3.5 w-3.5 text-[#d4af37]"></span>
                    <span class="font-serif text-xs text-[#d4af37]/90 font-semibold">入馆新孤本</span>
                </div>
            </div>
        </div>
    </div>
</template>

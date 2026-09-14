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
    <div class="walnut-shelf-collector-view space-y-10 select-none py-2" data-walnut-shelf-collector-view>
        <!-- 藏书阁顶部胡桃木铭牌标识 -->
        <div class="flex items-center justify-between border-b border-[#3e271a] pb-4">
            <div class="flex items-center gap-3.5">
                <div class="flex h-10 w-10 items-center justify-center rounded bg-gradient-to-b from-[#4a2e1d] to-[#2b180d] border border-[#cba038]/40 shadow-inner">
                    <span class="font-serif text-sm font-bold text-[#f3cc69]">NB</span>
                </div>
                <div>
                    <h3 class="font-serif text-base font-bold tracking-wider text-[var(--text-main)]">
                        私家典藏馆 · 胡桃木藏书架
                    </h3>
                    <p class="text-[11px] font-mono text-[#cba038]/80 tracking-widest uppercase">
                        BIBLIOTHECA PRIVATA · {{ projects.length }} 卷在架孤本
                    </p>
                </div>
            </div>

            <Button
                variant="secondary"
                size="sm"
                icon-class="i-lucide-plus"
                class="border-[#cba038]/30 hover:border-[#cba038]"
                @click="emit('create-book')"
            >
                添置新手订本
            </Button>
        </div>

        <!-- 核心展台：胡桃木立体书架插拔区 -->
        <div class="relative rounded-2xl bg-gradient-to-b from-[#1b100a] via-[#24150d] to-[#120a06] p-6 sm:p-8 border border-[#422617] shadow-2xl overflow-hidden">
            <!-- 顶部书架顶板阴影 -->
            <div class="absolute inset-x-0 top-0 h-4 bg-gradient-to-b from-black/80 to-transparent pointer-events-none"></div>

            <!-- 书籍陈列排 (横排立式凸脊书脊) -->
            <div class="flex items-end justify-start gap-4 sm:gap-6 overflow-x-auto pb-6 pt-10 px-4 scrollbar-none min-h-[340px]">
                <div
                    v-for="(project, idx) in projects"
                    :key="project.projectRoot"
                    class="group relative flex flex-col items-center cursor-pointer transition-all duration-300"
                    :class="project.projectRoot === selectedRoot ? '-translate-y-6' : 'hover:-translate-y-3'"
                    @click="selectedRoot = project.projectRoot"
                    @dblclick="emit('open', project.projectRoot)"
                >
                    <!-- 立式凸脊皮质书脊 (Spine) -->
                    <div
                        class="relative w-14 sm:w-16 h-64 sm:h-72 rounded-t-sm shadow-2xl flex flex-col justify-between py-4 px-2 border-x border-t border-black/40 overflow-hidden transition-all duration-300"
                        :style="{
                            background: getCollectorBookStats(project, idx).leatherGradient,
                            boxShadow: project.projectRoot === selectedRoot
                                ? `0 16px 32px -4px rgba(0,0,0,0.8), 0 0 16px ${getCollectorBookStats(project, idx).gildedColor}40`
                                : '0 10px 20px -2px rgba(0,0,0,0.6)',
                        }"
                    >
                        <!-- 凸脊竹节横棱 (5 道立体 Raised Bands) -->
                        <div class="absolute inset-x-0 top-6 h-1.5 bg-gradient-to-b from-white/20 via-white/5 to-black/60 shadow-sm"></div>
                        <div class="absolute inset-x-0 top-20 h-1.5 bg-gradient-to-b from-white/20 via-white/5 to-black/60 shadow-sm"></div>
                        <div class="absolute inset-x-0 top-36 h-1.5 bg-gradient-to-b from-white/20 via-white/5 to-black/60 shadow-sm"></div>
                        <div class="absolute inset-x-0 bottom-20 h-1.5 bg-gradient-to-b from-white/20 via-white/5 to-black/60 shadow-sm"></div>
                        <div class="absolute inset-x-0 bottom-6 h-1.5 bg-gradient-to-b from-white/20 via-white/5 to-black/60 shadow-sm"></div>

                        <!-- 书脊顶部罗马卷标 -->
                        <div class="z-10 text-center">
                            <span
                                class="font-mono text-[9px] tracking-widest uppercase font-bold"
                                :style="{color: getCollectorBookStats(project, idx).gildedColor}"
                            >
                                {{ getCollectorBookStats(project, idx).tomeRoman }}
                            </span>
                        </div>

                        <!-- 书脊竖排烫金书名 -->
                        <div class="z-10 my-auto flex flex-col items-center justify-center py-2">
                            <span
                                class="writing-vertical font-serif text-xs font-bold tracking-widest leading-none drop-shadow line-clamp-6 text-center"
                                :style="{color: getCollectorBookStats(project, idx).gildedColor}"
                            >
                                {{ project.title }}
                            </span>
                        </div>

                        <!-- 书脊底部火漆封印印章微缩 -->
                        <div class="z-10 flex flex-col items-center gap-1">
                            <div
                                class="h-5 w-5 rounded-full flex items-center justify-center text-[8px] font-serif font-bold text-white shadow"
                                :style="{backgroundColor: getCollectorBookStats(project, idx).waxSealColor}"
                            >
                                {{ getCollectorBookStats(project, idx).waxSealText }}
                            </div>
                        </div>

                        <!-- 垂落出书脊的丝绸书签缎带 -->
                        <div
                            class="absolute -bottom-3 left-1/2 -translate-x-1/2 w-2.5 h-6 rounded-b shadow-md"
                            :style="{backgroundColor: getCollectorBookStats(project, idx).ribbonColor}"
                        ></div>
                    </div>

                    <!-- 书架黄铜刻字金属铭牌 (Brass Plaque) -->
                    <div
                        class="mt-4 rounded-xs px-2 py-0.5 border text-center transition-all duration-300"
                        :class="project.projectRoot === selectedRoot
                            ? 'bg-gradient-to-b from-[#e5c158] to-[#b38a2e] text-black font-bold border-[#fff2a8] shadow-md scale-105'
                            : 'bg-[#2b1910] text-[#cba038]/70 border-[#5e381f] group-hover:text-[#f3cc69]'"
                    >
                        <span class="font-mono text-[9px] tracking-wider block truncate max-w-[80px]">
                            {{ project.title }}
                        </span>
                    </div>
                </div>

                <!-- 展架末尾：黄铜空书立与新书位 -->
                <div
                    class="group relative flex flex-col items-center justify-center cursor-pointer transition-transform duration-300 hover:-translate-y-2 shrink-0 px-2"
                    @click="emit('create-book')"
                >
                    <div class="w-14 sm:w-16 h-64 sm:h-72 rounded-t-sm border-2 border-dashed border-[#5a3721] hover:border-[#cba038] flex flex-col items-center justify-center gap-2 p-2 text-center bg-black/20 hover:bg-[#cba038]/5 transition-colors">
                        <div class="h-8 w-8 rounded-full border border-[#cba038]/40 flex items-center justify-center text-[#cba038]">
                            <span class="i-lucide-plus h-4 w-4"></span>
                        </div>
                        <span class="font-serif text-[11px] text-[#cba038]/80 font-bold">添置长篇</span>
                        <span class="font-mono text-[8px] text-[#cba038]/50 uppercase">NEW VOLUME</span>
                    </div>
                    <div class="mt-4 text-[9px] font-mono text-[#5a3721] uppercase">EMPTY STAND</div>
                </div>
            </div>

            <!-- 底层厚重胡桃木层板实木边缘 -->
            <div class="relative h-6 w-full rounded-sm bg-gradient-to-r from-[#241309] via-[#3a2113] to-[#241309] border-t-2 border-[#5c351f] shadow-2xl flex items-center justify-between px-4">
                <span class="font-mono text-[9px] text-[#cba038]/40 tracking-widest">SHELF NO. 01 · SOLID WALNUT</span>
                <span class="font-mono text-[9px] text-[#cba038]/40 tracking-widest">OAK LINING</span>
            </div>
        </div>

        <!-- 抽出品鉴台 (Reading Desk Presentation)：展现当前选中的孤本大图装帧详情 -->
        <div
            v-if="activeProject && activeStats"
            class="rounded-2xl border border-[#4d2c19] bg-gradient-to-b from-[#180f0a] to-[#0f0906] p-6 sm:p-8 shadow-2xl relative overflow-hidden"
        >
            <!-- 雅致大理石纹路微光背景 -->
            <div
                class="absolute -right-20 -top-20 h-72 w-72 rounded-full opacity-15 pointer-events-none blur-3xl"
                :style="{background: activeStats.marbledBg}"
            ></div>

            <div class="relative z-10 flex flex-col md:flex-row gap-6 sm:gap-10 items-center md:items-stretch">
                <!-- 典藏精装书籍正面全幅装帧 (Hardcover Face) -->
                <div class="relative flex shrink-0 justify-center">
                    <div
                        class="relative aspect-[2/3] w-48 sm:w-56 rounded-r-md rounded-l-xs overflow-hidden shadow-2xl border-2 border-[#cba038]/60 transition-transform duration-300 hover:scale-[1.02] cursor-pointer"
                        :style="{
                            background: activeStats.leatherGradient,
                            boxShadow: `0 20px 40px -10px rgba(0,0,0,0.9), 0 0 24px ${activeStats.gildedColor}30`,
                        }"
                        @click="emit('open', activeProject.projectRoot)"
                    >
                        <!-- 四角古典金属雕花包角 (Brass Filigree Corners) -->
                        <div class="absolute top-1.5 left-1.5 h-6 w-6 border-t-2 border-l-2 border-[#f3cc69]/80 rounded-tl-sm pointer-events-none"></div>
                        <div class="absolute top-1.5 right-1.5 h-6 w-6 border-t-2 border-r-2 border-[#f3cc69]/80 rounded-tr-sm pointer-events-none"></div>
                        <div class="absolute bottom-1.5 left-1.5 h-6 w-6 border-b-2 border-l-2 border-[#f3cc69]/80 rounded-bl-sm pointer-events-none"></div>
                        <div class="absolute bottom-1.5 right-1.5 h-6 w-6 border-b-2 border-r-2 border-[#f3cc69]/80 rounded-br-sm pointer-events-none"></div>

                        <!-- 烫金双细线环绕边框 -->
                        <div class="absolute inset-3 border border-[#cba038]/40 pointer-events-none"></div>

                        <!-- 封面图片或古典排版 -->
                        <img
                            v-if="activeProject.cover && !failedCoverRoots.has(activeProject.projectRoot)"
                            :src="getProjectCoverSrc(activeProject)"
                            :alt="activeProject.title"
                            class="h-full w-full object-cover"
                        />
                        <div v-else class="h-full w-full flex flex-col justify-between p-5 text-center" :style="{color: activeStats.gildedColor}">
                            <div class="font-mono text-[10px] tracking-widest uppercase opacity-70">
                                {{ activeStats.tomeRoman }} · {{ activeStats.catalogCode }}
                            </div>

                            <div class="space-y-2 my-auto px-2">
                                <h3 class="font-serif text-xl font-bold leading-snug drop-shadow-md">
                                    {{ activeProject.title }}
                                </h3>
                                <div class="flex items-center justify-center gap-1.5 opacity-60">
                                    <span class="h-px w-6 bg-current"></span>
                                    <span class="text-xs">✦</span>
                                    <span class="h-px w-6 bg-current"></span>
                                </div>
                                <p class="font-mono text-[10px] tracking-wider opacity-80">
                                    {{ activeStats.volumeName }}
                                </p>
                            </div>

                            <!-- 底部火漆压印 -->
                            <div class="flex items-center justify-between text-[10px] font-mono border-t border-current/20 pt-2 opacity-75">
                                <span>{{ activeStats.wordCount }}</span>
                                <div
                                    class="h-5 px-2 rounded-full flex items-center justify-center text-[9px] font-serif font-bold text-white shadow"
                                    :style="{backgroundColor: activeStats.waxSealColor}"
                                >
                                    {{ activeStats.waxSealText }}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 右侧：典藏藏书票与卷轴档案 (Ex Libris Dossier) -->
                <div class="flex-1 flex flex-col justify-between gap-5 text-left">
                    <div class="space-y-3">
                        <!-- 藏书票铭文标头 -->
                        <div class="flex items-center justify-between text-xs font-mono border-b border-[#3d2417] pb-2">
                            <span class="text-[#cba038] tracking-wider uppercase font-bold">
                                {{ activeStats.exLibrisMotto }}
                            </span>
                            <span class="text-[var(--text-muted)]">
                                编号: {{ activeStats.catalogCode }}
                            </span>
                        </div>

                        <!-- 标题与简介 -->
                        <div>
                            <h2
                                class="font-serif text-2xl sm:text-3xl font-bold text-[var(--text-main)] hover:text-[#f3cc69] transition-colors cursor-pointer"
                                @click="emit('open', activeProject.projectRoot)"
                            >
                                {{ activeProject.title }}
                            </h2>
                            <p v-if="activeProject.summary" class="mt-2 text-sm text-[var(--text-secondary)] leading-relaxed line-clamp-3">
                                {{ activeProject.summary }}
                            </p>
                        </div>

                        <!-- 停笔节点驻足卡 -->
                        <div class="rounded-xl border border-[#4a2b1a] bg-[#1d120c]/80 p-3.5 space-y-1">
                            <div class="flex items-center gap-1.5 text-xs font-serif font-bold text-[#cba038]">
                                <span class="i-lucide-bookmark h-3.5 w-3.5"></span>
                                <span>上次闭关停笔章节</span>
                            </div>
                            <p class="font-serif text-sm font-semibold text-[var(--text-main)]">
                                {{ activeStats.lastChapterTitle }}
                            </p>
                        </div>
                    </div>

                    <!-- 底部参数与取书操作 -->
                    <div class="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-[#3d2417]">
                        <div class="flex items-center gap-6 text-xs font-mono text-[var(--text-secondary)]">
                            <div>
                                <span class="text-[var(--text-muted)] block text-[10px]">累计书写</span>
                                <span class="text-sm font-bold text-[var(--text-main)]">{{ activeStats.wordCount }}</span>
                            </div>
                            <div class="h-6 w-px bg-[#3d2417]"></div>
                            <div>
                                <span class="text-[var(--text-muted)] block text-[10px]">已成篇章</span>
                                <span class="text-sm font-bold text-[var(--text-main)]">{{ activeStats.chapterCount }} 卷</span>
                            </div>
                            <div class="h-6 w-px bg-[#3d2417]"></div>
                            <div>
                                <span class="text-[var(--text-muted)] block text-[10px]">编目进度</span>
                                <span class="text-sm font-bold text-[#cba038]">{{ activeStats.outlineProgress }}%</span>
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
                                icon-class="i-lucide-book-open"
                                class="bg-gradient-to-r from-[#b38a2e] to-[#cba038] text-black font-bold border-[#fff09e] shadow-lg hover:shadow-xl transition-all"
                                @click="emit('open', activeProject.projectRoot)"
                            >
                                取书执笔 ↵
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.writing-vertical {
    writing-mode: vertical-rl;
    text-orientation: mixed;
}
</style>

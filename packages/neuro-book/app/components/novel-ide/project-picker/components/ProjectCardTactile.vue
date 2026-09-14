<script setup lang="ts">
import {ref, computed} from "vue";
import {Badge, Button, IconButton} from "@notnotype/nb-ui/components";
import type {ProjectMetadataDto} from "nbook/shared/dto/project.dto";
import type {ProjectPickerRecoveryEntry} from "nbook/app/utils/project-picker-recovery";
import {getProjectCreativeStats} from "./project-stats";

const props = withDefaults(defineProps<{
    project: ProjectMetadataDto;
    tags?: readonly string[];
    deleteBusy?: boolean;
    deleteRecovery?: ProjectPickerRecoveryEntry;
    coverRefreshVersion?: number;
    failedCover?: boolean;
    resolveCoverUrl?: (projectRoot: string) => string;
    formatDate?: (dateString?: string | null) => string;
}>(), {
    tags: () => [],
    deleteBusy: false,
    deleteRecovery: undefined,
    coverRefreshVersion: 0,
    failedCover: false,
});

const emit = defineEmits<{
    (e: "open", projectRoot: string): void;
    (e: "delete", project: ProjectMetadataDto): void;
    (e: "retry-delete-recovery", projectRoot: string): void;
    (e: "open-cover-dialog", project: ProjectMetadataDto): void;
    (e: "cover-error", projectRoot: string): void;
}>();

const {t} = useI18n();
const imageLoadFailed = ref(false);

const stats = computed(() => getProjectCreativeStats(props.project, props.tags));

const hasImageCover = computed(() => {
    return Boolean(props.project.cover) && !props.failedCover && !imageLoadFailed.value;
});

const coverSrc = computed(() => {
    if (!props.project.cover) return "";
    const base = props.resolveCoverUrl
        ? props.resolveCoverUrl(props.project.projectRoot)
        : `/api/projects/cover?${new URLSearchParams({projectRoot: props.project.projectRoot, preset: "project-cover"}).toString()}`;
    return props.coverRefreshVersion > 0 ? `${base}&v=${props.coverRefreshVersion}` : base;
});

function handleImageError(): void {
    imageLoadFailed.value = true;
    emit("cover-error", props.project.projectRoot);
}
</script>

<template>
    <div
        class="tactile-book-card group relative flex flex-col transition-all duration-300 select-none"
        :class="deleteBusy ? 'opacity-50 pointer-events-none' : ''"
        data-project-card
    >
        <!-- 3D 实体书本容器 -->
        <div class="tactile-stage relative flex justify-center py-4 sm:py-6">
            <!-- 3D 书本本体 -->
            <div
                class="tactile-book relative aspect-[2/3] w-36 sm:w-44 cursor-pointer"
                role="button"
                :aria-label="t('ide.picker.openBook', {title: project.title})"
                tabindex="0"
                @click="emit('open', project.projectRoot)"
                @keydown.enter="emit('open', project.projectRoot)"
                @keydown.space.prevent="emit('open', project.projectRoot)"
            >
                <!-- 书本阴影（模拟环境光与离地阴影） -->
                <div class="tactile-shadow absolute -bottom-3 inset-x-2 h-5 rounded-full blur-md transition-all duration-300"></div>

                <!-- 书本体块包装 -->
                <div class="tactile-volume relative h-full w-full rounded-r-md rounded-l-xs overflow-visible">
                    <!-- 书脊厚度立体边（右侧纸页截面） -->
                    <div class="tactile-pages-edge absolute top-1 bottom-1 right-0 w-3 origin-right bg-[#f4ece1] rounded-r-xs shadow-inner">
                        <div class="h-full w-full bg-[repeating-linear-gradient(to_bottom,transparent,transparent_2px,rgba(0,0,0,0.06)_2px,rgba(0,0,0,0.06)_3px)]"></div>
                    </div>

                    <!-- 书签缎带（从书底微露出） -->
                    <div
                        class="tactile-ribbon absolute -bottom-3 left-6 w-2.5 h-6 rounded-b-xs shadow-sm"
                        :style="{backgroundColor: stats.accentColor}"
                    ></div>

                    <!-- 真实书封层 -->
                    <div
                        class="tactile-cover relative h-full w-full rounded-r-md rounded-l-xs border border-[var(--panel-outline)] overflow-hidden shadow-lg transition-transform duration-300"
                        :class="`bg-gradient-to-br ${stats.themeGradient.from} ${stats.themeGradient.to}`"
                    >
                        <!-- 用户自定义真实图片封面 -->
                        <img
                            v-if="hasImageCover"
                            :src="coverSrc"
                            :alt="project.title"
                            class="h-full w-full object-cover"
                            loading="lazy"
                            @error="handleImageError"
                        />

                        <!-- 生成式题材典藏封面 -->
                        <div v-else class="relative h-full w-full flex flex-col justify-between p-3.5 text-white/90">
                            <!-- 顶部题材与装饰印记 -->
                            <div class="flex items-center justify-between text-[10px] text-white/60">
                                <span class="font-mono tracking-widest uppercase">{{ stats.genreKey }}</span>
                                <span class="h-1.5 w-1.5 rounded-full" :style="{backgroundColor: stats.accentColor}"></span>
                            </div>

                            <!-- 中间排版书名 -->
                            <div class="my-auto text-center space-y-1.5 px-1">
                                <p class="font-serif text-sm sm:text-base font-bold leading-snug tracking-wide line-clamp-3 drop-shadow-sm">
                                    {{ project.title }}
                                </p>
                                <div class="flex justify-center">
                                    <span class="inline-block h-px w-8 bg-white/30"></span>
                                </div>
                                <p class="text-[9px] text-white/70 font-mono tracking-wider">
                                    {{ stats.genreLabel }}
                                </p>
                            </div>

                            <!-- 底部字数与微章 -->
                            <div class="flex items-center justify-between text-[9px] text-white/60 border-t border-white/10 pt-1.5">
                                <span class="font-mono">{{ stats.wordCount }}</span>
                                <span class="font-mono">{{ stats.chapterCount }}章</span>
                            </div>

                            <!-- 书脊左侧压痕与立体光影 -->
                            <div class="absolute inset-y-0 left-0 w-2.5 bg-gradient-to-r from-black/40 via-transparent to-transparent pointer-events-none"></div>
                            <div class="absolute inset-y-0 left-2.5 w-px bg-white/15 pointer-events-none"></div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 浮动快捷操作栏 -->
            <div
                class="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--bg-panel)_85%,transparent)] p-1 backdrop-blur-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 shadow-sm border border-[var(--border-color)]"
            >
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
        </div>

        <!-- 底部元数据信息 -->
        <div class="mt-1 space-y-1.5 px-1 text-left">
            <div class="flex items-center justify-between gap-2">
                <h3
                    class="truncate font-serif text-sm font-semibold text-[var(--text-main)] hover:text-[var(--accent-main)] cursor-pointer transition-colors"
                    @click="emit('open', project.projectRoot)"
                >
                    {{ project.title }}
                </h3>
            </div>

            <!-- 题材标签与字数徽章 -->
            <div class="flex flex-wrap items-center gap-1">
                <Badge
                    v-for="tag in (props.tags ?? [])"
                    :key="tag"
                    size="sm"
                    variant="soft"
                    tone="accent"
                    class="text-[10px] scale-95 origin-left"
                >
                    {{ tag }}
                </Badge>
                <span class="text-[10px] font-mono text-[var(--text-muted)] ml-auto">
                    {{ stats.wordCount }}
                </span>
            </div>

            <!-- 简介摘要 -->
            <p v-if="project.summary" class="line-clamp-2 text-xs text-[var(--text-secondary)] leading-relaxed">
                {{ project.summary }}
            </p>

            <!-- 更新时间 -->
            <div class="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] pt-0.5">
                <span class="i-lucide-clock h-3 w-3 shrink-0"></span>
                <span class="truncate">
                    {{ props.formatDate ? props.formatDate(project.manifestUpdatedAt) : project.manifestUpdatedAt }}
                </span>
            </div>
        </div>
    </div>
</template>

<style scoped>
.tactile-stage {
    perspective: 1000px;
}

.tactile-book {
    transform-style: preserve-3d;
    transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

.tactile-shadow {
    background: radial-gradient(ellipse at center, rgba(0, 0, 0, 0.35) 0%, rgba(0, 0, 0, 0) 75%);
    transform: rotateX(80deg) translateZ(-16px);
}

/* 悬浮时带 3D 俯仰展开并抽出 */
.tactile-book-card:hover .tactile-book {
    transform: rotateY(-18deg) rotateX(6deg) translateY(-8px) translateZ(16px);
}

.tactile-book-card:hover .tactile-shadow {
    transform: rotateX(80deg) translateZ(-24px) scale(1.15);
    opacity: 0.8;
}

.tactile-pages-edge {
    transform: rotateY(90deg) translateZ(0);
}
</style>

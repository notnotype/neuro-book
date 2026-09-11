<script setup lang="ts">
import {computed} from "vue";

const props = withDefaults(defineProps<{
    title: string;
    genre?: string;
}>(), {
    genre: "general",
});

const {t} = useI18n();

const displayTitle = computed(() => props.title.trim() || t("ide.bookshelf.defaultTitle"));

interface GenreTheme {
    from: string;
    to: string;
    accent: string;
    label: string;
}

const DEFAULT_THEME: GenreTheme = {
    from: "from-[color-mix(in_srgb,var(--bg-panel)_85%,var(--accent-main)_15%)]",
    to: "to-[var(--bg-panel)]",
    accent: "var(--accent-main)",
    label: "通用创作",
};

// 预设题材的封面环境色板（冷暖/情绪区分）
const genreThemes = computed<Record<string, GenreTheme>>(() => ({
    general: {
        from: "from-[color-mix(in_srgb,var(--bg-panel)_85%,var(--accent-main)_15%)]",
        to: "to-[var(--bg-panel)]",
        accent: "var(--accent-main)",
        label: t("ide.picker.genres.general"),
    },
    xuanhuan: {
        from: "from-[color-mix(in_srgb,var(--bg-panel)_80%,#8b5cf6_20%)]",
        to: "to-[var(--bg-panel)]",
        accent: "#8b5cf6",
        label: t("ide.picker.genres.xuanhuan"),
    },
    scifi: {
        from: "from-[color-mix(in_srgb,var(--bg-panel)_80%,#06b6d4_20%)]",
        to: "to-[var(--bg-panel)]",
        accent: "#06b6d4",
        label: t("ide.picker.genres.scifi"),
    },
    urban: {
        from: "from-[color-mix(in_srgb,var(--bg-panel)_80%,#3b82f6_20%)]",
        to: "to-[var(--bg-panel)]",
        accent: "#3b82f6",
        label: t("ide.picker.genres.urban"),
    },
    mystery: {
        from: "from-[color-mix(in_srgb,var(--bg-panel)_80%,#e11d48_20%)]",
        to: "to-[var(--bg-panel)]",
        accent: "#e11d48",
        label: t("ide.picker.genres.mystery"),
    },
    world: {
        from: "from-[color-mix(in_srgb,var(--bg-panel)_80%,#10b981_20%)]",
        to: "to-[var(--bg-panel)]",
        accent: "#10b981",
        label: t("ide.picker.genres.world"),
    },
}));

const currentTheme = computed<GenreTheme>(() => (props.genre ? genreThemes.value[props.genre] : undefined) ?? DEFAULT_THEME);
</script>

<template>
    <div class="project-create-cover-preview relative flex flex-col items-center">
        <!-- 拟真 2:3 书封卡片 -->
        <div
            class="relative aspect-[2/3] w-28 sm:w-32 overflow-hidden rounded-[var(--radius-panel,6px)] border border-[var(--border-color)] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] shadow-md transition-colors [transition-duration:var(--motion-base,240ms)]"
            :class="[currentTheme.from, currentTheme.to]"
        >
            <div class="flex h-full w-full flex-col items-center justify-between p-3 sm:p-4 text-center select-none">
                <!-- 顶部羽毛与装饰线 -->
                <div class="flex w-full items-center gap-1 text-[8px] font-medium text-[var(--text-muted)]">
                    <span class="h-px flex-1 bg-[var(--border-color)]"></span>
                    <span class="i-lucide-feather h-3 w-3" :style="{color: currentTheme.accent}"></span>
                    <span class="h-px flex-1 bg-[var(--border-color)]"></span>
                </div>

                <!-- 实时联动标题 -->
                <div class="my-auto px-1">
                    <p class="line-clamp-3 break-words font-serif text-xs font-bold leading-4.5 text-[var(--text-main)] sm:text-sm sm:leading-5">
                        {{ displayTitle }}
                    </p>
                    <span
                        class="mt-1.5 inline-block rounded-[3px] border border-[var(--border-color)] px-1 py-0.5 text-[9px] text-[var(--text-muted)] font-mono"
                    >
                        {{ currentTheme.label }}
                    </span>
                </div>

                <!-- 底部装饰色块 -->
                <span class="h-0.5 w-6 rounded-full opacity-80" :style="{backgroundColor: currentTheme.accent}"></span>
            </div>

            <!-- 书脊与立体页边光影 -->
            <span class="absolute inset-y-0 left-0 w-1.5 border-r border-[var(--border-color)] bg-[color-mix(in_srgb,var(--text-main)_4%,transparent)]"></span>
            <span class="absolute inset-y-2 right-0 w-0.5 border-l border-[var(--border-color)] bg-[color-mix(in_srgb,var(--text-main)_3%,transparent)]"></span>
        </div>

        <!-- 拟真阴影垫底 -->
        <span class="mt-1.5 text-[10px] font-medium text-[var(--text-muted)] tracking-wider">
            {{ t("ide.picker.previewBadge") }}
        </span>
    </div>
</template>

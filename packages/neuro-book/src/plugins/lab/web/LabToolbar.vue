<script setup lang="ts">
/**
 * Lab 顶栏：改整页的旋钮（docs/specs/ui/component-lab.md）。主题、配色、桌面背景与自定义壁纸，复制场景链接，恢复默认
 * 配置。值由 LabShell 持有并写进偏好；这里只呈现与转发。
 */
import {computed, ref, watch} from "vue";
import {FormSelect as NbFormSelect} from "@notnotype/nb-ui/components";
import type {FormSelectOption} from "@notnotype/nb-ui/components";

import {labColorwayMeta, labThemes} from "./lab-theme";
import {labPageBackdrops} from "./stage-backdrops";

const props = defineProps<{
    componentCount: number;
    /** 已经有一张自定义壁纸。 */
    hasWallpaper: boolean;
    /** 刚复制过场景链接：按钮换成对勾。 */
    linkCopied: boolean;
}>();

const themeId = defineModel<string>("themeId", {required: true});
const colorwayId = defineModel<string>("colorwayId", {required: true});
const pageBackdrop = defineModel<string>("pageBackdrop", {required: true});

const emit = defineEmits<{
    /** 选了一张壁纸图片。 */
    wallpaper: [file: File];
    "drop-wallpaper": [];
    "copy-link": [];
    reset: [];
}>();

const themeOptions: FormSelectOption[] = labThemes.map((theme) => ({
    value: theme.manifest.id,
    label: theme.manifest.name,
    description: theme.manifest.tagline,
}));
const colorwayOptions = computed<FormSelectOption[]>(() =>
    Object.entries(labColorwayMeta).map(([id, meta]) => ({
        value: id,
        label: meta.label,
        description: meta.appearance === "dark" ? "深色" : "浅色",
    })));
const pageBackdropOptions: FormSelectOption[] = labPageBackdrops.map((item) => ({value: item.id, label: item.label}));

const wallpaperInput = ref<HTMLInputElement | null>(null);

function pick(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // 选同一个文件两次也要生效，所以每次都清空 input，否则第二次不发 change
    input.value = "";
    if (file) {
        emit("wallpaper", file);
    }
}

// 选了「自定义图片」却一张都没有，等于选了个空档。这时直接把选择框打开，
// 而不是让人先看见一片空白再自己去找按钮。
watch(pageBackdrop, (id) => {
    if (id === "custom" && !props.hasWallpaper) {
        wallpaperInput.value?.click();
    }
});
</script>

<template>
    <!-- 顶栏每一项都写 shrink-0：这是一条全宽 flex 行，只要有一项不肯收缩，
         其余项就会被压到 min-content，而中文可以逐字换行，会直接压成竖排。 -->
    <header class="lab-bar flex shrink-0 flex-wrap items-center">
        <div class="lab-bar__lead flex min-w-0 flex-1 items-center gap-[var(--space-5)]">
            <span class="lab-title min-w-0 truncate">组件 Lab</span>
            <span class="lab-bar__count lab-note shrink-0">{{ componentCount }} 个组件</span>
        </div>
        <!--
            整页的四个旋钮：主题、配色、桌面、恢复默认。它们与下面的画布旋钮一样不可替代，
            所以同样 shrink-0；空间不够时先藏左边的计数、再收窄这三个下拉（见样式里的容器查询）。
        -->
        <div class="lab-bar__controls flex min-w-0 flex-wrap items-center gap-[var(--space-5)]">
            <NbFormSelect
                v-model="themeId"
                :options="themeOptions"
                size="sm"
                class="lab-bar__theme shrink-0"
                aria-label="主题"
            />
            <NbFormSelect
                v-model="colorwayId"
                :options="colorwayOptions"
                size="sm"
                class="lab-bar__colorway shrink-0"
                aria-label="配色"
            />
            <!-- 桌面与画布底是两层不同的东西，别合成一个控件：这个改的是整页最底下那一层，
                 中栏工具条上的「画布底」改的是被测组件背后那一层。取值都在 stage-backdrops.ts。 -->
            <NbFormSelect
                v-model="pageBackdrop"
                :options="pageBackdropOptions"
                size="sm"
                class="lab-bar__backdrop shrink-0"
                aria-label="桌面"
            />
            <!-- 壁纸只在选了「自定义图片」时才有得换。文件选择框自己不显示，
                 由旁边的按钮或上面那个 watch 触发。 -->
            <input
                ref="wallpaperInput"
                type="file"
                accept="image/*"
                class="hidden"
                @change="pick"
            />
            <template v-if="pageBackdrop === 'custom'">
                <button type="button" class="lab-btn shrink-0" @click="wallpaperInput?.click()">
                    {{ hasWallpaper ? "换图片" : "选图片" }}
                </button>
                <button v-if="hasWallpaper" type="button" class="lab-btn shrink-0" @click="emit('drop-wallpaper')">
                    清除
                </button>
            </template>
            <button
                type="button"
                class="lab-btn lab-btn--icon shrink-0"
                :aria-label="linkCopied ? '已复制场景链接' : '复制场景链接'"
                :title="linkCopied ? '已复制场景链接' : '复制场景链接（带主题与配色）'"
                data-lab-copy-link
                @click="emit('copy-link')"
            >
                <span :class="linkCopied ? 'i-lucide-check' : 'i-lucide-link'" class="h-3.5 w-3.5" aria-hidden="true"></span>
            </button>
            <button
                type="button"
                class="lab-btn lab-btn--icon shrink-0"
                aria-label="恢复 Lab 默认配置"
                title="恢复 Lab 默认配置"
                @click="emit('reset')"
            >
                <span class="i-lucide-rotate-ccw h-3.5 w-3.5" aria-hidden="true"></span>
            </button>
        </div>
    </header>
</template>

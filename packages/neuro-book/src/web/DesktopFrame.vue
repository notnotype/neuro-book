<script setup lang="ts">
/**
 * 桌面窗口的外框（docs/specs/runtime/browser-host.md 的“窗口外框”）：右上角的窗口按钮，页面没有自己的标题栏时再画一条后备标题栏。
 * 状态与 `<html>` 上的属性在 `host/desktop-frame.ts`；这里只按状态画。拖动区域由 CSS `app-region` 标出，拖动、双击最大化、
 * 贴边分屏都由 WebView2 交给系统，组件不处理。
 */
import {computed} from "vue";

import {NB_Z_INDEX} from "@notnotype/nb-ui/theme";
import {useText} from "@notnotype/nb-ui/text-port";

import NeuroBookMark from "nbook/ui/brand/NeuroBookMark.vue";

import type {DesktopFrame} from "./host/desktop-frame";
import {hostText} from "./host-text";

const props = defineProps<{frame: DesktopFrame}>();
const {t} = useText();

const state = computed(() => props.frame.state.value);
const layer = {zIndex: NB_Z_INDEX.desktopFrame};
/** Windows 图标字体里的按钮字形（私有区码位）：最小化、最大化、还原、关闭。 */
const GLYPH = {minimize: "\uE921", maximize: "\uE922", restore: "\uE923", close: "\uE8BB"} as const;
</script>

<template>
    <template v-if="frame.enabled">
        <!-- 后备标题栏只是拖动区域与标题的重复，读屏读文档标题即可。 -->
        <div v-if="!state.pageTitlebar" class="desktop-frame__bar" :style="layer" aria-hidden="true" data-desktop-fallback-bar>
            <NeuroBookMark class="desktop-frame__mark" />
            <span class="desktop-frame__title">{{ state.title }}</span>
        </div>
        <!-- 按下时不取焦点（mousedown.prevent）：系统标题栏的按钮不抢焦点，编辑器里的光标与选区不受影响。 -->
        <div class="desktop-frame__controls" :style="layer" role="group" :aria-label="t(hostText('desktopFrame.controls'))" :data-focused="state.focused ? '' : undefined" data-desktop-controls>
            <button type="button" tabindex="-1" class="desktop-frame__button" :aria-label="t(hostText('desktopFrame.minimize'))" data-desktop-control="minimize" @mousedown.prevent @click="frame.control('minimize')">{{ GLYPH.minimize }}</button>
            <button type="button" tabindex="-1" class="desktop-frame__button" :aria-label="t(hostText(state.maximized ? 'desktopFrame.restore' : 'desktopFrame.maximize'))" data-desktop-control="toggle-maximize" @mousedown.prevent @click="frame.control('toggle-maximize')">{{ state.maximized ? GLYPH.restore : GLYPH.maximize }}</button>
            <button type="button" tabindex="-1" class="desktop-frame__button desktop-frame__button--close" :aria-label="t(hostText('desktopFrame.close'))" data-desktop-control="close" @mousedown.prevent @click="frame.control('close')">{{ GLYPH.close }}</button>
        </div>
    </template>
</template>

<style scoped>
/*
 * 颜色按三级回退：主题变量（工作台就绪后）→ 加载页的变量（index.html 按上次的明暗写下，宿主页也在用）→ 系统色（什么都没有时）。
 * 外框在主题加载之前就显示，少了后两级时整条声明无效。
 */
.desktop-frame__bar {
    position: fixed;
    inset: 0 0 auto 0;
    box-sizing: border-box;
    height: var(--nb-window-frame-height);
    display: flex;
    align-items: center;
    gap: 8px;
    padding-inline: 10px calc(var(--nb-window-controls-width) + 10px);
    background: var(--shell-chrome-surface, var(--bg-panel, var(--host-loading-background, Canvas)));
    border-bottom: 1px solid var(--shell-chrome-line, var(--divider, transparent));
    color: var(--text-muted, var(--host-loading-muted, GrayText));
    font: 12px system-ui, "Segoe UI", "Microsoft YaHei UI", sans-serif;
    -webkit-app-region: drag;
    app-region: drag;
    user-select: none;
}

.desktop-frame__mark {
    width: 16px;
    height: 16px;
    flex: none;
    color: var(--text-main, var(--host-loading-text, CanvasText));
}

.desktop-frame__title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.desktop-frame__controls {
    position: fixed;
    top: 0;
    right: 0;
    display: flex;
    height: var(--nb-window-frame-height);
    pointer-events: auto;
    -webkit-app-region: no-drag;
    app-region: no-drag;
    color: var(--text-muted, var(--host-loading-muted, GrayText));
}

.desktop-frame__controls[data-focused] {
    color: var(--text-main, var(--host-loading-text, CanvasText));
}

/*
 * 原生按钮而不是 nb-ui 的 IconButton：系统标题栏的按钮是贴边、无圆角、无内边距的 46×36 矩形，IconButton 做不出来。字形用
 * Windows 的图标字体（11 是 Segoe Fluent Icons，10 是 Segoe MDL2 Assets），与系统按钮像素一致；外框只在 Windows 的桌面壳里出现。
 */
.desktop-frame__button {
    width: calc(var(--nb-window-controls-width) / 3);
    height: 100%;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: inherit;
    font: 10px "Segoe Fluent Icons", "Segoe MDL2 Assets", sans-serif;
    cursor: default;
}

.desktop-frame__button:hover {
    background: color-mix(in srgb, currentColor 10%, transparent);
    color: var(--text-main, var(--host-loading-text, CanvasText));
}

/* Windows 关闭按钮的红，配白色字形（对比度约 5.7:1）；系统按钮就是这个颜色，不随主题变。 */
.desktop-frame__button--close:hover {
    background: #c42b1c;
    color: #fff;
}

@media (forced-colors: active) {
    .desktop-frame__button:hover,
    .desktop-frame__button--close:hover {
        background: Highlight;
        color: HighlightText;
    }
}
</style>

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
</script>

<template>
    <template v-if="frame.enabled">
        <!-- 后备标题栏只是拖动区域与标题的重复，读屏读文档标题即可。 -->
        <div v-if="!state.pageTitlebar" class="desktop-frame__bar" :style="layer" aria-hidden="true" data-desktop-fallback-bar>
            <NeuroBookMark class="desktop-frame__mark" />
            <span class="desktop-frame__title">{{ state.title }}</span>
        </div>
        <!--
            按下时不取焦点（mousedown.prevent）：系统标题栏的按钮不抢焦点，编辑器里的光标与选区不受影响。
            图标是内联 SVG（图形取自 lucide，与标题栏其它按钮的图标同形同粗）：图标类是遮罩加背景色，高对比度模式下背景色被强制成
            Canvas，按钮会整个消失；描边用 currentColor，颜色由系统给。
        -->
        <div class="desktop-frame__controls" :style="layer" role="group" :aria-label="t(hostText('desktopFrame.controls'))" data-desktop-controls>
            <span class="desktop-frame__divider" aria-hidden="true"></span>
            <button type="button" tabindex="-1" class="desktop-frame__button" :aria-label="t(hostText('desktopFrame.minimize'))" data-desktop-control="minimize" @mousedown.prevent @click="frame.control('minimize')">
                <span class="desktop-frame__chip"><svg class="desktop-frame__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg></span>
            </button>
            <button type="button" tabindex="-1" class="desktop-frame__button" :aria-label="t(hostText(state.maximized ? 'desktopFrame.restore' : 'desktopFrame.maximize'))" data-desktop-control="toggle-maximize" @mousedown.prevent @click="frame.control('toggle-maximize')">
                <span class="desktop-frame__chip">
                    <svg v-if="state.maximized" class="desktop-frame__icon" viewBox="0 0 24 24" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg>
                    <svg v-else class="desktop-frame__icon" viewBox="0 0 24 24" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2" /></svg>
                </span>
            </button>
            <button type="button" tabindex="-1" class="desktop-frame__button desktop-frame__button--close" :aria-label="t(hostText('desktopFrame.close'))" data-desktop-control="close" @mousedown.prevent @click="frame.control('close')">
                <span class="desktop-frame__chip"><svg class="desktop-frame__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg></span>
            </button>
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
    align-items: stretch;
    height: var(--nb-window-frame-height);
    pointer-events: auto;
    -webkit-app-region: no-drag;
    app-region: no-drag;
}

/* 与标题栏里“项目切换与菜单之间”的分隔同款，把窗口按钮与左边的布局按钮分成两组。宽度在 styles.css 的 --nb-window-controls-width 里算过。 */
.desktop-frame__divider {
    align-self: center;
    flex: none;
    width: var(--border-w, 1px);
    height: 16px;
    margin-inline: 8px 9px;
    background: var(--divider, var(--host-loading-muted, GrayText));
}

/*
 * 命中区与“芯”分开：命中区 34×36 贴边排开（关闭按钮一直到窗口右缘与上缘，指针甩到屏幕角落仍点得到），看得见的是中间 26×26 的芯，
 * 与标题栏里的布局按钮（nb-ui IconButton 的 sm、default 变体）同样大小、圆角、颜色、过渡与按下缩放；指针在命中区里任何位置都点亮芯。
 * 这些值与 IconButton 同步，那边改了这里跟着改。原生按钮而不是 IconButton：IconButton 是定边长的方块，做不出比芯大的命中区。
 */
.desktop-frame__button {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 100%;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--text-secondary, var(--host-loading-muted, GrayText));
    cursor: pointer;
}

.desktop-frame__chip {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: var(--radius-button-sm, 6px);
    transition-property: background-color, color, transform;
    transition-duration: var(--motion-fast, 120ms);
    transition-timing-function: var(--ease-layout, ease);
}

.desktop-frame__icon {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.desktop-frame__button:hover .desktop-frame__chip {
    background: color-mix(in srgb, var(--text-main, var(--host-loading-text, CanvasText)) 15%, transparent);
    color: var(--text-main, var(--host-loading-text, CanvasText));
}

.desktop-frame__button:active .desktop-frame__chip {
    background: color-mix(in srgb, var(--text-main, var(--host-loading-text, CanvasText)) 24%, transparent);
    transform: scale(0.93);
}

/* Windows 关闭按钮的红，配白色图标（对比度约 5.7:1）；系统按钮就是这个颜色，不随主题变。 */
.desktop-frame__button--close:hover .desktop-frame__chip,
.desktop-frame__button--close:active .desktop-frame__chip {
    background: #c42b1c;
    color: #fff;
}

@media (forced-colors: active) {
    .desktop-frame__button {
        color: ButtonText;
    }

    .desktop-frame__button:hover .desktop-frame__chip,
    .desktop-frame__button--close:hover .desktop-frame__chip {
        background: Highlight;
        color: HighlightText;
    }
}
</style>

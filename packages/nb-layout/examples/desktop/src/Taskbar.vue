<script setup lang="ts">
/**
 * 底栏：四扇窗各一个按钮，一直列着，按钮上的 `data-window-state` 是这扇窗此刻的样子。
 * 点按钮做什么（挪到最上、回到原来的模式、重新打开）由模型定，这里只发出被点的窗。
 */
import {TITLES, WINDOW_IDS, type Mode, type WindowId} from "./model";

/** 按钮的状态也要说出来，不只靠圆点的样式：读屏用户念到的是“Notes, minimized”。 */
const SPOKEN: Readonly<Record<Mode, string>> = {
    floating: "open",
    maximized: "maximized",
    "tiled-left": "tiled left",
    "tiled-right": "tiled right",
    minimized: "minimized",
    closed: "closed",
};

defineProps<{states: Readonly<Record<WindowId, Mode>>}>();
defineEmits<{click: [id: WindowId]}>();
</script>

<template>
    <nav class="taskbar" aria-label="Windows">
        <button v-for="id in WINDOW_IDS" :key="id" type="button" class="taskbar__button" :data-window="id" :data-window-state="states[id]" :aria-label="`${TITLES[id]}, ${SPOKEN[states[id]]}`" @click="$emit('click', id)">
            <span class="taskbar__dot" aria-hidden="true"></span>{{ TITLES[id] }}
        </button>
    </nav>
</template>

<style scoped>
.taskbar {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    height: 100%;
    padding: 0 12px;
    background: #20263a;
}
.taskbar__button {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 8px 14px;
    border: 0;
    border-radius: 8px;
    background: rgb(255 255 255 / 8%);
    color: #e9ecf5;
    font: inherit;
    cursor: pointer;
    transition: background-color 120ms;
}
.taskbar__button:hover {
    background: rgb(255 255 255 / 16%);
}
.taskbar__dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: transparent;
    box-shadow: 0 0 0 1px rgb(255 255 255 / 45%);
    transition: background-color 120ms;
}
/* 开着的窗点亮，最小化的空心带虚影，关掉的暗下去。 */
.taskbar__button:not([data-window-state="closed"], [data-window-state="minimized"]) .taskbar__dot {
    background: #8fb0ff;
    box-shadow: none;
}
.taskbar__button[data-window-state="minimized"] {
    background: rgb(255 255 255 / 4%);
}
.taskbar__button[data-window-state="closed"] {
    color: rgb(233 236 245 / 55%);
}
@media (prefers-reduced-motion: reduce) {
    .taskbar__button,
    .taskbar__dot {
        transition: none;
    }
}
</style>

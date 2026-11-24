<script setup lang="ts">
/**
 * 一扇窗的标题栏：标题与按钮。它放在 `NestedGrid` 的叶插槽里：窗浮动时这块叶不在树里、由 `floats` 给矩形，
 * 平铺时叶在树里，插槽的内容是同一份，所以窗在两边之间来回时标题栏不重建。正文在内容层，不在这里。
 *
 * 拖动不在这里：整个网格一场拖动会话，按 `data-window-title` 认来源，按钮由会话的 `sourceAt` 排除。
 * 按钮离窗的上边与右边至少 8px：库的缩放手柄带贴着窗的边往里 6px（上边 3px），按钮挨得更近会点到手柄。
 *
 * 数据全经属性传进来，不按 id 查模型：窗被关掉时它的叶可能还留着缩回去，那几帧里这个组件还会重新渲染。
 */
import {TITLE_BAR_HEIGHT, type Mode} from "./model";

export type WindowAction = "minimize" | "maximize" | "close" | "untile";

/** 样式里的 `v-bind(titleBarHeight)` 把它写成这个组件的 CSS 变量：高度只在模型里定义一处，内容层的 `insetTop` 读的也是它。 */
const titleBarHeight = `${TITLE_BAR_HEIGHT}px`;

const props = defineProps<{id: string; title: string; mode: Mode}>();
const emit = defineEmits<{action: [id: string, action: WindowAction]}>();

const tiled = () => props.mode === "tiled-left" || props.mode === "tiled-right";
const placed = () => tiled() || props.mode === "floating" || props.mode === "maximized";
</script>

<template>
    <div class="titlebar" :class="{'titlebar--movable': mode === 'floating'}" :data-window-title="id" :data-window-mode="mode">
        <span class="titlebar__text">{{ title }}</span>
        <span v-if="placed()" class="titlebar__buttons">
            <button v-if="tiled()" type="button" class="titlebar__button" data-window-action="untile" :aria-label="`Untile ${title}`" @click="emit('action', id, 'untile')">
                <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2h8v8H2zM6 2v8" /></svg>
            </button>
            <button type="button" class="titlebar__button" data-window-action="minimize" :aria-label="`Minimize ${title}`" @click="emit('action', id, 'minimize')">
                <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 9h8" /></svg>
            </button>
            <button v-if="!tiled()" type="button" class="titlebar__button" data-window-action="maximize" :aria-label="`${mode === 'maximized' ? 'Restore' : 'Maximize'} ${title}`" @click="emit('action', id, 'maximize')">
                <svg viewBox="0 0 12 12" aria-hidden="true"><path v-if="mode === 'maximized'" d="M4 2h6v6M2 4h6v6H2z" /><path v-else d="M2 2h8v8H2z" /></svg>
            </button>
            <button type="button" class="titlebar__button titlebar__button--close" data-window-action="close" :aria-label="`Close ${title}`" @click="emit('action', id, 'close')">
                <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" /></svg>
            </button>
        </span>
    </div>
</template>

<style scoped>
.titlebar {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: space-between;
    box-sizing: border-box;
    /* 按钮 22px 高，加 1px 的下边线共 39px，按钮上下各留 8px：离窗的上边不小于 8px（见文件头）。改高度要连按钮一起看。 */
    height: v-bind(titleBarHeight);
    padding: 0 10px 0 12px;
    background: linear-gradient(#eef0f6, #dfe3ec);
    border-bottom: 1px solid #c4cad8;
    /* 触摸时指针事件不交给浏览器滚动，拖动会话才收得到移动。 */
    touch-action: none;
    user-select: none;
}
.titlebar--movable {
    cursor: grab;
}
.titlebar__text {
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.titlebar__buttons {
    display: flex;
    gap: 4px;
}
.titlebar__button {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: #35405a;
    cursor: pointer;
    transition: background-color 120ms;
}
.titlebar__button:hover {
    background: rgb(53 64 90 / 14%);
}
.titlebar__button--close:hover {
    background: #d9534f;
    color: #fff;
}
.titlebar__button svg {
    width: 12px;
    height: 12px;
    fill: none;
    stroke: currentcolor;
    stroke-width: 1.4;
}
@media (prefers-reduced-motion: reduce) {
    .titlebar__button {
        transition: none;
    }
}
</style>

<script setup lang="ts">
/**
 * 一个编组的标签条：选中、关闭、键盘在标签之间走。拖动不在这里：整个网格一场拖动会话，按 `data-tab` 认来源。
 *
 * 数据全经属性传进来（这一刻的标签与选中的副本），不按编组 id 去查模型。编组被删掉时，它的叶留着缩回去，
 * 那几帧里这个组件还在、还会按响应式依赖更新；按 id 查的话会查到一个已经不在的编组。
 */
import {nextTick, useTemplateRef} from "vue";

const props = defineProps<{
    group: string;
    label: string;
    tabs: readonly string[];
    active: string;
    /** 能不能关：最后一个编组的最后一个标签不能关，按钮不画。 */
    closable: boolean;
}>();

const emit = defineEmits<{
    activate: [tab: string];
    close: [tab: string];
}>();

const root = useTemplateRef<HTMLElement>("root");

/** 读屏与键盘按 WAI-ARIA 的标签页写法：选中的那个在 Tab 顺序里，其余用方向键到。 */
function onKeydown(event: KeyboardEvent, tab: string): void {
    const index = props.tabs.indexOf(tab);
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step !== 0 || event.key === "Home" || event.key === "End") {
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? props.tabs.length - 1 : (index + step + props.tabs.length) % props.tabs.length;
        const target = props.tabs[next]!;
        emit("activate", target);
        void nextTick(() => root.value?.querySelector<HTMLElement>(`[data-tab-button="${CSS.escape(target)}"]`)?.focus());
        return;
    }
    if (event.key === "Delete" && props.closable) {
        event.preventDefault();
        emit("close", tab);
    }
}
</script>

<template>
    <div ref="root" class="tab-bar" role="tablist" :aria-label="label" data-tab-strip :data-group="group">
        <!-- 关闭按钮与标签并排，不放进 role="tab" 里面：放在里面读屏读不到它。 -->
        <div v-for="tab in tabs" :key="tab" class="tab" role="presentation" :data-tab="tab" :data-selected="tab === active ? '' : undefined">
            <button
                :id="`tab-${tab}`"
                type="button"
                role="tab"
                class="tab__label"
                :data-tab-button="tab"
                :aria-selected="tab === active"
                :aria-controls="`panel-${tab}`"
                :tabindex="tab === active ? 0 : -1"
                @click="emit('activate', tab)"
                @keydown="onKeydown($event, tab)"
            >{{ tab }}</button>
            <button v-if="closable" type="button" class="tab__close" data-tab-close tabindex="-1" :aria-label="`Close ${tab}`" @click="emit('close', tab)">×</button>
        </div>
    </div>
</template>

<style scoped>
.tab-bar {
    display: flex;
    height: var(--tab-bar-height);
    overflow: hidden;
    background: #eef0f4;
    border-bottom: 1px solid #d5d9e0;
}
/* 放不下时标签一起变窄、文字截断，不滚动：滚出去的标签库判插入位时会跳过，插入线与实际位置会对不上。 */
.tab {
    display: flex;
    flex: 0 1 auto;
    min-width: 56px;
    align-items: center;
    border-right: 1px solid #d5d9e0;
    cursor: grab;
}
.tab[data-selected] {
    background: #fff;
}
.tab__label {
    min-width: 0;
    overflow: hidden;
    padding: 0 6px 0 10px;
    border: 0;
    background: none;
    font: inherit;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: inherit;
}
.tab__close {
    flex: none;
    width: 20px;
    margin-right: 4px;
    border: 0;
    border-radius: 4px;
    background: none;
    color: #667;
    cursor: pointer;
}
.tab__close:hover {
    background: #dde1e8;
}
</style>

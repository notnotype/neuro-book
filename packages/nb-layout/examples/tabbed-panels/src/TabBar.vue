<script setup lang="ts">
/**
 * 一个编组的标签条：选中、关闭、键盘在标签之间走。拖动不在这里：整个网格一场拖动会话，按 `data-tab` 认来源。
 *
 * 数据全经属性传进来（这一刻的标签与选中的副本），不按编组 id 去查模型。编组被删掉时，它的叶留着缩回去，
 * 那几帧里这个组件还在、还会按响应式依赖更新；按 id 查的话会查到一个已经不在的编组。
 */
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

/**
 * 读屏与键盘按 WAI-ARIA 的标签页写法：选中的那个在 Tab 顺序里，其余用方向键到。方向键只换选中，焦点由主界面跟过去
 * （它对所有“换了选中”的操作统一给焦点）。带修饰键的不管：Alt+左右是浏览器的前进后退。
 */
function onKeydown(event: KeyboardEvent, tab: string): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const index = props.tabs.indexOf(tab);
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step !== 0 || event.key === "Home" || event.key === "End") {
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? props.tabs.length - 1 : (index + step + props.tabs.length) % props.tabs.length;
        emit("activate", props.tabs[next]!);
        return;
    }
    // 能不能关由模型判：最后一个标签按了也关不掉，状态行会说为什么。
    if (event.key === "Delete") {
        event.preventDefault();
        emit("close", tab);
    }
}
</script>

<template>
    <div class="tab-bar" role="tablist" :aria-label="label" data-tab-strip :data-group="group">
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
    box-sizing: border-box; /* 高度连下边框一共是标签条的高度，内容层的 insetTop 读的是同一个数。 */
    height: var(--tab-bar-height);
    /* 放不下时横向滚动。滚出去的标签库判插入位时也认：拖过最后一个看得见的标签，插到第一个滚出去的前面，和插入线一致。拖到条的两端时它自己滚（`App.vue` 的 `autoScroll`）。 */
    overflow-x: auto;
    overflow-y: hidden;
    /* 滚动条占的是标签条自己的高度（总高不变，标签矮一点），细的那种才不至于挤掉标签的文字。 */
    scrollbar-width: thin;
    background: #eef0f4;
    border-bottom: 1px solid #d5d9e0;
}
/* 标签按名字的宽度排、不跟着变窄（短名字也不窄过最小宽）：放不下就滚，文字不截断。 */
.tab {
    display: flex;
    flex: none;
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

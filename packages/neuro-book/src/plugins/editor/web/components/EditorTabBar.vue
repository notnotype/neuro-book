<script setup lang="ts">
/** 编辑组的标签条（同名 .md）。 */
import {nextTick, ref, watch} from "vue";

export interface TabItem {
    readonly id: string;
    readonly label: string;
    /** 悬停提示：完整地址。 */
    readonly title: string;
    readonly preview: boolean;
    readonly dirty: boolean;
    readonly active: boolean;
}

const props = defineProps<{tabs: ReadonlyArray<TabItem>; label: string; closeLabel: (label: string) => string; unsavedLabel: string}>();
const emit = defineEmits<{
    (event: "activate", id: string): void;
    (event: "pin", id: string): void;
    (event: "close", id: string): void;
    (event: "move", id: string, delta: -1 | 1): void;
}>();

const list = ref<HTMLElement | null>(null);

// 活动标签换了（新打开、键盘切换）：横向滚到它完整可见；只动标签条自己的滚动，不牵动页面。
watch(() => props.tabs.find((tab) => tab.active)?.id, (id) => {
    if (id === undefined) return;
    // 等下一帧再量：新标签刚插入时宽度还没落定，太早量会差几像素。
    void nextTick(() => requestAnimationFrame(() => {
        const strip = list.value;
        // 整个标签（含关闭按钮）的外框。
        const tab = strip?.querySelector<HTMLElement>(`[data-editor-tab="${id}"]`)?.parentElement;
        if (strip === null || strip === undefined || tab === null || tab === undefined) return;
        const box = tab.getBoundingClientRect();
        const view = strip.getBoundingClientRect();
        // 滚动量向外取整：`scrollLeft` 会被截到整像素，差的零点几像素会让标签边缘仍被裁掉。
        if (box.left < view.left) strip.scrollLeft -= Math.ceil(view.left - box.left);
        else if (box.right > view.right) strip.scrollLeft += Math.ceil(box.right - view.right);
    }));
}, {immediate: true});

const focusTab = (index: number): void => {
    const tab = props.tabs[(index + props.tabs.length) % props.tabs.length];
    if (tab === undefined) return;
    emit("activate", tab.id);
    void nextTick(() => list.value?.querySelector<HTMLElement>(`[data-editor-tab="${tab.id}"]`)?.focus());
};

const onKeydown = (event: KeyboardEvent, index: number, id: string): void => {
    if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        emit("move", id, event.key === "ArrowLeft" ? -1 : 1);
        return;
    }
    switch (event.key) {
        case "ArrowLeft":
            event.preventDefault();
            focusTab(index - 1);
            return;
        case "ArrowRight":
            event.preventDefault();
            focusTab(index + 1);
            return;
        case "Home":
            event.preventDefault();
            focusTab(0);
            return;
        case "End":
            event.preventDefault();
            focusTab(props.tabs.length - 1);
            return;
        case "Delete":
            event.preventDefault();
            emit("close", id);
    }
};

/** 中键关闭：按下时阻止浏览器的自动滚动。 */
const onAuxClick = (event: MouseEvent, id: string): void => {
    if (event.button === 1) {
        event.preventDefault();
        emit("close", id);
    }
};
</script>

<template>
    <div ref="list" role="tablist" :aria-label="label" class="flex min-h-[var(--control-h-sm)] shrink-0 items-stretch overflow-x-auto border-b border-[color:var(--divider)] bg-[var(--bg-panel)] text-[13px]" data-editor-tabs>
        <div
            v-for="(tab, index) in tabs"
            :key="tab.id"
            class="group flex max-w-[240px] shrink-0 items-center gap-1 border-r border-[color:var(--divider)] pl-3 pr-1"
            :class="tab.active ? 'bg-[var(--bg-main)] text-[var(--text-main)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'"
        >
            <button
                type="button"
                role="tab"
                class="nb-ui-focus-ring min-w-0 truncate py-1 text-left"
                :class="tab.preview ? 'italic' : ''"
                :aria-selected="tab.active ? 'true' : 'false'"
                :tabindex="tab.active ? 0 : -1"
                :title="tab.title"
                :data-editor-tab="tab.id"
                :data-editor-tab-preview="tab.preview ? '' : undefined"
                :data-editor-tab-dirty="tab.dirty ? '' : undefined"
                @click="emit('activate', tab.id)"
                @dblclick="emit('pin', tab.id)"
                @auxclick="onAuxClick($event, tab.id)"
                @keydown="onKeydown($event, index, tab.id)"
            >
                <span data-editor-tab-label>{{ tab.label }}</span><span v-if="tab.dirty" class="sr-only">（{{ unsavedLabel }}）</span>
            </button>
            <button
                type="button"
                class="nb-ui-focus-ring flex size-5 shrink-0 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                :aria-label="closeLabel(tab.label)"
                tabindex="-1"
                :data-editor-tab-close="tab.id"
                @click="emit('close', tab.id)"
            >
                <span v-if="tab.dirty" class="i-lucide-circle size-2.5 group-hover:hidden" aria-hidden="true"></span>
                <span class="i-lucide-x size-3.5" :class="tab.dirty ? 'hidden group-hover:block' : ''" aria-hidden="true"></span>
            </button>
        </div>
    </div>
</template>

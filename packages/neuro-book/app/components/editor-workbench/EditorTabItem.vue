<script setup lang="ts">
import {computed, ref} from "vue";
import type {EditorTabPresentation} from "./editor-view.types";

const props = withDefaults(defineProps<{
    tab: EditorTabPresentation;
    active?: boolean;
    focused?: boolean;
    pinned?: boolean;
    dropIndicator?: "before" | "after" | null;
    tabId?: string;
    ariaControls?: string;
}>(), {
    active: false,
    focused: false,
    pinned: false,
    dropIndicator: null,
    tabId: undefined,
    ariaControls: undefined,
});

const emit = defineEmits<{
    (e: "select", path: string): void;
    (e: "close", path: string): void;
    (e: "keep", path: string): void;
    (e: "contextmenu", event: MouseEvent): void;
    (e: "dragstart", event: DragEvent): void;
    (e: "dragover", event: DragEvent): void;
    (e: "drop", event: DragEvent): void;
    (e: "dragend", event: DragEvent): void;
    (e: "keydown", event: KeyboardEvent): void;
}>();

const {t} = useI18n();
const buttonRef = ref<HTMLButtonElement | null>(null);

/** 根据文件名扩展名解析图标与特定色彩 */
const resolvedIconClass = computed(() => {
    if (props.tab.iconClass && props.tab.iconClass !== "i-lucide-file-text") {
        return props.tab.iconClass;
    }
    const ext = props.tab.path.split(".").pop()?.toLowerCase();
    switch (ext) {
        case "md":
            return "i-lucide-file-text text-[var(--accent-text)]";
        case "json":
            return "i-lucide-braces text-amber-500";
        case "html":
        case "htm":
            return "i-lucide-code-xml text-orange-500";
        case "env":
            return "i-lucide-key-round text-amber-400";
        case "ts":
        case "tsx":
            return "i-lucide-file-code-2 text-blue-500";
        case "js":
        case "jsx":
            return "i-lucide-file-code text-yellow-500";
        case "vue":
            return "i-lucide-file-code text-emerald-500";
        default:
            return props.tab.iconClass || "i-lucide-file-text text-[var(--text-secondary)]";
    }
});

defineExpose({
    focus: () => buttonRef.value?.focus(),
    getButtonElement: () => buttonRef.value,
});
</script>

<template>
    <div
        data-role="editor-tab-item"
        class="editor-tab-item group relative flex shrink-0 items-center rounded-[var(--radius-control)] transition-all select-none mx-0.5 my-1"
        :class="[
            pinned ? 'h-6' : 'h-[26px]',
            active
                ? 'bg-[var(--panel-surface)] text-[var(--text-main)] shadow-2xs ring-1 ring-[var(--border-color)]/60 font-medium'
                : 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]',
            tab.preview ? 'is-preview' : '',
            tab.dirty ? 'is-dirty' : '',
        ]"
        :title="tab.path"
        draggable="true"
        @dragstart="emit('dragstart', $event)"
        @dragover="emit('dragover', $event)"
        @drop="emit('drop', $event)"
        @dragend="emit('dragend', $event)"
        @contextmenu.prevent.stop="emit('contextmenu', $event)"
    >
        <!-- 拖拽目标指示线 -->
        <div
            v-if="dropIndicator === 'before'"
            class="absolute inset-y-1 left-0 -translate-x-1/2 w-0.5 z-10 bg-[var(--accent-main)] rounded-full"
            aria-hidden="true"
        />
        <div
            v-if="dropIndicator === 'after'"
            class="absolute inset-y-1 right-0 translate-x-1/2 w-0.5 z-10 bg-[var(--accent-main)] rounded-full"
            aria-hidden="true"
        />

        <button
            ref="buttonRef"
            type="button"
            role="tab"
            :id="tabId"
            :aria-selected="active"
            :aria-controls="ariaControls"
            :tabindex="focused ? 0 : -1"
            class="editor-tab-button flex min-w-0 items-center gap-1.5 pl-2.5 pr-1 py-1 text-xs text-left outline-none cursor-pointer focus-visible:ring-1 focus-visible:ring-[var(--accent-main)] rounded-[calc(var(--radius-control)-1px)]"
            :class="pinned ? 'max-w-[160px]' : 'max-w-[220px]'"
            @click="emit('select', tab.path)"
            @dblclick="emit('keep', tab.path)"
            @keydown="emit('keydown', $event)"
        >
            <span :class="resolvedIconClass" class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span
                class="min-w-0 flex-1 truncate font-normal text-[11.5px]"
                :class="[
                    tab.preview ? 'italic text-[var(--text-secondary)]' : '',
                    tab.statusText === 'U' || (!tab.statusText && tab.dirty) ? 'text-emerald-600 dark:text-emerald-400' : '',
                    tab.statusText === 'M' ? 'text-amber-600 dark:text-amber-400' : '',
                ]"
            >
                {{ tab.title }}
            </span>

            <!-- Git 状态标识 (对齐 VS Code: 浅绿小字母 U 或 浅橙小字母 M) -->
            <span
                v-if="tab.statusText"
                class="text-[11px] font-mono leading-none font-normal"
                :class="tab.statusText === 'U' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'"
                :aria-label="`状态: ${tab.statusText}`"
            >
                {{ tab.statusText }}
            </span>
        </button>

        <!-- VS Code 风格关闭/未保存圆点区域：未保存时默认小圆点，hover 时切换为叉号 -->
        <div class="relative flex h-4.5 w-4.5 shrink-0 items-center justify-center mr-1 ml-0.5">
            <span
                v-if="tab.dirty"
                class="h-2 w-2 shrink-0 rounded-full bg-[var(--text-secondary)] transition-opacity duration-150 group-hover:opacity-0"
                :title="t('editorWorkbench.unsaved')"
                :aria-label="t('editorWorkbench.unsaved')"
            />
            <button
                type="button"
                class="editor-tab-close absolute inset-0 flex items-center justify-center rounded-[calc(var(--radius-control)*0.75)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-all cursor-pointer"
                :class="[
                    tab.dirty
                        ? 'opacity-0 group-hover:opacity-80 hover:!opacity-100 focus-visible:opacity-100'
                        : (active ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100 focus-visible:opacity-100'),
                ]"
                :title="`${t('editorWorkbench.close')} (${tab.title})`"
                :aria-label="`${t('editorWorkbench.close')} ${tab.title}`"
                tabindex="-1"
                @click.stop="emit('close', tab.path)"
            >
                <span class="i-lucide-x h-3 w-3" aria-hidden="true" />
            </button>
        </div>
    </div>
</template>

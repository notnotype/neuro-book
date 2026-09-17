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
        class="editor-tab-item group relative flex shrink-0 items-center border-r border-[var(--divider)] transition-colors select-none"
        :class="[
            pinned ? 'h-7' : 'h-8.5',
            active
                ? 'bg-[var(--panel-surface)] text-[var(--text-main)] shadow-xs after:absolute after:top-0 after:left-0 after:h-[2px] after:w-full after:bg-[var(--accent-main)]'
                : 'bg-[var(--bg-panel)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]',
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
            class="absolute inset-y-0 left-0 w-0.5 z-10 bg-[var(--accent-main)]"
            aria-hidden="true"
        />
        <div
            v-if="dropIndicator === 'after'"
            class="absolute inset-y-0 right-0 w-0.5 z-10 bg-[var(--accent-main)]"
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
            class="editor-tab-button flex min-w-0 items-center gap-1.5 px-3 py-1 text-xs font-medium text-left outline-none cursor-pointer focus-visible:ring-1 focus-visible:ring-[var(--accent-main)]"
            :class="pinned ? 'max-w-[180px]' : 'max-w-[220px]'"
            @click="emit('select', tab.path)"
            @dblclick="emit('keep', tab.path)"
            @keydown="emit('keydown', $event)"
        >
            <span :class="resolvedIconClass" class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span
                class="min-w-0 flex-1 truncate"
                :class="[
                    tab.preview ? 'italic text-[var(--text-secondary)]' : '',
                    tab.statusText === 'U' ? 'text-emerald-600 dark:text-emerald-400 font-medium' : '',
                    tab.statusText === 'M' ? 'text-amber-600 dark:text-amber-400 font-medium' : '',
                ]"
            >
                {{ tab.title }}
            </span>

            <!-- Git 状态标识 (如 U, M) -->
            <span
                v-if="tab.statusText"
                class="text-[10px] font-mono leading-none px-0.5"
                :class="tab.statusText === 'U' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'"
                :aria-label="`状态: ${tab.statusText}`"
            >
                {{ tab.statusText }}
            </span>

            <!-- 未保存 Dirty 圆点 -->
            <span
                v-if="tab.dirty"
                class="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--status-warning)]"
                :title="t('editorWorkbench.unsaved')"
                :aria-label="t('editorWorkbench.unsaved')"
            />
        </button>

        <!-- 关闭按钮 -->
        <button
            type="button"
            class="editor-tab-close mr-1.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[calc(var(--radius-control)*0.75)] opacity-0 transition-opacity hover:bg-[var(--bg-hover)] group-hover:opacity-100 focus-visible:opacity-100 cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-main)]"
            :class="active ? 'opacity-70 hover:opacity-100' : ''"
            :title="`${t('editorWorkbench.close')} (${tab.title})`"
            :aria-label="`${t('editorWorkbench.close')} ${tab.title}`"
            tabindex="-1"
            @click.stop="emit('close', tab.path)"
        >
            <span class="i-lucide-x h-3 w-3" aria-hidden="true" />
        </button>
    </div>
</template>

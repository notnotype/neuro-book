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
        class="editor-tab-item group relative flex h-full shrink-0 items-center select-none border-r border-[var(--divider)] transition-colors"
        :class="[
            active
                ? 'bg-[var(--panel-surface)] text-[var(--text-main)] border-b border-transparent z-10'
                : 'bg-[var(--bg-panel)] text-[var(--text-secondary)] border-b border-[var(--divider)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]',
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
        <!-- 拖拽目标指示线：对齐 VS Code 2px 竖条 -->
        <div
            v-if="dropIndicator === 'before'"
            class="absolute inset-y-0 left-0 -translate-x-1/2 w-0.5 z-20 bg-[var(--accent-main)]"
            aria-hidden="true"
        />
        <div
            v-if="dropIndicator === 'after'"
            class="absolute inset-y-0 right-0 translate-x-1/2 w-0.5 z-20 bg-[var(--accent-main)]"
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
            class="editor-tab-button flex h-full min-w-0 items-center gap-1.5 pl-3 pr-1 text-xs text-left outline-none cursor-pointer focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--accent-main)]"
            :class="pinned ? 'max-w-[160px]' : 'max-w-[240px]'"
            @click="emit('select', tab.path)"
            @dblclick="emit('keep', tab.path)"
            @keydown="emit('keydown', $event)"
        >
            <span :class="resolvedIconClass" class="h-4 w-4 shrink-0" aria-hidden="true" />
            <span
                class="min-w-0 truncate font-normal text-[11.5px] leading-none"
                :class="[
                    tab.preview ? 'italic' : '',
                    tab.statusText === 'U' || (!tab.statusText && tab.dirty) ? 'text-emerald-600 dark:text-emerald-400' : '',
                    tab.statusText === 'M' ? 'text-amber-600 dark:text-amber-400' : '',
                    !tab.statusText && !tab.dirty ? (active ? 'text-[var(--text-main)]' : 'text-[var(--text-secondary)] group-hover:text-[var(--text-main)]') : '',
                ]"
            >
                {{ tab.title }}
            </span>

            <!-- 路径消歧义描述（如 Image 2 中的 ...\doc-review 或 C:\...\handoff） -->
            <span
                v-if="tab.description"
                class="min-w-0 truncate text-[10px] font-mono leading-none text-[var(--text-muted)] opacity-75"
            >
                {{ tab.description }}
            </span>

            <!-- Git 状态标识 (对齐 VS Code: 纯色单字母 M 或 U) -->
            <span
                v-if="tab.statusText"
                class="text-[11px] font-mono leading-none font-normal shrink-0 ml-0.5"
                :class="tab.statusText === 'U' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'"
                :aria-label="`状态: ${tab.statusText}`"
            >
                {{ tab.statusText }}
            </span>

            <!-- 固定标签图钉标识 -->
            <span
                v-if="pinned"
                class="i-lucide-pin h-2.5 w-2.5 shrink-0 text-[var(--text-muted)] opacity-50 ml-0.5"
                aria-hidden="true"
            />
        </button>

        <!-- VS Code 风格关闭/未保存圆点区域：未保存时默认小圆点，hover 时切换为叉号 -->
        <div class="relative flex h-5 w-5 shrink-0 items-center justify-center mr-1 ml-0.5">
            <span
                v-if="tab.dirty"
                class="h-2 w-2 shrink-0 rounded-full bg-[var(--text-secondary)] transition-opacity duration-150 group-hover:opacity-0"
                :title="t('editorWorkbench.unsaved')"
                :aria-label="t('editorWorkbench.unsaved')"
            />
            <button
                type="button"
                class="editor-tab-close absolute inset-0.5 flex items-center justify-center rounded-[3px] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-all cursor-pointer"
                :class="[
                    tab.dirty
                        ? 'opacity-0 group-hover:opacity-80 hover:!opacity-100 focus-visible:opacity-100'
                        : (active ? 'opacity-70 hover:opacity-100' : 'opacity-0 group-hover:opacity-70 hover:!opacity-100 focus-visible:opacity-100'),
                ]"
                :title="`${t('editorWorkbench.close')} (${tab.title})`"
                :aria-label="`${t('editorWorkbench.close')} ${tab.title}`"
                tabindex="-1"
                @click.stop="emit('close', tab.path)"
            >
                <span class="i-lucide-x h-3.5 w-3.5" aria-hidden="true" />
            </button>
        </div>
    </div>
</template>

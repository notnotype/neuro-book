<script setup lang="ts">
import {computed, ref, useId, watch} from "vue";
import {useDraggable} from "@dnd-kit/vue";
import type {EditorTabPresentation} from "./editor-view.types";
import {EDITOR_TAB_DRAG_TYPE, useEditorTabDrag} from "./useEditorTabDrag";
import {resolveFileIcon} from "../../utils/editor-workbench/editor-icon";

export interface EditorTabItemHandle {
    focus: () => void;
    getButtonElement: () => HTMLButtonElement | null;
}

const props = withDefaults(defineProps<{
    tab: EditorTabPresentation;
    active?: boolean;
    focused?: boolean;
    pinned?: boolean;
    /** 所属编辑组：拖动源载荷的一半；缺席（脱离工作台的纯展示）时这个条目不是拖动源。 */
    groupId?: string;
    tabId?: string;
    ariaControls?: string;
}>(), {
    active: false,
    focused: false,
    pinned: false,
    groupId: undefined,
    tabId: undefined,
    ariaControls: undefined,
});

const emit = defineEmits<{
    (e: "select", path: string): void;
    (e: "close", path: string): void;
    (e: "keep", path: string): void;
    (e: "unpin", path: string): void;
    (e: "contextmenu", event: MouseEvent): void;
    (e: "keydown", event: KeyboardEvent): void;
}>();

const {t} = useI18n();
const itemRef = ref<HTMLElement | null>(null);
const buttonRef = ref<HTMLButtonElement | null>(null);

/**
 * 拖动源在**装配时**决定，之后不再变：会话由宿主（`EditorWorkbench` / 独立标签栏夹具的 Provider）
 * 提供，没有会话就没有 dnd-kit 的 Provider，`useDraggable` 会直接抛错——所以纯展示用法
 * 连注册都不做，而不是登记一个永远禁用的源。
 */
const dragSession = useEditorTabDrag();
const dragSourceId = `editor-tab:${useId()}`;

/**
 * 拖动面是标签按钮本身：`element` 是整个条目（会话按它的真实矩形读拖动源几何），`handle` 是
 * `role="tab"` 按钮——关闭按钮与脏标记区不在手柄里，按住它们不会起拖（另有 `data-no-drag` 双保险）。
 * 载荷只有 `kind / groupId / path`：拖动中它不因组件 props 变化而改变含义。
 *
 * 激活门槛不在这里另写一份：Provider 用 `editorDragSensors()` 建管理器（鼠标/笔按距离、触摸按延迟、
 * `Ctrl+Space` 起键盘拖动），拖动源沿用管理器那一套；`useDraggable` 的 `sensors` 只接数组形式，
 * 逐源再传一份没有额外语义。
 */
const draggable = dragSession
    ? useDraggable({
        id: dragSourceId,
        type: EDITOR_TAB_DRAG_TYPE,
        data: computed(() => ({
            kind: EDITOR_TAB_DRAG_TYPE,
            groupId: props.groupId ?? "",
            path: props.tab.path,
        })),
        element: itemRef,
        handle: buttonRef,
        disabled: computed(() => !props.groupId),
    })
    : null;

const dragging = computed(() => draggable?.isDragging.value === true);

/**
 * 拖动激活后抑制同一次手势末尾的 click：松手落在标签上不该顺带选中它。
 * 新的按下序列（`pointerdown` 捕获阶段）重置抑制位，键盘拖动之后同样在下一次按下时归位。
 */
const clickSuppressed = ref(false);

watch(dragging, (active) => {
    if (active) {
        clickSuppressed.value = true;
    }
});

function resetClickSuppression(): void {
    clickSuppressed.value = false;
}

function suppressClick(event: MouseEvent): void {
    if (!clickSuppressed.value) {
        return;
    }
    clickSuppressed.value = false;
    event.preventDefault();
    event.stopPropagation();
}

/** 根据文件名扩展名解析图标与特定色彩 */
const resolvedIconClass = computed(() => {
    if (props.tab.iconClass && props.tab.iconClass !== "i-lucide-file-text") {
        return props.tab.iconClass;
    }
    return resolveFileIcon(props.tab.path);
});

defineExpose<EditorTabItemHandle>({
    focus: () => buttonRef.value?.focus(),
    getButtonElement: () => buttonRef.value,
});
</script>

<template>
    <div
        ref="itemRef"
        data-role="editor-tab-item"
        :data-editor-tab-path="tab.path"
        class="editor-tab-item group relative flex shrink-0 items-center select-none rounded-[var(--radius-control)] my-1 mx-1.5 border transition-[background-color,border-color,color,box-shadow] [transition-duration:var(--motion-fast)] motion-reduce:transition-none"
        :class="[
            pinned ? 'h-[26px]' : 'h-[28px]',
            active
                ? 'border-[var(--border-color)]/60 bg-[var(--panel-surface)] text-[var(--text-main)] shadow-2xs'
                : 'border-transparent bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]',
            tab.preview ? 'is-preview' : '',
            tab.dirty ? 'is-dirty' : '',
        ]"
        :title="tab.path"
        @pointerdown.capture="resetClickSuppression"
        @click.capture="suppressClick"
        @contextmenu.prevent.stop="emit('contextmenu', $event)"
    >
        <button
            ref="buttonRef"
            type="button"
            role="tab"
            :id="tabId"
            :aria-selected="active"
            :aria-controls="ariaControls"
            :tabindex="focused ? 0 : -1"
            class="editor-tab-button flex h-full min-w-0 items-center gap-1.5 pl-2.5 pr-1 text-xs text-left outline-none cursor-pointer focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--accent-main)] rounded-[calc(var(--radius-control)-1px)]"
            :class="pinned ? 'max-w-[160px]' : 'max-w-[240px]'"
            @click="emit('select', tab.path)"
            @dblclick="emit('keep', tab.path)"
            @keydown="emit('keydown', $event)"
        >
            <span :class="resolvedIconClass" class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span
                class="min-w-0 truncate text-[12px] leading-none"
                :class="[
                    tab.preview ? 'italic' : '',
                    tab.statusText === 'U' || (!tab.statusText && tab.dirty) ? 'text-[var(--status-success)]' : '',
                    tab.statusText === 'M' ? 'text-[var(--status-warning)]' : '',
                    !tab.statusText && !tab.dirty ? (active ? 'text-[var(--accent-text)]' : 'text-[var(--text-secondary)] group-hover:text-[var(--text-main)]') : '',
                ]"
            >
                {{ tab.title }}
            </span>

            <!-- 路径消歧义描述（如 ...\doc-review） -->
            <span
                v-if="tab.description"
                class="min-w-0 truncate text-[10px] font-mono leading-none text-[var(--text-muted)] opacity-75"
            >
                {{ tab.description }}
            </span>

            <!-- Git 状态标识 (遵循主题语义状态色) -->
            <span
                v-if="tab.statusText"
                class="text-[11px] font-mono leading-none font-normal shrink-0 ml-0.5"
                :class="tab.statusText === 'U' ? 'text-[var(--status-success)]' : 'text-[var(--status-warning)]'"
                :aria-label="`状态: ${tab.statusText}`"
            >
                {{ tab.statusText }}
            </span>

        </button>

        <button
            v-if="pinned"
            type="button"
            data-no-drag
            class="editor-tab-unpin flex h-5 w-5 shrink-0 items-center justify-center rounded-[calc(var(--radius-control)*0.75)] text-[var(--text-secondary)] hover:text-[var(--accent-text)] hover:bg-[var(--bg-hover)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--accent-main)] outline-none transition-[background-color,color] [transition-duration:var(--motion-fast)] motion-reduce:transition-none cursor-pointer"
            :title="`${t('editorWorkbench.unpin')} (${tab.title})`"
            :aria-label="`${t('editorWorkbench.unpin')} ${tab.title}`"
            :tabindex="focused ? 0 : -1"
            @click.stop="emit('unpin', tab.path)"
        >
            <span class="i-lucide-pin h-3 w-3" aria-hidden="true" />
        </button>

        <!-- 关闭/未保存圆点区域：未保存时默认小圆点，hover 时切换为叉号 -->
        <div data-no-drag class="relative flex h-4.5 w-4.5 shrink-0 items-center justify-center mr-1 ml-0.5">
            <span
                v-if="tab.dirty"
                class="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--status-warning)] transition-opacity [transition-duration:var(--motion-fast)] motion-reduce:transition-none group-hover:opacity-0"
                :title="t('editorWorkbench.unsaved')"
                :aria-label="t('editorWorkbench.unsaved')"
            />
            <button
                type="button"
                class="editor-tab-close absolute inset-0 flex items-center justify-center rounded-[calc(var(--radius-control)*0.75)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-[opacity,background-color,color] [transition-duration:var(--motion-fast)] motion-reduce:transition-none cursor-pointer"
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
                <span class="i-lucide-x h-3 w-3" aria-hidden="true" />
            </button>
        </div>
    </div>
</template>

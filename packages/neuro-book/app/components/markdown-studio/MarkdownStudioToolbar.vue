<script setup lang="ts">
import ContextMenu, {type ContextMenuItem} from "nbook/app/components/common/ContextMenu.vue";
import type {WorkspaceEditorKind, WorkspaceEditorTab, WorkspaceEditorViewMode} from "nbook/app/stores/novel-ide";

type TabDropPosition = "before" | "after";

const props = withDefaults(defineProps<{
    tabs: WorkspaceEditorTab[];
    activePath: string;
    editorKind: WorkspaceEditorKind;
    workspaceViewMode: WorkspaceEditorViewMode;
    commentViewOpen?: boolean;
    commentCount?: number;
    activeTabRows?: number;
}>(), {
    commentViewOpen: false,
    commentCount: 0,
    activeTabRows: 3,
});

const emit = defineEmits<{
    (e: "select-tab", path: string): void;
    (e: "close-tab", path: string): void;
    (e: "set-pin", path: string, pinned: boolean): void;
    (e: "keep-tab", path: string): void;
    (e: "move-tab", path: string, targetPath: string | null, targetPinned: boolean, position: TabDropPosition): void;
    (e: "set-view-mode", mode: WorkspaceEditorViewMode): void;
    (e: "toggle-comment-view"): void;
    (e: "more"): void;
}>();

const {t} = useI18n();
const pinnedTabs = computed(() => props.tabs.filter((tab) => tab.pinned));
const regularTabs = computed(() => props.tabs.filter((tab) => !tab.pinned));
const draggedTabPath = ref<string | null>(null);
const dropTargetPath = ref<string | null>(null);
const dropTargetPinned = ref(false);
const dropPosition = ref<TabDropPosition>("after");
const dropReady = ref(false);
const contextMenuVisible = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuItems = ref<ContextMenuItem[]>([]);

const modeButtons = computed<Array<{mode: WorkspaceEditorViewMode; title: string; iconClass: string}>>(() => [
    {mode: "rich", title: t("markdownStudio.toolbar.richMode"), iconClass: "i-lucide-book-open-text"},
    {mode: "source", title: t("markdownStudio.toolbar.sourceMode"), iconClass: "i-lucide-file-code-2"},
]);

/**
 * 标签行高度限制，默认允许多行，调用方仍可配置为单行。
 */
const tabRowsStyle = computed(() => ({
    maxHeight: `${Math.max(1, props.activeTabRows) * 34}px`,
}));

/**
 * 根据编辑器类型选择标签图标。
 */
function tabIconClass(tab: WorkspaceEditorTab): string {
    if (tab.editorKind === "markdown") {
        return "i-lucide-file-text";
    }
    if (tab.editorKind === "monaco") {
        return "i-lucide-file-code-2";
    }
    return "i-lucide-file-question";
}

/**
 * 打开标签右键菜单。
 */
function openTabContextMenu(tab: WorkspaceEditorTab, event: MouseEvent): void {
    contextMenuX.value = event.clientX;
    contextMenuY.value = event.clientY;
    contextMenuItems.value = [
        {
            label: tab.pinned ? t("markdownStudio.toolbar.unpin") : t("markdownStudio.toolbar.pin"),
            iconClass: tab.pinned ? "i-lucide-bookmark-x" : "i-lucide-bookmark",
            action: () => emit("set-pin", tab.path, !tab.pinned),
        },
        {
            label: t("markdownStudio.toolbar.keepPreview"),
            iconClass: "i-lucide-panel-top-open",
            disabled: !tab.preview,
            action: () => emit("keep-tab", tab.path),
        },
        {separator: true},
        {
            label: t("markdownStudio.toolbar.close"),
            iconClass: "i-lucide-x",
            action: () => emit("close-tab", tab.path),
        },
    ];
    contextMenuVisible.value = true;
}

/**
 * 开始拖拽标签页。
 */
function startTabDrag(tab: WorkspaceEditorTab, event: DragEvent): void {
    draggedTabPath.value = tab.path;
    if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", tab.path);
    }
}

/**
 * 更新标签页拖拽落点。
 */
function updateTabDrop(tab: WorkspaceEditorTab, targetPinned: boolean, event: DragEvent): void {
    event.preventDefault();
    if (!draggedTabPath.value || draggedTabPath.value === tab.path) {
        dropTargetPath.value = null;
        dropReady.value = false;
        return;
    }

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    dropTargetPath.value = tab.path;
    dropTargetPinned.value = targetPinned;
    dropPosition.value = event.clientX < rect.left + rect.width / 2 ? "before" : "after";
    dropReady.value = true;
    if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
    }
}

/**
 * 更新标签行空白区域落点。
 */
function updateGroupDrop(targetPinned: boolean, event: DragEvent): void {
    event.preventDefault();
    if (!draggedTabPath.value) {
        return;
    }

    const targetElement = event.target as HTMLElement | null;
    if (targetElement?.closest("[data-role='markdown-studio-tab']")) {
        return;
    }
    dropTargetPath.value = null;
    dropTargetPinned.value = targetPinned;
    dropPosition.value = "after";
    dropReady.value = true;
    if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
    }
}

/**
 * 提交标签页拖拽排序。
 */
function commitTabDrop(event: DragEvent): void {
    event.preventDefault();
    if (!draggedTabPath.value || !dropReady.value) {
        clearTabDrag();
        return;
    }

    emit("move-tab", draggedTabPath.value, dropTargetPath.value, dropTargetPinned.value, dropPosition.value);
    clearTabDrag();
}

/**
 * 清理标签页拖拽状态。
 */
function clearTabDrag(): void {
    draggedTabPath.value = null;
    dropTargetPath.value = null;
    dropTargetPinned.value = false;
    dropPosition.value = "after";
    dropReady.value = false;
}

/**
 * 判断当前标签是否显示拖拽指示线。
 */
function isDropTarget(tab: WorkspaceEditorTab, pinned: boolean, position: TabDropPosition): boolean {
    return dropTargetPath.value === tab.path && dropTargetPinned.value === pinned && dropPosition.value === position;
}
</script>

<template>
    <header class="studio-toolbar flex shrink-0 flex-col border-b border-[var(--border-color)] bg-[var(--toolbar-surface)]">
        <!-- 固定标签行 -->
        <div
            v-if="pinnedTabs.length || draggedTabPath"
            class="flex min-h-8 shrink-0 flex-wrap items-end overflow-hidden border-b border-[var(--border-color)] px-2 custom-scrollbar"
            :style="tabRowsStyle"
            @dragover="updateGroupDrop(true, $event)"
            @drop="commitTabDrop"
        >
            <div
                v-for="tab in pinnedTabs"
                :key="tab.path"
                class="group relative flex h-8 w-[188px] max-w-[188px] cursor-pointer select-none items-center gap-2 px-3 text-xs transition-colors"
                :class="tab.path === props.activePath ? 'bg-[var(--page-surface)] text-[var(--text-main)] after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full after:bg-[var(--accent-main)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                :title="tab.path"
                data-role="markdown-studio-tab"
                draggable="true"
                role="button"
                tabindex="0"
                @click="emit('select-tab', tab.path)"
                @dblclick="emit('keep-tab', tab.path)"
                @contextmenu.prevent.stop="openTabContextMenu(tab, $event)"
                @dragstart="startTabDrag(tab, $event)"
                @dragover="updateTabDrop(tab, true, $event)"
                @drop="commitTabDrop"
                @dragend="clearTabDrag"
                @keydown.enter.prevent="emit('select-tab', tab.path)"
                @keydown.space.prevent="emit('select-tab', tab.path)"
            >
                <div v-if="isDropTarget(tab, true, 'before')" class="absolute bottom-0 left-0 top-0 w-0.5 bg-[var(--accent-main)]"></div>
                <div v-if="isDropTarget(tab, true, 'after')" class="absolute bottom-0 right-0 top-0 w-0.5 bg-[var(--accent-main)]"></div>
                <span :class="tabIconClass(tab)" class="h-3.5 w-3.5 shrink-0"></span>
                <span class="min-w-0 flex-1 truncate" :class="tab.preview ? 'italic' : ''">{{ tab.title }}</span>
                <span class="flex h-2 w-2 shrink-0 items-center justify-center">
                    <span v-if="tab.dirty" class="h-1.5 w-1.5 rounded-full bg-[var(--status-warning)]"></span>
                </span>
                <button type="button" class="-mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-0 hover:bg-[var(--bg-hover)] group-hover:opacity-100" :title="t('markdownStudio.toolbar.close')" @click.stop="emit('close-tab', tab.path)">
                    <span class="i-lucide-x h-3 w-3"></span>
                </button>
            </div>
        </div>

        <!-- 活跃标签与轻量工具区 -->
        <div class="flex min-h-9 shrink-0 items-end gap-2 px-2">
            <div
                class="min-w-0 flex flex-1 flex-wrap items-end overflow-hidden custom-scrollbar"
                :style="tabRowsStyle"
                @dragover="updateGroupDrop(false, $event)"
                @drop="commitTabDrop"
            >
                <div
                    v-for="tab in regularTabs"
                    :key="tab.path"
                    class="group relative flex h-[34px] w-[188px] max-w-[188px] cursor-pointer select-none items-center gap-2 px-3 text-xs transition-colors"
                    :class="tab.path === props.activePath ? 'bg-[var(--page-surface)] text-[var(--text-main)] after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full after:bg-[var(--accent-main)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                    :title="tab.path"
                    data-role="markdown-studio-tab"
                    draggable="true"
                    role="button"
                    tabindex="0"
                    @click="emit('select-tab', tab.path)"
                    @dblclick="emit('keep-tab', tab.path)"
                    @contextmenu.prevent.stop="openTabContextMenu(tab, $event)"
                    @dragstart="startTabDrag(tab, $event)"
                    @dragover="updateTabDrop(tab, false, $event)"
                    @drop="commitTabDrop"
                    @dragend="clearTabDrag"
                    @keydown.enter.prevent="emit('select-tab', tab.path)"
                    @keydown.space.prevent="emit('select-tab', tab.path)"
                >
                    <div v-if="isDropTarget(tab, false, 'before')" class="absolute bottom-0 left-0 top-0 w-0.5 bg-[var(--accent-main)]"></div>
                    <div v-if="isDropTarget(tab, false, 'after')" class="absolute bottom-0 right-0 top-0 w-0.5 bg-[var(--accent-main)]"></div>
                    <span :class="tabIconClass(tab)" class="h-3.5 w-3.5 shrink-0"></span>
                    <span class="min-w-0 flex-1 truncate" :class="tab.preview ? 'italic' : ''">{{ tab.title }}</span>
                    <span class="flex h-2 w-2 shrink-0 items-center justify-center">
                        <span v-if="tab.dirty" class="h-1.5 w-1.5 rounded-full bg-[var(--status-warning)]"></span>
                    </span>
                    <button type="button" class="-mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-0 hover:bg-[var(--bg-hover)] group-hover:opacity-100" :title="t('markdownStudio.toolbar.close')" @click.stop="emit('close-tab', tab.path)">
                        <span class="i-lucide-x h-3 w-3"></span>
                    </button>
                </div>
            </div>

            <div class="flex h-[34px] shrink-0 items-center gap-1 text-[var(--text-muted)]">
                <div v-if="props.editorKind === 'markdown'" class="flex items-center rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-0.5">
                    <button
                        v-for="button in modeButtons"
                        :key="button.mode"
                        type="button"
                        class="flex h-6 w-6 items-center justify-center rounded transition-colors"
                        :class="props.workspaceViewMode === button.mode ? 'bg-[var(--bg-hover)] text-[var(--text-main)]' : 'hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                        :title="button.title"
                        @click="emit('set-view-mode', button.mode)"
                    >
                        <span :class="button.iconClass" class="h-3.5 w-3.5"></span>
                    </button>
                </div>
                <button
                    v-if="props.editorKind === 'markdown'"
                    type="button"
                    class="relative flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                    :class="props.commentViewOpen ? 'bg-[var(--bg-hover)] text-[var(--accent-main)]' : ''"
                    :title="t('markdownStudio.toolbar.comments')"
                    @click="emit('toggle-comment-view')"
                >
                    <span class="i-lucide-message-square-text h-4 w-4"></span>
                    <span
                        v-if="props.commentCount > 0"
                        class="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full border border-[var(--toolbar-surface)] bg-[var(--status-warning)] px-0.5 text-[9px] font-semibold leading-none text-[var(--text-inverse)]"
                    >{{ props.commentCount > 9 ? "9+" : props.commentCount }}</span>
                </button>
                <button class="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('markdownStudio.toolbar.more')" @click="emit('more')">
                    <span class="i-lucide-ellipsis-vertical h-4 w-4"></span>
                </button>
            </div>
        </div>

        <ContextMenu :visible="contextMenuVisible" :x="contextMenuX" :y="contextMenuY" :items="contextMenuItems" @close="contextMenuVisible = false" />
    </header>
</template>

<script setup lang="ts">
import {computed, nextTick, onMounted, onUnmounted, ref, watch} from "vue";
import {ContextMenu, type ContextMenuItem} from "@notnotype/nb-ui/components";
import type {EditorTabDropPosition, EditorTabPresentation} from "./editor-view.types";
import EditorTabItem from "./EditorTabItem.vue";

const props = defineProps<{
    tabs: readonly EditorTabPresentation[];
    activePath: string;
}>();

const emit = defineEmits<{
    (e: "select-tab", path: string): void;
    (e: "close-tab", path: string): void;
    (e: "set-pin", path: string, pinned: boolean): void;
    (e: "keep-tab", path: string): void;
    (e: "move-tab", path: string, targetPath: string | null, targetPinned: boolean, position: EditorTabDropPosition): void;
    (e: "empty-focus"): void;
}>();

const {t} = useI18n();

const pinnedTabs = computed(() => props.tabs.filter((tab) => tab.pinned));
const regularTabs = computed(() => props.tabs.filter((tab) => !tab.pinned));

const focusedPath = ref<string>("");
const tabItemRefs = ref<Record<string, unknown>>({});
const activeRowContainerRef = ref<HTMLElement | null>(null);

function getTabButton(path: string): HTMLButtonElement | null {
    const comp = tabItemRefs.value[path];
    if (!comp) return null;
    if (comp instanceof HTMLButtonElement) return comp;
    if (typeof comp === "object" && comp !== null) {
        if ("$el" in comp && (comp as any).$el instanceof HTMLElement) {
            return (comp as any).$el.querySelector('button[role="tab"]');
        }
        if ("getButtonElement" in comp && typeof (comp as any).getButtonElement === "function") {
            return (comp as any).getButtonElement();
        }
    }
    return null;
}

const tabButtonRefs = computed(() => {
    const map: Record<string, HTMLButtonElement | null> = {};
    for (const path of props.tabs.map((t) => t.path)) {
        map[path] = getTabButton(path);
    }
    return map;
});

const draggedTabPath = ref<string | null>(null);
const dropTargetPath = ref<string | null>(null);
const dropTargetPinned = ref(false);
const dropPosition = ref<EditorTabDropPosition>("after");
const dropReady = ref(false);

const contextMenuVisible = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuItems = ref<ContextMenuItem[]>([]);
const menuTriggerTab = ref<EditorTabPresentation | null>(null);
const menuTriggerElement = ref<HTMLElement | null>(null);

function tabDomId(path: string): string {
    return `editor-tab-${encodeURIComponent(path)}`;
}

function panelDomId(path: string): string {
    return `editor-tabpanel-${encodeURIComponent(path)}`;
}

function setTabItemRef(path: string, comp: unknown): void {
    if (comp) {
        tabItemRefs.value[path] = comp;
    } else {
        delete tabItemRefs.value[path];
    }
}

watch(
    () => props.activePath,
    (newPath) => {
        if (newPath && props.tabs.some((tab) => tab.path === newPath)) {
            focusedPath.value = newPath;
            scrollToActiveTab();
        }
    },
    {immediate: true},
);

watch(
    () => props.tabs,
    (newTabs, oldTabs) => {
        if (!newTabs.length) {
            focusedPath.value = "";
            if (oldTabs && oldTabs.length > 0) {
                emit("empty-focus");
            }
            return;
        }

        if (!newTabs.some((tab) => tab.path === focusedPath.value)) {
            const oldIndex = oldTabs ? oldTabs.findIndex((tab) => tab.path === focusedPath.value) : -1;
            let targetTab: EditorTabPresentation | undefined;
            if (oldIndex !== -1) {
                const targetIndex = Math.min(oldIndex, newTabs.length - 1);
                targetTab = newTabs[targetIndex];
            }
            if (!targetTab && props.activePath) {
                targetTab = newTabs.find((tab) => tab.path === props.activePath);
            }
            if (!targetTab) {
                targetTab = newTabs[0];
            }
            if (targetTab) {
                focusTab(targetTab.path);
            }
        } else if (focusedPath.value && typeof document !== "undefined" && (!document.activeElement || document.activeElement === document.body)) {
            nextTick(() => {
                getTabButton(focusedPath.value)?.focus();
            });
        }
    },
    {deep: true},
);

function scrollToActiveTab(): void {
    nextTick(() => {
        const btn = getTabButton(props.activePath);
        if (btn) {
            btn.scrollIntoView({behavior: "smooth", block: "nearest", inline: "nearest"});
        }
    });
}

function focusTab(path: string): void {
    focusedPath.value = path;
    nextTick(() => {
        getTabButton(path)?.focus();
    });
}

function handleTabClick(path: string): void {
    focusedPath.value = path;
    emit("select-tab", path);
}

function handleCloseTab(path: string): void {
    emit("close-tab", path);
}

function handleTabKeydown(tab: EditorTabPresentation, pinned: boolean, event: KeyboardEvent): void {
    const allTabs = props.tabs;
    if (!allTabs.length) return;

    const currentIndex = allTabs.findIndex((t) => t.path === tab.path);
    if (currentIndex === -1) return;

    if (event.key === "ArrowRight") {
        event.preventDefault();
        const nextTab = allTabs[(currentIndex + 1) % allTabs.length];
        if (nextTab) {
            focusTab(nextTab.path);
        }
    } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        const prevTab = allTabs[(currentIndex - 1 + allTabs.length) % allTabs.length];
        if (prevTab) {
            focusTab(prevTab.path);
        }
    } else if (event.key === "Home") {
        event.preventDefault();
        const firstTab = allTabs[0];
        if (firstTab) {
            focusTab(firstTab.path);
        }
    } else if (event.key === "End") {
        event.preventDefault();
        const lastTab = allTabs[allTabs.length - 1];
        if (lastTab) {
            focusTab(lastTab.path);
        }
    } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        emit("select-tab", tab.path);
    } else if (event.key === "Delete") {
        event.preventDefault();
        handleCloseTab(tab.path);
    } else if (event.shiftKey && event.key === "F10") {
        event.preventDefault();
        const btn = getTabButton(tab.path);
        if (btn) {
            const rect = btn.getBoundingClientRect();
            openTabContextMenuAt(tab, rect.left + rect.width / 2, rect.bottom);
        }
    }
}

function isFirstInGroup(tab: EditorTabPresentation): boolean {
    const group = tab.pinned ? pinnedTabs.value : regularTabs.value;
    const first = group[0];
    return Boolean(first && first.path === tab.path);
}

function isLastInGroup(tab: EditorTabPresentation): boolean {
    const group = tab.pinned ? pinnedTabs.value : regularTabs.value;
    const last = group[group.length - 1];
    return Boolean(last && last.path === tab.path);
}

function moveTabDirection(tab: EditorTabPresentation, delta: -1 | 1): void {
    const group = tab.pinned ? pinnedTabs.value : regularTabs.value;
    const index = group.findIndex((t) => t.path === tab.path);
    if (index === -1) return;

    if (delta === -1 && index > 0) {
        const target = group[index - 1];
        if (target) {
            emit("move-tab", tab.path, target.path, tab.pinned, "before");
        }
    } else if (delta === 1 && index < group.length - 1) {
        const target = group[index + 1];
        if (target) {
            emit("move-tab", tab.path, target.path, tab.pinned, "after");
        }
    }
}

function buildContextMenuItems(tab: EditorTabPresentation): ContextMenuItem[] {
    return [
        {
            label: tab.pinned ? t("editorWorkbench.unpin") : t("editorWorkbench.pin"),
            iconClass: tab.pinned ? "i-lucide-pin-off" : "i-lucide-pin",
            action: () => emit("set-pin", tab.path, !tab.pinned),
        },
        {
            label: t("editorWorkbench.keep"),
            iconClass: "i-lucide-file-check",
            disabled: !tab.preview,
            action: () => emit("keep-tab", tab.path),
        },
        {
            label: t("editorWorkbench.moveBefore"),
            iconClass: "i-lucide-arrow-left",
            disabled: isFirstInGroup(tab),
            action: () => moveTabDirection(tab, -1),
        },
        {
            label: t("editorWorkbench.moveAfter"),
            iconClass: "i-lucide-arrow-right",
            disabled: isLastInGroup(tab),
            action: () => moveTabDirection(tab, 1),
        },
        {separator: true},
        {
            label: t("editorWorkbench.close"),
            iconClass: "i-lucide-x",
            action: () => handleCloseTab(tab.path),
        },
    ];
}

function openTabContextMenu(tab: EditorTabPresentation, event: MouseEvent): void {
    contextMenuX.value = event.clientX;
    contextMenuY.value = event.clientY;
    openContextMenuForTab(tab, event.currentTarget as HTMLElement | null);
}

function openTabContextMenuAt(tab: EditorTabPresentation, x: number, y: number): void {
    contextMenuX.value = x;
    contextMenuY.value = y;
    const el = getTabButton(tab.path);
    openContextMenuForTab(tab, el);
}

function openContextMenuForTab(tab: EditorTabPresentation, triggerEl: HTMLElement | null): void {
    menuTriggerTab.value = tab;
    menuTriggerElement.value = triggerEl;
    contextMenuItems.value = buildContextMenuItems(tab);
    contextMenuVisible.value = true;
}

function closeContextMenu(): void {
    if (!contextMenuVisible.value) return;
    contextMenuVisible.value = false;
    nextTick(() => {
        menuTriggerElement.value?.focus();
    });
}

function handleWindowKeydown(event: KeyboardEvent): void {
    if (!contextMenuVisible.value) return;

    if (event.key === "Escape") {
        event.preventDefault();
        closeContextMenu();
        return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const menuItems = Array.from(
            document.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitem"]:not(:disabled)'),
        );
        if (!menuItems.length) return;

        const activeIndex = menuItems.findIndex((item) => item === document.activeElement);
        let nextIndex = 0;
        if (event.key === "ArrowDown") {
            nextIndex = activeIndex >= 0 ? (activeIndex + 1) % menuItems.length : 0;
        } else {
            nextIndex = activeIndex > 0 ? activeIndex - 1 : menuItems.length - 1;
        }
        menuItems[nextIndex]?.focus();
        return;
    }

    if (event.key === "Home") {
        event.preventDefault();
        const menuItems = Array.from(
            document.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitem"]:not(:disabled)'),
        );
        menuItems[0]?.focus();
        return;
    }

    if (event.key === "End") {
        event.preventDefault();
        const menuItems = Array.from(
            document.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitem"]:not(:disabled)'),
        );
        menuItems[menuItems.length - 1]?.focus();
    }
}

onMounted(() => {
    window.addEventListener("keydown", handleWindowKeydown, true);
});

onUnmounted(() => {
    window.removeEventListener("keydown", handleWindowKeydown, true);
});

/** 鼠标滚轮横向滚动 TabBar */
function handleTabWheel(event: WheelEvent): void {
    const container = event.currentTarget as HTMLElement;
    if (!container || container.scrollWidth <= container.clientWidth) return;
    if (Math.abs(event.deltaY) > 0) {
        event.preventDefault();
        container.scrollLeft += event.deltaY;
    }
}

function startTabDrag(tab: EditorTabPresentation, event: DragEvent): void {
    draggedTabPath.value = tab.path;
    if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", tab.path);
        event.dataTransfer.setData("application/x-editor-tab", tab.path);
    }
}

function updateTabDrop(tab: EditorTabPresentation, targetPinned: boolean, event: DragEvent): void {
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

function updateGroupDrop(targetPinned: boolean, event: DragEvent): void {
    event.preventDefault();
    if (!draggedTabPath.value) return;

    const targetElement = event.target as HTMLElement | null;
    if (targetElement?.closest("[data-role='editor-tab-item']")) {
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

function commitTabDrop(event: DragEvent): void {
    event.preventDefault();
    if (!draggedTabPath.value || !dropReady.value) {
        clearTabDrag();
        return;
    }

    emit("move-tab", draggedTabPath.value, dropTargetPath.value, dropTargetPinned.value, dropPosition.value);
    clearTabDrag();
}

function clearTabDrag(): void {
    draggedTabPath.value = null;
    dropTargetPath.value = null;
    dropTargetPinned.value = false;
    dropPosition.value = "after";
    dropReady.value = false;
}

function getDropIndicator(tab: EditorTabPresentation, pinned: boolean): "before" | "after" | null {
    if (dropTargetPath.value === tab.path && dropTargetPinned.value === pinned) {
        return dropPosition.value;
    }
    return null;
}
</script>

<template>
    <div class="editor-tab-bar flex h-[35px] w-full min-w-0 shrink-0 select-none bg-[var(--bg-panel)] text-[var(--text-main)]">
        <!-- 标签滚动行：包含固定标签与普通标签，整行 35px 高度对齐 VS Code 原生 -->
        <div
            ref="activeRowContainerRef"
            class="flex h-full min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
            @wheel="handleTabWheel"
        >
            <!-- 固定标签组 -->
            <div
                v-if="pinnedTabs.length > 0 || (draggedTabPath && dropTargetPinned)"
                role="tablist"
                :aria-label="t('editorWorkbench.pinnedTabs')"
                class="editor-tab-group editor-pinned-tabs flex h-full shrink-0 items-stretch"
                @wheel="handleTabWheel"
                @dragover="updateGroupDrop(true, $event)"
                @drop="commitTabDrop"
            >
                <EditorTabItem
                    v-for="tab in pinnedTabs"
                    :key="tab.path"
                    :ref="(el) => setTabItemRef(tab.path, el)"
                    :tab="tab"
                    :active="tab.path === props.activePath"
                    :focused="tab.path === focusedPath"
                    :pinned="true"
                    :drop-indicator="getDropIndicator(tab, true)"
                    :tab-id="tabDomId(tab.path)"
                    :aria-controls="panelDomId(tab.path)"
                    @select="handleTabClick"
                    @close="handleCloseTab"
                    @keep="emit('keep-tab', $event)"
                    @contextmenu="openTabContextMenu(tab, $event)"
                    @dragstart="startTabDrag(tab, $event)"
                    @dragover="updateTabDrop(tab, true, $event)"
                    @drop="commitTabDrop"
                    @dragend="clearTabDrag"
                    @keydown="handleTabKeydown(tab, true, $event)"
                />
            </div>

            <!-- 普通标签组 -->
            <div
                role="tablist"
                :aria-label="t('editorWorkbench.regularTabs')"
                class="editor-tab-group editor-regular-tabs flex h-full min-w-0 flex-1 items-stretch"
                @wheel="handleTabWheel"
                @dragover="updateGroupDrop(false, $event)"
                @drop="commitTabDrop"
            >
                <EditorTabItem
                    v-for="tab in regularTabs"
                    :key="tab.path"
                    :ref="(el) => setTabItemRef(tab.path, el)"
                    :tab="tab"
                    :active="tab.path === props.activePath"
                    :focused="tab.path === focusedPath"
                    :pinned="false"
                    :drop-indicator="getDropIndicator(tab, false)"
                    :tab-id="tabDomId(tab.path)"
                    :aria-controls="panelDomId(tab.path)"
                    @select="handleTabClick"
                    @close="handleCloseTab"
                    @keep="emit('keep-tab', $event)"
                    @contextmenu="openTabContextMenu(tab, $event)"
                    @dragstart="startTabDrag(tab, $event)"
                    @dragover="updateTabDrop(tab, false, $event)"
                    @drop="commitTabDrop"
                    @dragend="clearTabDrag"
                    @keydown="handleTabKeydown(tab, false, $event)"
                />
            </div>
        </div>

        <!-- 尾部插槽 (用于放置 EditorToolbar / status) -->
        <div v-if="$slots.trailing" class="editor-tab-bar-trailing flex h-full shrink-0 items-center gap-1 border-b border-[var(--divider)] bg-[var(--bg-panel)] px-2">
            <slot name="trailing" />
        </div>

        <ContextMenu
            :visible="contextMenuVisible"
            :x="contextMenuX"
            :y="contextMenuY"
            :items="contextMenuItems"
            @close="closeContextMenu"
        />
    </div>
</template>

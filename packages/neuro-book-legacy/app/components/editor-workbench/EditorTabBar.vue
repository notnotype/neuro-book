<script setup lang="ts">
import {computed, nextTick, onMounted, onUnmounted, ref, watch, type Ref} from "vue";
import {ContextMenu, type ContextMenuItem} from "@notnotype/nb-ui/components";
import type {EditorTabDropPosition, EditorTabPresentation} from "./editor-view.types";
import EditorTabItem, {type EditorTabItemHandle} from "./EditorTabItem.vue";
import {useEditorTabDrag} from "./useEditorTabDrag";

const props = withDefaults(defineProps<{
    tabs: readonly EditorTabPresentation[];
    activePath: string;
    groupId?: string;
    wrap?: boolean;
}>(), {
    groupId: "primary",
    wrap: true,
});

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
/** 严格以界面的真实展示顺序驱动焦点漫游与键盘导航 */
const displayTabs = computed(() => [...pinnedTabs.value, ...regularTabs.value]);

const focusedPath = ref<string>("");
const tabItemRefs = ref<Record<string, EditorTabItemHandle | null>>({});
const activeRowContainerRef = ref<HTMLElement | null>(null);

function getTabButton(path: string): HTMLButtonElement | null {
    const comp = tabItemRefs.value[path];
    if (!comp) return null;
    return comp.getButtonElement();
}

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
    if (comp && typeof comp === "object" && "focus" in comp && "getButtonElement" in comp) {
        tabItemRefs.value[path] = comp as EditorTabItemHandle;
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

watch(() => props.wrap, () => scrollToActiveTab());

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
    {deep: true, flush: "post"},
);

function scrollToActiveTab(): void {
    nextTick(() => {
        const btn = getTabButton(props.activePath);
        if (btn) {
            const prefersReducedMotion = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            btn.scrollIntoView({behavior: prefersReducedMotion ? "auto" : "smooth", block: "nearest", inline: "nearest"});
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

function setPin(path: string, pinned: boolean): void {
    emit("set-pin", path, pinned);
    nextTick(() => focusTab(path));
}

const dragSession = useEditorTabDrag();
const pinnedGroupRef = ref<HTMLElement | null>(null);
const regularGroupRef = ref<HTMLElement | null>(null);
/** 手势状态只控制键盘归属，不改变标签栏布局或新增空落区。 */
const dragActive = computed(() => dragSession?.active.value === true);

/**
 * 登记一个真实标签组落点：`element` / `tabs()` 都是**读法**，会话在每次求值时按当下 DOM 与列表投影取形，
 * 组件不缓存矩形、不算落点、不画反馈。落点只登记给提供了会话的宿主——脱离工作台的单组件用法不注册。
 */
function registerTabsTarget(element: Ref<HTMLElement | null>, pinned: boolean, tabs: () => readonly EditorTabPresentation[]): void {
    const session = dragSession;
    if (!session) {
        return;
    }
    watch(
        [element, () => props.groupId, () => props.wrap],
        (_value, _oldValue, onCleanup) => {
            if (!element.value || (pinned && !props.wrap)) {
                return;
            }
            onCleanup(session.registerTarget(
                `editor-tabs:${props.groupId}:${pinned ? "pinned" : "regular"}`,
                {
                    kind: "tabs",
                    groupId: props.groupId,
                    pinned,
                    wrap: props.wrap,
                    element: () => element.value,
                    tabs,
                },
            ));
        },
        {immediate: true},
    );
}

registerTabsTarget(pinnedGroupRef, true, () => pinnedTabs.value);
registerTabsTarget(regularGroupRef, false, () => regularTabs.value);

function focusAdjacentRow(path: string, direction: -1 | 1): void {
    const current = getTabButton(path)?.getBoundingClientRect();
    if (!current) return;
    const candidates = displayTabs.value.flatMap(tab => {
        const rect = getTabButton(tab.path)?.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return [];
        const distance = direction === 1 ? rect.top - current.bottom : current.top - rect.bottom;
        return distance >= 0 ? [{path: tab.path, rect, distance}] : [];
    });
    const row = candidates.reduce<(typeof candidates)[number] | undefined>((best, candidate) =>
        !best || candidate.distance < best.distance ? candidate : best, undefined);
    if (!row) return;
    const centerX = (current.left + current.right) / 2;
    let nearest = row;
    let distanceX = Infinity;
    for (const candidate of candidates) {
        if (candidate.rect.top >= row.rect.bottom || candidate.rect.bottom <= row.rect.top) continue;
        const distance = Math.abs((candidate.rect.left + candidate.rect.right) / 2 - centerX);
        if (distance < distanceX) { nearest = candidate; distanceX = distance; }
    }
    focusTab(nearest.path);
}

function handleTabKeydown(tab: EditorTabPresentation, pinned: boolean, event: KeyboardEvent): void {
    // 拖动会话进行中：方向键/结束键属于拖放库的键盘拖动，标签栏不再漫游。
    if (dragActive.value) {
        return;
    }
    // Ctrl+Space 是键盘拖动的启动键（由会话的传感器接管），这里不当成"选中"。
    if (event.ctrlKey && event.key === " ") {
        return;
    }

    const allTabs = displayTabs.value;
    if (!allTabs.length) return;

    const currentIndex = allTabs.findIndex((t) => t.path === tab.path);
    if (currentIndex === -1) return;

    if (props.wrap && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        focusAdjacentRow(tab.path, event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "ArrowRight") {
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
            action: () => setPin(tab.path, !tab.pinned),
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
    // 上层浮层（例如 S4 命令面板）消费过的按键不再动到这个菜单
    if (event.defaultPrevented) return;
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
    // 冒泡阶段：贴着焦点的浮层先消费 Escape / 方向键，window 这层只接管剩下的
    window.addEventListener("keydown", handleWindowKeydown);
});

onUnmounted(() => {
    window.removeEventListener("keydown", handleWindowKeydown);
});

/** 鼠标滚轮只改变整排滚动行；标签组本身不是滚动宿主。 */
function handleTabWheel(event: WheelEvent): void {
    if (props.wrap) return;
    const container = activeRowContainerRef.value;
    if (!container || container.scrollWidth <= container.clientWidth || event.deltaY === 0) return;
    event.preventDefault();
    container.scrollLeft += event.deltaY;
}
</script>

<template>
    <div class="editor-tab-bar flex w-full min-w-0 select-none border-b border-[var(--divider)] bg-[var(--bg-panel)] px-1 text-[var(--text-main)]"
        :class="props.wrap ? 'editor-tab-bar-wrapped min-h-0 items-start overflow-hidden' : 'h-[36px] shrink-0 items-center'">
        <!-- 标签滚动行：包含固定标签与普通标签，整行对齐项目圆角设计系统 -->
        <div
            ref="activeRowContainerRef"
            class="editor-tab-row min-w-0 flex-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
            :class="props.wrap ? 'max-h-[180px] self-stretch overflow-x-hidden overflow-y-auto' : 'flex h-full items-center overflow-x-auto overflow-y-hidden'"
            @wheel="handleTabWheel"
        >
            <!-- 固定区始终可辨认；单行不接收拖入，多行独占一个可换行分区。 -->
            <div
                v-if="pinnedTabs.length > 0"
                ref="pinnedGroupRef"
                role="tablist"
                :aria-label="t('editorWorkbench.pinnedTabs')"
                class="editor-tab-group editor-pinned-tabs flex shrink-0 items-center"
                :class="props.wrap ? 'w-full flex-wrap border-b border-[var(--divider)]' : 'h-full border-r border-[var(--divider)] mr-2 pr-2'"
            >
                <EditorTabItem
                    v-for="tab in pinnedTabs"
                    :key="tab.path"
                    :ref="(el) => setTabItemRef(tab.path, el)"
                    :tab="tab"
                    :active="tab.path === props.activePath"
                    :focused="tab.path === focusedPath"
                    :pinned="true"
                    :group-id="props.groupId"
                    :tab-id="tabDomId(tab.path)"
                    :aria-controls="panelDomId(tab.path)"
                    @select="handleTabClick"
                    @close="handleCloseTab"
                    @unpin="setPin($event, false)"
                    @keep="emit('keep-tab', $event)"
                    @contextmenu="openTabContextMenu(tab, $event)"
                    @keydown="handleTabKeydown(tab, true, $event)"
                />
            </div>

            <!-- 落点盒必须覆盖整排标签；允许子项溢出会让滚动后的可见标签落在碰撞盒之外。 -->
            <div
                ref="regularGroupRef"
                role="tablist"
                :aria-label="t('editorWorkbench.regularTabs')"
                class="editor-tab-group editor-regular-tabs flex items-center"
                :class="props.wrap ? 'min-h-9 w-full flex-wrap' : 'h-full min-w-max flex-1'"
            >
                <EditorTabItem
                    v-for="tab in regularTabs"
                    :key="tab.path"
                    :ref="(el) => setTabItemRef(tab.path, el)"
                    :tab="tab"
                    :active="tab.path === props.activePath"
                    :focused="tab.path === focusedPath"
                    :pinned="false"
                    :group-id="props.groupId"
                    :tab-id="tabDomId(tab.path)"
                    :aria-controls="panelDomId(tab.path)"
                    @select="handleTabClick"
                    @close="handleCloseTab"
                    @keep="emit('keep-tab', $event)"
                    @contextmenu="openTabContextMenu(tab, $event)"
                    @keydown="handleTabKeydown(tab, false, $event)"
                />
            </div>
        </div>

        <!-- 尾部插槽 (用于放置 EditorToolbar / status) -->
        <div v-if="$slots.trailing" class="editor-tab-bar-trailing flex h-[35px] shrink-0 items-center gap-1.5 pl-2 pr-1">
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

<style scoped>
.editor-tab-bar-wrapped :deep([data-role="editor-tab-item"]) {
    max-width: calc(100% - 12px);
}
</style>

<script setup lang="ts">
import {computed, nextTick, ref, watch} from "vue";
import {IconButton, type MenubarItemData, type MenubarMenuData} from "@notnotype/nb-ui/components";
import type {EditorGroupState, EditorTabDropPosition} from "./editor-view.types";
import EditorTabBar from "./EditorTabBar.vue";
import EditorToolbar from "./EditorToolbar.vue";
import EditorBreadcrumbs, {type BreadcrumbItem} from "./EditorBreadcrumbs.vue";
import type {EditorSplitPayload} from "./editor-intents";
import {useEditorTabDrag} from "./useEditorTabDrag";

const props = withDefaults(defineProps<{
    /** 本组的渲染模型：内容与状态一起传，外壳不再按组分别铺一套 props。 */
    group: EditorGroupState;
    /** 是否当前活动组（焦点与命令归属由宿主持有）。 */
    activeGroup?: boolean;
    /** 是否提供分屏入口；默认关闭，宿主按产品能力打开。 */
    allowSplit?: boolean;
}>(), {
    activeGroup: true,
    allowSplit: false,
});

const emit = defineEmits<{
    (e: "select-tab", path: string): void;
    (e: "close-tab", path: string): void;
    (e: "set-pin", path: string, pinned: boolean): void;
    (e: "keep-tab", path: string): void;
    (e: "move-tab", path: string, targetPath: string | null, targetPinned: boolean, position: EditorTabDropPosition): void;
    (e: "select-menu", item: MenubarItemData): void;
    (e: "toolbar-action", actionId: string): void;
    (e: "retry"): void;
    (e: "open-as-code"): void;
    (e: "split-tab", payload: EditorSplitPayload): void;
    (e: "navigate-breadcrumb", item: BreadcrumbItem): void;
    (e: "empty-focus"): void;
    (e: "focus-group", groupId: string): void;
}>();

const {t} = useI18n();

/**
 * 标签换行是本组的默认呈现：窄容器里多行折行比横向滚动更容易一眼看全打开的文档。
 * 这是单组的本地视图状态（不落库、不进 Store），工具栏可见按钮与「更多」菜单共用它。
 */
const wrapTabs = ref(true);
const WRAP_TABS_ACTION = "editor-group.wrap-tabs";
const toolbarMenus = computed<MenubarMenuData[]>(() => [
    ...(props.group.menus ?? []),
    {id: "editor-group.tab-layout", label: t("editorWorkbench.wrapTabs"), items: [
        {value: WRAP_TABS_ACTION, label: t("editorWorkbench.wrapTabs"), type: "checkbox", checked: wrapTabs.value},
    ]},
]);
function selectToolbarMenu(item: MenubarItemData): void {
    if (item.value === WRAP_TABS_ACTION) wrapTabs.value = !wrapTabs.value;
    else emit("select-menu", item);
}

const emptyContainerRef = ref<HTMLElement | null>(null);
/**
 * 正文外壳：有文档时是 `role="tabpanel"`，无文档时是空态容器，两者同一个盒子。
 * 内容落点登记的就是它——落点几何由会话在求值时现读，组件不缓存矩形、不判落点、不画反馈。
 * 视图（ProseMirror / Monaco）不再需要任何拖放屏障：拖动用指针事件与变换实现，不产生原生拖放事件。
 */
const contentAreaRef = ref<HTMLElement | null>(null);

const dragSession = useEditorTabDrag();
const dragActive = computed(() => dragSession?.active.value === true);

if (dragSession) {
    const session = dragSession;
    watch(
        [contentAreaRef, () => props.group.id],
        (_value, _oldValue, onCleanup) => {
            if (!contentAreaRef.value) {
                return;
            }
            onCleanup(session.registerTarget(
                `editor-content:${props.group.id}`,
                {
                    kind: "content",
                    groupId: props.group.id,
                    element: () => contentAreaRef.value,
                },
            ));
        },
        {immediate: true},
    );
}

const hasTabs = computed(() => props.group.tabs.length > 0);
const hasActiveDoc = computed(() => Boolean(props.group.activePath && props.group.tabs.some((tab) => tab.path === props.group.activePath)));

const activePanelDomId = computed(() => {
    if (!props.group.activePath) return `editor-tabpanel-empty-${props.group.id}`;
    return `editor-tabpanel-${encodeURIComponent(props.group.activePath)}`;
});

const activeTabDomId = computed(() => {
    if (!props.group.activePath) return undefined;
    return `editor-tab-${encodeURIComponent(props.group.activePath)}`;
});

function handleEmptyFocus(): void {
    nextTick(() => {
        const focusable = emptyContainerRef.value?.querySelector<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        focusable?.focus();
        emit("empty-focus");
    });
}

watch(hasTabs, (newHasTabs, oldHasTabs) => {
    if (oldHasTabs && !newHasTabs) {
        nextTick(() => {
            handleEmptyFocus();
        });
    }
});
</script>

<template>
    <section
        :data-group-id="group.id"
        class="editor-group relative flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--panel-surface)] text-[var(--text-main)]"
        :class="activeGroup ? 'is-active-group ring-1 ring-inset ring-[var(--accent-main)]/25' : ''"
        @pointerdown="emit('focus-group', group.id)"
    >
        <!-- 顶部外壳区：标签栏与面包屑（单组独立管理） -->
        <header
            v-if="hasTabs"
            class="editor-workbench-header flex w-full min-w-0 shrink-0 flex-col bg-[var(--bg-panel)] select-none"
            :class="wrapTabs ? 'max-h-[50%] min-h-0 overflow-hidden' : ''"
        >
            <EditorTabBar
                :tabs="props.group.tabs"
                :active-path="props.group.activePath"
                :group-id="props.group.id"
                :wrap="wrapTabs"
                @select-tab="(path) => emit('select-tab', path)"
                @close-tab="(path) => emit('close-tab', path)"
                @set-pin="(path, pinned) => emit('set-pin', path, pinned)"
                @keep-tab="(path) => emit('keep-tab', path)"
                @move-tab="(path, targetPath, targetPinned, position) => emit('move-tab', path, targetPath, targetPinned, position)"
                @empty-focus="handleEmptyFocus"
            >
                <template #trailing>
                    <div class="flex shrink-0 items-center gap-1.5">
                        <!-- 多行/单行切换：与菜单里的同一项共享本地 wrapTabs，窄屏不必先展开菜单 -->
                        <IconButton
                            icon-class="i-lucide-wrap-text"
                            size="sm"
                            :variant="wrapTabs ? 'accent' : 'default'"
                            :title="t('editorWorkbench.wrapTabs')"
                            :aria-label="t('editorWorkbench.wrapTabs')"
                            :aria-pressed="wrapTabs"
                            class="editor-group-wrap-tabs-btn cursor-pointer"
                            @click="wrapTabs = !wrapTabs"
                        />
                        <EditorToolbar
                            :menus="toolbarMenus"
                            :actions="props.group.toolbarActions"
                            :allow-split="props.allowSplit"
                            @select="selectToolbarMenu"
                            @split="emit('split-tab', {sourceGroupId: props.group.id, targetGroupId: props.group.id, path: props.group.activePath, direction: 'right', mode: 'copy'})"
                            @action="(id) => emit('toolbar-action', id)"
                        >
                            <template #actions><slot name="toolbar-actions" /></template>
                            <template #status><slot name="status" /></template>
                        </EditorToolbar>
                    </div>
                </template>
            </EditorTabBar>

            <!-- 面包屑导航 -->
            <EditorBreadcrumbs
                v-if="hasActiveDoc"
                :path="props.group.activePath"
                :symbols="props.group.breadcrumbsSymbols"
                @navigate="(item) => emit('navigate-breadcrumb', item)"
            >
                <template #trailing>
                    <slot name="breadcrumbs-trailing">
                        <button
                            type="button"
                            class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors [transition-duration:var(--motion-fast)] motion-reduce:transition-none cursor-pointer select-none outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-main)]"
                            :title="t('editorWorkbench.openAsCode') || '以源码打开'"
                            :aria-label="t('editorWorkbench.textEditor') || '文本编辑器'"
                            @click="emit('open-as-code')"
                        >
                            <span>{{ t("editorWorkbench.textEditor") || "文本编辑器" }}</span>
                            <span class="i-lucide-chevron-down h-3 w-3" aria-hidden="true" />
                        </button>
                    </slot>
                </template>
            </EditorBreadcrumbs>
        </header>

        <!-- 诊断/错误提示条 -->
        <div
            v-if="props.group.diagnosis"
            role="alert"
            class="editor-workbench-diagnosis flex shrink-0 items-center justify-between gap-3 border-b border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-1.5 text-xs text-[var(--text-main)] select-none"
        >
            <div class="flex min-w-0 flex-1 items-center gap-2">
                <span class="i-lucide-alert-triangle h-4 w-4 shrink-0 text-[var(--status-warning)]" aria-hidden="true" />
                <span class="min-w-0 flex-1 truncate font-medium">{{ props.group.diagnosis }}</span>
            </div>
            <div class="flex shrink-0 items-center gap-1.5">
                <button
                    type="button"
                    class="inline-flex h-6 items-center justify-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 text-[11px] font-medium text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)] cursor-pointer"
                    @click="emit('retry')"
                >
                    <span class="i-lucide-refresh-cw mr-1 h-3 w-3" aria-hidden="true" />
                    <span>{{ t("editorWorkbench.retry") }}</span>
                </button>
                <button
                    type="button"
                    class="inline-flex h-6 items-center justify-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 text-[11px] font-medium text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)] cursor-pointer"
                    @click="emit('open-as-code')"
                >
                    <span class="i-lucide-file-code mr-1 h-3 w-3" aria-hidden="true" />
                    <span>{{ t("editorWorkbench.openAsCode") }}</span>
                </button>
            </div>
        </div>

        <!-- 主内容区：有文档时为 tabpanel 承载视图；无文档时为欢迎页 -->
        <div
            ref="contentAreaRef"
            class="relative flex min-h-0 min-w-0 flex-1 flex-col"
            :class="dragActive ? 'select-none' : ''"
        >
            <div
                v-if="hasActiveDoc || hasTabs"
                role="tabpanel"
                :id="activePanelDomId"
                :aria-labelledby="activeTabDomId"
                class="editor-workbench-content relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--panel-surface)]"
                :aria-busy="props.group.busy ? 'true' : undefined"
            >
                <slot />

                <!-- 读取/切换忙碌遮罩 -->
                <div
                    v-if="props.group.busy"
                    role="status"
                    aria-live="polite"
                    class="editor-workbench-busy-mask absolute inset-0 z-30 flex items-center justify-center bg-[color-mix(in_srgb,var(--panel-surface)_70%,transparent)] backdrop-blur-xs select-none"
                >
                    <div class="flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--divider)] bg-[var(--bg-panel)] px-3 py-1.5 text-xs text-[var(--text-main)] shadow-sm">
                        <span class="i-lucide-loader-2 h-4 w-4 animate-spin text-[var(--accent-text)]" aria-hidden="true" />
                        <span>{{ t("editorWorkbench.loading") }}</span>
                    </div>
                </div>
            </div>

            <div
                v-else
                ref="emptyContainerRef"
                class="editor-workbench-empty-container flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--panel-surface)]"
            >
                <slot name="empty" />
            </div>
        </div>
    </section>
</template>

<script setup lang="ts">
import {computed, nextTick, ref, watch} from "vue";
import type {MenubarItemData, MenubarMenuData} from "@notnotype/nb-ui/components";
import type {EditorSplitDirection, EditorTabDropPosition, EditorTabPresentation} from "./editor-view.types";
import EditorTabBar from "./EditorTabBar.vue";
import EditorToolbar from "./EditorToolbar.vue";
import EditorBreadcrumbs, {type BreadcrumbItem} from "./EditorBreadcrumbs.vue";

const props = withDefaults(defineProps<{
    tabs?: readonly EditorTabPresentation[];
    activePath?: string;
    menus?: MenubarMenuData[];
    busy?: boolean;
    diagnosis?: string | null;
    breadcrumbsSymbols?: readonly {id: string; label: string; iconClass?: string}[];
}>(), {
    tabs: () => [],
    activePath: "",
    menus: () => [],
    busy: false,
    diagnosis: null,
    breadcrumbsSymbols: () => [],
});

const emit = defineEmits<{
    (e: "select-tab", path: string): void;
    (e: "close-tab", path: string): void;
    (e: "set-pin", path: string, pinned: boolean): void;
    (e: "keep-tab", path: string): void;
    (e: "move-tab", path: string, targetPath: string | null, targetPinned: boolean, position: EditorTabDropPosition): void;
    (e: "select-menu", item: MenubarItemData): void;
    (e: "retry"): void;
    (e: "open-as-code"): void;
    (e: "split-tab", path: string, direction: EditorSplitDirection): void;
    (e: "navigate-breadcrumb", item: BreadcrumbItem): void;
}>();

const {t} = useI18n();

const emptyContainerRef = ref<HTMLElement | null>(null);
const contentContainerRef = ref<HTMLElement | null>(null);
const activeSplitZone = ref<EditorSplitDirection | null>(null);
let dragCounter = 0;

const hasTabs = computed(() => props.tabs.length > 0);
const hasActiveDoc = computed(() => Boolean(props.activePath && props.tabs.some((tab) => tab.path === props.activePath)));

const activePanelDomId = computed(() => {
    if (!props.activePath) return "editor-tabpanel-empty";
    return `editor-tabpanel-${encodeURIComponent(props.activePath)}`;
});

const activeTabDomId = computed(() => {
    if (!props.activePath) return undefined;
    return `editor-tab-${encodeURIComponent(props.activePath)}`;
});

function handleEmptyFocus(): void {
    nextTick(() => {
        const focusable = emptyContainerRef.value?.querySelector<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        focusable?.focus();
    });
}

watch(hasTabs, (newHasTabs, oldHasTabs) => {
    if (oldHasTabs && !newHasTabs) {
        nextTick(() => {
            handleEmptyFocus();
        });
    }
});

function handleContentDragEnter(event: DragEvent): void {
    if (event.dataTransfer?.types.includes("application/x-editor-tab") || event.dataTransfer?.types.includes("text/plain")) {
        dragCounter++;
    }
}

function handleContentDragOver(event: DragEvent): void {
    const rect = contentContainerRef.value?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
    }

    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const relX = x / rect.width;
    const relY = y / rect.height;

    if (relX < 0.25) activeSplitZone.value = "left";
    else if (relX > 0.75) activeSplitZone.value = "right";
    else if (relY < 0.25) activeSplitZone.value = "top";
    else if (relY > 0.75) activeSplitZone.value = "bottom";
    else activeSplitZone.value = null;
}

function handleContentDragLeave(): void {
    dragCounter--;
    if (dragCounter <= 0) {
        dragCounter = 0;
        activeSplitZone.value = null;
    }
}

function handleContentDrop(event: DragEvent): void {
    event.preventDefault();
    dragCounter = 0;
    const zone = activeSplitZone.value;
    activeSplitZone.value = null;
    if (!zone) return;

    const path = event.dataTransfer?.getData("application/x-editor-tab")
        || event.dataTransfer?.getData("text/plain");
    if (path) {
        emit("split-tab", path, zone);
    }
}
</script>

<template>
    <section
        class="editor-workbench flex h-full w-full min-w-0 min-h-0 flex-col overflow-hidden bg-[var(--panel-surface)] text-[var(--text-main)]"
    >
        <!-- 顶部外壳区：标签栏与面包屑（对齐 VS Code，仅在有打开标签时显示） -->
        <header
            v-if="hasTabs"
            class="editor-workbench-header flex w-full min-w-0 shrink-0 flex-col bg-[var(--bg-panel)] select-none"
        >
            <EditorTabBar
                :tabs="props.tabs"
                :active-path="props.activePath"
                @select-tab="(path) => emit('select-tab', path)"
                @close-tab="(path) => emit('close-tab', path)"
                @set-pin="(path, pinned) => emit('set-pin', path, pinned)"
                @keep-tab="(path) => emit('keep-tab', path)"
                @move-tab="(path, targetPath, targetPinned, position) => emit('move-tab', path, targetPath, targetPinned, position)"
                @empty-focus="handleEmptyFocus"
            >
                <template #trailing>
                    <div class="flex shrink-0 items-center gap-1.5">
                        <slot name="status" />
                        <EditorToolbar
                            v-if="props.menus && props.menus.length > 0"
                            :menus="props.menus"
                            @select="(item) => emit('select-menu', item)"
                            @split="emit('split-tab', props.activePath, 'right')"
                        />
                    </div>
                </template>
            </EditorTabBar>

            <!-- VS Code 风格极窄路径/大纲面包屑 -->
            <EditorBreadcrumbs
                v-if="hasActiveDoc"
                :path="props.activePath"
                :symbols="props.breadcrumbsSymbols"
                @navigate="(item) => emit('navigate-breadcrumb', item)"
            >
                <template #trailing>
                    <div class="flex items-center gap-1 text-[10.5px] text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer select-none">
                        <span>{{ t("editorWorkbench.textEditor") || "文本编辑器" }}</span>
                        <span class="i-lucide-chevron-down h-3 w-3" aria-hidden="true" />
                    </div>
                </template>
            </EditorBreadcrumbs>
        </header>

        <!-- 诊断/错误提示条：错误可见但绝不卸载正文 -->
        <div
            v-if="props.diagnosis"
            role="alert"
            class="editor-workbench-diagnosis flex shrink-0 items-center justify-between gap-3 border-b border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-1.5 text-xs text-[var(--text-main)] select-none"
        >
            <div class="flex min-w-0 flex-1 items-center gap-2">
                <span class="i-lucide-alert-triangle h-4 w-4 shrink-0 text-[var(--status-warning)]" aria-hidden="true" />
                <span class="min-w-0 flex-1 truncate font-medium">{{ props.diagnosis }}</span>
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
            v-if="hasActiveDoc || hasTabs"
            ref="contentContainerRef"
            role="tabpanel"
            :id="activePanelDomId"
            :aria-labelledby="activeTabDomId"
            class="editor-workbench-content relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--panel-surface)]"
            :aria-busy="props.busy ? 'true' : undefined"
            @dragenter="handleContentDragEnter"
            @dragover="handleContentDragOver"
            @dragleave="handleContentDragLeave"
            @drop="handleContentDrop"
        >
            <!-- 视图插槽 (如 EditorViewHost) -->
            <slot />

            <!-- 拖拽分屏高亮指示遮罩 -->
            <div
                v-if="activeSplitZone"
                data-role="editor-split-overlay"
                class="pointer-events-none absolute z-40 transition-all duration-150 border-2 border-[var(--accent-main)] bg-[color-mix(in_srgb,var(--accent-main)_20%,transparent)] shadow-lg"
                :class="{
                    'inset-y-0 left-0 w-1/2': activeSplitZone === 'left',
                    'inset-y-0 right-0 w-1/2': activeSplitZone === 'right',
                    'inset-x-0 top-0 h-1/2': activeSplitZone === 'top',
                    'inset-x-0 bottom-0 h-1/2': activeSplitZone === 'bottom',
                }"
                aria-hidden="true"
            >
                <div class="absolute inset-0 flex items-center justify-center font-medium text-xs text-[var(--accent-main)] bg-[var(--panel-surface)]/80 rounded m-2 border border-[var(--accent-main)]/30 backdrop-blur-xs">
                    <span class="mr-1.5 h-4 w-4" :class="activeSplitZone === 'left' || activeSplitZone === 'right' ? 'i-lucide-columns' : 'i-lucide-rows'" />
                    分屏打开到{{ activeSplitZone === 'left' ? '左侧' : activeSplitZone === 'right' ? '右侧' : activeSplitZone === 'top' ? '上方' : '下方' }}
                </div>
            </div>

            <!-- 读取/切换忙碌遮罩：禁止输入非保存中 -->
            <div
                v-if="props.busy"
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
    </section>
</template>

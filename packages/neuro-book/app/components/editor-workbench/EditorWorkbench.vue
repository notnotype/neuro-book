<script setup lang="ts">
import {computed, nextTick, ref, watch} from "vue";
import type {MenubarItemData, MenubarMenuData} from "@notnotype/nb-ui/components";
import type {EditorTabDropPosition, EditorTabPresentation} from "./editor-view.types";
import EditorTabBar from "./EditorTabBar.vue";
import EditorToolbar from "./EditorToolbar.vue";

const props = withDefaults(defineProps<{
    tabs?: readonly EditorTabPresentation[];
    activePath?: string;
    menus?: MenubarMenuData[];
    busy?: boolean;
    diagnosis?: string | null;
}>(), {
    tabs: () => [],
    activePath: "",
    menus: () => [],
    busy: false,
    diagnosis: null,
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
}>();

const {t} = useI18n();

const emptyContainerRef = ref<HTMLElement | null>(null);

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
</script>

<template>
    <section
        class="editor-workbench flex h-full w-full min-w-0 min-h-0 flex-col overflow-hidden bg-[var(--panel-surface)] text-[var(--text-main)]"
    >
        <!-- 顶部外壳区：标签与菜单 -->
        <header class="editor-workbench-header flex shrink-0 flex-col border-b border-[var(--divider)] bg-[var(--bg-panel)] select-none">
            <EditorTabBar
                v-if="hasTabs"
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
                        />
                    </div>
                </template>
            </EditorTabBar>

            <!-- 无标签但有菜单/状态时的轻量外壳行 -->
            <div
                v-else-if="(props.menus && props.menus.length > 0) || $slots.status"
                class="flex h-9 shrink-0 items-center justify-between px-2"
            >
                <div class="flex items-center gap-1.5 text-xs text-[var(--text-muted)] font-medium">
                    <span class="i-lucide-layout-panel-top text-[var(--accent-text)] h-3.5 w-3.5" aria-hidden="true" />
                    <span>{{ t("editorWorkbench.title") }}</span>
                </div>
                <div class="flex shrink-0 items-center gap-1.5">
                    <slot name="status" />
                    <EditorToolbar
                        v-if="props.menus && props.menus.length > 0"
                        :menus="props.menus"
                        @select="(item) => emit('select-menu', item)"
                    />
                </div>
            </div>
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
            role="tabpanel"
            :id="activePanelDomId"
            :aria-labelledby="activeTabDomId"
            class="editor-workbench-content relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--panel-surface)]"
            :aria-busy="props.busy ? 'true' : undefined"
        >
            <!-- 视图插槽 (如 EditorViewHost) -->
            <slot />

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

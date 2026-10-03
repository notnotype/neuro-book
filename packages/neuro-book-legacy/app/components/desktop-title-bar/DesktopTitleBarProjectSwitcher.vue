<script setup lang="ts">
/**
 * 桌面标题栏工程与书架切换模块：
 * 1. 书架直达图标按钮：点击直接进入书架页面（select-project: null）；
 * 2. 工程切换选择器：复用正统 NbDropdown，呈现当前工程/书架标题，支持受控展开；
 * 3. 复合行操作：当前窗口切换工程 + 在新标签中打开独立工程 URL。
 */
import {Dropdown as NbDropdown, IconButton as NbIconButton, type DropdownItem} from "@notnotype/nb-ui/components";
import {computed, ref, type ComputedRef} from "vue";
import type {TitleBarProject} from "./desktop-title-bar.types";

export type ProjectMenuItem = Readonly<{
    projectRoot: string | null;
    label: string;
    active: boolean;
}>;

const props = defineProps<{
    projects: readonly TitleBarProject[];
    currentProjectRoot: string | null;
    projectUrl?: ((projectRoot: string | null) => string) | null;
    openMenu?: string | null;
}>();

const emit = defineEmits<{
    (e: "update:openMenu", value: string | null): void;
    (e: "select-project", projectRoot: string | null): void;
}>();

const triggerRef = ref<HTMLElement | null>(null);

const projectMenuOpen = computed(() => props.openMenu === "project");

const projectLabel = computed(() =>
    props.projects.find((project) => project.projectRoot === props.currentProjectRoot)?.title ?? "我的书架"
);

const projectDropdownItems = computed<DropdownItem[]>(() => [
    {
        label: "我的书架",
        value: "__bookshelf__",
        iconClass: "i-lucide-library",
        active: props.currentProjectRoot === null,
    },
    ...props.projects.map((project) => ({
        label: project.title,
        value: project.projectRoot,
        iconClass: "i-lucide-book-open-text",
        active: project.projectRoot === props.currentProjectRoot,
    })),
]);

function closeMenu(): void {
    emit("update:openMenu", null);
}

function handleGoBookshelf(): void {
    closeMenu();
    emit("select-project", null);
}

function onDropdownSelect(value: string): void {
    closeMenu();
    emit("select-project", value === "__bookshelf__" ? null : value);
}

function onDropdownOpenChange(open: boolean): void {
    emit("update:openMenu", open ? "project" : null);
}
</script>

<template>
    <div class="desktop-title-bar__switcher-group">
        <!-- 书架直达图标按钮：点击一键直达书架界面 -->
        <NbIconButton
            size="sm"
            class="desktop-title-bar__bookshelf-btn"
            data-titlebar-action="bookshelf-direct"
            title="进入我的书架"
            aria-label="进入我的书架"
            @click="handleGoBookshelf"
        >
            <span class="i-lucide-library-big h-3.5 w-3.5 shrink-0 text-[var(--accent-main)]" aria-hidden="true"></span>
        </NbIconButton>

        <!-- 工程切换下拉菜单：复用正统 NbDropdown，完全对齐汉堡包菜单浮层与无滚动态 -->
        <NbDropdown
            :items="projectDropdownItems"
            :open="projectMenuOpen"
            align="start"
            side="bottom"
            :side-offset="6"
            menu-class="min-w-[220px] max-w-[340px]"
            menu-max-height="none"
            :content-props="{'data-titlebar-menu-panel': 'project'}"
            @update:open="onDropdownOpenChange"
            @select="onDropdownSelect"
        >
            <button
                type="button"
                class="desktop-title-bar__project"
                data-menu-button="project"
                data-titlebar-action="project-switcher"
                aria-haspopup="menu"
                :aria-expanded="projectMenuOpen"
                :title="`当前工程：${projectLabel}`"
            >
                <span class="i-lucide-book-open-text h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
                <span class="desktop-title-bar__project-label">{{ projectLabel }}</span>
                <span
                    class="i-lucide-chevron-down h-3 w-3 shrink-0 text-[var(--text-muted)] transition-transform duration-200"
                    :class="{'rotate-180': projectMenuOpen}"
                    aria-hidden="true"
                ></span>
            </button>

            <!-- 自定义项：提供本窗口切换 + 右侧新标签打开链接的两条通道 -->
            <template #item="{ item }">
                <div class="desktop-title-bar__project-row w-full flex items-center justify-between gap-1">
                    <button
                        type="button"
                        class="desktop-title-bar__project-item flex items-center gap-2 min-w-0 flex-1 text-left bg-transparent border-none p-0 cursor-pointer text-inherit"
                        role="menuitem"
                        :data-project-root="item.value === '__bookshelf__' ? '' : item.value"
                    >
                        <span :class="item.iconClass" class="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden="true"></span>
                        <span class="truncate">{{ item.label }}</span>
                    </button>
                    <a
                        v-if="projectUrl"
                        :href="projectUrl(item.value === '__bookshelf__' ? null : item.value)"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="desktop-title-bar__new-tab inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--overlay-item-active)]"
                        :title="`在新标签打开：${item.label}`"
                        :aria-label="`在新标签打开：${item.label}`"
                        data-titlebar-action="open-project-new-tab"
                        @click.stop="closeMenu"
                    >
                        <span class="i-lucide-external-link h-3 w-3 shrink-0" aria-hidden="true"></span>
                    </a>
                </div>
            </template>
        </NbDropdown>
    </div>
</template>

<style scoped>
.desktop-title-bar__switcher-group {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    height: var(--control-h-sm);
    flex-shrink: 0;
    flex-wrap: nowrap;
    -webkit-app-region: no-drag;
}

.desktop-title-bar__bookshelf-btn {
    display: flex;
    width: var(--control-h-sm);
    height: var(--control-h-sm);
    align-items: center;
    justify-content: center;
    border: var(--border-w) solid transparent;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    flex-shrink: 0;
    transition:
        background-color var(--motion-fast) var(--ease-standard),
        color var(--motion-fast) var(--ease-standard),
        border-color var(--motion-fast) var(--ease-standard);
}

.desktop-title-bar__bookshelf-btn:hover {
    color: var(--text-main);
    background: var(--bg-hover);
    border-color: var(--divider);
}

.desktop-title-bar__bookshelf-btn:focus-visible {
    outline: 2px solid var(--focus-outline);
    outline-offset: 1px;
}

.desktop-title-bar__project {
    display: flex;
    max-width: 190px;
    height: var(--control-h-sm);
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-3);
    color: inherit;
    border: var(--border-w) solid transparent;
    border-radius: var(--radius-control);
    background: transparent;
    font-size: var(--text-xs);
    cursor: pointer;
    flex-shrink: 0;
    flex-wrap: nowrap;
    white-space: nowrap;
    -webkit-app-region: no-drag;
    transition:
        background-color var(--motion-fast) var(--ease-standard),
        color var(--motion-fast) var(--ease-standard),
        border-color var(--motion-fast) var(--ease-standard);
}

.desktop-title-bar__project:hover,
.desktop-title-bar__project[aria-expanded="true"] {
    color: var(--text-main);
    background: var(--bg-hover);
    border-color: var(--divider);
}

.desktop-title-bar__project:focus-visible {
    outline: 2px solid var(--focus-outline);
    outline-offset: 1px;
}

.desktop-title-bar__project-label {
    min-width: 0;
    overflow: hidden;
    color: var(--text-main);
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: var(--weight-medium);
}

@media (max-width: 960px) {
    .desktop-title-bar__project {
        max-width: 132px;
    }
}

@media (max-width: 720px) {
    .desktop-title-bar__project {
        max-width: 92px;
    }
}
</style>

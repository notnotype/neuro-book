<script setup lang="ts">
/**
 * 自绘标题栏 Chrome 装配入口（受控零件，Lab 可挂载）。
 *
 * 组织架构：
 * - Brand: 左侧品牌 Logo 与标题，可拖动表面；
 * - Menus: 菜单组（File / Edit / View / Help 及紧凑汉堡菜单）；
 * - ProjectSwitcher: 书架直达图标按钮与基于 FormSelect 的工程切换；
 * - CommandCenter: 居中命令搜索中心（VS Code 风格），点击呼出 WorkbenchCommandPalette；
 * - Actions: Agent 面板切换与工作台布局快捷控制；
 * - WindowControls: 桌面自绘窗口控制（最小化/最大化/关闭）。
 */
import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch} from "vue";
import {SHELL_TITLEBAR_HEIGHT} from "nbook/app/utils/workbench/layout";
import {
    resolveTitleBarMenuPresentation,
    type TitleBarHostCapabilities,
    type TitleBarMenuPresentation,
} from "nbook/app/utils/workbench-chrome";
import type {DesktopMenuCommandId} from "@notnotype/neuro-book-contracts/desktop";
import type {TitleBarProject, TitleBarWindowCommand} from "./desktop-title-bar.types";

import DesktopTitleBarBrand from "./DesktopTitleBarBrand.vue";
import DesktopTitleBarMenus from "./DesktopTitleBarMenus.vue";
import DesktopTitleBarProjectSwitcher from "./DesktopTitleBarProjectSwitcher.vue";
import DesktopTitleBarCommandCenter from "./DesktopTitleBarCommandCenter.vue";
import DesktopTitleBarActions from "./DesktopTitleBarActions.vue";
import DesktopTitleBarWindowControls from "./DesktopTitleBarWindowControls.vue";

const props = withDefaults(defineProps<{
    /** 中心拖拽区的 tooltip 文案（窗口标题）。 */
    title?: string;
    /** 菜单呈现模式：强制 full / compact，缺省为响应式自适应。 */
    presentation?: TitleBarMenuPresentation;
    /** 已打开的书架条目；空数组表示只有「我的书架」。 */
    projects?: readonly TitleBarProject[];
    /** 当前 Project；`null` 表示停在书架。 */
    currentProjectRoot?: string | null;
    /** 宿主真实能力：菜单 enabled / visible 由它映射，缺省即没有能力。 */
    capabilities?: TitleBarHostCapabilities;
    /** 新标签打开使用的标准 Project URL（`null` 表示书架）。 */
    projectUrl?: ((projectRoot: string | null) => string) | null;
    /** 宿主是否具备 Agent 面板能力（没有则不画按钮）。 */
    agentPanelAvailable?: boolean;
    agentPanelOpen?: boolean;
    /** 菜单由 renderer 画；false 表示菜单归操作系统（渲染进程一个菜单都不画）。 */
    rendererMenus?: boolean;
    /** 窗口按钮由 renderer 画；false 表示系统标题栏负责。 */
    customWindowControls?: boolean;
    /** 连接状态；`null` 表示还没有状态，不画状态点。 */
    connection?: "local" | "remote" | null;
    /** 展开的分组：菜单组名 / `compact` / `project`；`null` 表示都收起。 */
    openMenu?: string | null;
    /** 布局控制 */
    sidebarOpen?: boolean;
    bottomPanelOpen?: boolean;
}>(), {
    title: "NeuroBook",
    presentation: undefined,
    projects: () => [],
    currentProjectRoot: null,
    capabilities: () => ({desktop: false, surfaceActive: false, editTarget: "none"}),
    projectUrl: null,
    agentPanelAvailable: false,
    agentPanelOpen: false,
    rendererMenus: true,
    customWindowControls: false,
    connection: null,
    openMenu: null,
    sidebarOpen: true,
    bottomPanelOpen: false,
});

const emit = defineEmits<{
    (e: "update:openMenu", value: string | null): void;
    (e: "invoke-command", command: DesktopMenuCommandId): void;
    (e: "select-project", projectRoot: string | null): void;
    (e: "toggle-agent-panel"): void;
    (e: "window-command", command: TitleBarWindowCommand): void;
    (e: "open-command-palette"): void;
    (e: "toggle-sidebar"): void;
    (e: "toggle-bottom-panel"): void;
}>();

const titleBarRootStyle = {"--workbench-titlebar-height": `${String(SHELL_TITLEBAR_HEIGHT)}px`};

const rootRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);
const leadingRef = ref<HTMLElement | null>(null);
const centerRef = ref<HTMLElement | null>(null);
const trailingRef = ref<HTMLElement | null>(null);
const windowControlsRef = ref<HTMLElement | null>(null);

const internalPresentation = ref<TitleBarMenuPresentation>("full");
const effectivePresentation = computed(() => props.presentation ?? internalPresentation.value);

let resizeObserver: ResizeObserver | null = null;

const COLLAPSE_THRESHOLD = 800;
const EXPAND_THRESHOLD = 840;

function updatePresentation(): void {
    if (props.presentation) return;
    const content = contentRef.value;
    if (!content) return;

    const width = content.clientWidth;
    // 确定性滞环状态机 (Hysteresis)：
    // 处于 full 时，只有宽度小于 800px 时才折叠到 compact；
    // 处于 compact 时，只有宽度回升到 840px 以上时才展开到 full。
    // 40px 的滞环缓冲带彻底切断了任何边界震荡与往复闪烁（鬼畜闪动）。
    if (internalPresentation.value === "full") {
        if (width < COLLAPSE_THRESHOLD) {
            internalPresentation.value = "compact";
        }
    } else {
        if (width >= EXPAND_THRESHOLD) {
            internalPresentation.value = "full";
        }
    }
}

onMounted(() => {
    resizeObserver = new ResizeObserver(() => updatePresentation());
    if (contentRef.value) resizeObserver.observe(contentRef.value);
    void nextTick(updatePresentation);
});

watch(
    [() => props.title, () => props.currentProjectRoot, () => props.projects, () => props.capabilities],
    () => void nextTick(updatePresentation),
);

onBeforeUnmount(() => resizeObserver?.disconnect());
</script>

<template>
    <header
        ref="rootRef"
        class="desktop-title-bar"
        role="banner"
        :style="titleBarRootStyle"
        data-desktop-title-bar
    >
        <div ref="contentRef" class="desktop-title-bar__content">
            <!-- 左侧 Leading 区域：品牌、菜单、书架与工程切换器 -->
            <div ref="leadingRef" class="desktop-title-bar__leading">
                <DesktopTitleBarBrand />

                <DesktopTitleBarMenus
                    :capabilities="capabilities"
                    :renderer-menus="rendererMenus"
                    :presentation="effectivePresentation"
                    :open-menu="openMenu"
                    @update:open-menu="emit('update:openMenu', $event)"
                    @invoke-command="emit('invoke-command', $event)"
                />

                <div class="desktop-title-bar__divider" aria-hidden="true"></div>

                <DesktopTitleBarProjectSwitcher
                    :projects="projects"
                    :current-project-root="currentProjectRoot"
                    :project-url="projectUrl"
                    :open-menu="openMenu"
                    @update:open-menu="emit('update:openMenu', $event)"
                    @select-project="emit('select-project', $event)"
                />
            </div>

            <!-- 中间 Center 区域：VS Code 风格居中命令搜索中心 -->
            <div ref="centerRef" class="desktop-title-bar__center">
                <DesktopTitleBarCommandCenter
                    :project-title="projects.find(p => p.projectRoot === currentProjectRoot)?.title"
                    :window-title="title"
                    @open-command-palette="emit('open-command-palette')"
                />
            </div>

            <!-- 右侧 Trailing 区域：Agent 快捷开关、布局控制工具与窗口控制 -->
            <div ref="trailingRef" class="desktop-title-bar__trailing">
                <DesktopTitleBarActions
                    :capabilities="capabilities"
                    :agent-panel-available="agentPanelAvailable"
                    :agent-panel-open="agentPanelOpen"
                    :connection="connection"
                    :sidebar-open="sidebarOpen"
                    :bottom-panel-open="bottomPanelOpen"
                    @toggle-agent-panel="emit('toggle-agent-panel')"
                    @toggle-sidebar="emit('toggle-sidebar')"
                    @toggle-bottom-panel="emit('toggle-bottom-panel')"
                />

                <DesktopTitleBarWindowControls
                    v-if="customWindowControls"
                    ref="windowControlsRef"
                    @window-command="emit('window-command', $event)"
                />
            </div>
        </div>
    </header>
</template>

<style scoped>
.desktop-title-bar {
    position: relative;
    z-index: 1000;
    width: 100%;
    min-width: 320px;
    height: var(--workbench-titlebar-height);
    min-height: var(--workbench-titlebar-height);
    max-height: var(--workbench-titlebar-height);
    flex: 0 0 var(--workbench-titlebar-height);
    color: var(--text-secondary);
    background: var(--bg-panel);
    border-bottom: var(--border-w) solid var(--divider);
    box-sizing: border-box;
    overflow: hidden;
    user-select: none;
    container-type: inline-size;
}

.desktop-title-bar__content {
    display: flex;
    width: 100%;
    height: 100%;
    align-items: center;
    justify-content: space-between;
    padding-left: var(--space-2);
    overflow: hidden;
    flex-wrap: nowrap;
    white-space: nowrap;
}

.desktop-title-bar__leading,
.desktop-title-bar__trailing {
    display: flex;
    height: 100%;
    align-items: center;
    flex-shrink: 0;
    flex-wrap: nowrap;
    white-space: nowrap;
}

.desktop-title-bar__leading {
    flex: 0 0 auto;
    gap: var(--space-1);
}

.desktop-title-bar__center {
    display: flex;
    height: 100%;
    align-items: center;
    flex: 1 1 auto;
    min-width: 80px;
    justify-content: center;
    overflow: hidden;
}

.desktop-title-bar__trailing {
    display: flex;
    height: 100%;
    align-items: center;
    flex-shrink: 0;
    flex-wrap: nowrap;
    white-space: nowrap;
    margin-left: auto;
}

.desktop-title-bar__divider {
    width: var(--border-w);
    height: 14px;
    margin: 0 var(--space-1);
    background: var(--divider);
    flex-shrink: 0;
}

/* 容器查询：无论在桌面全屏还是 Component Lab 任意尺寸拖拽，根据真实容器宽度阶梯式优雅降级 */
@container (max-width: 860px) {
    :deep(.desktop-title-bar__brand-label) {
        display: none;
    }
    :deep(.desktop-title-bar__project) {
        max-width: 130px;
    }
}

@container (max-width: 660px) {
    :deep(.desktop-title-bar__project) {
        max-width: 100px;
    }
}

@container (max-width: 540px) {
    :deep(.desktop-title-bar__layout-group) {
        display: none;
    }
    :deep(.desktop-title-bar__actions-divider) {
        display: none;
    }
    .desktop-title-bar__divider {
        display: none;
    }
    :deep(.desktop-title-bar__project-label) {
        display: none;
    }
    :deep(.desktop-title-bar__project) {
        padding: 0 var(--space-2);
        max-width: 32px;
    }
}

@container (max-width: 440px) {
    :deep(.desktop-title-bar__switcher-group) {
        display: none;
    }
    :deep(.desktop-title-bar__agent-btn) {
        display: none;
    }
}
</style>

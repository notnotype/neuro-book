<script setup lang="ts">
/**
 * 自绘标题栏的**宿主**：桌面平台边界都在这一层。
 *
 * - 有没有 bridge（桌面 / B/S 两态）：**两种宿主都画标题栏**，没有 bridge 时应用动作走页面登记的回调；
 * - bridge 状态（菜单由谁画、窗口按钮由谁画、连接方式）；
 * - 宿主能力投影（`TitleBarHostCapabilities`）：菜单的 enabled / visible 由它决定；
 * - 菜单命令派发、Project 切换、Agent 面板开关、外观上报。
 *
 * chrome 本身在 `DesktopTitleBarChrome.vue`（受控零件，Lab 可挂载），本组件只做投影与派发；
 * 点组件外收起菜单也归 chrome（它自己知道传送到 body 的下拉层）。
 */
import {computed, onBeforeUnmount, onMounted, ref, watch} from "vue";
import DesktopTitleBarChrome, {type TitleBarWindowCommand} from "nbook/app/components/common/DesktopTitleBarChrome.vue";
import {markTitleBarPresent} from "nbook/app/composables/useTitleBarPresent";
import {useWorkbenchChrome} from "nbook/app/composables/useWorkbenchChrome";
import {tryUseWorkbenchCommands} from "nbook/app/composables/useWorkbenchCommands";
import {
    parseDesktopStatus,
    type DesktopMenuCommandId,
    type DesktopStatus,
} from "@notnotype/neuro-book-contracts/desktop";
import type {TitleBarHostCapabilities} from "nbook/app/utils/workbench-chrome";

const bridge = computed(() => import.meta.client ? window.neuroBookDesktop : undefined);
const chrome = useWorkbenchChrome();
const status = ref<DesktopStatus | null>(null);
const openMenu = ref<string | null>(null);

const registration = computed(() => chrome.current.value);
const title = computed(() => registration.value?.title() || "NeuroBook");
const currentProjectRoot = computed(() => registration.value?.currentProjectRoot() ?? null);
const projects = computed(() => registration.value?.projects() ?? []);
const agentPanelOpen = computed(() => registration.value?.agentPanelOpen() ?? false);
const rendererMenus = computed(() => status.value?.menuPresentation !== "native");
const customWindowControls = computed(() => status.value?.windowControls === "custom");
/**
 * 宿主能力：没有 bridge 就不是桌面（退出应用、窗口控制与桌面缩放整条不画）；
 * 编辑动作按页面登记的真实焦点判断，不按「哪个编辑器更常用」。
 */
const capabilities = computed<TitleBarHostCapabilities>(() => ({
    desktop: bridge.value !== undefined,
    surfaceActive: registration.value?.surfaceActive() ?? false,
    editTarget: registration.value?.editTarget() ?? "none",
}));
/** 新标签打开要的是页面路由给出的标准 Project URL；页面没登记这条能力就整条不画。 */
const projectUrl = computed<((projectRoot: string | null) => string) | null>(() => {
    const current = registration.value;
    return current === null ? null : (projectRoot) => current.projectUrl(projectRoot);
});

async function invoke(command: DesktopMenuCommandId): Promise<void> {
    openMenu.value = null;
    const desktop = bridge.value;
    if (desktop) {
        // 桌面：命令照旧回到桌面宿主，原生菜单与自绘菜单同一条派发路径。
        await desktop.menu(command);
        return;
    }
    // 浏览器：没有桌面宿主，应用动作由页面登记的回调执行。
    await registration.value?.invokeMenuCommand(command);
}

async function selectProject(projectRoot: string | null): Promise<void> {
    openMenu.value = null;
    if (!registration.value) return;
    if (projectRoot === null) {
        await registration.value.openBookshelf();
        return;
    }
    if (projectRoot !== currentProjectRoot.value) {
        await registration.value.switchProject(projectRoot);
    }
}

async function toggleAgentPanel(): Promise<void> {
    if (!capabilities.value.surfaceActive) return;
    await registration.value?.toggleAgentPanel();
}

function windowCommand(command: TitleBarWindowCommand): void {
    void bridge.value?.window(command);
}

function handleOpenCommandPalette(): void {
    const commands = tryUseWorkbenchCommands();
    commands?.openPalette("commands");
}

onMounted(async () => {
    // 在场事实登记给通知视口这类抢同一块屏幕的组件（浏览器同样有标题栏）。
    markTitleBarPresent(true);
    if (bridge.value) {
        status.value = await bridge.value.status().then(parseDesktopStatus).catch(() => null);
    }
});

onBeforeUnmount(() => {
    markTitleBarPresent(false);
});

watch(
    () => registration.value?.appearance() ?? null,
    (appearance) => {
        if (appearance) void bridge.value?.setAppearance(appearance);
    },
    {immediate: true},
);
</script>

<template>
    <DesktopTitleBarChrome
        v-model:open-menu="openMenu"
        :title="title"
        :projects="projects"
        :current-project-root="currentProjectRoot"
        :capabilities="capabilities"
        :project-url="projectUrl"
        :agent-panel-available="Boolean(registration)"
        :agent-panel-open="agentPanelOpen"
        :renderer-menus="rendererMenus"
        :custom-window-controls="customWindowControls"
        :connection="status?.connection ?? null"
        @invoke-command="void invoke($event)"
        @select-project="void selectProject($event)"
        @toggle-agent-panel="void toggleAgentPanel()"
        @window-command="windowCommand"
        @open-command-palette="handleOpenCommandPalette"
    />
</template>

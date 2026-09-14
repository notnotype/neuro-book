<script setup lang="ts">
/**
 * 自绘标题栏的**宿主**：桌面平台边界都在这一层。
 *
 * - 有没有 bridge（桌面 / B/S 两态）；
 * - bridge 状态（菜单由谁画、窗口按钮由谁画、连接方式）；
 * - 菜单命令派发、Project 切换、Agent 面板开关、外观上报；
 * - 菜单在组件外被点掉时收起（`onClickOutside` 是页面级行为，按组件规范由宿主执行）。
 *
 * chrome 本身在 `DesktopTitleBarChrome.vue`（受控零件，Lab 可挂载），本组件只做投影与派发。
 */
import {onClickOutside} from "@vueuse/core";
import {computed, onMounted, ref, watch} from "vue";
import DesktopTitleBarChrome, {type TitleBarWindowCommand} from "nbook/app/components/common/DesktopTitleBarChrome.vue";
import {useWorkbenchChrome} from "nbook/app/composables/useWorkbenchChrome";
import {
    parseDesktopStatus,
    type DesktopMenuCommandId,
    type DesktopStatus,
} from "@notnotype/neuro-book-contracts/desktop";

const bridge = computed(() => import.meta.client ? window.neuroBookDesktop : undefined);
const chrome = useWorkbenchChrome();
const status = ref<DesktopStatus | null>(null);
const openMenu = ref<string | null>(null);
const barRef = ref<InstanceType<typeof DesktopTitleBarChrome> | null>(null);
/** outside 判定要的是根 DOM 节点：组件的 `$el` 就是那一个根。 */
const barEl = computed<HTMLElement | null>(() => (barRef.value?.$el as HTMLElement | undefined) ?? null);

const registration = computed(() => chrome.current.value);
const title = computed(() => registration.value?.title() || "NeuroBook");
const surfaceActive = computed(() => registration.value?.surfaceActive() ?? false);
const currentProjectRoot = computed(() => registration.value?.currentProjectRoot() ?? null);
const projects = computed(() => registration.value?.projects() ?? []);
const agentPanelOpen = computed(() => registration.value?.agentPanelOpen() ?? false);
const rendererMenus = computed(() => status.value?.menuPresentation !== "native");
const customWindowControls = computed(() => status.value?.windowControls === "custom");

async function invoke(command: DesktopMenuCommandId): Promise<void> {
    openMenu.value = null;
    await bridge.value?.menu(command);
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
    if (!surfaceActive.value) return;
    await registration.value?.toggleAgentPanel();
}

function windowCommand(command: TitleBarWindowCommand): void {
    void bridge.value?.window(command);
}

onClickOutside(barEl, () => {
    openMenu.value = null;
});

onMounted(async () => {
    if (bridge.value) {
        status.value = await bridge.value.status().then(parseDesktopStatus).catch(() => null);
    }
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
        v-if="bridge"
        ref="barRef"
        v-model:open-menu="openMenu"
        :title="title"
        :projects="projects"
        :current-project-root="currentProjectRoot"
        :surface-active="surfaceActive"
        :agent-panel-available="Boolean(registration)"
        :agent-panel-open="agentPanelOpen"
        :renderer-menus="rendererMenus"
        :custom-window-controls="customWindowControls"
        :connection="status?.connection ?? null"
        @invoke-command="void invoke($event)"
        @select-project="void selectProject($event)"
        @toggle-agent-panel="void toggleAgentPanel()"
        @window-command="windowCommand"
    />
</template>

<script setup lang="ts">
import {computed, ref} from "vue";
import DesktopTitleBarChrome from "nbook/app/components/common/DesktopTitleBarChrome.vue";
import type {TitleBarHostCapabilities} from "nbook/app/utils/workbench-chrome";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import LabFixtureControls from "../LabFixtureControls.vue";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof DesktopTitleBarChrome>(() => props.input, [
    "invoke-command", "select-project", "toggle-agent-panel", "window-command", "open-command-palette", "toggle-sidebar", "toggle-bottom-panel",
]);

// 能力是宿主状态，不是 JSON prop；场景只选择本地内存能力预设。
const capabilities = computed<TitleBarHostCapabilities>(() => ({
    desktop: props.scene !== "browser",
    surfaceActive: props.scene !== "bookshelf" && props.scene !== "no-agent",
    editTarget: props.scene === "browser" ? "native" : props.scene === "edit-focus" ? "none" : "editor",
}));

/** 新标签打开的 URL：Lab 只需要看得见链接，指到项目自己的草稿路由即可。 */
function projectUrl(projectRoot: string | null): string {
    return projectRoot === null ? "/?lab=bookshelf" : `/?lab=${encodeURIComponent(projectRoot)}`;
}

const sidebarOpen = ref(true);
const bottomPanelOpen = ref(false);

function onToggleSidebar(): void {
    sidebarOpen.value = !sidebarOpen.value;
}

function onToggleBottomPanel(): void {
    bottomPanelOpen.value = !bottomPanelOpen.value;
}
</script>

<template>
    <div class="flex h-full min-h-0 w-full flex-col bg-[var(--bg-main)]">
        <LabFixtureControls>
            <div class="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
                <div>桌面标题栏（36px 标准高度）：直达书架独立按钮、项目切换、VS Code 风格命令搜索中心、布局切换与窗口控制。</div>
                <div>可通过 Lab 顶栏预设或拖动手柄观察收缩至 compact 菜单与搜索框自适应折叠。</div>
            </div>
        </LabFixtureControls>

        <div class="w-full shrink-0">
            <DesktopTitleBarChrome
                data-lab-subject
                class="w-full"
                v-bind="subject.bindings.value"
                :capabilities="capabilities"
                :project-url="projectUrl"
                :sidebar-open="sidebarOpen"
                :bottom-panel-open="bottomPanelOpen"
                @toggle-sidebar="onToggleSidebar"
                @toggle-bottom-panel="onToggleBottomPanel"
            />
        </div>

        <div class="flex min-h-0 flex-1 items-center justify-center bg-[var(--panel-surface)] text-xs text-[var(--text-muted)] select-none">
            <span>主工作区内容（标题栏吸附于视口顶部）</span>
        </div>
    </div>
</template>

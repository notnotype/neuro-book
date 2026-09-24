<script setup lang="ts">
import {computed, ref, watch} from "vue";
import DesktopTitleBarChrome from "nbook/app/components/common/DesktopTitleBarChrome.vue";
import type {
    TitleBarProject,
    TitleBarWindowCommand,
} from "nbook/app/components/common/DesktopTitleBarChrome.vue";
import type {DesktopMenuCommandId} from "@notnotype/neuro-book-contracts/desktop";
import type {TitleBarEditTarget, TitleBarHostCapabilities} from "nbook/app/utils/workbench-chrome";
import {useLabEventSink} from "../lab-event-sink";
import LabFixtureControls from "../LabFixtureControls.vue";

const props = defineProps<{scene: string; data?: unknown}>();

const emitLabEvent = useLabEventSink();

/** fixture 扮演宿主：菜单展开状态在这里；点组件外收起由组件自己判定（下拉层 Teleport 到 body）。 */
const openMenu = ref<string | null>(null);

function readString(value: unknown, fallback: string): string {
    return typeof value === "string" ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
}

function readProjects(value: unknown): TitleBarProject[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
        if (typeof item !== "object" || item === null) return [];
        const {projectRoot, title} = item as Record<string, unknown>;
        if (typeof projectRoot !== "string" || typeof title !== "string") return [];
        return [{projectRoot, title}];
    });
}

function readConnection(value: unknown): "local" | "remote" | null {
    return value === "local" || value === "remote" ? value : null;
}

function readEditTarget(value: unknown): TitleBarEditTarget {
    return value === "native" || value === "editor" ? value : "none";
}

const knobs = computed(() => {
    const data = (props.data ?? {}) as Record<string, unknown>;
    return {
        title: readString(data.title, "NeuroBook"),
        presentation: (data.presentation === "full" || data.presentation === "compact" ? data.presentation : undefined) as TitleBarMenuPresentation | undefined,
        projects: readProjects(data.projects),
        currentProjectRoot: typeof data.currentProjectRoot === "string" ? data.currentProjectRoot : null,
        surfaceActive: readBoolean(data.surfaceActive, true),
        desktop: readBoolean(data.desktop, true),
        editTarget: readEditTarget(data.editTarget),
        agentPanelAvailable: readBoolean(data.agentPanelAvailable, true),
        agentPanelOpen: readBoolean(data.agentPanelOpen, false),
        rendererMenus: readBoolean(data.rendererMenus, true),
        customWindowControls: readBoolean(data.customWindowControls, true),
        connection: readConnection(data.connection),
    };
});

/** 宿主能力就是组件收到的菜单依据：Lab 用旋钮表达「浏览器 / 桌面」与「焦点在哪」。 */
const capabilities = computed<TitleBarHostCapabilities>(() => ({
    desktop: knobs.value.desktop,
    surfaceActive: knobs.value.surfaceActive,
    editTarget: knobs.value.editTarget,
}));

/** 新标签打开的 URL：Lab 只需要看得见链接，指到项目自己的草稿路由即可。 */
function projectUrl(projectRoot: string | null): string {
    return projectRoot === null ? "/?lab=bookshelf" : `/?lab=${encodeURIComponent(projectRoot)}`;
}

/** 场景可以要求一开局就展开某一组，用来固定「下拉浮层长什么样」这一条观察。 */
const initialMenu = computed(() => readString((props.data as Record<string, unknown> | undefined)?.openMenu, ""));

/** 紧凑档由宽度决定；窄栏是量出紧凑菜单的唯一办法。 */
const narrow = computed(() => props.scene === "compact");

watch(() => props.scene, () => {
    openMenu.value = initialMenu.value || null;
}, {immediate: true});

const sidebarOpen = ref(true);
const bottomPanelOpen = ref(false);

function onWindowCommand(command: TitleBarWindowCommand): void {
    emitLabEvent("window-command", command);
}

function onInvokeCommand(command: DesktopMenuCommandId): void {
    emitLabEvent("invoke-command", command);
}

function onSelectProject(projectRoot: string | null): void {
    emitLabEvent("select-project", projectRoot);
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
                v-model:open-menu="openMenu"
                data-lab-subject
                class="w-full"
                :title="knobs.title"
                :presentation="narrow ? 'compact' : knobs.presentation"
                :projects="knobs.projects"
                :current-project-root="knobs.currentProjectRoot"
                :capabilities="capabilities"
                :project-url="projectUrl"
                :agent-panel-available="knobs.agentPanelAvailable"
                :agent-panel-open="knobs.agentPanelOpen"
                :renderer-menus="knobs.rendererMenus"
                :custom-window-controls="knobs.customWindowControls"
                :connection="knobs.connection"
                :sidebar-open="sidebarOpen"
                :bottom-panel-open="bottomPanelOpen"
                @invoke-command="onInvokeCommand"
                @select-project="onSelectProject"
                @toggle-agent-panel="emitLabEvent('toggle-agent-panel')"
                @window-command="onWindowCommand"
                @open-command-palette="emitLabEvent('open-command-palette')"
                @toggle-sidebar="sidebarOpen = !sidebarOpen; emitLabEvent('toggle-sidebar', sidebarOpen)"
                @toggle-bottom-panel="bottomPanelOpen = !bottomPanelOpen; emitLabEvent('toggle-bottom-panel', bottomPanelOpen)"
            />
        </div>

        <div class="flex min-h-0 flex-1 items-center justify-center bg-[var(--panel-surface)] text-xs text-[var(--text-muted)] select-none">
            <span>主工作区内容（标题栏吸附于视口顶部）</span>
        </div>
    </div>
</template>

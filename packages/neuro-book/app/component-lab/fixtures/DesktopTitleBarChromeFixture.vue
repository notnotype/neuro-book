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
        <div :class="narrow ? 'w-[560px] max-w-full' : 'w-full'" class="shrink-0">
            <DesktopTitleBarChrome
                v-model:open-menu="openMenu"
                data-lab-subject
                :title="knobs.title"
                :projects="knobs.projects"
                :current-project-root="knobs.currentProjectRoot"
                :capabilities="capabilities"
                :project-url="projectUrl"
                :agent-panel-available="knobs.agentPanelAvailable"
                :agent-panel-open="knobs.agentPanelOpen"
                :renderer-menus="knobs.rendererMenus"
                :custom-window-controls="knobs.customWindowControls"
                :connection="knobs.connection"
                @invoke-command="onInvokeCommand"
                @select-project="onSelectProject"
                @toggle-agent-panel="emitLabEvent('toggle-agent-panel')"
                @window-command="onWindowCommand"
            />
        </div>

        <div class="min-h-0 flex-1 overflow-auto p-4 text-[var(--text-muted)] text-xs">
            <p>这条横条下面就是主区。标题栏自己只占 36px，底部那条缝取自主题的 <code>--divider</code>。</p>
            <p class="mt-2">
                菜单选择由实测宽度决定：把画布拉窄（或用「窄栏」场景）到放不下四个菜单时，它会换成一条
                <code>compact</code> 按钮；再窄下去品牌名先让位，然后收 Project 标题与搜索框，最后隐去搜索。
            </p>
            <p class="mt-2">点菜单按钮、Project 按钮、Agent 按钮与窗口按钮都会在右侧「事件」tab 里留一条记录。</p>
        </div>
    </div>
</template>

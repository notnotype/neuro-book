<script setup lang="ts">
/** 产品的工作台外壳（同名 .md）：布局 store 接到纯布局组件，七个 Part 的外壳一内容，按钮接到面板命令。 */
import {computed} from "vue";

import type {CommandService} from "nbook/plugins/commands/shared/contracts";
import {formatText, localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";

import {
    PANEL_COMMAND_DECLARATIONS,
    SET_PANEL_ALIGNMENT_COMMAND,
    SET_PANEL_COLLAPSED_COMMAND,
    SET_PANEL_HIDDEN_COMMAND,
    SET_PANEL_POSITION_COMMAND,
    TOGGLE_PANEL_MAXIMIZED_COMMAND,
} from "../commands/panel-commands";
import type {ShellLayoutFacts, ShellSizePatch} from "../shell/sizes";
import type {LayoutStore} from "../state/layout-store";
import WorkbenchPanelSurface from "./WorkbenchPanelSurface.vue";
import type {PanelFrameAction} from "./WorkbenchPanelSurface.vue";
import WorkbenchShellLayout from "./WorkbenchShellLayout.vue";
import WorkbenchStatusBar from "./WorkbenchStatusBar.vue";

defineOptions({name: "WorkbenchShell"});

const props = defineProps<{
    layout: LayoutStore;
    commands: CommandService;
    project: string | null;
    locale: DisplayLocale;
}>();

const TEXT = {
    ready: {"zh-CN": "工作台已就绪。没有打开项目。", "en-US": "The workbench is ready. No project is open."},
    readyWithProject: {"zh-CN": "工作台已就绪。当前项目：{name}", "en-US": "The workbench is ready. Current project: {name}"},
    panel: {"zh-CN": "面板", "en-US": "Panel"},
    emptyTools: {"zh-CN": "工具视图会显示在这里", "en-US": "Tool views appear here"},
    emptyPanel: {"zh-CN": "面板里还没有视图", "en-US": "No views in the panel yet"},
} satisfies Record<string, LocalizedText>;

const text = (value: LocalizedText): string => localize(value, props.locale);
const welcome = computed(() => (props.project === null ? text(TEXT.ready) : text(formatText(TEXT.readyWithProject, {name: props.project}))));

const state = computed(() => props.layout.state);

/** 框架按钮：可用性问命令系统；先读布局状态，让按钮随它重新求值（命令系统的可用性变化不通知）。 */
const FRAME: ReadonlyArray<{id: keyof typeof PANEL_COMMAND_DECLARATIONS; icon: string}> = [
    {id: SET_PANEL_POSITION_COMMAND, icon: "i-lucide-panel-bottom"},
    {id: SET_PANEL_ALIGNMENT_COMMAND, icon: "i-lucide-align-horizontal-space-between"},
    {id: SET_PANEL_COLLAPSED_COMMAND, icon: "i-lucide-chevrons-down"},
    {id: TOGGLE_PANEL_MAXIMIZED_COMMAND, icon: "i-lucide-maximize-2"},
    {id: SET_PANEL_HIDDEN_COMMAND, icon: "i-lucide-x"},
];
const frameActions = computed<ReadonlyArray<PanelFrameAction>>(() => {
    const {panel, ready, facts} = state.value;
    void [panel.position, panel.alignment, panel.hidden, panel.collapsed, panel.maximized, ready, facts?.mode];
    return FRAME.map(({id, icon}) => {
        const enabled = props.commands.isEnabled(id);
        const available = enabled.ok && enabled.value;
        return {
            id,
            icon,
            label: localize(PANEL_COMMAND_DECLARATIONS[id].title, props.locale),
            disabled: !available,
            ...(enabled.ok ? {} : {reason: enabled.reason}),
            ...(id === SET_PANEL_COLLAPSED_COMMAND ? {pressed: panel.collapsed} : id === TOGGLE_PANEL_MAXIMIZED_COMMAND ? {pressed: panel.maximized} : {}),
        };
    });
});

function run(id: string, args: Record<string, unknown> = {}): void {
    void props.commands.execute(id, args, {source: "user"});
}

function onResize(payload: {contextKey: string; patch: ShellSizePatch}): void {
    props.layout.actions.commitSizes(payload.patch);
}

function onLayout(facts: ShellLayoutFacts): void {
    props.layout.actions.acceptLayoutFacts(facts);
}
</script>

<template>
    <WorkbenchShellLayout
        class="workbench-shell"
        :sizes="state.sizes"
        :panel="state.panel"
        context-key="workbench"
        :hidden-parts="state.hiddenParts"
        :drag-collapsed-parts="state.dragCollapsed"
        :disabled="!state.ready"
        @resize="onResize"
        @layout="onLayout"
    >
        <template #titlebar>
            <div class="workbench-shell__titlebar">
                <span class="workbench-shell__app">NeuroBook</span>
                <span v-if="project !== null" class="workbench-shell__project">{{ project }}</span>
            </div>
        </template>
        <template #activitybar>
            <div class="workbench-shell__card"></div>
        </template>
        <template #sidebar>
            <div class="workbench-shell__card workbench-shell__empty">{{ text(TEXT.emptyTools) }}</div>
        </template>
        <template #auxiliarybar>
            <div class="workbench-shell__card workbench-shell__empty">{{ text(TEXT.emptyTools) }}</div>
        </template>
        <template #editor>
            <div class="workbench-shell__welcome">
                <h1>NeuroBook</h1>
                <p>{{ welcome }}</p>
            </div>
        </template>
        <template #panel="{collapsed}">
            <WorkbenchPanelSurface :title="text(TEXT.panel)" :collapsed="collapsed" :actions="frameActions" @action="run">
                <div class="workbench-shell__empty workbench-shell__panel-empty">{{ text(TEXT.emptyPanel) }}</div>
            </WorkbenchPanelSurface>
        </template>
        <template #statusbar>
            <WorkbenchStatusBar
                :locale="locale"
                :project="project"
                :panel-hidden="state.panel.hidden"
                :panel-toggle-disabled="!state.ready"
                :problems="state.problems"
                @toggle-panel="run(SET_PANEL_HIDDEN_COMMAND, {hidden: !state.panel.hidden})"
                @retry="(record) => layout.actions.retry(record as 'side' | 'panelSize' | 'customizations')"
                @discard="(record) => layout.actions.discard(record as 'side' | 'panelSize' | 'customizations')"
            />
        </template>
    </WorkbenchShellLayout>
</template>

<style scoped>
.workbench-shell {
    background: var(--bg-main);
    color: var(--text-main);
    font-family: var(--font-ui);
}

.workbench-shell__titlebar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 100%;
    padding-inline: var(--space-3);
    font-size: var(--text-xs);
}

.workbench-shell__app {
    font-weight: 600;
}

.workbench-shell__project {
    min-width: 0;
    overflow: hidden;
    color: var(--text-secondary);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.workbench-shell__card {
    height: 100%;
    background: var(--panel-surface);
    border: var(--border-w) solid var(--panel-outline);
    border-radius: var(--radius-panel);
}

.workbench-shell__empty {
    padding: var(--space-3);
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.workbench-shell__panel-empty {
    height: 100%;
}

.workbench-shell__welcome {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    height: 100%;
    padding: var(--space-4);
    text-align: center;
}

.workbench-shell__welcome h1 {
    margin: 0;
    font-size: var(--text-lg);
}

.workbench-shell__welcome p {
    margin: 0;
    max-width: 40rem;
    color: var(--text-secondary);
}
</style>

/**
 * 面板命令（docs/specs/ui/workbench-layout.md 输出 35、docs/specs/workbench/commands.md 第二批）：`when` 读工作台的公开状态，实现调布局 store。面板头的框架按钮、菜单与命令面板都经这几条。
 *
 * 不给 `panelId` 时是当前面板；执行时重验，已不存在时返回 `unavailable`。命令返回时布局已按新值显示，保存在后台进行，失败由状态栏给出。
 */

import {Type} from "typebox";

import {findTab, isFloating} from "@notnotype/nb-layout";

import type {CommandImplementation, CommandResult, WrittenCommandDeclaration} from "nbook/plugins/commands/shared/contracts";

import {workbenchText} from "../../shared/text";
import type {LayoutDocStore} from "../state/layout-doc-store";
import {viewIdOf} from "../state/layout-present";
import {workbenchState} from "../state/public-state";

export const SET_PANEL_COLLAPSED_COMMAND = "nbook.view.set-panel-collapsed";
export const TOGGLE_PANEL_MAXIMIZED_COMMAND = "nbook.view.toggle-panel-maximized";
export const FLOAT_COMMAND = "nbook.view.float";
export const DOCK_COMMAND = "nbook.view.dock";

const CATEGORY = workbenchText("categories.view");
const PanelId = Type.Optional(Type.String({minLength: 1, maxLength: 160}));

export const PANEL_COMMAND_DECLARATIONS = {
    [SET_PANEL_COLLAPSED_COMMAND]: {
        category: CATEGORY,
        description: "Collapse a tool panel, or expand it: to its 32px head in a column, to nothing in a row. Without collapsed, toggles. Without panelId, the current panel.",
        args: Type.Object({panelId: PanelId, collapsed: Type.Optional(Type.Boolean())}, {additionalProperties: false}),
        effect: "write",
        expose: {agent: "never"},
        when: {requires: [workbenchState.key("layoutReady")]},
    },
    [TOGGLE_PANEL_MAXIMIZED_COMMAND]: {
        category: CATEGORY,
        description: "Maximize a panel over everything except the bars, or restore it. Not saved. Without panelId, the current panel.",
        args: Type.Object({panelId: PanelId}, {additionalProperties: false}),
        effect: "write",
        expose: {agent: "never"},
        when: {requires: [workbenchState.key("layoutReady")]},
    },
    [FLOAT_COMMAND]: {
        category: CATEGORY,
        description: "Float a tab in a window inside the app. Views can declare they cannot float. Without tab, the active tab of the panel; without panelId, the current panel.",
        args: Type.Object({panelId: PanelId, tab: Type.Optional(Type.String({minLength: 1, maxLength: 200}))}, {additionalProperties: false}),
        effect: "write",
        expose: {agent: "never"},
        when: {requires: [workbenchState.key("layoutReady")]},
    },
    [DOCK_COMMAND]: {
        category: CATEGORY,
        description: "Dock a floating window: tool views return to the panel they declare, editor tabs to an editor group. Without panelId, the current panel.",
        args: Type.Object({panelId: PanelId}, {additionalProperties: false}),
        effect: "write",
        expose: {agent: "never"},
        when: {requires: [workbenchState.key("layoutReady")]},
    },
} as const satisfies Readonly<Record<string, WrittenCommandDeclaration>>;

const TEXT = {
    noLayout: workbenchText("layout.notOpen"),
    noPanel: workbenchText("panelCommands.noPanel"),
    editorCollapse: workbenchText("panelCommands.editorCollapse"),
    notFloating: workbenchText("panelCommands.notFloating"),
    cannotFloat: workbenchText("panelCommands.cannotFloat"),
    floatMaximize: workbenchText("panelCommands.floatMaximize"),
} as const;

const DONE: CommandResult<null> = {ok: true, value: null};

type PanelCommands = {readonly [K in keyof typeof PANEL_COMMAND_DECLARATIONS]: CommandImplementation};

export function panelCommands(layout: () => LayoutDocStore | null): PanelCommands {
    /** 取目标面板：缺省当前面板，执行这一刻还在才算。 */
    const withPanel = (run: (store: LayoutDocStore, panel: string, args: Readonly<Record<string, unknown>>) => CommandResult<null>): CommandImplementation => ({
        run: (raw) => {
            const store = layout();
            if (store === null) return {ok: false, code: "unavailable", reason: TEXT.noLayout};
            const args = raw as Readonly<Record<string, unknown>>;
            const panel = (args.panelId as string | undefined) ?? store.state.currentPanel;
            if (panel === null || store.state.doc.panels[panel] === undefined) return {ok: false, code: "unavailable", reason: TEXT.noPanel};
            return run(store, panel, args);
        },
    });
    return {
        [SET_PANEL_COLLAPSED_COMMAND]: withPanel((store, panel, args) => {
            if (store.state.doc.panels[panel]?.role === "editor") return {ok: false, code: "unavailable", reason: TEXT.editorCollapse};
            const result = store.actions.setCollapsed(panel, (args.collapsed as boolean | undefined) ?? store.state.doc.panels[panel]?.collapsed !== true);
            return result.ok ? DONE : {ok: false, code: "unavailable", reason: TEXT.noPanel};
        }),
        [TOGGLE_PANEL_MAXIMIZED_COMMAND]: withPanel((store, panel) => (store.actions.toggleMaximized(panel) ? DONE : {ok: false, code: "unavailable", reason: TEXT.floatMaximize})),
        [FLOAT_COMMAND]: {
            run: (raw) => {
                const store = layout();
                if (store === null) return {ok: false, code: "unavailable", reason: TEXT.noLayout};
                const args = raw as {readonly panelId?: string; readonly tab?: string};
                const doc = store.actions.document();
                const panelId = args.panelId ?? store.state.currentPanel;
                const key = args.tab ?? (panelId === null ? null : (doc.panels[panelId]?.active ?? null));
                const home = key === null ? null : findTab(doc, key)?.panel ?? null;
                const viewId = viewIdOf(key ?? "");
                const declaration = viewId === null ? undefined : store.state.catalog.get(viewId);
                const alone = home !== null && isFloating(doc, home) && doc.panels[home]?.tabs.length === 1;
                if (key === null || home === null || alone || declaration?.floatable === false || declaration?.movable === false) return {ok: false, code: "unavailable", reason: TEXT.cannotFloat};
                return store.actions.floatTab(key).ok ? DONE : {ok: false, code: "unavailable", reason: TEXT.cannotFloat};
            },
        },
        [DOCK_COMMAND]: withPanel((store, panel) => (store.actions.dockFloat(panel).ok ? DONE : {ok: false, code: "unavailable", reason: TEXT.notFloating})),
    };
}

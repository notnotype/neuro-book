/**
 * 五条面板命令（docs/specs/workbench/commands.md 第二批，docs/specs/ui/workbench-shell.md 外壳一输出 7、13）：`when` 读
 * 工作台的公开状态，实现调布局 store 的 action。面板标题头的按钮、状态栏与命令面板都经这几条命令改面板。
 *
 * 位置、对齐、隐藏、收起的参数可以省略：命令面板对普通候选执行 `{}`，省略时位置与对齐经选择、隐藏与收起切换；取消
 * 选择为成功且不写。命令返回时布局已按新值显示，保存在后台进行，失败由状态栏给出。
 */

import {Type} from "typebox";

import type {CommandDeclaration, CommandImplementation, CommandResult} from "nbook/plugins/commands/shared/contracts";
import type {LocalizedText} from "nbook/shared/localized-text";

import type {QuickPick} from "../../shared/contracts";
import {PANEL_ALIGNMENTS, PANEL_POSITIONS} from "../shell/panel-state";
import type {PanelAlignment, PanelPosition} from "../shell/panel-state";
import type {LayoutStore} from "../state/layout-store";
import {workbenchState} from "../state/public-state";

export const SET_PANEL_POSITION_COMMAND = "nbook.view.set-panel-position";
export const SET_PANEL_ALIGNMENT_COMMAND = "nbook.view.set-panel-alignment";
export const SET_PANEL_HIDDEN_COMMAND = "nbook.view.set-panel-hidden";
export const SET_PANEL_COLLAPSED_COMMAND = "nbook.view.set-panel-collapsed";
export const TOGGLE_PANEL_MAXIMIZED_COMMAND = "nbook.view.toggle-panel-maximized";

const CATEGORY = {"zh-CN": "视图", "en-US": "View"};
const requires = (...names: ReadonlyArray<keyof typeof workbenchState.declarations & string>) => ({requires: names.map((name) => workbenchState.key(name))});
const literals = <const T extends ReadonlyArray<string>>(values: T) => Type.Union(values.map((value) => Type.Literal(value)));

export const PANEL_COMMAND_DECLARATIONS = {
    [SET_PANEL_POSITION_COMMAND]: {
        title: {"zh-CN": "面板位置", "en-US": "Panel Position"},
        category: CATEGORY,
        description: "Move the panel to the bottom, top, left or right. Without arguments, the user picks one.",
        args: Type.Object({position: Type.Optional(literals(PANEL_POSITIONS))}, {additionalProperties: false}),
        effect: "write",
        expose: {agent: "never"},
        when: requires("layoutReady", "nonCompact"),
    },
    [SET_PANEL_ALIGNMENT_COMMAND]: {
        title: {"zh-CN": "面板对齐", "en-US": "Panel Alignment"},
        category: CATEGORY,
        description: "Set how far a bottom or top panel spans: center, left, right or justify. Without arguments, the user picks one.",
        args: Type.Object({alignment: Type.Optional(literals(PANEL_ALIGNMENTS))}, {additionalProperties: false}),
        effect: "write",
        expose: {agent: "never"},
        when: requires("panelHorizontal", "nonCompact"),
    },
    [SET_PANEL_HIDDEN_COMMAND]: {
        title: {"zh-CN": "隐藏/显示面板", "en-US": "Hide or Show Panel"},
        category: CATEGORY,
        description: "Hide or show the panel; showing it also expands a collapsed panel. Without arguments, toggles.",
        args: Type.Object({hidden: Type.Optional(Type.Boolean())}, {additionalProperties: false}),
        effect: "write",
        expose: {agent: "never"},
        when: requires("layoutReady"),
    },
    [SET_PANEL_COLLAPSED_COMMAND]: {
        title: {"zh-CN": "收起为标题头", "en-US": "Collapse to Title Bar"},
        category: CATEGORY,
        description: "Collapse a bottom or top panel to its 32px title bar, or expand it. Without arguments, toggles.",
        args: Type.Object({collapsed: Type.Optional(Type.Boolean())}, {additionalProperties: false}),
        effect: "write",
        expose: {agent: "never"},
        when: requires("panelHorizontal"),
    },
    [TOGGLE_PANEL_MAXIMIZED_COMMAND]: {
        title: {"zh-CN": "最大化/还原面板", "en-US": "Maximize or Restore Panel"},
        category: CATEGORY,
        description: "Maximize the panel over the editor column, or restore it. Not saved.",
        args: Type.Object({}, {additionalProperties: false}),
        effect: "write",
        expose: {agent: "never"},
        when: requires("panelMaximizable", "nonCompact"),
    },
} as const satisfies Readonly<Record<string, CommandDeclaration>>;

const POSITION_LABELS: Readonly<Record<PanelPosition, LocalizedText>> = {
    bottom: {"zh-CN": "底部", "en-US": "Bottom"},
    top: {"zh-CN": "顶部", "en-US": "Top"},
    left: {"zh-CN": "左侧", "en-US": "Left"},
    right: {"zh-CN": "右侧", "en-US": "Right"},
};

const ALIGNMENT_LABELS: Readonly<Record<PanelAlignment, LocalizedText>> = {
    center: {"zh-CN": "居中（只在编辑器下）", "en-US": "Center (under the editor)"},
    left: {"zh-CN": "靠左（含侧栏）", "en-US": "Left (with the sidebar)"},
    right: {"zh-CN": "靠右（含右栏）", "en-US": "Right (with the auxiliary bar)"},
    justify: {"zh-CN": "两端（含左右侧栏）", "en-US": "Justify (both sidebars)"},
};

const TEXT = {
    current: {"zh-CN": "当前", "en-US": "current"},
    placeholder: {"zh-CN": "选中后立即生效", "en-US": "Takes effect immediately"},
    noLayout: "工作台布局没有打开（这个窗口没有显示外壳）",
} as const;

const DONE: CommandResult<null> = {ok: true, value: null};

/** 选一项：取消、选择服务不可用、选了不认识的都不写。 */
async function choose<T extends string>(quickPick: QuickPick, title: LocalizedText, values: ReadonlyArray<T>, labels: Readonly<Record<T, LocalizedText>>, current: T): Promise<T | CommandResult<null>> {
    const picked = await quickPick.pick({
        title,
        placeholder: TEXT.placeholder,
        items: values.map((value) => ({id: value, label: labels[value], ...(value === current ? {detail: TEXT.current} : {})})),
    });
    if (picked.kind === "unavailable") return {ok: false, code: "unavailable", reason: picked.reason};
    if (picked.kind !== "item") return DONE;
    return values.find((value) => value === picked.id) ?? DONE;
}

type PanelCommands = {readonly [K in keyof typeof PANEL_COMMAND_DECLARATIONS]: CommandImplementation};

/** 五条命令的实现；`layout` 取当前的布局 store，外壳还没挂载时为 null。 */
export function panelCommands(layout: () => LayoutStore | null, quickPick: QuickPick): PanelCommands {
    const withStore = (run: (store: LayoutStore, args: Readonly<Record<string, unknown>>) => CommandResult<null> | Promise<CommandResult<null>>): CommandImplementation => ({
        run: (args) => {
            const store = layout();
            if (store === null) return {ok: false, code: "unavailable", reason: TEXT.noLayout};
            return run(store, args as Readonly<Record<string, unknown>>);
        },
    });
    return {
        [SET_PANEL_POSITION_COMMAND]: withStore(async (store, args) => {
            const position = (args.position as PanelPosition | undefined) ?? (await choose(quickPick, PANEL_COMMAND_DECLARATIONS[SET_PANEL_POSITION_COMMAND].title, PANEL_POSITIONS, POSITION_LABELS, store.state.panel.position));
            if (typeof position !== "string") return position;
            store.actions.setPanelPosition(position);
            return DONE;
        }),
        [SET_PANEL_ALIGNMENT_COMMAND]: withStore(async (store, args) => {
            const alignment = (args.alignment as PanelAlignment | undefined) ?? (await choose(quickPick, PANEL_COMMAND_DECLARATIONS[SET_PANEL_ALIGNMENT_COMMAND].title, PANEL_ALIGNMENTS, ALIGNMENT_LABELS, store.state.panel.alignment));
            if (typeof alignment !== "string") return alignment;
            store.actions.setPanelAlignment(alignment);
            return DONE;
        }),
        [SET_PANEL_HIDDEN_COMMAND]: withStore((store, args) => {
            // 省略参数时切换：面板隐藏或拖到零（看不见）就显示，否则隐藏。
            const shown = !store.state.panel.hidden && store.state.dragCollapsed.panel !== true;
            store.actions.setPanelHidden((args.hidden as boolean | undefined) ?? shown);
            return DONE;
        }),
        [SET_PANEL_COLLAPSED_COMMAND]: withStore((store, args) => {
            store.actions.setPanelCollapsed((args.collapsed as boolean | undefined) ?? !store.state.panel.collapsed);
            return DONE;
        }),
        [TOGGLE_PANEL_MAXIMIZED_COMMAND]: withStore((store) => {
            store.actions.togglePanelMaximized();
            return DONE;
        }),
    };
}

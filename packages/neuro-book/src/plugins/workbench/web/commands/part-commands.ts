/**
 * 区域显隐命令 `nbook.view.set-part-hidden`（docs/specs/workbench/commands.md 第二批，docs/specs/ui/workbench-layout.md
 * 输出 35）：标题栏的布局按钮、视图菜单与命令面板走同一条。参数都可以省略：`part` 省略时经选择服务选区域
 * （命令面板对普通候选执行 `{}`），`hidden` 省略时按“可见”切换。
 */

import {Type} from "typebox";

import type {CommandImplementation, CommandResult, WrittenCommandDeclaration} from "nbook/plugins/commands/shared/contracts";
import type {DisplayText} from "nbook/shared/localized-text";

import type {QuickPick} from "../../shared/contracts";
import {workbenchText} from "../../shared/text";
import type {LayoutDocStore} from "../state/layout-doc-store";
import {workbenchState} from "../state/public-state";

export const SET_PART_HIDDEN_COMMAND = "nbook.view.set-part-hidden";

export const TOGGLEABLE_PARTS = ["sidebar", "auxiliarybar", "panel", "activitybar", "statusbar"] as const;
export type ToggleablePart = (typeof TOGGLEABLE_PARTS)[number];

export const PART_COMMAND_DECLARATIONS = {
    [SET_PART_HIDDEN_COMMAND]: {
        category: workbenchText("categories.view"),
        description: "Hide or show the sidebar, the auxiliary bar, the panel, the activity bar or the status bar; showing also restores a collapsed or dragged-closed area. Without a part, the user picks one; without hidden, toggles.",
        args: Type.Object({
            part: Type.Optional(Type.Union(TOGGLEABLE_PARTS.map((part) => Type.Literal(part)))),
            hidden: Type.Optional(Type.Boolean()),
        }, {additionalProperties: false}),
        effect: "write",
        expose: {agent: "never"},
        when: {requires: [workbenchState.key("layoutReady")]},
    },
} as const satisfies Readonly<Record<string, WrittenCommandDeclaration>>;

const PART_LABELS: Readonly<Record<ToggleablePart, DisplayText>> = {
    sidebar: workbenchText("partCommands.parts.sidebar"),
    auxiliarybar: workbenchText("partCommands.parts.auxiliarybar"),
    panel: workbenchText("partCommands.parts.panel"),
    activitybar: workbenchText("partCommands.parts.activitybar"),
    statusbar: workbenchText("partCommands.parts.statusbar"),
};

const TEXT = {
    visible: workbenchText("partCommands.visible"),
    hidden: workbenchText("partCommands.hidden"),
    placeholder: workbenchText("partCommands.placeholder"),
    noLayout: workbenchText("layout.notOpen"),
} as const;

const DONE: CommandResult<null> = {ok: true, value: null};

export function partCommands(layout: () => LayoutDocStore | null, quickPick: QuickPick): {readonly [SET_PART_HIDDEN_COMMAND]: CommandImplementation} {
    return {
        [SET_PART_HIDDEN_COMMAND]: {
            run: async (args) => {
                const store = layout();
                if (store === null) return {ok: false, code: "unavailable", reason: TEXT.noLayout};
                const given = args as {readonly part?: ToggleablePart; readonly hidden?: boolean};
                let part = given.part;
                if (part === undefined) {
                    const picked = await quickPick.pick({
                        title: workbenchText("commands.nbook.view.set-part-hidden.title"),
                        placeholder: TEXT.placeholder,
                        items: TOGGLEABLE_PARTS.map((id) => ({id, label: PART_LABELS[id], detail: store.actions.partVisible(id) ? TEXT.visible : TEXT.hidden})),
                    });
                    if (picked.kind === "unavailable") return {ok: false, code: "unavailable", reason: picked.reason};
                    if (picked.kind !== "item") return DONE;
                    part = TOGGLEABLE_PARTS.find((id) => id === picked.id);
                    if (part === undefined) return DONE;
                }
                // 选择期间布局可能换了：按执行这一刻的可见性切换。
                store.actions.setPartHidden(part, given.hidden ?? store.actions.partVisible(part));
                return DONE;
            },
        },
    };
}

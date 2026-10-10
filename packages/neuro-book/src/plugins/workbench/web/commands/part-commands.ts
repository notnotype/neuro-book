/**
 * 区域显隐命令 `nbook.view.set-part-hidden`（docs/specs/workbench/commands.md 第二批，docs/specs/ui/workbench-shell.md
 * 外壳四输出 32）：标题栏的布局按钮、视图菜单与命令面板走同一条。参数都可以省略：`part` 省略时经选择服务选区域
 * （命令面板对普通候选执行 `{}`），`hidden` 省略时按“可见”切换。
 */

import {Type} from "typebox";

import type {CommandDeclaration, CommandImplementation, CommandResult} from "nbook/plugins/commands/shared/contracts";
import type {LocalizedText} from "nbook/shared/localized-text";

import type {QuickPick} from "../../shared/contracts";
import type {LayoutStore} from "../state/layout-store";
import {workbenchState} from "../state/public-state";

export const SET_PART_HIDDEN_COMMAND = "nbook.view.set-part-hidden";

export const TOGGLEABLE_PARTS = ["sidebar", "auxiliarybar", "activitybar"] as const;
export type ToggleablePart = (typeof TOGGLEABLE_PARTS)[number];

export const PART_COMMAND_DECLARATIONS = {
    [SET_PART_HIDDEN_COMMAND]: {
        title: {"zh-CN": "切换区域显隐", "en-US": "Toggle Area Visibility"},
        category: {"zh-CN": "视图", "en-US": "View"},
        description: "Hide or show the sidebar, the auxiliary bar or the activity bar; showing also restores a dragged-closed area. Without a part, the user picks one; without hidden, toggles.",
        args: Type.Object({
            part: Type.Optional(Type.Union(TOGGLEABLE_PARTS.map((part) => Type.Literal(part)))),
            hidden: Type.Optional(Type.Boolean()),
        }, {additionalProperties: false}),
        effect: "write",
        expose: {agent: "never"},
        when: {requires: [workbenchState.key("layoutReady")]},
    },
} as const satisfies Readonly<Record<string, CommandDeclaration>>;

const PART_LABELS: Readonly<Record<ToggleablePart, LocalizedText>> = {
    sidebar: {"zh-CN": "侧栏", "en-US": "Sidebar"},
    auxiliarybar: {"zh-CN": "右栏", "en-US": "Auxiliary Bar"},
    activitybar: {"zh-CN": "活动栏", "en-US": "Activity Bar"},
};

const TEXT = {
    visible: {"zh-CN": "显示中", "en-US": "shown"},
    hidden: {"zh-CN": "已隐藏", "en-US": "hidden"},
    placeholder: {"zh-CN": "选中后立即切换", "en-US": "Toggles immediately"},
    noLayout: "工作台布局没有打开（这个窗口没有显示外壳）",
} as const;

const DONE: CommandResult<null> = {ok: true, value: null};

export function partCommands(layout: () => LayoutStore | null, quickPick: QuickPick): {readonly [SET_PART_HIDDEN_COMMAND]: CommandImplementation} {
    return {
        [SET_PART_HIDDEN_COMMAND]: {
            run: async (args) => {
                const store = layout();
                if (store === null) return {ok: false, code: "unavailable", reason: TEXT.noLayout};
                const given = args as {readonly part?: ToggleablePart; readonly hidden?: boolean};
                let part = given.part;
                if (part === undefined) {
                    const picked = await quickPick.pick({
                        title: PART_COMMAND_DECLARATIONS[SET_PART_HIDDEN_COMMAND].title,
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

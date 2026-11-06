/**
 * 在面板之间移动焦点（docs/specs/workbench/commands.md 第二批，docs/specs/ui/nested-grid.md 的“移动焦点”）：键位走命令系统，有冲突
 * 检测，也进命令面板。走法要用 nb-layout 的 Vue 层，插件入口不静态依赖它，所以由外壳挂上时把实现交过来；外壳没挂上时没有东西可走，
 * 命令什么都不做。
 */

import {Type} from "typebox";

import type {CommandImplementation, CommandResult, WrittenCommandDeclaration} from "nbook/plugins/commands/shared/contracts";

import {workbenchText} from "../../shared/text";

export const FOCUS_NEXT_PANE_COMMAND = "nbook.view.focus-next-pane";
export const FOCUS_PREVIOUS_PANE_COMMAND = "nbook.view.focus-previous-pane";

export type PaneFocusMover = (direction: "next" | "previous") => void;

const declaration = (description: string, keybinding: string): WrittenCommandDeclaration => ({
    category: workbenchText("categories.view"),
    description,
    args: Type.Object({}, {additionalProperties: false}),
    effect: "read",
    expose: {agent: "never"},
    keybinding,
});

export const PANE_FOCUS_COMMAND_DECLARATIONS = {
    [FOCUS_NEXT_PANE_COMMAND]: declaration("Move focus to the next pane in layout order.", "F6"),
    [FOCUS_PREVIOUS_PANE_COMMAND]: declaration("Move focus to the previous pane in layout order.", "Shift+F6"),
} as const satisfies Readonly<Record<string, WrittenCommandDeclaration>>;

const DONE: CommandResult<null> = {ok: true, value: null};

export function paneFocusCommands(mover: () => PaneFocusMover | null): {readonly [FOCUS_NEXT_PANE_COMMAND]: CommandImplementation; readonly [FOCUS_PREVIOUS_PANE_COMMAND]: CommandImplementation} {
    return {
        [FOCUS_NEXT_PANE_COMMAND]: {
            run: () => {
                mover()?.("next");
                return DONE;
            },
        },
        [FOCUS_PREVIOUS_PANE_COMMAND]: {
            run: () => {
                mover()?.("previous");
                return DONE;
            },
        },
    };
}

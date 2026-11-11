/**
 * 编辑区标题的动作（docs/specs/workbench/editor.md 输出 34）：只画在活动编辑组的标签条右侧——编辑器的命令与它们的 `when`
 * 都按活动组算，画在别的组上会读错可用性。编辑器自己的“向右拆分”（按钮）与“用其它编辑器重新打开”（“⋯”里）在前，别的
 * 插件经 `editor.title` 贡献的在后（菜单项的共同规则见 docs/specs/workbench/menus.md）。按钮至多 4 个；编辑组窄时由组按自己
 * 的宽度给出更少的个数（`model(maxButtons)`），给标签条至少留 `EDITOR_TITLE_TAB_RESERVE`。
 */

import {arrangeMenu, formatKeybinding} from "nbook/plugins/commands/shared/contracts";
import type {CommandService, KeyPlatform} from "nbook/plugins/commands/shared/contracts";
import type {PublicStateService} from "nbook/plugins/state/shared/contracts";
import type {TextResolver} from "nbook/shared/localized-text";
import {assembleTitleActions} from "nbook/ui/menus/title-actions";
import type {TitleActionCandidate, TitleActionsModel} from "nbook/ui/menus/title-actions";

import type {EditorTitleItemDeclaration} from "../shared/contracts";
import {editorText} from "../shared/text";
import type {EditorArea} from "./area";
import {OPEN_PREVIEW_COMMAND, REOPEN_WITH_COMMAND, SPLIT_RIGHT_COMMAND} from "./commands";
import {TOGGLE_COMMENT_MARGIN_COMMAND} from "./editing-commands";
import {nameOf} from "./documents/address";

export const EDITOR_TITLE_MAX_BUTTONS = 4;

/** 编辑组窄时给标签条至少留的宽度（一个截断的标签），加上标题动作两侧的内边距。 */
export const EDITOR_TITLE_TAB_RESERVE = 96 + 8;

/** 编辑器自己的标题动作：key 以 `own:` 开头，与贡献 id 分开。 */
/**
 * `whenHidden`：命令不可用时不出现（而不是画成禁用）。“打开预览”只对有预览的文件有意义，其余文件上一直灰着是噪音
 * （docs/specs/workbench/editor.md 输出 47）。
 */
const OWN: ReadonlyArray<{readonly key: string; readonly command: string; readonly icon: string; readonly menu: boolean; readonly args?: Readonly<Record<string, unknown>>; readonly whenHidden?: true; readonly pressed?: string; readonly badge?: true}> = [
    {key: "own:open-preview", command: OPEN_PREVIEW_COMMAND, icon: "i-lucide-eye", menu: false, whenHidden: true},
    {key: "own:split-right", command: SPLIT_RIGHT_COMMAND, icon: "i-lucide-columns-2", menu: false},
    // 批注页边的开关（markdown-editing.md 输出 33）：活动控件提供批注页边时才有（命令的 `when` 读 `hasComments`），按下态读这部作品的开关，
    // 图标后面是文档里批注的条数。
    {key: "own:comment-margin", command: TOGGLE_COMMENT_MARGIN_COMMAND, icon: "i-lucide-message-square-text", menu: false, whenHidden: true, pressed: "nbook.editor/commentMargin", badge: true},
    {key: "own:open-preview-side", command: OPEN_PREVIEW_COMMAND, icon: "i-lucide-eye", menu: true, args: {side: true}, whenHidden: true},
    {key: "own:reopen-with", command: REOPEN_WITH_COMMAND, icon: "i-lucide-file-cog", menu: true},
];

/** “在侧边打开预览”的标题：同一条命令带参数，标题另给。 */
const SIDE_TITLE = editorText("titleActions.openPreviewSide");

const RESOURCE: ReadonlySet<string> = new Set(["resource"]);
const NONE: ReadonlySet<string> = new Set();

export interface EditorTitleActions {
    /**
     * 活动组的标题动作；没有编辑区时为 null。`model(maxButtons)` 按组给出的按钮个数拼好（至多 4 个）；`identity` 是“⋯”的菜单
     * 身份：活动组、活动标签与它的地址，任一变化就关闭打开着的菜单（输出 34）。响应式：在 computed 或渲染函数里读。
     */
    current(text: TextResolver): {readonly group: string; readonly model: (maxButtons: number) => TitleActionsModel; readonly identity: string} | null;
    /** 点了一个动作：按 key 找回动作执行；带 `context: "resource"` 的项收到此刻活动标签的地址，活动标签不是文件时不执行。 */
    run(key: string): void;
}

export function createEditorTitleActions(options: {
    /** 只读编辑组的布局（活动组与它的标签）。 */
    /** `activeHandle` 给了才有“批注 N”（输出 33）：活动控件提供 `comments` 时出现。 */
    readonly area: () => (Pick<EditorArea, "groups"> & Partial<Pick<EditorArea, "activeHandle">>) | null;
    readonly commands: Pick<CommandService, "get" | "isEnabled" | "execute">;
    readonly state: Pick<PublicStateService, "read">;
    /** 此刻已交付的贡献项（产品里是 `MenuItemRegistry.items()`，响应式）。 */
    readonly items: () => ReadonlyArray<{readonly id: string; readonly declaration: EditorTitleItemDeclaration}>;
    readonly platform: KeyPlatform;
}): EditorTitleActions {
    /** 活动组与它的活动标签；标签是页面（欢迎页）时没有当前文件。 */
    const active = (area: Pick<EditorArea, "groups">) => {
        const group = area.groups.activeGroup.value;
        const found = area.groups.groups.value.find((candidate) => candidate.id === group);
        const tab = found?.tabs.find((candidate) => candidate.id === found.active) ?? null;
        return {group, tab, file: tab !== null && tab.kind === "file" ? tab.address : null};
    };

    const isOn = (key: string): boolean => {
        const read = options.state.read(key);
        return read.status === "ready" && read.value === true;
    };

    return {
        current: (text) => {
            const area = options.area();
            if (area === null) return null;
            const {group, tab, file} = active(area);
            const own = OWN.flatMap((action): TitleActionCandidate[] => {
                const command = options.commands.get(action.command);
                if (!command.ok) return [];
                const title = text.t(action.key === "own:open-preview-side" ? SIDE_TITLE : command.value.title);
                const enabled = options.commands.isEnabled(action.command);
                if (action.whenHidden === true && !(enabled.ok && enabled.value)) return [];
                const keybinding = command.value.keybinding;
                const count = action.badge === true ? area.activeHandle?.value?.comments?.count.value : undefined;
                const pressed = action.pressed === undefined ? undefined : isOn(action.pressed);
                return [{menu: action.menu, entry: {
                    key: action.key,
                    command: action.command,
                    title,
                    icon: action.icon,
                    disabledReason: enabled.ok ? (enabled.value ? null : title) : text.t(enabled.reason),
                    ...(pressed === undefined ? {} : {pressed}),
                    ...(count === undefined ? {} : {badge: count > 99 ? "99+" : String(count)}),
                    ...(keybinding === undefined ? {} : {shortcut: formatKeybinding(keybinding, options.platform)}),
                }}];
            });
            const contributed = arrangeMenu(options.items(), {
                command: (id) => {
                    const command = options.commands.get(id);
                    return command.ok ? command.value : null;
                },
                isEnabled: (id) => options.commands.isEnabled(id),
                isOn,
                text,
                platform: options.platform,
                current: file === null ? null : [nameOf(file)],
                contexts: file === null ? NONE : RESOURCE,
            }).map((section) => section.map((item): TitleActionCandidate => ({menu: item.placement === "menu", entry: {
                key: item.id,
                command: item.command,
                title: item.label,
                icon: item.icon,
                disabledReason: item.enabled ? null : (item.reason ?? item.label),
                ...(item.checked === null ? {} : {pressed: item.checked}),
                ...(item.shortcut === null ? {} : {shortcut: item.shortcut}),
            }})));
            return {group, model: (maxButtons) => assembleTitleActions(own, contributed, Math.min(maxButtons, EDITOR_TITLE_MAX_BUTTONS)), identity: `${group}|${tab?.id ?? ""}|${tab?.address ?? ""}`};
        },
        run: (key) => {
            const own = OWN.find((action) => action.key === key);
            if (own !== undefined) {
                void options.commands.execute(own.command, {...(own.args ?? {})}, {source: "user"});
                return;
            }
            const area = options.area();
            const item = options.items().find((candidate) => candidate.id === key);
            if (area === null || item === undefined) return;
            const {declaration} = item;
            if (declaration.context !== "resource") {
                void options.commands.execute(declaration.command, {...(declaration.args ?? {})}, {source: "user"});
                return;
            }
            const {file} = active(area);
            if (file !== null) void options.commands.execute(declaration.command, {address: file}, {source: "user"});
        },
    };
}

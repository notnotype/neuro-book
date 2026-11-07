/**
 * 标签的右键菜单（docs/specs/workbench/editor.md 输出 57）：作用于被右击的那个标签，不先激活它。编辑器自己的项直接作用于
 * 这个标签（与带 `tabId` 的命令同一个动作），可用与否按它算：命令的 `when` 按活动标签求值，活动的是页面或控件还没就绪时
 * 会挡住对别的标签的操作。别的插件经 `editor.tab-context` 贡献的项在后（共同规则见 docs/specs/workbench/menus.md），
 * `context: "resource"` 的收到这个标签的地址。菜单打开期间标签被关、移到别的组或换了编辑器，`identity` 随之变化，打开着
 * 的菜单据此关闭。
 */

import {arrangeMenu} from "nbook/plugins/commands/shared/contracts";
import {editorTabKey} from "nbook/plugins/workbench/shared/contracts";
import type {CommandService, KeyPlatform} from "nbook/plugins/commands/shared/contracts";
import type {PublicStateService} from "nbook/plugins/state/shared/contracts";
import {diagnosticText} from "nbook/shared/localized-text";
import type {DisplayText, TextResolver} from "nbook/shared/localized-text";

import type {EditorTabContextItemDeclaration} from "../shared/contracts";
import {editorText} from "../shared/text";
import type {ActionResult, EditorArea} from "./area";
import type {EditorTab} from "./groups/groups";
import {nameOf} from "./documents/address";

/** 资源管理器的“在资源管理器中显示”（docs/specs/workbench/files-explorer.md）：命令 id 是公开接口，不引它的插件代码。 */
const REVEAL_COMMAND = "nbook.files.reveal";

export type TabMenuEntry =
    | {readonly kind: "separator"}
    | {readonly kind: "item"; readonly key: string; readonly label: string; readonly disabled: boolean; readonly reason: string | null; readonly shortcut: string | null};

type MenuArea = Pick<EditorArea, "groups" | "close" | "closeOthers" | "closeToRight" | "closeSaved" | "setPinned" | "split">;

/** 工作台的“浮动”：矩形按窗口算，归工作台（docs/specs/ui/workbench-layout.md 输出 35）。命令 id 是公开接口。 */
const FLOAT_COMMAND = "nbook.view.float";

interface OwnAction {
    readonly key: string;
    readonly label: DisplayText;
    /** 这个标签有没有这一项（页面标签没有路径与拆分）。 */
    readonly shown: (tab: EditorTab) => boolean;
    readonly run: (area: MenuArea, tab: EditorTab, copy: (tab: EditorTab, relative: boolean) => Promise<ActionResult>) => Promise<ActionResult> | ActionResult;
}

const file = (tab: EditorTab): boolean => tab.kind === "file";
const pinned = (tab: EditorTab): boolean => tab.kind === "file" && tab.pinned === true;
const FLOAT_KEY = "own:float";
const always = (): boolean => true;
const batch = async (result: Promise<{readonly ok: boolean; readonly reason?: DisplayText}>): Promise<ActionResult> => {
    const settled = await result;
    return settled.ok ? {ok: true} : {ok: false, reason: settled.reason ?? ""};
};

/** 编辑器自己的项，按节排。 */
const OWN: ReadonlyArray<ReadonlyArray<OwnAction>> = [
    [
        {key: "own:close", label: editorText("tabMenu.close"), shown: always, run: async (area, tab) => {
            // 用户在询问里取消不是失败。
            await area.close(tab.id);
            return {ok: true};
        }},
        {key: "own:close-others", label: editorText("tabMenu.closeOthers"), shown: always, run: (area, tab) => batch(area.closeOthers(tab.id))},
        {key: "own:close-to-right", label: editorText("tabMenu.closeToRight"), shown: always, run: (area, tab) => batch(area.closeToRight(tab.id))},
        {key: "own:close-saved", label: editorText("tabMenu.closeSaved"), shown: always, run: (area, tab) => batch(area.closeSaved(tab.id))},
    ],
    [
        {key: "own:pin", label: editorText("tabMenu.pin"), shown: (tab) => file(tab) && !pinned(tab), run: (area, tab) => area.setPinned(tab.id, true)},
        {key: "own:unpin", label: editorText("tabMenu.unpin"), shown: pinned, run: (area, tab) => area.setPinned(tab.id, false)},
    ],
    [
        {key: "own:split-right", label: editorText("tabMenu.splitRight"), shown: file, run: (area, tab) => area.split("right", tab.id)},
        {key: "own:split-down", label: editorText("tabMenu.splitDown"), shown: file, run: (area, tab) => area.split("down", tab.id)},
    ],
    [
        {key: "own:copy-path", label: editorText("tabMenu.copyPath"), shown: file, run: (_area, tab, copy) => copy(tab, false)},
        {key: "own:copy-relative-path", label: editorText("tabMenu.copyRelativePath"), shown: file, run: (_area, tab, copy) => copy(tab, true)},
    ],
];
const REVEAL_KEY = "own:reveal";

const RESOURCE: ReadonlySet<string> = new Set(["resource"]);
const NONE: ReadonlySet<string> = new Set();

export interface EditorTabMenu {
    /** 标签的菜单；标签已不在为 null。响应式：在 computed 或渲染函数里读。 */
    entries(tabId: string, text: TextResolver): ReadonlyArray<TabMenuEntry> | null;
    /** 菜单身份：组、地址与编辑器，任一变化（或标签已关）时打开着的菜单关闭。 */
    identity(tabId: string): string | null;
    /** 点了一项：按 key 找回动作，带这个标签执行；标签已不在时不执行。 */
    run(tabId: string, key: string): void;
}

export function createEditorTabMenu(options: {
    readonly area: () => MenuArea | null;
    readonly commands: Pick<CommandService, "get" | "isEnabled" | "execute">;
    readonly state: Pick<PublicStateService, "read">;
    /** 此刻已交付的贡献项（产品里是 `MenuItemRegistry.items()`，响应式）。 */
    readonly items: () => ReadonlyArray<{readonly id: string; readonly declaration: EditorTabContextItemDeclaration}>;
    readonly platform: KeyPlatform;
    /** 复制路径（`copyTabPath`）。 */
    readonly copy: (tab: EditorTab, relative: boolean) => Promise<ActionResult>;
    /** 动作或命令失败：记诊断。 */
    readonly report: (action: string, reason: string) => void;
}): EditorTabMenu {
    const find = (tabId: string) => options.area()?.groups.find(tabId) ?? null;
    const execute = (command: string, args: Record<string, unknown>): void => {
        void options.commands.execute(command, args, {source: "user"}).then((result) => {
            if (!result.ok) options.report(command, `${result.code}：${diagnosticText(result.reason)}`);
        });
    };
    return {
        entries: (tabId, text) => {
            const found = find(tabId);
            if (found === null) return null;
            const {tab} = found;
            const own = OWN.map((section) => section.filter((action) => action.shown(tab)).map((action): TabMenuEntry => ({kind: "item", key: action.key, label: text.t(action.label), disabled: false, reason: null, shortcut: null})));
            // “浮动”走工作台的命令：矩形按窗口算。排在复制路径那一节前面；已经独占一个窗的再浮动没有意义。
            if (!(found.group.floating && found.group.tabs.length === 1)) own.splice(own.length - 1, 0, [{kind: "item", key: FLOAT_KEY, label: text.t(editorText("tabMenu.float")), disabled: false, reason: null, shortcut: null}]);
            // “在资源管理器中显示”是资源管理器的命令：可用与否照它自己的 `when`（资源管理器还没就绪时禁用）。
            const reveal = options.commands.get(REVEAL_COMMAND);
            if (file(tab) && reveal.ok) {
                const enabled = options.commands.isEnabled(REVEAL_COMMAND);
                const label = text.t(editorText("tabMenu.reveal"));
                own[own.length - 1]?.push({kind: "item", key: REVEAL_KEY, label, disabled: !(enabled.ok && enabled.value), reason: enabled.ok ? (enabled.value ? null : label) : text.t(enabled.reason), shortcut: null});
            }
            const address = tab.kind === "file" ? tab.address : null;
            const contributed = arrangeMenu(options.items(), {
                command: (id) => {
                    const command = options.commands.get(id);
                    return command.ok ? command.value : null;
                },
                isEnabled: (id) => options.commands.isEnabled(id),
                isOn: (key) => {
                    const read = options.state.read(key);
                    return read.status === "ready" && read.value === true;
                },
                text,
                platform: options.platform,
                current: address === null ? null : [nameOf(address)],
                contexts: address === null ? NONE : RESOURCE,
            }).map((section) => section.map((item): TabMenuEntry => ({kind: "item", key: item.id, label: item.label, disabled: !item.enabled, reason: item.enabled ? null : (item.reason ?? item.label), shortcut: item.shortcut})));
            // 节之间一条分隔线，空节不画。
            return [...own, ...contributed].filter((section) => section.length > 0).flatMap((section, index): TabMenuEntry[] => (index === 0 ? section : [{kind: "separator"}, ...section]));
        },
        identity: (tabId) => {
            const found = find(tabId);
            if (found === null) return null;
            return `${found.group.id}|${found.tab.address}|${found.tab.kind === "file" ? found.tab.editor : "page"}`;
        },
        run: (tabId, key) => {
            const area = options.area();
            const found = find(tabId);
            if (area === null || found === null) return;
            if (key === REVEAL_KEY) {
                execute(REVEAL_COMMAND, {address: found.tab.address});
                return;
            }
            if (key === FLOAT_KEY) {
                execute(FLOAT_COMMAND, {tab: editorTabKey(found.tab.id)});
                return;
            }
            const own = OWN.flat().find((action) => action.key === key);
            if (own !== undefined) {
                void Promise.resolve(own.run(area, found.tab, options.copy)).then((result) => {
                    if (!result.ok) options.report(key, diagnosticText(result.reason));
                });
                return;
            }
            const item = options.items().find((candidate) => candidate.id === key);
            if (item === undefined) return;
            const {declaration} = item;
            if (declaration.context !== "resource") execute(declaration.command, {...(declaration.args ?? {})});
            else if (found.tab.kind === "file") execute(declaration.command, {address: found.tab.address});
        },
    };
}

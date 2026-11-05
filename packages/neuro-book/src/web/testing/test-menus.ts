/**
 * 测试插件 `test.menus` 的浏览器入口（描述与命令见 `nbook/shared/testing/menus-contract`）：贡献方与菜单位置的拥有者、
 * 被贡献的视图分属不同插件，菜单项 id 归本插件，视图 id 归 `test.sample-views`。
 */

import {Type} from "typebox";

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {COMMANDS_POINT, menuImplementations} from "nbook/plugins/commands/shared/contracts";
import type {CommandDeclaration, MenuItemDeclaration} from "nbook/plugins/commands/shared/contracts";
import {EDITOR_BLOCK_POINT, EDITOR_BODY_CONTEXT_POINT, EDITOR_SELECTION_POINT, EDITOR_SLASH_POINT, EDITOR_TAB_CONTEXT_POINT, EDITOR_TITLE_POINT, EDITOR_TOOLBAR_POINT} from "nbook/plugins/editor/shared/contracts";
import type {EditorTabContextItemDeclaration, EditorTitleItemDeclaration} from "nbook/plugins/editor/shared/contracts";
import {EXPLORER_CONTEXT_POINT} from "nbook/plugins/explorer/shared/contracts";
import type {ExplorerContextItemDeclaration} from "nbook/plugins/explorer/shared/contracts";
import {notificationsKey, WORKBENCH_VIEW_TITLE_POINT} from "nbook/plugins/workbench/shared/contracts";
import type {ViewTitleItemDeclaration} from "nbook/plugins/workbench/shared/contracts";
import {recordedText, TEST_MENUS_RECORD_COMMAND, testMenusDescriptor} from "nbook/shared/testing/menus-contract";
import {SAMPLE_VIEW_IDS} from "nbook/shared/testing/sample-views-contract";

const RECORD: CommandDeclaration = {
    title: {"zh-CN": "记下收到的参数", "en-US": "Record Arguments"},
    category: {"zh-CN": "测试", "en-US": "Test"},
    description: "Notify the arguments this command received (test only).",
    args: Type.Object({
        from: Type.Optional(Type.String()),
        viewId: Type.Optional(Type.String()),
        generation: Type.Optional(Type.Integer()),
        addresses: Type.Optional(Type.Array(Type.String())),
        address: Type.Optional(Type.String()),
    }, {additionalProperties: false}),
    effect: "read",
};

const label = (zh: string) => ({"zh-CN": zh, "en-US": zh});

/** 给样例视图丙的标题加一个按钮与一个“⋯”里的项（docs/specs/workbench/views.md 验收 8）。 */
const VIEW_TITLE_ITEMS: ReadonlyArray<{readonly id: string; readonly declaration: ViewTitleItemDeclaration}> = [
    {id: "test.menus.view-button", declaration: {view: SAMPLE_VIEW_IDS.gamma, section: "1", command: TEST_MENUS_RECORD_COMMAND, icon: "i-lucide-star", label: label("测试按钮"), args: {from: "view-button"}}},
    {id: "test.menus.view-menu", declaration: {view: SAMPLE_VIEW_IDS.gamma, section: "1", command: TEST_MENUS_RECORD_COMMAND, placement: "menu", label: label("测试菜单项"), context: "instance"}},
];

/** 资源管理器右键：一条只对 `.md` 的、带选择的项，一条对任何资源都在的、带固定参数的项（files-explorer.md 验收 20）。 */
const EXPLORER_ITEMS: ReadonlyArray<{readonly id: string; readonly declaration: ExplorerContextItemDeclaration}> = [
    {id: "test.menus.explorer-md", declaration: {section: "1", command: TEST_MENUS_RECORD_COMMAND, label: label("测试右键项"), extensions: [".md"], context: "selection"}},
    {id: "test.menus.explorer-any", declaration: {section: "2", command: TEST_MENUS_RECORD_COMMAND, label: label("测试固定参数"), args: {from: "explorer"}}},
];

/** 编辑区标题：只对 `.md` 的按钮，执行时收到活动标签的地址（editor.md 验收 21）。 */
const EDITOR_ITEMS: ReadonlyArray<{readonly id: string; readonly declaration: EditorTitleItemDeclaration}> = [
    {id: "test.menus.editor-md", declaration: {section: "1", command: TEST_MENUS_RECORD_COMMAND, icon: "i-lucide-eye", label: label("测试编辑区按钮"), extensions: [".md"], context: "resource"}},
];

/** Markdown 编辑器的五个位置（docs/specs/workbench/markdown-editing.md 验收 6）：都排在内置项之后，收到活动标签的地址。 */
const markdownItem = (name: string, text: string, extra: Partial<MenuItemDeclaration> = {}): {readonly id: string; readonly declaration: MenuItemDeclaration} => ({
    id: `test.menus.markdown-${name}`,
    declaration: {section: "1", command: TEST_MENUS_RECORD_COMMAND, icon: "i-lucide-puzzle", label: label(text), context: "resource", ...extra},
});
const MARKDOWN_ITEMS: ReadonlyArray<{readonly point: string; readonly items: ReadonlyArray<{readonly id: string; readonly declaration: MenuItemDeclaration}>}> = [
    {point: EDITOR_TOOLBAR_POINT, items: [markdownItem("toolbar", "测试工具栏项")]},
    {point: EDITOR_SELECTION_POINT, items: [markdownItem("selection", "测试选区项")]},
    {point: EDITOR_SLASH_POINT, items: [markdownItem("slash", "测试斜杠项")]},
    {point: EDITOR_BLOCK_POINT, items: [markdownItem("block", "测试块菜单项")]},
    {point: EDITOR_BODY_CONTEXT_POINT, items: [markdownItem("context", "测试右键项目")]},
];

/** 标签右键（docs/specs/workbench/editor.md 输出 57）：`.md` 文件标签上多一项，收到被右击标签的地址。 */
const TAB_ITEMS: ReadonlyArray<{readonly id: string; readonly declaration: EditorTabContextItemDeclaration}> = [
    {id: "test.menus.tab-md", declaration: {section: "1", command: TEST_MENUS_RECORD_COMMAND, label: label("测试标签菜单"), extensions: [".md"], context: "resource"}},
];


export function createTestMenusBrowserPlugin(): PluginDefinition {
    return {
        id: testMenusDescriptor.id,
        entries: [defineEntry({
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            dependencies: [{key: notificationsKey}],
            contributions: [
                {capability: COMMANDS_POINT, id: TEST_MENUS_RECORD_COMMAND, declaration: RECORD},
                ...VIEW_TITLE_ITEMS.map(({id, declaration}) => ({capability: WORKBENCH_VIEW_TITLE_POINT, id, declaration})),
                ...EXPLORER_ITEMS.map(({id, declaration}) => ({capability: EXPLORER_CONTEXT_POINT, id, declaration})),
                ...EDITOR_ITEMS.map(({id, declaration}) => ({capability: EDITOR_TITLE_POINT, id, declaration})),
                ...TAB_ITEMS.map(({id, declaration}) => ({capability: EDITOR_TAB_CONTEXT_POINT, id, declaration})),
                ...MARKDOWN_ITEMS.flatMap(({point, items}) => items.map(({id, declaration}) => ({capability: point, id, declaration}))),
            ],
            activate: (context) => {
                const notifications = context.services.require(notificationsKey);
                return {contributions: {
                    [COMMANDS_POINT]: {[TEST_MENUS_RECORD_COMMAND]: {run: (args: unknown) => {
                        notifications.notify({message: recordedText(args), sticky: true});
                        return {ok: true, value: null};
                    }}},
                    [WORKBENCH_VIEW_TITLE_POINT]: menuImplementations(VIEW_TITLE_ITEMS),
                    [EXPLORER_CONTEXT_POINT]: menuImplementations(EXPLORER_ITEMS),
                    [EDITOR_TITLE_POINT]: menuImplementations(EDITOR_ITEMS),
                    [EDITOR_TAB_CONTEXT_POINT]: menuImplementations(TAB_ITEMS),
                    ...Object.fromEntries(MARKDOWN_ITEMS.map(({point, items}) => [point, menuImplementations(items)])),
                }};
            },
        })],
    };
}

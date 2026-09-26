import type EditorWorkbench from "nbook/app/components/editor-workbench/EditorWorkbench.vue";
import type MonacoCodeEditor from "nbook/app/components/editor-workbench/MonacoCodeEditor.vue";
import type NovelIdeActivityBar from "nbook/app/components/novel-ide/NovelIdeActivityBar.vue";
import type {LabFixtureDefinition} from "./index";
import {EDITOR_WORKBENCH_SCENE_INPUTS} from "./editor-workbench/fixture-data";
import {DEFAULT_MONACO_EDITOR_PREFERENCES} from "nbook/shared/editor-workbench";

export const editorWorkbenchScenes = [
    {id: "empty", label: "空工作区 / 欢迎页", input: EDITOR_WORKBENCH_SCENE_INPUTS.empty},
    {id: "mixed", label: "固定、普通、预览与脏标记标签", input: EDITOR_WORKBENCH_SCENE_INPUTS.mixed},
    {id: "long-titles", label: "超长路径与横向截断滚动", input: EDITOR_WORKBENCH_SCENE_INPUTS["long-titles"]},
    {id: "loading", label: "加载中 / 忙碌遮罩态", input: EDITOR_WORKBENCH_SCENE_INPUTS.loading},
    {id: "diagnosis", label: "诊断警告 / 未知打开方式", input: EDITOR_WORKBENCH_SCENE_INPUTS.diagnosis},
    {id: "closing-cancel", label: "未保存关闭保护与取消决策", input: EDITOR_WORKBENCH_SCENE_INPUTS["closing-cancel"]},
    {id: "keyboard-menu", label: "菜单栏集合与键盘无障碍漫游", input: EDITOR_WORKBENCH_SCENE_INPUTS["keyboard-menu"]},
    {id: "multi-view", label: "真实 Registry / 第三视图同一正文切换", input: EDITOR_WORKBENCH_SCENE_INPUTS["multi-view"]},
] satisfies LabFixtureDefinition<typeof EditorWorkbench>["scenes"];

const preferences = (overrides: Partial<typeof DEFAULT_MONACO_EDITOR_PREFERENCES> = {}) => ({...DEFAULT_MONACO_EDITOR_PREFERENCES, ...overrides});

export const monacoCodeEditorScenes = [
    {id: "markdown", label: "Markdown 源码", input: {props: {
        initialValue: "# 退潮\n\n礁石上留下了一层薄薄的盐。\n\n- 把灯点上\n- 等他回来\n", language: "markdown", readonly: false,
        placeholder: "", temporaryFontSize: null, monacoPreferences: preferences(),
    }}},
    {id: "typescript", label: "TypeScript 源码", input: {props: {
        initialValue: "type Draft = {\n    id: string;\n    title: string;\n    words: number;\n};\n\nfunction isLong(draft: Draft): boolean {\n    return draft.words > 3000;\n}\n", language: "typescript", readonly: false,
        placeholder: "", temporaryFontSize: null, monacoPreferences: preferences({tabSize: 4, lineNumbers: true}),
    }}},
    {id: "readonly", label: "只读", input: {props: {
        initialValue: "这份文档只读：可以选中、复制、滚动，但输入不会进入正文。\n", language: "plaintext", readonly: true,
        placeholder: "", temporaryFontSize: null, monacoPreferences: preferences(),
    }}},
    {id: "placeholder", label: "空值占位文案", input: {props: {
        initialValue: "", language: "markdown", readonly: false,
        placeholder: "在此输入正文，Ctrl+S 发出保存请求…", temporaryFontSize: null, monacoPreferences: preferences(),
    }}},
    {id: "preferences", label: "显示偏好（不换行 / 无行号 / 显示空白 / 临时字号 22）", input: {props: {
        initialValue: "const unwrapped = \"这一段不自动换行，并且显示空白字符与行号开关的效果\";\n\n\t缩进用制表符，字号被临时调大。\n",
        language: "javascript", readonly: false, placeholder: "", temporaryFontSize: 22,
        monacoPreferences: preferences({wordWrap: false, lineNumbers: false, renderWhitespace: true, tabSize: 8, fontSize: 18}),
    }}},
] satisfies LabFixtureDefinition<typeof MonacoCodeEditor>["scenes"];

const containers = [
    {containerId: "lab.container.tools", title: "工具", icon: "i-lucide-files", location: "sidebar-left", partId: "left", viewIds: [], canMoveContainer: true},
    {containerId: "lab.container.panel", title: "面板", icon: "i-lucide-panel-bottom", location: "sidebar-left", partId: "left", viewIds: [], canMoveContainer: true},
] as const;

const labUser = {id: "lab-user", username: "lab-author", displayName: "写作实验员", role: "admin", sessionVersion: 1} as const;

export const novelIdeActivityBarScenes = [
    {id: "default", label: "桌面（Project 已打开）", input: {props: {
        containers, activeContainerId: "lab.container.tools", desktopAvailable: true, surfaceActive: true, userAssetsMode: false, currentUser: null,
    }}},
    {id: "disabled", label: "书架态（未打开 Project）", input: {props: {
        containers, activeContainerId: "lab.container.panel", desktopAvailable: true, surfaceActive: false, userAssetsMode: false, currentUser: null,
    }}},
    {id: "account", label: "账户菜单（假 AuthUserDto）", input: {props: {
        containers, activeContainerId: "lab.container.tools", desktopAvailable: true, surfaceActive: true, userAssetsMode: false, currentUser: labUser,
    }}},
] satisfies LabFixtureDefinition<typeof NovelIdeActivityBar>["scenes"];

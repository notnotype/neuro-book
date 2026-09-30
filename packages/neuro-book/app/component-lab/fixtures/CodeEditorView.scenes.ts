import type CodeEditorView from "nbook/app/components/editor-workbench/CodeEditorView.vue";
import {DEFAULT_MONACO_EDITOR_PREFERENCES} from "nbook/shared/editor-workbench";
import type {LabFixtureDefinition} from "./index";

const document = (path: string, languageId: string, readonly: boolean, content: string) => ({
    target: {workspaceKey: "lab:code-editor-view", generation: 1, documentId: `lab-doc:${path}`, path},
    content, contentRevision: 0, languageId, readonly,
});
const scene = (id: string, label: string, path: string, languageId: string, readonly: boolean, content: string) => ({
    id, label,
    input: {props: {document: document(path, languageId, readonly, content), visible: true, viewInstanceId: "lab-code-view:initial", monacoPreferences: DEFAULT_MONACO_EDITOR_PREFERENCES}},
});

export const codeEditorViewScenes = [
    scene("markdown", "Markdown 正文源码", "manuscript/chapter-01.md", "markdown", false, "# 开场\n\n潮水退下去的时候，礁石上留下了一层薄薄的盐。\n\n她把鞋提在手里，沿着滩涂往东走。\n\n> 那些没有说出口的话，最后都变成了潮声。\n\n- 第一件事：把灯点上\n- 第二件事：等他回来\n"),
    scene("json-invalid", "非法 JSON 原样保留", "project/chapters.json", "json", false, "{\n    \"chapters\": [\n        {\"id\": 1, \"title\": \"开场\"},\n        {\"id\": 2, \"title\": \"退潮\", \"draft\": tru\n"),
    scene("html-source", "HTML 只有源码", "export/page.html", "html", false, "<!doctype html>\n<html lang=\"zh-CN\">\n<head>\n    <meta charset=\"utf-8\">\n    <title>退潮</title>\n</head>\n<body>\n    <p>这段 HTML 只有源码，没有预览。</p>\n</body>\n</html>\n"),
    scene("readonly", "只读文档", "assets/导出的旧稿.txt", "plaintext", true, "这是一份只读文档：内核不允许输入，夹具也不伪造「保存成功」。\n"),
    scene("empty", "空文档", "manuscript/未命名.md", "markdown", false, ""),
    scene("command-navigation", "命令与行号导航", "lab/command-navigation.txt", "plaintext", false, Array.from({length: 60}, (_, index) => `第 ${index + 1} 行：命令导航验收`).join("\n")),
    scene("commands-unavailable", "无活动编辑器", "lab/commands-unavailable.txt", "plaintext", false, ""),
] satisfies LabFixtureDefinition<typeof CodeEditorView>["scenes"];

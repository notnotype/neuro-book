import type MarkdownEditorView from "nbook/app/components/editor-workbench/MarkdownEditorView.vue";
import {DEFAULT_MARKDOWN_EDITOR_PREFERENCES} from "nbook/shared/editor-workbench";
import type {LabFixtureDefinition} from "./index";

const scene = (id: string, label: string, path: string, readonly: boolean, showFrontmatterPanel: boolean, content: string) => ({
    id, label,
    input: {props: {
        document: {target: {workspaceKey: "lab:markdown-editor-view", generation: 1, documentId: `lab-doc:${path}`, path}, content, contentRevision: 0, languageId: "markdown", readonly},
        visible: true, viewInstanceId: "lab-markdown-view:initial", editorPreferences: DEFAULT_MARKDOWN_EDITOR_PREFERENCES,
        showFrontmatterPanel,
    }},
});

export const markdownEditorViewScenes = [
    scene("prose", "普通正文", "manuscript/chapter-01.md", false, false, "# 开场\n\n潮水退下去的时候，礁石上留下了一层薄薄的盐。\n\n她把鞋提在手里，沿着滩涂往东走，**没有回头**。\n\n> 那些没有说出口的话，最后都变成了潮声。\n\n- 把灯点上\n- 等他回来\n\n行内代码写作 `manuscript/chapter-01.md`。\n"),
    scene("comments", "含批注的正文（批注面板经视图动作打开）", "manuscript/chapter-02.md", false, false, "# 退潮\n\n<comment body=\"这里要补一段潮汐的细节\">她把鞋提在手里，沿着滩涂往东走。</comment>\n\n<comment body=\"第二处批注：删掉重复的比喻\">礁石上留下了一层薄薄的盐。</comment>\n\n（打开右上角的批注动作可以看到这两条；修改批注会写回这份正文。）\n"),
    scene("frontmatter", "frontmatter 与正文分离", "manuscript/退潮/index.md", false, true, "---\ntitle: 退潮\nstatus: 草稿\nwords: 1284\n---\n\n# 退潮\n\n正文在第一段之后开始，frontmatter 不属于正文。\n"),
    scene("readonly", "只读文档", "manuscript/定稿/开场.md", true, false, "# 开场（定稿）\n\n这份文档只读：可以选中、复制、滚动与查看批注，但输入不会写回正文。\n"),
    scene("empty", "空文档", "manuscript/未命名.md", false, false, ""),
] satisfies LabFixtureDefinition<typeof MarkdownEditorView>["scenes"];

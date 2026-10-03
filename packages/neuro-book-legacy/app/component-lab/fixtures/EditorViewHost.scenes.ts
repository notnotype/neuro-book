import type EditorViewHost from "nbook/app/components/editor-workbench/EditorViewHost.vue";
import type {LabFixtureDefinition} from "./index";

const path = "manuscript/chapter-01.md";
const content = "# 退潮\n\n礁石上留下了一层薄薄的盐。\n";
const scene = (id: string, label: string, editorId: string) => ({
    id, label,
    input: {props: {editorId, document: {
        target: {workspaceKey: "lab:editor-view-host", generation: 1, documentId: `lab-doc:${path}`, path},
        content, contentRevision: 0, languageId: "markdown", readonly: false,
    }, conflictResolution: null}},
});

export const editorViewHostScenes = [
    scene("switch", "两个替身视图对同一份正文切换", "code"),
    scene("pending", "目标视图慢就绪（旧视图仍可见）", "code"),
    scene("view-error", "视图抛错被宿主收敛", "crash"),
    scene("single", "单视图最小结构", "code"),
] satisfies LabFixtureDefinition<typeof EditorViewHost>["scenes"];

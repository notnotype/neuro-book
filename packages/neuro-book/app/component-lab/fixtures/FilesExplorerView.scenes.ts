import type FilesExplorerView from "../../components/novel-ide/workspace/FilesExplorerView.vue";
import type {WorkspaceFileNode} from "../../stores/novel-ide";
import type {LabFixtureDefinition} from "./index";

function node(path: string, directory = false, title = path.split("/").at(-1) ?? path): WorkspaceFileNode {
    return {
        path, absolutePath: `/lab/files/${path}`, title, mode: directory ? "directory" : "file",
        entryType: null, icon: null, status: null, words: 0, refs: [], isDirectory: directory,
        hasIndex: false, contentNode: false, summary: "", frontmatter: title === path ? {} : {title},
        frontmatterError: null, state: null, size: 0, mtimeMs: 1, editable: !directory,
    };
}

const sampleNodes = [
    node("index.md", false, "航海日志"),
    node("manuscript", true), node("manuscript/index.md", false, "第一卷"),
    node("manuscript/chapter-01.md", false, "潮门"), node("manuscript/notes.md", false, "海图"),
    node("reference", true), node("reference/chart.png"), node("empty", true),
];

const scene = (
    id: string,
    label: string,
    overrides: {nodes?: WorkspaceFileNode[]; mode?: "ordinary" | "content"; loading?: boolean; error?: string | null} = {},
) => ({
    id, label,
    input: {
        props: {nodes: overrides.nodes ?? sampleNodes, selectedPath: "", loading: overrides.loading ?? false, error: overrides.error ?? null},
        model: {mode: overrides.mode ?? "ordinary", expandedPaths: ["manuscript", "reference"], selectedPaths: []},
    },
});

export const filesExplorerViewScenes = [
    scene("ordinary", "普通文件与 index.md"),
    scene("content", "内容节点与目录正文", {mode: "content"}),
    scene("loading", "读取中", {loading: true}),
    scene("error", "读取失败与重试", {error: "无法读取文件树"}),
    scene("empty", "空目录", {nodes: []}),
] satisfies LabFixtureDefinition<typeof FilesExplorerView>["scenes"];

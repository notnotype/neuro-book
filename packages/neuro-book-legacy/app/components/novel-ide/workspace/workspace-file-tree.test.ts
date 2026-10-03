import {describe, expect, it} from "vitest";
import type {WorkspaceFileNode} from "nbook/app/stores/novel-ide";
import {
    buildWorkspaceFileTree,
    outermostWorkspacePaths,
    projectWorkspaceFileNodes,
    resolveWorkspaceNodeRepresentedPath,
} from "nbook/app/components/novel-ide/workspace/workspace-file-tree";

function file(path: string, title = "", overrides: Partial<WorkspaceFileNode> = {}): WorkspaceFileNode {
    return {
        mode: "file",
        entryType: null,
        icon: null,
        status: null,
        words: 0,
        refs: [],
        path,
        absolutePath: `C:/project/${path}`,
        isDirectory: false,
        hasIndex: false,
        contentNode: false,
        summary: "",
        title,
        frontmatter: {},
        frontmatterError: null,
        state: null,
        size: 0,
        mtimeMs: 0,
        editable: true,
        ...overrides,
    };
}

function directory(path: string, title = "", overrides: Partial<WorkspaceFileNode> = {}): WorkspaceFileNode {
    return file(path, title, {
        isDirectory: true,
        editable: false,
        ...overrides,
    });
}

describe("outermost workspace selection", () => {
    it("deduplicates directory children regardless of selection order while retaining independent siblings", () => {
        expect(outermostWorkspacePaths(["novel/chapter.md", "notes.md", "novel/", "novel/deep/", "notes.md"])).toEqual(["notes.md", "novel/"]);
    });
});

describe("workspace file modes", () => {
    it("ordinary mode shows real filenames including index.md in every directory", () => {
        const nodes = [
            directory("manuscript/", "Collection", {hasIndex: true, contentNode: true}),
            file("manuscript/index.md", "Collection", {contentNode: true}),
            directory("notes/", "Notebook", {hasIndex: true, contentNode: true}),
            file("notes/index.md", "Notebook", {contentNode: true}),
            file("index.md", "Project", {contentNode: true}),
            file("notes/chapter.md", "Actual title"),
        ];

        const projected = projectWorkspaceFileNodes(nodes, "ordinary");
        const tree = buildWorkspaceFileTree(projected);

        expect(projected.map(node => [node.path, node.title])).toEqual([
            ["manuscript/", "manuscript"],
            ["manuscript/index.md", "index.md"],
            ["notes/", "notes"],
            ["notes/index.md", "index.md"],
            ["index.md", "index.md"],
            ["notes/chapter.md", "chapter.md"],
        ]);
        expect(tree.find(node => node.path === "manuscript/")?.children.map(node => node.path)).toEqual(["manuscript/index.md"]);
        expect(tree.find(node => node.path === "notes/")?.children.map(node => node.path)).toEqual(["notes/chapter.md", "notes/index.md"]);
        expect(tree.find(node => node.path === "index.md")?.path).toBe("index.md");
        expect(nodes[0]?.title).toBe("Collection");
        expect(nodes[1]?.title).toBe("Collection");
    });

    it("content mode hides every index.md including root and opens directory through its real index", () => {
        const nodes = [
            file("index.md", "Project"),
            directory("notes/", "Stale directory title", {contentNode: false, hasIndex: false}),
            file("notes/index.md", "Field Notes"),
            directory("notes/deep/", "Stale title", {contentNode: true, hasIndex: true}),
            file("notes/deep/index.md", "Nested Notes"),
            directory("empty/", "Old title", {contentNode: true, hasIndex: true}),
            file("notes/deep/sketch.png", "Should not be title", {editable: false}),
        ];

        const projected = projectWorkspaceFileNodes(nodes, "content");
        const tree = buildWorkspaceFileTree(projected);
        const notes = tree.find(node => node.path === "notes/");
        const deep = notes?.children.find(node => node.path === "notes/deep/");
        const empty = tree.find(node => node.path === "empty/");

        expect(projected.map(node => node.path)).toEqual(["notes/", "notes/deep/", "empty/", "notes/deep/sketch.png"]);
        expect(notes).toMatchObject({path: "notes/", title: "Field Notes", hasIndex: true, contentNode: true});
        expect(deep).toMatchObject({path: "notes/deep/", title: "Nested Notes", hasIndex: true, contentNode: true});
        expect(resolveWorkspaceNodeRepresentedPath(notes!)).toBe("notes/index.md");
        expect(resolveWorkspaceNodeRepresentedPath(deep!)).toBe("notes/deep/index.md");
        expect(empty).toMatchObject({title: "empty", hasIndex: false, contentNode: false});
        expect(resolveWorkspaceNodeRepresentedPath(empty!)).toBe("empty/");
        expect(deep?.children[0]).toMatchObject({title: "sketch.png", path: "notes/deep/sketch.png"});
        expect(nodes[1]).toMatchObject({title: "Stale directory title", hasIndex: false, contentNode: false});
    });

    it("falls back to real path names for malformed or empty markdown titles while preserving distinct paths", () => {
        const nodes = [
            directory("drafts/a/", "Stale"),
            file("drafts/a/index.md", "Wrong title", {frontmatterError: "invalid YAML"}),
            directory("drafts/b/", "Stale"),
            file("drafts/b/index.md", "   "),
            file("drafts/a/chapter.md", "New Chapter"),
            file("drafts/b/chapter.md", "   "),
            file("drafts/b/broken.md", "Wrong", {frontmatterError: "invalid YAML"}),
        ];

        const projected = projectWorkspaceFileNodes(nodes, "content");

        expect(projected.map(node => [node.path, node.title])).toEqual([
            ["drafts/a/", "a"],
            ["drafts/b/", "b"],
            ["drafts/a/chapter.md", "New Chapter"],
            ["drafts/b/chapter.md", "chapter.md"],
            ["drafts/b/broken.md", "broken.md"],
        ]);
        expect(nodes.map(node => node.title)).toEqual(["Stale", "Wrong title", "Stale", "   ", "New Chapter", "   ", "Wrong"]);
    });
});

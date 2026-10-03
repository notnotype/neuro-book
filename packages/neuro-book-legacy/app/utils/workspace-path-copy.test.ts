import {describe, expect, it} from "vitest";
import type {WorkspaceFileNode} from "nbook/app/stores/novel-ide";
import {
    buildWorkspacePathCopyText,
    resolveWorkspaceAbsolutePath,
    resolveWorkspaceRelativePath,
} from "nbook/app/utils/workspace-path-copy";

function createNode(patch: Partial<WorkspaceFileNode>): WorkspaceFileNode {
    return {
        mode: "",
        entryType: null,
        icon: null,
        status: null,
        words: 0,
        refs: [],
        path: "",
        absolutePath: "",
        isDirectory: false,
        hasIndex: false,
        contentNode: false,
        summary: "",
        title: "",
        frontmatter: {},
        frontmatterError: null,
        state: null,
        size: 0,
        mtimeMs: 0,
        editable: true,
        ...patch,
    };
}

describe("workspace path copy helpers", () => {
    it("copies workspace-root relative file paths", () => {
        const node = createNode({
            path: "manuscript/001-opening.md",
            absolutePath: "C:\\Novel\\manuscript\\001-opening.md",
        });

        expect(resolveWorkspaceRelativePath(node)).toBe("manuscript/001-opening.md");
        expect(resolveWorkspaceAbsolutePath(node)).toBe("C:\\Novel\\manuscript\\001-opening.md");
    });

    it("keeps trailing separators for directories", () => {
        const node = createNode({
            path: "lorebook/location/",
            absolutePath: "C:\\Novel\\lorebook\\location",
            isDirectory: true,
        });

        expect(resolveWorkspaceRelativePath(node)).toBe("lorebook/location/");
        expect(resolveWorkspaceAbsolutePath(node)).toBe("C:\\Novel\\lorebook\\location\\");
    });

    it("uses content directory paths for index markdown nodes", () => {
        const node = createNode({
            path: "lorebook/character/hero/index.md",
            absolutePath: "C:\\Novel\\lorebook\\character\\hero\\index.md",
            title: "主角",
        });

        expect(resolveWorkspaceRelativePath(node)).toBe("lorebook/character/hero/");
        expect(buildWorkspacePathCopyText(node, "relative-reference")).toBe("[主角](lorebook/character/hero/)");
        expect(buildWorkspacePathCopyText(node, "absolute-reference")).toBe("[主角](C:\\Novel\\lorebook\\character\\hero\\index.md)");
    });

    it("copies character panel content nodes with workspace-root relative references", () => {
        const node = createNode({
            path: "lorebook/character/alice/index.md",
            absolutePath: "C:\\Novel\\lorebook\\character\\alice\\index.md",
            contentNode: true,
            entryType: "character",
            title: "Alice",
        });

        expect(buildWorkspacePathCopyText(node, "relative-reference")).toBe("[Alice](lorebook/character/alice/)");
    });

    it("escapes markdown label characters", () => {
        const node = createNode({
            path: "notes/ref.md",
            absolutePath: "C:\\Novel\\notes\\ref.md",
            title: "A]B\\C",
        });

        expect(buildWorkspacePathCopyText(node, "relative-reference")).toBe("[A\\]B\\\\C](notes/ref.md)");
    });
});

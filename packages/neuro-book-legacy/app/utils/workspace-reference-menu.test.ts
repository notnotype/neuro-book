import {describe, expect, it} from "vitest";
import type {WorkspaceFileNode} from "nbook/app/stores/novel-ide";
import {buildWorkspaceReferenceSections} from "nbook/app/utils/workspace-reference-menu";

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

function flattenLabels(query: string): string[] {
    const sections = buildWorkspaceReferenceSections([
        createNode({
            path: "manuscript/001-volume/001-chapter",
            isDirectory: true,
            hasIndex: true,
            contentNode: true,
            entryType: "chapter",
            title: "第一章",
            summary: "章节：第一章",
            icon: "book-open",
        }),
        createNode({path: "AGENTS.md"}),
        createNode({path: "workspace.yaml"}),
        createNode({path: "project.yaml"}),
        createNode({path: "upload/cover.png", editable: false}),
        createNode({path: "upload/reference.pdf", editable: false}),
        createNode({path: "upload/archive.zip", editable: false}),
        createNode({path: "upload/tool.exe", editable: false}),
    ], query);
    return sections.flatMap((section) => section.items.map((item) => item.label));
}

describe("buildWorkspaceReferenceSections", () => {
    it("prioritizes exact file names over earlier content-node groups", () => {
        expect(flattenLabels("agents.md")[0]).toBe("AGENTS.md");
    });

    it("includes yaml config files as reference candidates", () => {
        expect(flattenLabels("workspace")[0]).toBe("workspace.yaml");
        expect(flattenLabels("project")[0]).toBe("project.yaml");
    });

    it("includes upload files even when they are not editable text files", () => {
        expect(flattenLabels("cover")).toContain("cover.png");
        expect(flattenLabels("reference")).toContain("reference.pdf");
    });

    it("excludes blacklisted binary/archive files", () => {
        expect(flattenLabels("archive")).not.toContain("archive.zip");
        expect(flattenLabels("tool")).not.toContain("tool.exe");
    });
});

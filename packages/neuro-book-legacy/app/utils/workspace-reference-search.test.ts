import {describe, expect, it} from "vitest";
import {
    collectWorkspaceReferencePathCandidates,
    searchWorkspaceReferences,
    type WorkspaceReferenceSearchInput,
} from "nbook/app/utils/workspace-reference-search";

interface TestItem {
    path: string;
}

function createInput(path: string, frontmatter: Record<string, unknown> = {}): WorkspaceReferenceSearchInput<TestItem> {
    return {
        item: {path},
        label: path.split("/").at(-1) ?? path,
        target: path,
        description: "",
        entryType: "note",
        menuId: `workspace-reference:${path}`,
        frontmatter,
        order: 0,
    };
}

describe("searchWorkspaceReferences", () => {
    it("matches compact path fragments across segments", () => {
        const items = [createInput("lorebook/foo/bar")];

        expect(searchWorkspaceReferences(items, "lorebar")[0]?.item.path).toBe("lorebook/foo/bar");
        expect(searchWorkspaceReferences(items, "lore ba")[0]?.item.path).toBe("lorebook/foo/bar");
    });

    it("matches Chinese paths by full pinyin", () => {
        const items = [createInput("lorebook/你好世界/foo/bar")];

        expect(searchWorkspaceReferences(items, "nihaoshijie")[0]?.item.path).toBe("lorebook/你好世界/foo/bar");
    });

    it("matches Chinese paths by pinyin initials", () => {
        const items = [createInput("lorebook/你好世界/foo/bar")];

        expect(searchWorkspaceReferences(items, "nhsj")[0]?.item.path).toBe("lorebook/你好世界/foo/bar");
    });

    it("matches slight pinyin omissions through fuzzy search", () => {
        const items = [createInput("lorebook/你好/foo/bar")];

        expect(searchWorkspaceReferences(items, "nhao")[0]?.item.path).toBe("lorebook/你好/foo/bar");
    });

    it("matches frontmatter id", () => {
        const items = [createInput("lorebook/你好/foo/bar", {id: 1})];

        expect(searchWorkspaceReferences(items, "1")[0]?.item.path).toBe("lorebook/你好/foo/bar");
    });
});

describe("collectWorkspaceReferencePathCandidates", () => {
    it("strips current workspace prefix from full workspace paths", () => {
        expect(collectWorkspaceReferencePathCandidates(
            "workspace/silver-dragon-hime/.agent/thread-1/plan.md",
            "workspace/silver-dragon-hime",
        )).toContain(".agent/thread-1/plan.md");
    });

    it("keeps existing relative content-node candidates", () => {
        const candidates = collectWorkspaceReferencePathCandidates("character/foo", "workspace/silver-dragon-hime");

        expect(candidates).toContain("lorebook/character/foo/index.md");
        expect(candidates).toContain("manuscript/character/foo/index.md");
    });
});

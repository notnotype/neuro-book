import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {ChapterProseService} from "nbook/server/plot/services/chapter-prose.service";
import type {WorkspaceFileNode} from "nbook/server/workspace-files/workspace-files";
import {beforeEach, describe, expect, it, vi} from "vitest";
import path from "node:path";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import { testAbsoluteFsPath } from "@notnotype/neuro-book-test-support/test-path"
import type {ProjectFileIndexHandle} from "nbook/server/workspace-files/project-file-index";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";

const snapshotMock = vi.fn();
vi.mock("nbook/server/workspace-files/project-workspace-index", () => ({
    readProjectWorkspaceTreeSnapshot: (...args: unknown[]) => snapshotMock(...args),
}));

/** 构造最小 workspace 节点;只填 Prose 反指解析用到的字段。 */
function node(patch: Partial<WorkspaceFileNode>): WorkspaceFileNode {
    return {
        mode: "", entryType: "chapter", icon: null, status: null, words: 0, refs: [],
        path: "manuscript/x/", absolutePath: "", isDirectory: true, hasIndex: true,
        contentNode: true, summary: "", title: "章", frontmatter: {}, frontmatterError: null,
        state: null, size: 0, mtimeMs: 0, editable: true,
        ...patch,
    };
}

describe("ChapterProseService", () => {
    const workspaceRoot = absoluteFsPath(testHostPath("chapter-prose-service-test", "workspace"));
    const fileIndex = {} as ProjectFileIndexHandle;
    const target = {
        kind: "project-workspace" as const,
        root: absoluteFsPath(path.join(workspaceRoot, "novel")),
        projectRoot: projectWorkspaceRef("novel").projectRoot,
    };
    const service = new ChapterProseService(target, fileIndex);

    beforeEach(() => {
        snapshotMock.mockReset();
    });

    it("只收 manuscript 下带合法 chapter 指针的内容节点,按 path 升序", async () => {
        snapshotMock.mockResolvedValueOnce({nodes: [
            node({path: "manuscript/002-vol/002-ch/", title: "第二章", frontmatter: {chapter: "002-vol-002-ch"}, words: 30}),
            node({path: "manuscript/002-vol/001-ch/", title: "第一章", frontmatter: {chapter: "002-vol-001-ch"}, words: 20}),
            // 无 chapter 指针 → 跳过。
            node({path: "manuscript/002-vol/003-ch/", frontmatter: {}}),
            // lorebook 下即使有 chapter 指针也不算 Prose。
            node({path: "lorebook/character/hero/", frontmatter: {chapter: "hack"}}),
            // 空白指针 → 跳过。
            node({path: "manuscript/002-vol/004-ch/", frontmatter: {chapter: "   "}}),
            // 非内容节点文件 → 跳过。
            node({path: "manuscript/readme.md", isDirectory: false, contentNode: false, frontmatter: {chapter: "x"}}),
        ]});

        const result = await service.listChapterPointers();

        expect(result.map((item) => item.path)).toEqual([
            "manuscript/002-vol/001-ch",
            "manuscript/002-vol/002-ch",
        ]);
        expect(result[0]).toMatchObject({
            indexPath: "manuscript/002-vol/001-ch/index.md",
            chapterName: "002-vol-001-ch",
            title: "第一章",
            words: 20,
        });
        expect(snapshotMock).toHaveBeenCalledWith({
            target,
            fileIndex,
        });
    });

    it("findProseForChapter 只返回指向该章 name 的 Prose", async () => {
        snapshotMock.mockResolvedValue({nodes: [
            node({path: "manuscript/a/", frontmatter: {chapter: "ch-1"}}),
            node({path: "manuscript/b/", frontmatter: {chapter: "ch-2"}}),
            // 同章多份正文(草稿/重写版共存)。
            node({path: "manuscript/a-draft/", frontmatter: {chapter: "ch-1"}}),
        ]});

        const result = await service.findProseForChapter("ch-1");
        expect(result.map((item) => item.path)).toEqual(["manuscript/a", "manuscript/a-draft"]);
    });

    it("findOrphanPointers 挑出指向未注册 Chapter name 的 Prose", async () => {
        snapshotMock.mockResolvedValue({nodes: [
            node({path: "manuscript/a/", frontmatter: {chapter: "ch-1"}}),
            node({path: "manuscript/b/", frontmatter: {chapter: "ghost"}}),
        ]});

        const orphans = await service.findOrphanPointers(new Set(["ch-1"]));
        expect(orphans.map((item) => item.chapterName)).toEqual(["ghost"]);
    });
});

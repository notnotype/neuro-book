import {testAbsoluteFsPath, testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {homedir, tmpdir} from "node:os";
import path from "node:path";
import {mkdtemp, mkdir, rm, symlink} from "node:fs/promises";
import {afterEach, describe, expect, it} from "vitest";
import {
    absoluteFsPath,
    assertRealParentContained,
    assertRealPathContained,
    relativeFilePathInside,
    resolveContainedFilePath,
    resolveFilePath,
} from "nbook/server/runtime/paths/file-path";

describe("通用文件系统路径解析", () => {
    const root = absoluteFsPath(testHostPath("file-path-root"));
    const cleanupRoots: string[] = [];

    afterEach(async () => {
        await Promise.all(cleanupRoots.splice(0).map((entry) => rm(entry, {recursive: true, force: true})));
    });

    it("相对路径以明确物理根解析", () => {
        expect(resolveFilePath(root, "lorebook/hero/index.md"))
            .toBe(path.resolve(root, "lorebook", "hero", "index.md"));
    });

    it("绝对路径与HOME路径不依赖调用方cwd", () => {
        const absolute = path.resolve("reference", "workspace", "TERMS.md");
        expect(resolveFilePath(root, absolute)).toBe(absolute);
        expect(resolveFilePath(root, "~/notes.md")).toBe(path.resolve(homedir(), "notes.md"));
    });

    it("contained解析拒绝越过物理根", () => {
        expect(resolveContainedFilePath(root, "manuscript/chapter.md"))
            .toBe(path.resolve(root, "manuscript", "chapter.md"));
        expect(resolveContainedFilePath(root, "..draft/chapter.md"))
            .toBe(path.resolve(root, "..draft", "chapter.md"));
        expect(() => resolveContainedFilePath(root, "../outside.md"))
            .toThrow("越过文件系统根");
    });

    it("根内绝对目标转换为canonical相对路径", () => {
        expect(relativeFilePathInside(root, absoluteFsPath(path.join(root, "lorebook", "..", "manuscript", "001.md"))))
            .toBe("manuscript/001.md");
        expect(relativeFilePathInside(root, root)).toBe(".");
        expect(relativeFilePathInside(root, absoluteFsPath(path.resolve(root, "..", "outside.md")))).toBeNull();
    });

    it("拒绝把相对领域引用伪装为绝对路径", () => {
        expect(() => absoluteFsPath("workspace/project"))
            .toThrow("需要绝对文件系统路径");
    });

    it("真实路径检查拒绝通过symlink或junction逃逸", async () => {
        const fixture = await mkdtemp(testHostPath("nbook-file-path-"));
        cleanupRoots.push(fixture);
        const safeRoot = absoluteFsPath(path.join(fixture, "safe"));
        const outsideRoot = path.join(fixture, "outside");
        await mkdir(safeRoot, {recursive: true});
        await mkdir(outsideRoot, {recursive: true});
        await symlink(outsideRoot, path.join(safeRoot, "escape"), process.platform === "win32" ? "junction" : "dir");

        const escapedTarget = resolveContainedFilePath(safeRoot, "escape/new-file.md");
        await expect(assertRealPathContained(safeRoot, escapedTarget))
            .rejects.toThrow("真实路径越过文件系统根");
        const safeTarget = resolveContainedFilePath(safeRoot, "nested/new-file.md");
        await expect(assertRealPathContained(safeRoot, safeTarget)).resolves.toBeUndefined();
    });

    it("目录项操作只验证真实父目录，不跟随目标链接", async () => {
        const fixture = await mkdtemp(testHostPath("nbook-file-entry-"));
        cleanupRoots.push(fixture);
        const safeRoot = absoluteFsPath(path.join(fixture, "safe"));
        const outsideRoot = path.join(fixture, "outside");
        await mkdir(safeRoot, {recursive: true});
        await mkdir(outsideRoot, {recursive: true});
        const linkPath = absoluteFsPath(path.join(safeRoot, "outside-link"));
        await symlink(outsideRoot, linkPath, process.platform === "win32" ? "junction" : "dir");

        await expect(assertRealPathContained(safeRoot, linkPath)).rejects.toThrow("真实路径越过文件系统根");
        await expect(assertRealParentContained(safeRoot, linkPath)).resolves.toBeUndefined();
    });
});

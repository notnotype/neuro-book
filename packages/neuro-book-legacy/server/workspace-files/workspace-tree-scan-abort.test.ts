import fs from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import path from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {scanWorkspaceTree} from "nbook/server/workspace-files/workspace-files";

describe("scanWorkspaceTree 取消", () => {
    const tempRoots: string[] = [];

    afterEach(async () => {
        vi.restoreAllMocks();
        await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, {recursive: true, force: true})));
    });

    it("调用前已取消时抛出 signal.reason", async () => {
        const root = await createRoot();
        const controller = new AbortController();
        const reason = new Error("scan cancelled before start");
        controller.abort(reason);

        await expect(scanWorkspaceTree({
            root: absoluteFsPath(root),
            signal: controller.signal,
        })).rejects.toBe(reason);
    });

    it("显式 target 的 stat 同时取消与 ENOENT 时优先抛出取消原因", async () => {
        const root = await createRoot();
        const targetPath = path.join(root, "volatile.md");
        await fs.writeFile(targetPath, "temporary", "utf-8");
        const controller = new AbortController();
        const reason = new Error("scan cancelled during stat");
        const originalStat = fs.stat.bind(fs);
        vi.spyOn(fs, "stat").mockImplementation(async (filePath) => {
            if (path.resolve(String(filePath)) === path.resolve(targetPath)) {
                controller.abort(reason);
                const error = new Error("ENOENT: simulated stat race") as NodeJS.ErrnoException;
                error.code = "ENOENT";
                throw error;
            }
            return originalStat(filePath);
        });

        await expect(scanWorkspaceTree({
            root: absoluteFsPath(root),
            targets: ["volatile.md"],
            signal: controller.signal,
        })).rejects.toBe(reason);
    });

    it("frontmatter 读取同时取消时不会被宽 catch 降级为节点错误", async () => {
        const root = await createRoot();
        const targetPath = path.join(root, "chapter.md");
        await fs.writeFile(targetPath, "---\ntype: chapter\n---\n正文", "utf-8");
        const controller = new AbortController();
        const reason = new Error("scan cancelled during frontmatter read");
        const originalReadFile = fs.readFile.bind(fs);
        vi.spyOn(fs, "readFile").mockImplementation(async (filePath, options) => {
            if (path.resolve(String(filePath)) === path.resolve(targetPath)) {
                if (typeof options === "object" && options !== null && "signal" in options && options.signal) {
                    controller.abort(reason);
                    options.signal.throwIfAborted();
                }
                throw new Error("simulated read failure");
            }
            return originalReadFile(filePath, options);
        });

        await expect(scanWorkspaceTree({
            root: absoluteFsPath(root),
            targets: ["chapter.md"],
            signal: controller.signal,
        })).rejects.toBe(reason);
    });

    it("图标配置 readFile 接收同一个 AbortSignal 并停止扫描", async () => {
        const root = await createRoot();
        const configDirectory = path.join(root, ".nbook");
        const configPath = path.join(configDirectory, "icons.json");
        await fs.mkdir(configDirectory);
        await fs.writeFile(configPath, "{}", "utf-8");
        await fs.writeFile(path.join(root, "chapter.md"), "正文", "utf-8");
        const controller = new AbortController();
        const reason = new Error("scan cancelled by icon config read");
        const originalReadFile = fs.readFile.bind(fs);
        vi.spyOn(fs, "readFile").mockImplementation(async (filePath, options) => {
            if (path.resolve(String(filePath)) === path.resolve(configPath)) {
                if (typeof options === "object" && options !== null && "signal" in options && options.signal) {
                    controller.abort(reason);
                    options.signal.throwIfAborted();
                }
                return "{}";
            }
            return originalReadFile(filePath, options);
        });

        await expect(scanWorkspaceTree({
            root: absoluteFsPath(root),
            targets: ["chapter.md"],
            signal: controller.signal,
        })).rejects.toBe(reason);
    });

    it("ignore 规则 readFile 接收同一个 AbortSignal 并停止扫描", async () => {
        const root = await createRoot();
        const ignorePath = path.join(root, ".gitignore");
        await fs.writeFile(ignorePath, "ignored/\n", "utf-8");
        await fs.writeFile(path.join(root, "chapter.md"), "正文", "utf-8");
        const controller = new AbortController();
        const reason = new Error("scan cancelled by ignore read");
        const originalReadFile = fs.readFile.bind(fs);
        vi.spyOn(fs, "readFile").mockImplementation(async (filePath, options) => {
            if (path.resolve(String(filePath)) === path.resolve(ignorePath)) {
                if (typeof options === "object" && options !== null && "signal" in options && options.signal) {
                    controller.abort(reason);
                    options.signal.throwIfAborted();
                }
                return "ignored/\n";
            }
            return originalReadFile(filePath, options);
        });

        await expect(scanWorkspaceTree({
            root: absoluteFsPath(root),
            targets: ["chapter.md"],
            signal: controller.signal,
        })).rejects.toBe(reason);
    });

    it("递归 child 取消后停止访问后续 sibling", async () => {
        const root = await createRoot();
        const directoryPath = path.join(root, "manuscript");
        const firstPath = path.join(directoryPath, "a.md");
        const secondPath = path.join(directoryPath, "b.md");
        await fs.mkdir(directoryPath);
        await Promise.all([
            fs.writeFile(firstPath, "A", "utf-8"),
            fs.writeFile(secondPath, "B", "utf-8"),
        ]);
        const controller = new AbortController();
        const reason = new Error("scan cancelled in recursive child");
        const originalStat = fs.stat.bind(fs);
        let visitedSecond = false;
        vi.spyOn(fs, "stat").mockImplementation(async (filePath) => {
            const resolvedPath = path.resolve(String(filePath));
            if (resolvedPath === path.resolve(firstPath)) {
                controller.abort(reason);
                const error = new Error("ENOENT: simulated child race") as NodeJS.ErrnoException;
                error.code = "ENOENT";
                throw error;
            }
            if (resolvedPath === path.resolve(secondPath)) {
                visitedSecond = true;
            }
            return originalStat(filePath);
        });

        await expect(scanWorkspaceTree({
            root: absoluteFsPath(root),
            targets: ["manuscript"],
            signal: controller.signal,
        })).rejects.toBe(reason);
        expect(visitedSecond).toBe(false);
    });

    /** 创建隔离 Project Workspace 根。 */
    async function createRoot(): Promise<string> {
        const root = await fs.mkdtemp(testHostPath("nbook-tree-abort-"));
        tempRoots.push(root);
        return root;
    }
});

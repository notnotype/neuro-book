import fs from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import path from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {scanWorkspaceTree} from "nbook/server/workspace-files/workspace-files";

describe("scanWorkspaceTree 弱一致扫描", () => {
    const tempRoots: string[] = [];

    afterEach(async () => {
        vi.restoreAllMocks();
        await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, {recursive: true, force: true})));
    });

    it("子节点在 readdir 后消失时跳过该节点并保留其余文件", async () => {
        const root = await createRoot();
        const stablePath = path.join(root, "project.yaml");
        const volatilePath = path.join(root, ".nbook", "history.sqlite-shm");
        await write(stablePath, "kind: novel\ntitle: test\nsummary: ''\n");
        await write(volatilePath, "volatile");
        mockStatFailure(volatilePath, "ENOENT");

        const nodes = await scanWorkspaceTree({root: absoluteFsPath(root)});

        expect(nodes.map((node) => node.path)).toContain("project.yaml");
        expect(nodes.map((node) => node.path)).not.toContain(".nbook/history.sqlite-shm");
    });

    it("显式 target 在存在性检查后消失时返回空结果", async () => {
        const root = await createRoot();
        const volatilePath = path.join(root, "volatile.md");
        await write(volatilePath, "temporary");
        mockStatFailure(volatilePath, "ENOENT");

        await expect(scanWorkspaceTree({
            root: absoluteFsPath(root),
            targets: ["volatile.md"],
        })).resolves.toEqual([]);
    });

    it("非 ENOENT 的节点访问错误继续向调用方抛出", async () => {
        const root = await createRoot();
        const deniedPath = path.join(root, ".nbook", "history.sqlite-shm");
        await write(deniedPath, "denied");
        mockStatFailure(deniedPath, "EACCES");

        await expect(scanWorkspaceTree({root: absoluteFsPath(root)})).rejects.toMatchObject({code: "EACCES"});
    });

    it("显式 target 的 EACCES 不会被存在性检查伪装成缺失", async () => {
        const root = await createRoot();
        const deniedPath = path.join(root, "denied.md");
        await write(deniedPath, "denied");
        mockStatFailure(deniedPath, "EACCES");

        await expect(scanWorkspaceTree({
            root: absoluteFsPath(root),
            targets: ["denied.md"],
        })).rejects.toMatchObject({code: "EACCES"});
    });

    /** 创建隔离 Project Workspace 根。 */
    async function createRoot(): Promise<string> {
        const root = await fs.mkdtemp(testHostPath("nbook-tree-race-"));
        tempRoots.push(root);
        return root;
    }

    /** 写入测试文件并自动创建父目录。 */
    async function write(filePath: string, content: string): Promise<void> {
        await fs.mkdir(path.dirname(filePath), {recursive: true});
        await fs.writeFile(filePath, content, "utf-8");
    }

    /** 仅让目标路径的 stat 稳定失败，模拟目录枚举后的真实文件系统竞态。 */
    function mockStatFailure(targetPath: string, code: "ENOENT" | "EACCES"): void {
        const originalStat = fs.stat.bind(fs);
        vi.spyOn(fs, "stat").mockImplementation(async (filePath) => {
            if (path.resolve(String(filePath)) === path.resolve(targetPath)) {
                const error = new Error(`${code}: simulated stat failure`) as NodeJS.ErrnoException;
                error.code = code;
                throw error;
            }
            return originalStat(filePath);
        });
    }
});

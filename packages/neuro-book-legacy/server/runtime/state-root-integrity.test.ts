import {mkdir, mkdtemp, rm, symlink} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {inspectStateRootIntegrity, stateRootIntegrityFailed} from "nbook/server/runtime/state-root-integrity";

const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true}))));

describe("State Root integrity", () => {
    it("State Root等于Installation Root时不检查影子目录", async () => {
        const root = await fixtureRoot();
        const result = await inspectStateRootIntegrity({
            installationRoot: absoluteFsPath(root),
            stateRoot: absoluteFsPath(root),
        });

        expect(result.kind).toBe("same-state-root");
        expect(stateRootIntegrityFailed(result)).toBe(false);
    });

    it("Installation Root下没有workspace时返回clean", async () => {
        const root = await fixtureRoot();
        const stateRoot = path.join(root, "data");
        await mkdir(path.join(stateRoot, "workspace"), {recursive: true});

        const result = await inspectStateRootIntegrity({
            installationRoot: absoluteFsPath(root),
            stateRoot: absoluteFsPath(stateRoot),
        });

        expect(result.kind).toBe("clean");
    });

    it("两个真实workspace目录不同时报告数据分叉", async () => {
        const root = await fixtureRoot();
        const stateRoot = path.join(root, "data");
        await Promise.all([
            mkdir(path.join(root, "workspace"), {recursive: true}),
            mkdir(path.join(stateRoot, "workspace"), {recursive: true}),
        ]);

        const result = await inspectStateRootIntegrity({
            installationRoot: absoluteFsPath(root),
            stateRoot: absoluteFsPath(stateRoot),
        });

        expect(result).toMatchObject({kind: "shadow-workspace"});
        expect(stateRootIntegrityFailed(result)).toBe(true);
    });

    it("junction或symlink指向真实workspace时不误报", async () => {
        const root = await fixtureRoot();
        const stateRoot = path.join(root, "data");
        const expectedWorkspaceRoot = path.join(stateRoot, "workspace");
        await mkdir(expectedWorkspaceRoot, {recursive: true});
        await symlink(expectedWorkspaceRoot, path.join(root, "workspace"), process.platform === "win32" ? "junction" : "dir");

        const result = await inspectStateRootIntegrity({
            installationRoot: absoluteFsPath(root),
            stateRoot: absoluteFsPath(stateRoot),
        });

        expect(result).toMatchObject({kind: "same-target-link"});
        expect(stateRootIntegrityFailed(result)).toBe(false);
    });

    it("失效链接返回结构化检查错误", async () => {
        const root = await fixtureRoot();
        const stateRoot = path.join(root, "data");
        await mkdir(path.join(stateRoot, "workspace"), {recursive: true});
        await symlink(path.join(root, "missing-target"), path.join(root, "workspace"), process.platform === "win32" ? "junction" : "dir");

        const result = await inspectStateRootIntegrity({
            installationRoot: absoluteFsPath(root),
            stateRoot: absoluteFsPath(stateRoot),
        });

        expect(result).toMatchObject({kind: "inspection-error", operation: "realpath-checked", errorCode: "ENOENT"});
        expect(stateRootIntegrityFailed(result)).toBe(true);
    });
});

/** 创建隔离Installation Root。 */
async function fixtureRoot(): Promise<string> {
    const root = await mkdtemp(testHostPath("nbook-state-integrity-"));
    roots.push(root);
    return root;
}

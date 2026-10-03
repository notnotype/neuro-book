import {mkdir, mkdtemp, rm} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {join, resolve} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {getSystemWorkspaceAssetContextForTest, resolveApplicationRoot, resolveSystemNbookRoot, resolveSystemReferenceRoot, setSystemWorkspaceAssetContextForTest} from "nbook/server/workspace-files/system-workspace-assets";

const originalApplicationRoot = process.env.NEURO_BOOK_APPLICATION_ROOT;
const originalStateRoot = process.env.NEURO_BOOK_STATE_ROOT;
const originalProductImageRoot = process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT;
const roots: string[] = [];
const originalRuntimeAssetMode = process.env.NEURO_BOOK_RUNTIME_ASSET_MODE;

beforeEach(() => {
    delete process.env.NEURO_BOOK_APPLICATION_ROOT;
    delete process.env.NEURO_BOOK_STATE_ROOT;
    delete process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT;
    delete process.env.NEURO_BOOK_RUNTIME_ASSET_MODE;
});

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
    restoreEnv("NEURO_BOOK_APPLICATION_ROOT", originalApplicationRoot);
    restoreEnv("NEURO_BOOK_STATE_ROOT", originalStateRoot);
    restoreEnv("NEURO_BOOK_PRODUCT_IMAGE_ROOT", originalProductImageRoot);
    restoreEnv("NEURO_BOOK_RUNTIME_ASSET_MODE", originalRuntimeAssetMode);
});

function restoreEnv(name: string, value: string | undefined): void {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
}

describe("System Workspace assets", () => {
    it("显式 Runtime 安装模式只解析 State Root Reference，不读取 Seed 或 checkout 根", async () => {
        const root = await mkdtemp(testHostPath("nbook-runtime-reference-assets-"));
        roots.push(root);
        const applicationRoot = join(root, "application");
        const stateRoot = join(root, "state");
        const checkoutReferenceRoot = join(root, "reference");
        await mkdir(join(applicationRoot, "assets", "reference"), {recursive: true});
        await mkdir(checkoutReferenceRoot, {recursive: true});
        await mkdir(join(stateRoot, "workspace", ".nbook", "reference"), {recursive: true});
        process.env.NEURO_BOOK_APPLICATION_ROOT = applicationRoot;
        process.env.NEURO_BOOK_STATE_ROOT = stateRoot;
        process.env.NEURO_BOOK_RUNTIME_ASSET_MODE = "install";

        expect(resolveSystemReferenceRoot(root)).toBe(join(stateRoot, "workspace", ".nbook", "reference"));
        expect(resolveSystemReferenceRoot(root)).not.toBe(join(applicationRoot, "assets", "reference"));
        expect(resolveSystemReferenceRoot(root)).not.toBe(checkoutReferenceRoot);
    });

    it("显式 Runtime 安装模式忽略测试 Seed override 并解析 State Root Agent assets", async () => {
        const root = await mkdtemp(testHostPath("nbook-runtime-agent-assets-"));
        roots.push(root);
        const applicationRoot = join(root, "application");
        const stateRoot = join(root, "state");
        const seedRoot = join(root, "seed", "workspace", ".nbook");
        await mkdir(join(stateRoot, "workspace", ".nbook", "agent"), {recursive: true});
        await mkdir(seedRoot, {recursive: true});
        process.env.NEURO_BOOK_APPLICATION_ROOT = applicationRoot;
        process.env.NEURO_BOOK_STATE_ROOT = stateRoot;
        process.env.NEURO_BOOK_RUNTIME_ASSET_MODE = "install";
        const previous = getSystemWorkspaceAssetContextForTest();
        setSystemWorkspaceAssetContextForTest({applicationRoot, systemNbookRoot: seedRoot});
        try {
            expect(resolveSystemNbookRoot(root)).toBe(join(stateRoot, "workspace", ".nbook"));
        } finally {
            setSystemWorkspaceAssetContextForTest(previous);
        }
    });
    it("仓库编排根的遗留 assets 不会成为 Application Root", () => {
        const applicationRoot = resolve(import.meta.dirname, "../..");
        const repositoryRoot = resolve(applicationRoot, "../..");

        expect(resolveApplicationRoot(repositoryRoot)).toBe(applicationRoot);
    });
    it("无根node_modules时使用Product内已修补的系统模板", async () => {
        const root = await mkdtemp(testHostPath("nbook-product-assets-"));
        roots.push(root);
        await mkdir(join(root, "assets", "workspace", ".nbook"), {recursive: true});
        const productRoot = join(root, ".output", "server", "assets", "workspace", ".nbook");
        await mkdir(productRoot, {recursive: true});

        expect(resolveSystemNbookRoot(root)).toBe(productRoot);
    });

    it("源码Application Root存在node_modules时使用bundled系统模板", async () => {
        const root = await mkdtemp(testHostPath("nbook-source-assets-"));
        roots.push(root);
        const sourceRoot = join(root, "assets", "workspace", ".nbook");
        await mkdir(sourceRoot, {recursive: true});
        await mkdir(join(root, "node_modules"), {recursive: true});
        await mkdir(join(root, ".output", "server", "assets", "workspace", ".nbook"), {recursive: true});

        expect(resolveSystemNbookRoot(root)).toBe(sourceRoot);
    });
    it("源码和 Product Reference root 均不读取仓库根 reference", async () => {
        const root = await mkdtemp(testHostPath("nbook-reference-assets-"));
        roots.push(root);
        const sourceReferenceRoot = join(root, "assets", "reference");
        await mkdir(join(root, "assets", "workspace", ".nbook"), {recursive: true});
        await mkdir(sourceReferenceRoot, {recursive: true});
        await mkdir(join(root, "node_modules"), {recursive: true});
        const productReferenceRoot = join(root, ".output", "server", "assets", "reference");
        await mkdir(productReferenceRoot, {recursive: true});

        expect(resolveSystemReferenceRoot(root)).toBe(sourceReferenceRoot);
        await rm(join(root, "node_modules"), {recursive: true, force: true});
        expect(resolveSystemReferenceRoot(root)).toBe(productReferenceRoot);
    });
});

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";
import {importSingleFileTypeScriptConfig} from "nbook/server/world-engine/single-file-typescript-config-import";

describe("World Engine 单文件 runtime artifact cleanup", () => {
    const tempRoots: string[] = [];

    afterEach(async () => {
        vi.restoreAllMocks();
        await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, {recursive: true, force: true})));
    });

    it("新路径导入失败时保留源码旁旧 cache", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-world-engine-import-fail-"));
        tempRoots.push(root);
        const filePath = path.join(root, "world-engine", "calendar.ts");
        const oldCachePath = path.join(path.dirname(filePath), ".runtime-artifact-import-cache");
        await fs.mkdir(oldCachePath, {recursive: true});
        await fs.writeFile(path.join(oldCachePath, "legacy.mjs"), "export {};", "utf-8");
        await fs.writeFile(filePath, "throw new Error('import failed'); export default {};", "utf-8");

        await expect(importSingleFileTypeScriptConfig({
            filePath,
            label: "calendar",
            runtimeCacheRoot: path.join(root, ".nbook", "runtime-artifact-import-cache"),
        })).rejects.toThrow("import failed");

        await fs.access(oldCachePath);
    });

    it("旧 cache 首次清理失败时不阻断加载，同 hash 后续加载会重试", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-world-engine-cleanup-retry-"));
        tempRoots.push(root);
        const filePath = path.join(root, "world-engine", "calendar.ts");
        const oldCachePath = path.join(path.dirname(filePath), ".runtime-artifact-import-cache");
        await fs.mkdir(oldCachePath, {recursive: true});
        await fs.writeFile(path.join(oldCachePath, "legacy.mjs"), "export {};", "utf-8");
        await fs.writeFile(filePath, "export default {name: 'calendar'};", "utf-8");
        const originalRm = fs.rm.bind(fs);
        let cleanupAttempts = 0;
        vi.spyOn(fs, "rm").mockImplementation(async (target, options) => {
            if (String(target) === oldCachePath && cleanupAttempts === 0) {
                cleanupAttempts += 1;
                throw new Error("simulated EBUSY");
            }
            if (String(target) === oldCachePath) {
                cleanupAttempts += 1;
            }
            await originalRm(target, options);
        });
        const input = {
            filePath,
            label: "calendar" as const,
            runtimeCacheRoot: path.join(root, ".nbook", "runtime-artifact-import-cache"),
        };

        await expect(importSingleFileTypeScriptConfig(input)).resolves.toMatchObject({default: {name: "calendar"}});
        await fs.access(oldCachePath);

        await expect(importSingleFileTypeScriptConfig(input)).resolves.toMatchObject({default: {name: "calendar"}});
        await expect(fs.access(oldCachePath)).rejects.toThrow();
        expect(cleanupAttempts).toBe(2);
    });

    it("staging 写入部分内容后失败时清理文件并保留原始 I/O 错误", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-world-engine-write-fail-"));
        tempRoots.push(root);
        const filePath = path.join(root, "world-engine", "calendar.ts");
        const runtimeCacheRoot = path.join(root, ".nbook", "runtime-artifact-import-cache");
        const stagingRoot = path.join(runtimeCacheRoot, ".staging");
        await fs.mkdir(path.dirname(filePath), {recursive: true});
        await fs.writeFile(filePath, "export default {name: 'calendar'};", "utf-8");

        const originalWriteFile = fs.writeFile.bind(fs);
        const writeError = new Error("simulated staging write failure");
        vi.spyOn(fs, "writeFile").mockImplementation(async (target, data, options) => {
            if (path.dirname(String(target)) === stagingRoot) {
                await originalWriteFile(target, String(data).slice(0, 8), options);
                throw writeError;
            }
            await originalWriteFile(target, data, options);
        });

        await expect(importSingleFileTypeScriptConfig({
            filePath,
            label: "calendar",
            runtimeCacheRoot,
        })).rejects.toBe(writeError);

        const remaining = await fs.readdir(stagingRoot).catch(() => []);
        expect(remaining.filter((name) => name.startsWith(".world-engine-calendar-"))).toEqual([]);
    });

    it("Product candidate 在没有根 node_modules 时内联 Zod 与 World Engine helper", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-world-engine-product-authoring-"));
        tempRoots.push(root);
        const outputRoot = path.join(root, ".output");
        const serverRoot = path.join(outputRoot, "server");
        const authoringRoot = path.join(serverRoot, "authoring");
        const schemaPath = path.join(root, "world-engine", "schema", "index.ts");
        await fs.mkdir(path.join(authoringRoot, "nbook", "world-engine", "schema"), {recursive: true});
        await fs.mkdir(path.dirname(schemaPath), {recursive: true});
        await fs.writeFile(path.join(serverRoot, "index.mjs"), "export {};", "utf8");
        await fs.writeFile(path.join(serverRoot, "package.json"), '{"name":"neuro-book-output"}', "utf8");
        await fs.writeFile(path.join(authoringRoot, "package.json"), '{"name":"authoring-kit"}', "utf8");
        await fs.writeFile(path.join(authoringRoot, "tsconfig.json"), "{}", "utf8");
        await fs.writeFile(path.join(authoringRoot, "profile-compile-worker.mjs"), "export {};", "utf8");
        await fs.writeFile(
            path.join(authoringRoot, "nbook", "world-engine", "schema", "index.mjs"),
            "export const Ref = (name) => `ref:${name}`;",
            "utf8",
        );
        await fs.writeFile(
            path.join(authoringRoot, "nbook", "world-engine", "zod.mjs"),
            "export const z = {object: (shape) => ({kind: 'object', shape}), string: () => ({kind: 'string'})};",
            "utf8",
        );
        await fs.writeFile(
            schemaPath,
            [
                'import {z} from "zod";',
                'import {Ref} from "nbook/world-engine/schema";',
                'export default {character: z.object({name: z.string(), mentor: Ref("character")})};',
            ].join("\n"),
            "utf8",
        );
        const compilerContext = {
            kind: "product-candidate" as const,
            productRuntime: true as const,
            imageRoot: outputRoot,
            root,
            outputRoot: serverRoot,
            nbookRoot: path.join(authoringRoot, "nbook"),
            compilerPackageRoot: path.join(authoringRoot, "package.json"),
            compilerNodeModulesRoot: path.join(authoringRoot, "node_modules"),
            artifactRuntimeRequireRoot: path.join(serverRoot, "index.mjs"),
            tsconfigPath: path.join(authoringRoot, "tsconfig.json"),
        };

        const imported = await importSingleFileTypeScriptConfig<{default: {character: {kind: string}}}>({
            filePath: schemaPath,
            label: "schema",
            runtimeCacheRoot: path.join(root, ".nbook", "runtime-artifact-import-cache"),
            compilerContext,
        });
        expect(imported.default.character.kind).toBe("object");
        const cacheEntries = await fs.readdir(path.join(root, ".nbook", "runtime-artifact-import-cache", "world-engine-schema"));
        expect(cacheEntries).toHaveLength(1);
        expect(cacheEntries[0]).toMatch(/^[0-9a-f]{64}\.mjs$/u);
        await expect(fs.access(path.join(root, "node_modules"))).rejects.toThrow();
    });

    it("World Engine 配置拒绝未登记裸包", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-world-engine-package-policy-"));
        tempRoots.push(root);
        const filePath = path.join(root, "world-engine", "calendar.ts");
        await fs.mkdir(path.dirname(filePath), {recursive: true});
        await fs.writeFile(filePath, 'import value from "left-pad"; export default value;', "utf8");
        await expect(importSingleFileTypeScriptConfig({
            filePath,
            label: "calendar",
            runtimeCacheRoot: path.join(root, ".nbook", "runtime-artifact-import-cache"),
        })).rejects.toThrow("left-pad");
    });
});

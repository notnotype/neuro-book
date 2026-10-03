import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {assetResolver, AssetResolver} from "nbook/server/assets/asset-resolver";
import {createRuntimePaths} from "nbook/server/runtime/paths/runtime-paths";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";

const originalApplicationRoot = process.env.NEURO_BOOK_APPLICATION_ROOT;
const originalStateRoot = process.env.NEURO_BOOK_STATE_ROOT;
const originalCwd = process.cwd();
const roots: string[] = [];

afterEach(async () => {
    process.chdir(originalCwd);
    restoreEnv("NEURO_BOOK_APPLICATION_ROOT", originalApplicationRoot);
    restoreEnv("NEURO_BOOK_STATE_ROOT", originalStateRoot);
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("AssetResolver runtime roots", () => {
    it("cwd 在 Application Root 外时仍从 Runtime Paths 解析 system/user assets", async () => {
        const root = await mkdtemp(testHostPath("nbook-asset-resolver-runtime-"));
        roots.push(root);
        const applicationRoot = path.join(root, "application");
        const stateRoot = path.join(root, "state");
        const outsideRoot = path.join(root, "outside");
        const systemRoot = path.join(applicationRoot, "assets", "workspace", ".nbook");
        const userRoot = path.join(stateRoot, "workspace", ".nbook");
        const relativePath = path.join("agent", "writing-presets", "styles", "runtime-style.md");
        const systemPath = path.join(systemRoot, relativePath);
        const userPath = path.join(userRoot, relativePath);

        await mkdir(path.dirname(systemPath), {recursive: true});
        await mkdir(path.dirname(userPath), {recursive: true});
        await mkdir(outsideRoot, {recursive: true});
        await writeFile(systemPath, "system", "utf8");
        await writeFile(userPath, "user", "utf8");
        process.env.NEURO_BOOK_APPLICATION_ROOT = applicationRoot;
        process.env.NEURO_BOOK_STATE_ROOT = stateRoot;
        process.chdir(outsideRoot);

        expect(assetResolver.systemRoot).toBe(systemRoot);
        expect(assetResolver.userRoot).toBe(userRoot);
        expect(assetResolver.resolveFileSync(relativePath)).toEqual({
            absolutePath: userPath,
            relativePath: relativePath.replaceAll(path.sep, "/"),
            source: "user",
        });

        await rm(userPath);
        expect(assetResolver.resolveFileSync(relativePath)).toEqual({
            absolutePath: systemPath,
            relativePath: relativePath.replaceAll(path.sep, "/"),
            source: "system",
        });
    });
    it("显式 RuntimePaths 时 system assets 只读 State Root `.nbook`", async () => {
        const root = await mkdtemp(testHostPath("nbook-asset-resolver-install-root-"));
        roots.push(root);
        const applicationRoot = path.join(root, "application");
        const stateRoot = path.join(root, "state");
        const runtimePaths = createRuntimePaths({applicationRoot: absoluteFsPath(applicationRoot), stateRoot: absoluteFsPath(stateRoot)});
        const systemRoot = path.join(stateRoot, "workspace", ".nbook");
        const relativePath = path.join("agent", "skills", "installed", "skill.md");
        const systemPath = path.join(systemRoot, relativePath);
        await mkdir(path.dirname(systemPath), {recursive: true});
        await writeFile(systemPath, "installed", "utf8");

        const resolver = new AssetResolver(undefined, runtimePaths);
        expect(resolver.systemRoot).toBe(systemRoot);
        await expect(resolver.readFile(relativePath)).resolves.toBe("installed");
    });
});

function restoreEnv(name: "NEURO_BOOK_APPLICATION_ROOT" | "NEURO_BOOK_STATE_ROOT", value: string | undefined): void {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
}

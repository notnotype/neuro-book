import {createHash, randomUUID} from "node:crypto";
import {access, mkdir, readFile, rm, utimes, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {setTimeout as sleep} from "node:timers/promises";
import {afterEach, describe, expect, it, vi} from "vitest";

const faults = vi.hoisted(() => ({
    failArtifactCopy: false,
    failManifestRename: false,
    mutateOnArtifactCopy: null as null | (() => Promise<void>),
    manifestRenameBarrier: null as null | (() => Promise<void>),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs/promises")>();
    return {
        ...actual,
        copyFile: async (...args: Parameters<typeof actual.copyFile>) => {
            const target = String(args[1]).replaceAll("\\", "/");
            if (faults.failArtifactCopy && target.includes("/.compiled/artifacts/")) {
                throw Object.assign(new Error("injected variable artifact copy failure"), {code: "EIO"});
            }
            const result = await actual.copyFile(...args);
            if (faults.mutateOnArtifactCopy && target.includes("/.compiled/artifacts/")) {
                const mutate = faults.mutateOnArtifactCopy;
                faults.mutateOnArtifactCopy = null;
                await mutate();
            }
            return result;
        },
        rename: async (...args: Parameters<typeof actual.rename>) => {
            const target = String(args[1]).replaceAll("\\", "/");
            if (target.endsWith("/.compiled/manifest.json")) {
                if (faults.manifestRenameBarrier) await faults.manifestRenameBarrier();
                if (faults.failManifestRename) {
                    throw Object.assign(new Error("injected variable manifest rename failure"), {code: "EIO"});
                }
            }
            return await actual.rename(...args);
        },
    };
});

import {
    compileVariableDefinitions,
    readVariableDefinitionManifest,
    VARIABLE_DEFINITION_ORPHAN_MIN_AGE_MS,
} from "nbook/server/agent/variables/definition-artifact";

const roots: string[] = [];

afterEach(async () => {
    faults.failArtifactCopy = false;
    faults.failManifestRename = false;
    faults.mutateOnArtifactCopy = null;
    faults.manifestRenameBarrier = null;
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Variable definition 原子发布", () => {
    it("artifact复制失败时保留完整旧manifest与旧artifact", async () => {
        const fixture = await createFixture("copy-old");
        const before = await generation(fixture.root);
        await writeDefinition(fixture.root, "copy-new");
        faults.failArtifactCopy = true;

        await expect(compileVariableDefinitions({definitionRoot: fixture.root})).rejects.toThrow("injected variable artifact copy failure");

        expect(await generation(fixture.root)).toEqual(before);
    });

    it("manifest rename失败时保留完整旧代", async () => {
        const fixture = await createFixture("rename-old");
        const before = await generation(fixture.root);
        await writeDefinition(fixture.root, "rename-new");
        faults.failManifestRename = true;

        await expect(compileVariableDefinitions({definitionRoot: fixture.root})).rejects.toThrow("injected variable manifest rename failure");

        expect(await generation(fixture.root)).toEqual(before);
    });

    it("artifact安装期间源码变化时放弃manifest翻转", async () => {
        const fixture = await createFixture("source-old");
        const before = await generation(fixture.root);
        await writeDefinition(fixture.root, "source-candidate");
        faults.mutateOnArtifactCopy = async () => await writeDefinition(fixture.root, "source-mutated");

        await expect(compileVariableDefinitions({definitionRoot: fixture.root})).rejects.toThrow("发布期间源码发生变化");

        expect(await generation(fixture.root)).toEqual(before);
    });

    it("并发reader跨manifest翻转只能观察完整旧代或新代", async () => {
        const fixture = await createFixture("reader-old");
        const before = await generation(fixture.root);
        await writeDefinition(fixture.root, "reader-new");
        let releaseRename!: () => void;
        let enteredRename!: () => void;
        const entered = new Promise<void>((resolvePromise) => { enteredRename = resolvePromise; });
        const blocked = new Promise<void>((resolvePromise) => { releaseRename = resolvePromise; });
        faults.manifestRenameBarrier = async () => {
            enteredRename();
            await blocked;
        };
        const publish = compileVariableDefinitions({definitionRoot: fixture.root});
        await entered;

        const observed = [await generation(fixture.root)];
        releaseRename();
        await publish;
        observed.push(await generation(fixture.root));

        const after = observed[1]!;
        expect(after.manifest).not.toBe(before.manifest);
        expect(new Set(observed.map((item) => item.manifest))).toEqual(new Set([before.manifest, after.manifest]));
        expect(observed.every((item) => item.artifactSha256 === sha256(item.artifact))).toBe(true);
    });

    it("旧代长期被引用后从manifest退休仍为并发reader保留10分钟", async () => {
        const fixture = await createFixture("retired-old");
        const oldManifest = await readVariableDefinitionManifest(fixture.root);
        const oldItem = oldManifest.definitions[0]!;
        const oldPaths = [oldItem.artifactFileName, oldItem.typeFileName]
            .filter((path): path is string => Boolean(path))
            .map((path) => resolve(fixture.root, ".compiled", ...path.split("/")));
        const oldTime = (Date.now() - VARIABLE_DEFINITION_ORPHAN_MIN_AGE_MS - 60_000) / 1_000;
        await Promise.all(oldPaths.map((path) => utimes(path, oldTime, oldTime)));
        await writeDefinition(fixture.root, "retired-new");

        await compileVariableDefinitions({definitionRoot: fixture.root});

        await Promise.all(oldPaths.map((path) => access(path)));
        expect((await readVariableDefinitionManifest(fixture.root)).definitions[0]?.artifactFileName)
            .not.toBe(oldItem.artifactFileName);

        await Promise.all(oldPaths.map((path) => utimes(path, oldTime, oldTime)));
        await writeDefinition(fixture.root, "retired-next");
        await compileVariableDefinitions({definitionRoot: fixture.root});

        await Promise.all(oldPaths.map(async (path) => {
            await expect(access(path)).rejects.toMatchObject({code: "ENOENT"});
        }));
    });

    it("两个并发publisher最终收敛到一份完整可读代次", async () => {
        const fixture = await createFixture("publisher-old");
        await writeDefinition(fixture.root, "publisher-new");

        await Promise.all([
            compileVariableDefinitions({definitionRoot: fixture.root}),
            compileVariableDefinitions({definitionRoot: fixture.root}),
        ]);

        const final = await generation(fixture.root);
        expect(final.artifactSha256).toBe(sha256(final.artifact));
        expect(final.manifest).toContain("publisher-new");
    }, 15_000);
});

async function createFixture(key: string): Promise<{root: string}> {
    const root = resolve(".agent", "tmp", "variable-publish-test", randomUUID());
    roots.push(root);
    await mkdir(root, {recursive: true});
    await writeDefinition(root, key);
    await compileVariableDefinitions({definitionRoot: root});
    return {root};
}

async function writeDefinition(root: string, key: string): Promise<void> {
    await writeFile(resolve(root, "definitions.ts"), [
        "import {Type, defineWorkspaceRootVariable} from \"nbook/variable-sdk\";",
        "export const definitions = [defineWorkspaceRootVariable({",
        `    key: ${JSON.stringify(key)},`,
        "    schema: Type.String(),",
        "})];",
        "export default definitions;",
        "",
    ].join("\n"), "utf8");
}

async function generation(root: string): Promise<{manifest: string; artifact: string; artifactSha256: string}> {
    const manifestText = await readFile(resolve(root, ".compiled", "manifest.json"), "utf8");
    const manifest = await readVariableDefinitionManifest(root);
    const item = manifest.definitions[0]!;
    return {
        manifest: manifestText,
        artifact: await readFile(resolve(root, ".compiled", ...item.artifactFileName.split("/")), "utf8"),
        artifactSha256: item.artifactSha256,
    };
}

function sha256(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

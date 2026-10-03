import {access, mkdir, mkdtemp, rm, unlink, writeFile} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {dirname, join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {PROFILE_ARTIFACT_COMPILER_VERSION} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {VARIABLE_DEFINITION_COMPILER_VERSION} from "nbook/server/agent/variables/definition-artifact";
import {SystemAssetsProjection} from "nbook/server/workspace-files/system-assets-projection";
import {resolveSystemNbookRoot} from "nbook/server/workspace-files/system-workspace-assets";
import {SHARED_SNAPSHOT_BYTE_BUDGET} from "nbook/server/workspace-files/test-workspace-fixture";

const scratchRoots: string[] = [];
const projection = new SystemAssetsProjection();

afterEach(async () => {
    await Promise.all(scratchRoots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

/** 创建一组来源和目标路径，目标默认不存在。 */
async function projectionRoots(): Promise<{container: string; source: string; target: string}> {
    const container = await mkdtemp(testHostPath("nbook-system-assets-projection-"));
    scratchRoots.push(container);
    const source = join(container, "source");
    await mkdir(source, {recursive: true});
    return {container, source, target: join(container, "target")};
}

/** 写入一项测试资产，并自动创建父目录。 */
async function writeAsset(root: string, relativePath: string, content: string = relativePath): Promise<void> {
    const filePath = join(root, ...relativePath.split("/"));
    await mkdir(dirname(filePath), {recursive: true});
    await writeFile(filePath, content, "utf8");
}

/** 写入同时包含 Profile 与 Variable current 引用的最小合法 system assets。 */
async function seedCurrentArtifacts(source: string): Promise<void> {
    await writeAsset(source, "agent/profiles/builtin/writer.profile.tsx", "export default {};\n");
    await writeAsset(source, "agent/profiles/.compiled/artifacts/current.mjs", "export default {};\n");
    await writeAsset(source, "agent/profiles/.compiled/artifacts/current.types.d.ts", "export {};\n");
    await writeAsset(source, "agent/profiles/.compiled/artifacts/orphan.mjs", "export const orphan = true;\n");
    await writeAsset(source, "agent/profiles/.compiled/flat-orphan.mjs", "export const orphan = true;\n");
    await writeAsset(source, "agent/profiles/.compiled/.publish.lock/owner.json", "{}\n");
    await writeAsset(source, "agent/profiles/.compiled/manifest.json", `${JSON.stringify({
        compilerVersion: PROFILE_ARTIFACT_COMPILER_VERSION,
        generatedAt: "2026-01-01T00:00:00.000Z",
        profilesRoot: "agent/profiles",
        profiles: {
            writer: {
                status: "loaded",
                fileName: "builtin/writer.profile.tsx",
                profileKey: "writer",
                sourceSha256: "source",
                sourceBytes: 19,
                dependencyHash: "dependencies",
                artifactFileName: "artifacts/current.mjs",
                artifactSha: "artifact",
                artifactBytes: 19,
                typeFileName: "artifacts/current.types.d.ts",
                typeSha: "types",
                typeBytes: 11,
                dependencies: [],
            },
        },
    }, null, 4)}\n`);

    await writeAsset(source, "agent/variables/definitions.ts", "export const definitions = [];\n");
    await writeAsset(source, "agent/variables/.compiled/definitions.mjs", "export const definitions = [];\n");
    await writeAsset(source, "agent/variables/.compiled/definitions.types.d.ts", "export {};\n");
    await writeAsset(source, "agent/variables/.compiled/orphan.mjs", "export const orphan = true;\n");
    await writeAsset(source, "agent/variables/.compiled/manifest.json", `${JSON.stringify({
        compilerVersion: VARIABLE_DEFINITION_COMPILER_VERSION,
        generatedAt: "2026-01-01T00:00:00.000Z",
        definitionsRoot: "agent/variables",
        definitions: [{
            fileName: "definitions.ts",
            sourceSha256: "source",
            sourceBytes: 31,
            dependencyHash: "dependencies",
            artifactFileName: "definitions.mjs",
            artifactSha256: "artifact",
            artifactBytes: 31,
            typeFileName: "definitions.types.d.ts",
            typeSha256: "types",
            typeBytes: 11,
            registeredPaths: [],
            dependencies: [],
        }],
    }, null, 4)}\n`);
}

/** 断言投影目标里不存在指定相对路径。 */
async function expectMissing(root: string, relativePath: string): Promise<void> {
    await expect(access(join(root, ...relativePath.split("/")))).rejects.toMatchObject({code: "ENOENT"});
}

/** Bun 与 Node 对成功 access 的返回值不同；这里只验证调用没有抛错。 */
async function expectExists(root: string, relativePath: string): Promise<void> {
    await access(join(root, ...relativePath.split("/")));
}

describe("SystemAssetsProjection", () => {
    it("只复制静态源码与 manifest current，并排除所有已知生成物", async () => {
        const {source, target} = await projectionRoots();
        await seedCurrentArtifacts(source);
        await writeAsset(source, "agent/.staging/profile-build/work.mjs");
        await writeAsset(source, "agent/skills/demo/SKILL.md", "# Demo\n");
        await writeAsset(source, "agent/skills/demo/node_modules/pkg/index.js");
        await writeAsset(source, "agent/.runtime-artifact-import-cache/profile/cache.mjs");
        await writeAsset(source, "agent/runtime-artifact-import-cache/profile/cache.mjs");
        await writeAsset(source, "server/runtime.ts", "export {};\n");
        await writeAsset(source, "server/.agent/private.log");
        await writeAsset(source, "vitepress/.vitepress/config.ts", "export default {};\n");
        await writeAsset(source, "vitepress/.vitepress/theme/index.ts", "export {};\n");
        await writeAsset(source, "vitepress/.vitepress/cache/cache.bin");
        await writeAsset(source, "vitepress/.vitepress/dist/index.html");
        await writeAsset(source, "vitepress/.vitepress/staged/index.md", "# staged\n");
        await writeAsset(source, "unmanaged/.compiled/generated.mjs");

        const result = await projection.copyToEmpty({sourceRoot: source, targetRoot: target});

        await expectExists(target, "agent/profiles/builtin/writer.profile.tsx");
        await expectExists(target, "agent/profiles/.compiled/artifacts/current.mjs");
        await expectExists(target, "agent/variables/.compiled/definitions.mjs");
        await expectExists(target, "agent/skills/demo/SKILL.md");
        await expectExists(target, "server/runtime.ts");
        await expectExists(target, "vitepress/.vitepress/config.ts");
        await expectExists(target, "vitepress/.vitepress/theme/index.ts");

        for (const excluded of [
            "agent/profiles/.compiled/artifacts/orphan.mjs",
            "agent/profiles/.compiled/flat-orphan.mjs",
            "agent/profiles/.compiled/.publish.lock",
            "agent/variables/.compiled/orphan.mjs",
            "agent/.staging",
            "agent/skills/demo/node_modules",
            "agent/.runtime-artifact-import-cache",
            "agent/runtime-artifact-import-cache",
            "server/.agent",
            "vitepress/.vitepress/cache",
            "vitepress/.vitepress/dist",
            "vitepress/.vitepress/staged",
            "unmanaged/.compiled",
        ]) {
            await expectMissing(target, excluded);
        }
        expect(result.verification.profileArtifacts).toEqual({
            expected: ["artifacts/current.mjs", "artifacts/current.types.d.ts"],
            actual: ["artifacts/current.mjs", "artifacts/current.types.d.ts"],
        });
        expect(result.verification.variableArtifacts).toEqual({
            expected: ["definitions.mjs", "definitions.types.d.ts"],
            actual: ["definitions.mjs", "definitions.types.d.ts"],
        });
        expect(result.inventory.fileCount).toBeGreaterThan(0);
    });

    it("拒绝覆盖非空目标，并在投影被篡改后 fail closed", async () => {
        const {source, target} = await projectionRoots();
        await seedCurrentArtifacts(source);
        await mkdir(target, {recursive: true});
        await writeAsset(target, "sentinel.txt", "keep\n");
        await expect(projection.copyToEmpty({sourceRoot: source, targetRoot: target})).rejects.toThrow("目标不是空目录");

        await rm(target, {recursive: true, force: true});
        await projection.copyToEmpty({sourceRoot: source, targetRoot: target});
        await writeAsset(target, "agent/profiles/.compiled/artifacts/injected.mjs");
        await expect(projection.verify(target)).rejects.toThrow("orphan：artifacts/injected.mjs");

        await unlink(join(target, "agent", "profiles", ".compiled", "artifacts", "injected.mjs"));
        await unlink(join(target, "agent", "profiles", ".compiled", "artifacts", "current.mjs"));
        await expect(projection.verify(target)).rejects.toThrow("缺失：artifacts/current.mjs");
    });

    it("Product 空目标投影排除两类 compiled artifact 与 manifest", async () => {
        const {source, target} = await projectionRoots();
        await seedCurrentArtifacts(source);

        const result = await projection.copyToEmpty({
            sourceRoot: source,
            targetRoot: target,
            compiledArtifactMode: "exclude",
        });

        await expectExists(target, "agent/profiles/builtin/writer.profile.tsx");
        await expectExists(target, "agent/variables/definitions.ts");
        await expectMissing(target, "agent/profiles/.compiled");
        await expectMissing(target, "agent/variables/.compiled");
        expect(result.inventory.profileArtifacts).toEqual([]);
        expect(result.inventory.variableArtifacts).toEqual([]);
        expect(result.verification.profileArtifacts).toEqual({expected: [], actual: []});
        expect(result.verification.variableArtifacts).toEqual({expected: [], actual: []});
    });

    it("拒绝 manifest 使用逃离 compiled root 的 artifact 路径", async () => {
        const {source} = await projectionRoots();
        await writeAsset(source, "agent/profiles/.compiled/manifest.json", `${JSON.stringify({
            compilerVersion: PROFILE_ARTIFACT_COMPILER_VERSION,
            generatedAt: "2026-01-01T00:00:00.000Z",
            profilesRoot: "agent/profiles",
            profiles: {
                writer: {
                    status: "loaded",
                    fileName: "writer.profile.tsx",
                    profileKey: "writer",
                    sourceSha256: "source",
                    sourceBytes: 1,
                    dependencyHash: "dependencies",
                    artifactFileName: "artifacts/../../outside.mjs",
                    artifactSha: "artifact",
                    artifactBytes: 1,
                    dependencies: [],
                },
            },
        })}\n`);

        await expect(projection.inventory(source)).rejects.toThrow("非法 artifact 路径");
    });

    it("真实 system assets 的 current-only inventory 落在共享快照预算内", async () => {
        const inventory = await projection.inventory(resolveSystemNbookRoot());
        expect(inventory.profileArtifacts.length).toBeGreaterThan(0);
        expect(inventory.bytes).toBeLessThan(SHARED_SNAPSHOT_BYTE_BUDGET);
    });
});

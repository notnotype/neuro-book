import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {randomUUID} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {compileProfileArtifacts, resolveProfileArtifactPathContext} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {compileVariableDefinitions, resolveVariableDefinitionArtifactPathContext} from "nbook/server/agent/variables/definition-artifact";
import {prepareSystemAssets} from "nbook/server/workspace-files/system-assets-preflight";

describe("Product system assets preflight", () => {
    const originalApplicationRoot = process.env.NEURO_BOOK_APPLICATION_ROOT;
    const originalStateRoot = process.env.NEURO_BOOK_STATE_ROOT;
    const originalProductImageRoot = process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT;
    const originalProductBuild = process.env.NEURO_BOOK_PRODUCT_BUILD;

    afterEach(() => {
        restoreEnv("NEURO_BOOK_APPLICATION_ROOT", originalApplicationRoot);
        restoreEnv("NEURO_BOOK_STATE_ROOT", originalStateRoot);
        restoreEnv("NEURO_BOOK_PRODUCT_IMAGE_ROOT", originalProductImageRoot);
        restoreEnv("NEURO_BOOK_PRODUCT_BUILD", originalProductBuild);
    });

    it("只读 Product Root 的新鲜 system assets 零写入，过期时明确拒绝", async () => {
        const root = testHostPath("tmp", "system-assets-preflight-test", randomUUID());
        const applicationRoot = join(root, "product");
        const stateRoot = join(root, "state");
        const systemNbookRoot = join(applicationRoot, ".output", "server", "assets", "workspace", ".nbook");
        const profileRoot = join(systemNbookRoot, "agent", "profiles");
        const variableRoot = join(systemNbookRoot, "agent", "variables");
        const profilePath = join(profileRoot, "builtin", "readonly.profile.mjs");
        const variablePath = join(variableRoot, "definitions.ts");
        await mkdir(join(applicationRoot, ".output", "server", "authoring"), {recursive: true});
        await Promise.all([
            mkdir(join(profileRoot, "builtin"), {recursive: true}),
            mkdir(variableRoot, {recursive: true}),
            mkdir(stateRoot, {recursive: true}),
            writeFile(join(applicationRoot, "package.json"), '{"name":"neuro-book-product","type":"module"}\n', "utf8"),
            writeFile(join(applicationRoot, ".output", "server", "package.json"), '{"name":"neuro-book-output","type":"module"}\n', "utf8"),
            writeFile(join(applicationRoot, ".output", "server", "index.mjs"), "", "utf8"),
            writeFile(join(applicationRoot, ".output", "server", "authoring", "package.json"), '{"name":"@notnotype/neuro-book-profile-authoring-kit","private":true,"type":"module"}\n', "utf8"),
            writeFile(join(applicationRoot, ".output", "server", "authoring", "tsconfig.json"), "{}\n", "utf8"),
            writeFile(join(applicationRoot, ".output", "server", "authoring", "profile-compile-worker.mjs"), "export {};\n", "utf8"),
        ]);
        await writeFile(profilePath, [
            "export default {",
            "    manifest: {key: 'builtin.readonly', name: 'Readonly'},",
            "    initialSchema: {type: 'object', properties: {}},",
            "    outputSchema: {type: 'object', properties: {}},",
            "    tools: {},",
            "    rootToolKeys: [],",
            "    prepare() { return {systemPrompt: 'readonly'}; },",
            "};",
            "",
        ].join("\n"), "utf8");
        await writeFile(variablePath, [
            "export const definitions = [{",
            "    namespace: 'global',",
            "    key: 'readonlyMarker',",
            "    schema: {type: 'string'},",
            "}];",
            "export default definitions;",
            "",
        ].join("\n"), "utf8");

        try {
            process.env.NEURO_BOOK_APPLICATION_ROOT = applicationRoot;
            process.env.NEURO_BOOK_STATE_ROOT = stateRoot;
            process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT = join(applicationRoot, ".output");
            process.env.NEURO_BOOK_PRODUCT_BUILD = "1";
            const variableArtifactPathContext = await resolveVariableDefinitionArtifactPathContext(
                variableRoot,
                "assets/workspace/.nbook/agent/variables",
                applicationRoot,
            );
            const profileArtifactPathContext = await resolveProfileArtifactPathContext(
                profileRoot,
                "assets/workspace/.nbook/agent/profiles",
                applicationRoot,
            );
            await compileVariableDefinitions({
                definitionRoot: variableRoot,
                artifactPathContext: variableArtifactPathContext,
            });
            await compileProfileArtifacts({
                profileRoot,
                artifactPathContext: profileArtifactPathContext,
            });
            await rm(join(systemNbookRoot, "agent", ".staging"), {recursive: true, force: true});
            const variableManifestPath = join(variableRoot, ".compiled", "manifest.json");
            const profileManifestPath = join(profileRoot, ".compiled", "manifest.json");
            const [variableManifest, profileManifest] = await Promise.all([
                readFile(variableManifestPath, "utf8"),
                readFile(profileManifestPath, "utf8"),
            ]);

            process.env.NEURO_BOOK_APPLICATION_ROOT = applicationRoot;
            process.env.NEURO_BOOK_STATE_ROOT = stateRoot;
            const result = await prepareSystemAssets();

            expect(result.variableManifest.definitions).toHaveLength(1);
            expect(result.profileResult.compiled).toEqual([]);
            await expect(readFile(join(systemNbookRoot, "agent", ".staging"), "utf8")).rejects.toThrow();
            expect(await readFile(variableManifestPath, "utf8")).toBe(variableManifest);
            expect(await readFile(profileManifestPath, "utf8")).toBe(profileManifest);

            await writeFile(profilePath, (await readFile(profilePath, "utf8")).replace("readonly'}", "changed'}"), "utf8");
            await expect(prepareSystemAssets()).rejects.toThrow("请重新构建或安装与源码匹配的 Product");
            await expect(readFile(join(systemNbookRoot, "agent", ".staging"), "utf8")).rejects.toThrow();
            expect(await readFile(variableManifestPath, "utf8")).toBe(variableManifest);
            expect(await readFile(profileManifestPath, "utf8")).toBe(profileManifest);
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });
});

/** 恢复测试前的进程环境，避免影响同进程其他 RuntimePaths 用例。 */
function restoreEnv(key: "NEURO_BOOK_APPLICATION_ROOT" | "NEURO_BOOK_STATE_ROOT", value: string | undefined): void {
    if (value === undefined) {
        delete process.env[key];
        return;
    }
    process.env[key] = value;
}

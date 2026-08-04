import {randomUUID} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {compileProfileArtifacts} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {compileVariableDefinitions} from "nbook/server/agent/variables/definition-artifact";
import {prepareSystemAssets} from "nbook/server/workspace-files/system-assets-preflight";

describe("Product system assets preflight", () => {
    const originalApplicationRoot = process.env.NEURO_BOOK_APPLICATION_ROOT;
    const originalStateRoot = process.env.NEURO_BOOK_STATE_ROOT;

    afterEach(() => {
        restoreEnv("NEURO_BOOK_APPLICATION_ROOT", originalApplicationRoot);
        restoreEnv("NEURO_BOOK_STATE_ROOT", originalStateRoot);
    });

    it("只读 Product Root 的新鲜 system assets 零写入，过期时明确拒绝", async () => {
        const root = resolve(".agent", "tmp", "system-assets-preflight-test", randomUUID());
        const applicationRoot = join(root, "product");
        const stateRoot = join(root, "state");
        const systemNbookRoot = join(applicationRoot, ".output", "server", "assets", "workspace", ".nbook");
        const profileRoot = join(systemNbookRoot, "agent", "profiles");
        const variableRoot = join(systemNbookRoot, "agent", "variables");
        const profilePath = join(profileRoot, "builtin", "readonly.profile.mjs");
        const variablePath = join(variableRoot, "definitions.mjs");
        await Promise.all([
            mkdir(join(applicationRoot, ".output", "server"), {recursive: true}),
            mkdir(join(profileRoot, "builtin"), {recursive: true}),
            mkdir(variableRoot, {recursive: true}),
            mkdir(stateRoot, {recursive: true}),
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
            await compileVariableDefinitions({
                definitionRoot: variableRoot,
                rootLabel: "assets/workspace/.nbook/agent/variables",
            });
            await compileProfileArtifacts({
                profileRoot,
                rootLabel: "assets/workspace/.nbook/agent/profiles",
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

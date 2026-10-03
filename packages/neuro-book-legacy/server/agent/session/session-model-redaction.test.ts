import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {afterEach, describe, expect, it} from "vitest";
import {migrateSessionJsonlModels, parseDurableSessionModelRef, toDurableSessionModelRef} from "nbook/server/agent/session/session-model-redaction";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Session model redaction", () => {
    it("完整 Pi Model 只投影稳定选择身份", () => {
        expect(toDurableSessionModelRef({
            id: "private-model",
            provider: "fallback-provider",
            providerConfigId: "local-provider",
            baseUrl: "https://private.example/v1",
            headers: {Authorization: "Bearer secret"},
        } as never)).toEqual({providerConfigId: "local-provider", modelId: "private-model"});
        expect(() => toDurableSessionModelRef({id: "private-model", provider: "registry-provider"} as never))
            .toThrow("拒绝从Pi Provider身份猜测");
        expect(() => parseDurableSessionModelRef({providerConfigId: "local", modelId: "model", headers: {Authorization: "secret"}})).toThrow("必须只包含");
    });

    it("原子迁移 entry 与 batch 中的完整模型且不保留敏感字段", async () => {
        const filePath = await writeSession([
            {kind: "header", metadata: {sessionId: 1}},
            {kind: "entry", entry: {id: "entry-a", type: "model_change", model: {providerConfigId: "local", provider: "upstream", id: "model-a", baseUrl: "https://private.example", headers: {Authorization: "Bearer secret"}}}},
            {kind: "batch", entries: [
                {id: "entry-b", type: "model_change", model: {provider: "legacy-provider", id: "model-b", compat: {private: true}}},
                {type: "thinking_level_change", thinkingLevel: "high"},
            ]},
        ]);

        await expect(migrateSessionJsonlModels(filePath, {"1:entry-b": {providerConfigId: "local-b", modelId: "model-b"}}))
            .resolves.toEqual({changed: true, modelChanges: 2, artifacts: [], removedArtifacts: [], usedMappings: ["1:entry-b"]});
        const migrated = await readFile(filePath, "utf8");
        expect(migrated).toContain('"model":{"providerConfigId":"local","modelId":"model-a"}');
        expect(migrated).toContain('"model":{"providerConfigId":"local-b","modelId":"model-b"}');
        expect(migrated).not.toContain("private.example");
        expect(migrated).not.toContain("Authorization");
        expect(migrated).not.toContain("compat");
    });

    it("无法证明旧模型身份时拒绝迁移并保持源文件逐字节不变", async () => {
        const filePath = await writeSession([
            {kind: "header", metadata: {sessionId: 1}},
            {kind: "entry", entry: {id: "missing-entry", type: "model_change", model: {id: "missing-provider", headers: {Authorization: "secret"}}}},
        ]);
        const source = await readFile(filePath, "utf8");

        await expect(migrateSessionJsonlModels(filePath)).rejects.toThrow("显式映射");
        await expect(readFile(filePath, "utf8")).resolves.toBe(source);
    });

    it("已脱敏文件不会重写", async () => {
        const filePath = await writeSession([
            {kind: "header", metadata: {sessionId: 1}},
            {kind: "entry", entry: {type: "model_change", model: {providerConfigId: "local", modelId: "model"}}},
        ], true);
        const source = await readFile(filePath, "utf8");

        await expect(migrateSessionJsonlModels(filePath)).resolves.toEqual({changed: false, modelChanges: 1, artifacts: [], removedArtifacts: [], usedMappings: []});
        await expect(readFile(filePath, "utf8")).resolves.toBe(source);
    });
});

async function writeSession(records: unknown[], pretty = false): Promise<string> {
    const root = await mkdtemp(testHostPath("nbook-session-model-"));
    roots.push(root);
    const filePath = join(root, "1.jsonl");
    const content = records.map((record) => pretty ? `  ${JSON.stringify(record)}  ` : JSON.stringify(record)).join("\n") + "\n";
    await writeFile(filePath, content, "utf8");
    return filePath;
}

import {mkdtemp, mkdir, readFile, rm, stat, writeFile} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {join} from "node:path";

import {afterEach, describe, expect, it} from "vitest";

import {runSessionModelRefMigration} from "./migrate-session-model-refs";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("migrate-session-model-refs maintenance", () => {
    it("dry-run报告待迁移与敏感副本且保持所有文件不变", async () => {
        const fixture = await createFixture();
        const source = await readFile(fixture.sessionPath, "utf8");
        await writeFile(`${fixture.sessionPath}.old.redaction.bak`, source, "utf8");

        const report = await runSessionModelRefMigration([
            "--workspace-root", fixture.workspaceRoot,
            "--mapping", fixture.mappingPath,
            "--dry-run",
        ]);

        expect(report).toMatchObject({dryRun: true, planned: ["1.jsonl"], blocked: [], unusedMappings: [], removedArtifacts: 0});
        expect(report.artifacts).toEqual([{fileName: "1.jsonl", names: ["1.jsonl.old.redaction.bak"]}]);
        await expect(readFile(fixture.sessionPath, "utf8")).resolves.toBe(source);
        await expect(stat(`${fixture.sessionPath}.old.redaction.bak`)).resolves.toBeDefined();
    });

    it("apply逐Session原子替换并清理已脱敏Session旁的敏感副本", async () => {
        const fixture = await createFixture({durable: true, mappings: []});
        await writeFile(`${fixture.sessionPath}.old.redaction.tmp`, "sensitive", "utf8");

        const report = await runSessionModelRefMigration([
            "--workspace-root", fixture.workspaceRoot,
            "--mapping", fixture.mappingPath,
        ]);

        expect(report).toMatchObject({dryRun: false, planned: [], explicit: ["1.jsonl"], removedArtifacts: 1});
        await expect(stat(`${fixture.sessionPath}.old.redaction.tmp`)).rejects.toMatchObject({code: "ENOENT"});
        expect((await readFile(fixture.sessionPath, "utf8"))).toContain('"providerConfigId":"local"');
    });

    it("缺少映射、无效目标或未使用映射时预检失败且不修改Session", async () => {
        const missing = await createFixture({mappings: []});
        const missingSource = await readFile(missing.sessionPath, "utf8");
        await expect(runSessionModelRefMigration([
            "--workspace-root", missing.workspaceRoot,
            "--mapping", missing.mappingPath,
        ])).rejects.toThrow("预检失败");
        await expect(readFile(missing.sessionPath, "utf8")).resolves.toBe(missingSource);

        const invalid = await createFixture({providerConfigId: "missing"});
        await expect(runSessionModelRefMigration([
            "--workspace-root", invalid.workspaceRoot,
            "--mapping", invalid.mappingPath,
            "--dry-run",
        ])).rejects.toThrow("不存在的Provider Config");

        const unused = await createFixture({durable: true});
        await expect(runSessionModelRefMigration([
            "--workspace-root", unused.workspaceRoot,
            "--mapping", unused.mappingPath,
        ])).rejects.toThrow("预检失败");
    });
});

async function createFixture(options: {
    durable?: boolean;
    mappings?: Array<{sessionId: number; entryId: string; providerConfigId: string; modelId: string}>;
    providerConfigId?: string;
} = {}): Promise<{workspaceRoot: string; sessionPath: string; mappingPath: string}> {
    const workspaceRoot = await mkdtemp(testHostPath("nbook-model-ref-migration-"));
    roots.push(workspaceRoot);
    const nbookRoot = join(workspaceRoot, ".nbook");
    const sessionsRoot = join(nbookRoot, "agent", "sessions");
    await mkdir(sessionsRoot, {recursive: true});
    await writeFile(join(nbookRoot, "config.json"), JSON.stringify({
        models: {
            default: "local/model",
            providers: [{
                id: "local",
                name: "Local",
                enabled: true,
                modelApi: "openai-completions",
                options: {apiKey: "", baseURL: "https://example.com/v1", proxy: "", timeoutMs: null, requestOptions: {}},
                models: [{
                    id: "model",
                    name: "Model",
                    group: null,
                    enabled: true,
                    api: "openai-completions",
                    reasoning: false,
                    input: ["text"],
                    maxTokens: 4096,
                    contextWindowTokens: 8192,
                    cost: null,
                    compat: null,
                    headers: null,
                    thinkingLevelMap: null,
                }],
            }],
        },
    }), "utf8");
    const sessionPath = join(sessionsRoot, "1.jsonl");
    const model = options.durable
        ? {providerConfigId: "local", modelId: "model"}
        : {provider: "registry-provider", id: "model", baseUrl: "https://private.example", headers: {Authorization: "secret"}};
    await writeFile(sessionPath, [
        JSON.stringify({kind: "header", metadata: {sessionId: 1}}),
        JSON.stringify({kind: "entry", entry: {id: "entry-1", type: "model_change", model}}),
    ].join("\n") + "\n", "utf8");
    const mappingPath = join(workspaceRoot, "mapping.json");
    await writeFile(mappingPath, JSON.stringify({
        mappings: options.mappings ?? [{
            sessionId: 1,
            entryId: "entry-1",
            providerConfigId: options.providerConfigId ?? "local",
            modelId: "model",
        }],
    }), "utf8");
    return {workspaceRoot, sessionPath, mappingPath};
}

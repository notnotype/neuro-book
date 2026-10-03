import {access, mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {join, resolve} from "node:path";
import {setTimeout as sleep} from "node:timers/promises";
import {afterEach, describe, expect, it} from "vitest";
import {
    compileVariableDefinitions as compileVariableDefinitionsWithContext,
    VARIABLE_DEFINITION_STAGING_DIR_NAME,
    VARIABLE_DEFINITION_STAGING_LEASE_LOCK,
    VARIABLE_DEFINITION_STAGING_MAX_AGE_MS,
    VARIABLE_DEFINITION_STAGING_OWNER,
    VARIABLE_DEFINITION_STAGING_OWNER_FILE,
    VARIABLE_DEFINITION_STAGING_OWNER_SCHEMA,
    resolveVariableDefinitionArtifactPathContext,
    sweepVariableDefinitionStaging,
    type VariableDefinitionStagingOwner,
} from "nbook/server/agent/variables/definition-artifact";

const testCompilerRoot = resolve(import.meta.dirname, "../../..");
async function compileVariableDefinitions(options: Omit<Parameters<typeof compileVariableDefinitionsWithContext>[0], "artifactPathContext">) {
    return compileVariableDefinitionsWithContext({
        ...options,
        artifactPathContext: await resolveVariableDefinitionArtifactPathContext(options.definitionRoot, "test/workspace/.nbook/agent/variables", testCompilerRoot),
    });
}

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

/** 创建测试 staging 根。 */
async function createStagingRoot(): Promise<{root: string; stagingRoot: string}> {
    const root = await mkdtemp(testHostPath("nbook-variable-staging-"));
    roots.push(root);
    return {root, stagingRoot: join(root, ".staging")};
}

/** 写入一个由 Variable definition compiler owner 声明的 staging operation。 */
async function seedOwnedStaging(stagingRoot: string, operationId: string, startedAt: string): Promise<string> {
    const operationRoot = join(stagingRoot, VARIABLE_DEFINITION_STAGING_DIR_NAME, operationId);
    const marker: VariableDefinitionStagingOwner = {
        schema: VARIABLE_DEFINITION_STAGING_OWNER_SCHEMA,
        owner: VARIABLE_DEFINITION_STAGING_OWNER,
        operationId,
        pid: process.pid,
        startedAt,
    };
    await mkdir(operationRoot, {recursive: true});
    await writeFile(
        join(operationRoot, VARIABLE_DEFINITION_STAGING_OWNER_FILE),
        `${JSON.stringify(marker, null, 2)}\n`,
        "utf8",
    );
    return operationRoot;
}

/** 等待真实编译创建 UUID operation，避免测试依赖 esbuild 的具体启动耗时。 */
async function waitForOperationRoot(stagingRoot: string): Promise<string> {
    const ownerRoot = join(stagingRoot, VARIABLE_DEFINITION_STAGING_DIR_NAME);
    for (let attempt = 0; attempt < 200; attempt += 1) {
        const entries = await readdir(ownerRoot, {withFileTypes: true}).catch(() => []);
        const operation = entries.find((entry) => entry.isDirectory());
        if (operation) {
            return join(ownerRoot, operation.name);
        }
        await sleep(10);
    }
    throw new Error("等待 Variable definition staging operation 超时。");
}

describe("Variable definition staging lifecycle", () => {
    it("超过 24 小时且没有活跃 lease 的同 owner staging 会被回收", async () => {
        const {stagingRoot} = await createStagingRoot();
        const now = Date.now();
        const operationRoot = await seedOwnedStaging(
            stagingRoot,
            "stale-operation",
            new Date(now - VARIABLE_DEFINITION_STAGING_MAX_AGE_MS - 1_000).toISOString(),
        );

        const report = await sweepVariableDefinitionStaging(stagingRoot, now);

        expect(report).toEqual({scanned: 1, fresh: 0, active: 0, deleted: 1, malformed: 0, failed: 0});
        await expect(access(operationRoot)).rejects.toMatchObject({code: "ENOENT"});
    });

    it("下一次普通编译会先回收崩溃遗留 staging，且无待编译源码时不创建新 operation", async () => {
        const {root, stagingRoot} = await createStagingRoot();
        const definitionRoot = join(root, "variables");
        const operationRoot = await seedOwnedStaging(
            stagingRoot,
            "crashed-operation",
            new Date(Date.now() - VARIABLE_DEFINITION_STAGING_MAX_AGE_MS - 1_000).toISOString(),
        );
        await mkdir(definitionRoot, {recursive: true});

        await compileVariableDefinitions({definitionRoot, stagingRoot});

        await expect(access(operationRoot)).rejects.toMatchObject({code: "ENOENT"});
        const remaining = await readdir(join(stagingRoot, VARIABLE_DEFINITION_STAGING_DIR_NAME)).catch(() => []);
        expect(remaining).toEqual([]);
    });

    it("真实编译持有 heartbeat lease 时，即使 owner marker 过期也不会被删除", async () => {
        const {root, stagingRoot} = await createStagingRoot();
        const definitionRoot = join(root, "variables");
        await mkdir(definitionRoot, {recursive: true});
        await writeFile(join(definitionRoot, "definitions.ts"), [
            "await new Promise((resolve) => setTimeout(resolve, 1_500));",
            "export const definitions = [{",
            "    namespace: 'global',",
            "    key: 'activeMarker',",
            "    schema: {type: 'string'},",
            "}];",
            "export default definitions;",
            "",
        ].join("\n"), "utf8");

        const compilation = compileVariableDefinitions({definitionRoot, stagingRoot});
        try {
            const operationRoot = await waitForOperationRoot(stagingRoot);
            const markerPath = join(operationRoot, VARIABLE_DEFINITION_STAGING_OWNER_FILE);
            // 测试只在 compiler 刚写出的受控 marker 上做形态断言。
            const marker = JSON.parse(await readFile(markerPath, "utf8")) as VariableDefinitionStagingOwner;
            const now = Date.now();
            await writeFile(markerPath, `${JSON.stringify({
                ...marker,
                startedAt: new Date(now - VARIABLE_DEFINITION_STAGING_MAX_AGE_MS - 1_000).toISOString(),
            }, null, 2)}\n`, "utf8");

            expect((await stat(join(operationRoot, VARIABLE_DEFINITION_STAGING_LEASE_LOCK))).isDirectory()).toBe(true);
            const report = await sweepVariableDefinitionStaging(stagingRoot, now);

            expect(report).toEqual({scanned: 1, fresh: 0, active: 1, deleted: 0, malformed: 0, failed: 0});
            await access(operationRoot);
        } finally {
            await compilation;
        }

        const remaining = await readdir(join(stagingRoot, VARIABLE_DEFINITION_STAGING_DIR_NAME)).catch(() => []);
        expect(remaining).toEqual([]);
    });

    it("无法校验的 marker 即使目录很旧也保守保留", async () => {
        const {stagingRoot} = await createStagingRoot();
        const operationRoot = join(stagingRoot, VARIABLE_DEFINITION_STAGING_DIR_NAME, "malformed-operation");
        const markerPath = join(operationRoot, VARIABLE_DEFINITION_STAGING_OWNER_FILE);
        await mkdir(operationRoot, {recursive: true});
        await writeFile(markerPath, "{not-json\n", "utf8");
        const old = (Date.now() - VARIABLE_DEFINITION_STAGING_MAX_AGE_MS - 1_000) / 1_000;
        await utimes(markerPath, old, old);
        await utimes(operationRoot, old, old);

        const report = await sweepVariableDefinitionStaging(stagingRoot);

        expect(report).toEqual({scanned: 1, fresh: 0, active: 0, deleted: 0, malformed: 1, failed: 0});
        await expect(readFile(markerPath, "utf8")).resolves.toBe("{not-json\n");
    });
});

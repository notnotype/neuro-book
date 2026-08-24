import {existsSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {lock as acquireFileLock, unlock as releaseFileLock} from "proper-lockfile";
import {afterEach, describe, expect, it} from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "..", "..");
const scriptPath = resolve(repositoryRoot, "scripts", "deploy", "product-runtime.mjs");
const ACCEPTANCE_OWNER = "nbook.product-runtime-acceptance";
const OWNER_FILE = ".nbook-product-acceptance.json";
const LEASE_FILE = ".nbook-product-acceptance-lease";
const POINTER_FILE = "current.json";

type CleanupResult = {
    status: number | null;
    stdout: string;
    stderr: string;
};

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
    const tempRoot = await mkdtemp(join(tmpdir(), "nbook-cleanup-"));
    tempRoots.push(tempRoot);
    return tempRoot;
}

function spawnCleanup(tempRoot: string, operationId: string): CleanupResult {
    const result = spawnSync("bun", [scriptPath, "cleanup", operationId], {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: {...process.env, NBOOK_AGENT_TEMP_ROOT: tempRoot},
    });
    return {status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? ""};
}

async function writeStageFixture(
    acceptanceRoot: string,
    operationId: string,
    ownerOperationId: string = operationId,
): Promise<string> {
    const stageRoot = join(acceptanceRoot, operationId);
    await mkdir(stageRoot, {recursive: true});
    await writeFile(
        join(stageRoot, OWNER_FILE),
        JSON.stringify({owner: ACCEPTANCE_OWNER, schema: 1, operationId: ownerOperationId}),
    );
    await writeFile(
        join(acceptanceRoot, POINTER_FILE),
        JSON.stringify({owner: ACCEPTANCE_OWNER, schema: 1, operationId: ownerOperationId, path: stageRoot}),
    );
    return stageRoot;
}

afterEach(async () => {
    while (tempRoots.length > 0) {
        const tempRoot = tempRoots.pop();
        if (tempRoot) await rm(tempRoot, {recursive: true, force: true});
    }
});

describe("Product 验收 cleanup 命令合同", () => {
    it("stage 不存在时输出 already-cleaned 并成功退出", async () => {
        const tempRoot = await makeTempRoot();
        const result = spawnCleanup(tempRoot, "opmissing1");

        expect(result.status).toBe(0);
        expect(result.stdout).toBe("Product runtime cleanup: already-cleaned\n");
    });

    it("拒绝路径逃逸的 operation ID 且不以零退出", async () => {
        const tempRoot = await makeTempRoot();
        const result = spawnCleanup(tempRoot, "../escape");

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("operation ID 无效");
    });

    it("owner 与 operation ID 匹配时删除 stage 并清理匹配 pointer", async () => {
        const tempRoot = await makeTempRoot();
        const acceptanceRoot = join(tempRoot, "acceptance", "product-runtime");
        const stageRoot = await writeStageFixture(acceptanceRoot, "opok1");

        const result = spawnCleanup(tempRoot, "opok1");

        expect(result.status).toBe(0);
        expect(result.stdout).toBe("Product runtime cleanup: cleaned\n");
        expect(existsSync(stageRoot)).toBe(false);
        expect(existsSync(join(acceptanceRoot, POINTER_FILE))).toBe(false);
    });

    it("owner operation ID 不匹配时拒绝删除并保留 stage", async () => {
        const tempRoot = await makeTempRoot();
        const acceptanceRoot = join(tempRoot, "acceptance", "product-runtime");
        const stageRoot = await writeStageFixture(acceptanceRoot, "opmis1", "other9");

        const result = spawnCleanup(tempRoot, "opmis1");

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("operation ID 不匹配");
        expect(existsSync(stageRoot)).toBe(true);
    });

    it("活动 lease 持有时拒绝删除并保留 stage", async () => {
        const tempRoot = await makeTempRoot();
        const acceptanceRoot = join(tempRoot, "acceptance", "product-runtime");
        const stageRoot = await writeStageFixture(acceptanceRoot, "oplease1");
        await writeFile(join(stageRoot, LEASE_FILE), "");
        const leasePath = join(stageRoot, LEASE_FILE);
        const release = await acquireFileLock(leasePath, {update: null, stale: 3_600_000});

        try {
            const result = spawnCleanup(tempRoot, "oplease1");

            expect(result.status).not.toBe(0);
            expect(result.stderr).toContain("lease");
            expect(existsSync(stageRoot)).toBe(true);
        } finally {
            await releaseFileLock(leasePath, release);
        }
    });
});

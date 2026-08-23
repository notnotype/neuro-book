import {execFile as execFileCallback} from "node:child_process";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {promisify} from "node:util";
import {afterEach, describe, expect, it} from "vitest";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

type OwnershipMigrationReport = {
    mode: string;
    runRoot: string;
    blockers: Array<{path: string; reason: string}>;
};

const execFile = promisify(execFileCallback);
const repositoryRoot = join(import.meta.dirname, "..", "..");
const scriptPath = join(repositoryRoot, "scripts", "maintenance", "migrate-task-ownership.ts");
const fixtureRoots: string[] = [];

afterEach(async () => {
    await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("migrate-task-ownership metadata validation", () => {
    it("legacy index 缺少 localOnlyFiles 时输出 blocked report", async () => {
        const repoRoot = await createTestTmpRoot("ownership-metadata", "ownership-metadata-test");
        fixtureRoots.push(repoRoot);
        await mkdir(join(repoRoot, ".agents", "tasks"), {recursive: true});
        await writeFile(join(repoRoot, ".agents", "tasks", "legacy-index.json"), `${JSON.stringify({
            schema: "nbook.task-migration-index/v1",
            sourceRevision: "fixture-revision",
            fileCount: 1,
            manifestSha256: "sha256:fixture",
            mappings: [{
                source: "docs/tasks/001-fixture/README.md",
                destination: ".agents/tasks/001-fixture/README.md",
                sourceSha256: "sha256:fixture",
                destinationSha256: "sha256:fixture",
                kind: "file",
                linkRewrite: false,
            }],
        }, null, 2)}\n`, "utf8");

        let report: OwnershipMigrationReport | undefined;
        try {
            const result = await runOwnershipMigration(repoRoot);
            report = result.report;
            expect(result.status).not.toBe(0);
            expect(report.mode).toBe("blocked");
            expect(report.blockers).toContainEqual({
                path: ".agents/tasks/legacy-index.json",
                reason: "localOnlyFiles 不是数组",
            });
        } finally {
            if (report?.runRoot) await rm(report.runRoot, {recursive: true, force: true});
        }
    });
});

async function runOwnershipMigration(repoRoot: string): Promise<{status: number; report: OwnershipMigrationReport}> {
    try {
        const result = await execFile("bun", [scriptPath, "--repo-root", repoRoot], {cwd: repositoryRoot, encoding: "utf8"});
        return {status: 0, report: JSON.parse(result.stdout) as OwnershipMigrationReport};
    } catch (error) {
        const result = error as {code?: number | string; stdout?: string; stderr?: string};
        if (!result.stdout) throw new Error(`ownership migration 未输出 JSON：${result.stderr ?? ""}`, {cause: error});
        return {
            status: typeof result.code === "number" ? result.code : 1,
            report: JSON.parse(result.stdout) as OwnershipMigrationReport,
        };
    }
}

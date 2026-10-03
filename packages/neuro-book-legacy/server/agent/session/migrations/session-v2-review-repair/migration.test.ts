import {mkdtemp, readFile, rm} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {
    rollbackSessionV2ReviewRepair,
    runSessionV2ReviewRepair,
} from "nbook/server/agent/session/migrations/session-v2-review-repair/migration";
import {
    REVIEW_REPAIR_MIGRATION_TIMESTAMP,
    writeLegacyV2ReviewFixture,
} from "nbook/server/agent/session/migrations/session-v2-review-repair/test-fixture";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Session v2 review repair", () => {
    it("修复旧 nullable path review 和迁移时间，并保留 append-only 后缀且可逐字节回滚", async () => {
        const root = await fixtureRoot();
        const fixture = await writeLegacyV2ReviewFixture(root);
        const before = await readFile(fixture.sessionPath);

        const planned = await runSessionV2ReviewRepair({
            rootWorkspace: root,
            mode: "dry-run",
            runId: "repair-plan",
        });
        const applied = await runSessionV2ReviewRepair({
            rootWorkspace: root,
            mode: "apply",
            runId: "repair-apply",
        });
        const repaired = await readFile(fixture.sessionPath, "utf8");
        const header = sessionHeader(repaired);

        expect(planned).toMatchObject({status: "planned", repairedSessions: 1, reviewSessions: 0});
        expect(applied).toMatchObject({status: "complete", repairedSessions: 1, reviewSessions: 0});
        expect(header).toMatchObject({schemaVersion: 2, currentProjectRoot: "story"});
        expect(header).not.toHaveProperty("migrationReview");
        expect(repaired.endsWith(fixture.suffix)).toBe(true);
        expect(repaired).toBe(`${fixture.nextPrefix}${fixture.suffix}`);
        expect(migrationEntryTimestamps(repaired)).toEqual([
            REVIEW_REPAIR_MIGRATION_TIMESTAMP - 999,
            REVIEW_REPAIR_MIGRATION_TIMESTAMP - 999,
        ]);

        const rolledBack = await rollbackSessionV2ReviewRepair(root, "repair-apply");

        expect(rolledBack).toMatchObject({status: "rolled_back", restoredSessions: 1});
        expect(await readFile(fixture.sessionPath)).toEqual(before);
    });

    it("真正无法确定 Project 的 header 在 repair 后仍保留 current_project_unresolved", async () => {
        const root = await fixtureRoot();
        const fixture = await writeLegacyV2ReviewFixture(root, {external: true});

        const applied = await runSessionV2ReviewRepair({
            rootWorkspace: root,
            mode: "apply",
            runId: "repair-unresolved",
        });
        const header = sessionHeader(await readFile(fixture.sessionPath, "utf8"));

        expect(applied.reviewSessions).toBe(1);
        expect(header).not.toHaveProperty("currentProjectRoot");
        expect(header.migrationReview).toEqual({status: "required", reason: "current_project_unresolved"});
    });
});

async function fixtureRoot(): Promise<string> {
    const root = await mkdtemp(testHostPath("nbook-session-v2-review-repair-"));
    roots.push(root);
    return root;
}

function sessionHeader(text: string): {[key: string]: unknown} {
    const record = JSON.parse(text.split(/\r?\n/u).find(Boolean) as string) as {metadata?: {[key: string]: unknown}};
    if (!record.metadata) throw new Error("fixture 缺少 Session header");
    return record.metadata;
}

function migrationEntryTimestamps(text: string): number[] {
    return text.trimEnd().split(/\r?\n/u).flatMap((line) => {
        const record = JSON.parse(line) as {kind?: string; entries?: Array<{id?: string; timestamp?: number}>};
        return record.entries?.filter((entry) => entry.id?.startsWith("session-v2-migration-"))
            .map((entry) => entry.timestamp as number) ?? [];
    });
}

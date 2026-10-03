import {createHash} from "node:crypto";
import {mkdir, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {decodeSessionSchemaV1} from "nbook/server/agent/session/migrations/session-v2/legacy-decoder";

export const REVIEW_REPAIR_MIGRATION_TIMESTAMP = 1_800_000_000_000;

export type LegacyV2Fixture = {
    sessionPath: string;
    suffix: string;
    nextPrefix: string;
};

/** 构造已完成 Session v2、但仍包含旧 decoder 误判结果的隔离 State Root。 */
export async function writeLegacyV2ReviewFixture(
    root: string,
    options: {external?: boolean} = {},
): Promise<LegacyV2Fixture> {
    const migrationRunId = options.external ? "legacy-external" : "legacy-nullable";
    const sessionId = options.external ? 177 : 105;
    const sourcePath = `.nbook/agent/sessions/${String(sessionId)}.jsonl`;
    const sourceText = legacySessionText(sessionId, options.external === true);
    const decoderInput = {
        sourcePath,
        text: sourceText,
        migrationTimestamp: REVIEW_REPAIR_MIGRATION_TIMESTAMP,
        knownProjectRoots: options.external ? [] : ["story"],
        profileBySessionId: {[String(sessionId)]: "leader.default"},
    };
    const oldPlan = decodeSessionSchemaV1({...decoderInput, decoderFormat: 1});
    const nextPlan = decodeSessionSchemaV1({...decoderInput, decoderFormat: 2});
    const suffix = `${JSON.stringify({
        kind: "entry",
        entry: {
            type: "custom",
            id: "post_migration_append",
            parentId: null,
            timestamp: REVIEW_REPAIR_MIGRATION_TIMESTAMP + 10_000,
            key: "fixture.appended",
            value: true,
            origin: "projection",
        },
    })}\n`;
    const sessionPath = resolve(root, ...sourcePath.split("/"));
    const runRootRelative = `.nbook/agent/migrations/session-v2/${migrationRunId}`;
    const backupRelative = `${runRootRelative}/backups/${sourcePath}.backup`;
    const backupPath = resolve(root, ...backupRelative.split("/"));
    await mkdir(dirname(sessionPath), {recursive: true});
    await mkdir(dirname(backupPath), {recursive: true});
    await writeFile(sessionPath, `${oldPlan.targetText}${suffix}`, "utf8");
    await writeFile(backupPath, sourceText, "utf8");

    const statuses = [
        "backed_up",
        "prepared",
        "staged",
        "publishing",
        "published",
        "verified",
    ] as const;
    const sessionTransitions = statuses.map((status, index) => ({
        version: 1,
        kind: "session_transition",
        seq: index + 1,
        runId: migrationRunId,
        at: new Date(REVIEW_REPAIR_MIGRATION_TIMESTAMP + index).toISOString(),
        sourcePath,
        from: index === 0 ? "pending" : statuses[index - 1],
        to: status,
    }));
    const runTransitions = [
        {from: "running", to: "full_scan_verified"},
        {from: "full_scan_verified", to: "complete"},
        {from: "complete", to: "report_written"},
    ].map((transition, index) => ({
        version: 1,
        kind: "run_transition",
        seq: sessionTransitions.length + index + 1,
        runId: migrationRunId,
        at: new Date(REVIEW_REPAIR_MIGRATION_TIMESTAMP + 100 + index).toISOString(),
        ...transition,
    }));
    const appliedSeq = sessionTransitions.length + runTransitions.length;
    const manifest = {
        version: 1,
        journalVersion: 1,
        runId: migrationRunId,
        status: "report_written",
        appliedSeq,
        startedAt: new Date(REVIEW_REPAIR_MIGRATION_TIMESTAMP).toISOString(),
        updatedAt: new Date(REVIEW_REPAIR_MIGRATION_TIMESTAMP + 102).toISOString(),
        sessions: [{
            sessionId,
            profileKey: "leader.default",
            classification: oldPlan.classification,
            currentProjectRoot: oldPlan.currentProjectRoot ?? null,
            reviewReasons: oldPlan.reviewReasons,
            ambiguousLocations: oldPlan.ambiguousLocations,
            migrationTimestamp: REVIEW_REPAIR_MIGRATION_TIMESTAMP,
            rewrittenPaths: oldPlan.stats.rewrittenPaths,
            resetProfileReminders: oldPlan.stats.resetProfileReminders,
            cancelledToolCalls: oldPlan.stats.cancelledToolCalls,
            clearedPendingResolutions: oldPlan.stats.clearedPendingResolutions,
            clearedFollowUpQueue: oldPlan.stats.clearedFollowUpQueue,
            sourcePath,
            backupPath: backupRelative,
            stagePath: `${runRootRelative}/stages/${sourcePath}.stage`,
            rollbackPath: `${runRootRelative}/rollbacks/${sourcePath}.rollback`,
            sourceHash: sha256(sourceText),
            targetHash: sha256(oldPlan.targetText),
            changed: true,
            status: "verified",
        }],
    };
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    const manifestPath = resolve(root, runRootRelative, "manifest.json");
    await mkdir(dirname(manifestPath), {recursive: true});
    await writeFile(manifestPath, manifestText, "utf8");
    await writeFile(resolve(dirname(manifestPath), "journal.jsonl"), [
        ...sessionTransitions.map((entry) => JSON.stringify(entry)),
        ...runTransitions.map((entry) => JSON.stringify(entry)),
        "",
    ].join("\n"), "utf8");
    const sentinelPath = resolve(root, ".nbook", "agent", "migrations", "session-store.json");
    await writeFile(sentinelPath, `${JSON.stringify({
        sentinelVersion: 1,
        state: "complete",
        sourceSchemaVersion: 1,
        targetSchemaVersion: 2,
        runId: migrationRunId,
        manifestPath: `${runRootRelative}/manifest.json`,
        manifestHash: sha256(manifestText),
        checkpointCursor: appliedSeq,
    }, null, 2)}\n`, "utf8");
    return {sessionPath, suffix, nextPrefix: nextPlan.targetText};
}

/** 构造 schema v1 Session 原文，external=true 时 Project header 无法归一为单段 root。 */
function legacySessionText(sessionId: number, external: boolean): string {
    const projectPath = external ? "C:\\outside\\story" : "workspace/story";
    const entries = [
        {
            type: "message",
            id: "assistant",
            parentId: null,
            timestamp: REVIEW_REPAIR_MIGRATION_TIMESTAMP - 1_000,
            origin: "harness",
            message: {
                role: "assistant",
                content: [{type: "toolCall", id: "call_chapter", name: "get_chapter_plot", arguments: {chapterPath: null}}],
                api: "test",
                provider: "test",
                model: "test",
                usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}},
                stopReason: "toolUse",
                timestamp: REVIEW_REPAIR_MIGRATION_TIMESTAMP - 2_000,
            },
        },
        {
            type: "message",
            id: "result",
            parentId: "assistant",
            timestamp: REVIEW_REPAIR_MIGRATION_TIMESTAMP - 999,
            origin: "harness",
            message: {
                role: "toolResult",
                toolCallId: "call_chapter",
                toolName: "get_chapter_plot",
                content: [{type: "text", text: "ok"}],
                details: {chapterPath: null},
                isError: false,
                timestamp: REVIEW_REPAIR_MIGRATION_TIMESTAMP - 1_500,
            },
        },
        {
            type: "leaf",
            id: "source_leaf",
            parentId: "result",
            timestamp: REVIEW_REPAIR_MIGRATION_TIMESTAMP - 500,
            leafId: "result",
            origin: "auto",
        },
    ];
    return [
        JSON.stringify({
            kind: "header",
            metadata: {
                sessionId,
                profileKey: "leader.default",
                initial: {},
                workspaceRoot: projectPath,
                workspaceKey: external ? "external" : projectPath,
                projectPath,
                createdAt: REVIEW_REPAIR_MIGRATION_TIMESTAMP - 10_000,
            },
        }),
        JSON.stringify({kind: "batch", entries}),
        "",
    ].join("\n");
}

/** 生成 migration manifest 使用的稳定 SHA-256。 */
function sha256(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

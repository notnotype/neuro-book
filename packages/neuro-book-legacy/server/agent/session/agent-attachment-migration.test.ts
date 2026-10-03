import {createHash, randomUUID} from "node:crypto";
import {appendFile, copyFile, mkdtemp, mkdir, readFile, rename, rm, stat, symlink, writeFile} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {dirname, join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {
    rollbackAgentAttachmentMigration,
    runAgentAttachmentMigration,
} from "nbook/server/agent/session/migrations/attachment-v1/migration";

const PNG_BYTES = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from("migration-fixture", "utf8"),
]);

const JOURNAL_CORRUPTIONS: Array<{
    name: string;
    expected: string;
    mutate: (record: JournalRecordView) => void;
}> = [
    {name: "seq", expected: "seq 不连续", mutate: (record) => { record.seq = 2; }},
    {name: "runId", expected: "runId 不一致", mutate: (record) => { record.runId = "other-run"; }},
    {name: "sourcePath", expected: "sourcePath 不在 manifest", mutate: (record) => { record.sourcePath = ".nbook/agent/sessions/missing.jsonl"; }},
    {name: "from", expected: "journal from=verified", mutate: (record) => { record.from = "verified"; }},
    {name: "to", expected: "非法 migration 状态转换", mutate: (record) => { record.to = "verified"; }},
];

describe("Agent Attachment v1 migration", () => {
    const roots: string[] = [];

    afterEach(async () => {
        await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
    });

    it("全新 Workspace Root 没有 Agent 目录时 dry-run 返回空计划且不创建目录", async () => {
        const root = await mkdtemp(testHostPath("nbook-agent-attachment-empty-"));
        roots.push(root);

        const report = await runAgentAttachmentMigration({
            rootWorkspace: root,
            mode: "dry-run",
            runId: "empty-workspace",
        });

        expect(report).toMatchObject({
            runId: "empty-workspace",
            mode: "dry-run",
            status: "planned",
            scannedSessions: 0,
            migratedSessions: 0,
            images: 0,
            uniqueAttachments: 0,
            bytes: 0,
            sessions: [],
        });
        await expect(stat(join(root, ".nbook", "agent"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("dry-run 复用真实转换路径，但不写 lock、blob、backup 或 manifest", async () => {
        const root = await createWorkspace();
        roots.push(root);
        const sessionPath = await writeLegacySession(root, 41);
        const source = await readFile(sessionPath, "utf8");

        const report = await runAgentAttachmentMigration({
            rootWorkspace: root,
            mode: "dry-run",
            runId: "dry-run-test",
        });

        expect(report).toMatchObject({
            runId: "dry-run-test",
            mode: "dry-run",
            status: "planned",
            scannedSessions: 1,
            migratedSessions: 1,
            images: 1,
            uniqueAttachments: 1,
            bytes: PNG_BYTES.byteLength,
        });
        expect(report.sessions[0]).toMatchObject({
            sessionId: 41,
            sourceHash: sha256(source),
            images: 1,
            status: "pending",
        });
        expect(report.sessions[0]?.targetHash).not.toBe(sha256(source));
        await expect(readFile(sessionPath, "utf8")).resolves.toBe(source);
        await expect(readFile(join(root, ".nbook", "agent", "migrations", "attachment-v1.lock"), "utf8"))
            .rejects.toMatchObject({code: "ENOENT"});
        await expect(readFile(join(root, ".nbook", "agent", "attachments", "sha256"), "utf8"))
            .rejects.toMatchObject({code: "ENOENT"});
    });

    it("apply 保存去重 blob、迁移 message 与 follow-up queue，并保留可审计 backup/journal", async () => {
        const root = await createWorkspace();
        roots.push(root);
        const sessionPath = await writeLegacySession(root, 94, {includeQueue: true});
        const source = await readFile(sessionPath, "utf8");

        const report = await runAgentAttachmentMigration({
            rootWorkspace: root,
            mode: "apply",
            runId: "apply-test",
        });

        expect(report).toMatchObject({
            runId: "apply-test",
            mode: "apply",
            status: "complete",
            scannedSessions: 1,
            migratedSessions: 1,
            images: 2,
            uniqueAttachments: 1,
            bytes: PNG_BYTES.byteLength * 2,
        });
        expect(report.sessions[0]?.status).toBe("verified");

        const target = await readFile(sessionPath, "utf8");
        expect(target).not.toContain('"type":"image"');
        expect(target).not.toContain(PNG_BYTES.toString("base64"));
        expect(target.match(/"type":"attachment"/g)).toHaveLength(2);
        expect(target).not.toContain('"images"');
        expect(target).toContain('"clientMessageId"');

        const hash = sha256(PNG_BYTES);
        const blobPath = join(root, ".nbook", "agent", "attachments", "sha256", hash.slice(0, 2), hash.slice(2));
        await expect(readFile(blobPath)).resolves.toEqual(PNG_BYTES);
        const runRoot = join(root, ".nbook", "agent", "migrations", "attachment-v1", "apply-test");
        const backupPath = join(runRoot, "backups", ".nbook", "agent", "sessions", "94.jsonl.backup");
        await expect(readFile(backupPath, "utf8")).resolves.toBe(source);
        const manifest = JSON.parse(await readFile(join(runRoot, "manifest.json"), "utf8")) as {
            status: string;
            appliedSeq: number;
        };
        expect(manifest.status).toBe("report_written");
        const journal = (await readFile(join(runRoot, "journal.jsonl"), "utf8"))
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line) as {kind: string; seq: number});
        expect(journal.every((record) => record.kind === "session_transition" || record.kind === "run_transition")).toBe(true);
        expect(journal.map((record) => record.seq)).toEqual(journal.map((_, index) => index + 1));
        expect(manifest.appliedSeq).toBe(journal.length);
        await expect(stat(join(root, ".nbook", "agent", "migrations", "attachment-v1.lock")))
            .rejects.toMatchObject({code: "ENOENT"});
    });

    it("apply preflight 任一图片失败时零修改，不取得 lock", async () => {
        const root = await createWorkspace();
        roots.push(root);
        const invalidBytes = Buffer.from("not-a-png", "utf8");
        const sessionPath = await writeLegacySession(root, 61, {imageBytes: invalidBytes});
        const source = await readFile(sessionPath, "utf8");

        await expect(runAgentAttachmentMigration({
            rootWorkspace: root,
            mode: "apply",
            runId: "invalid-preflight",
        })).rejects.toThrow("MIME 与文件魔数不一致");

        await expect(readFile(sessionPath, "utf8")).resolves.toBe(source);
        await expect(stat(join(root, ".nbook", "agent", "migrations", "attachment-v1.lock")))
            .rejects.toMatchObject({code: "ENOENT"});
        await expect(stat(join(root, ".nbook", "agent", "attachments"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("publishing 前中断会保留 lock，显式 resume 从 journal 状态继续且不重复 backup", async () => {
        const root = await createWorkspace();
        roots.push(root);
        const sessionPath = await writeLegacySession(root, 41);
        const source = await readFile(sessionPath, "utf8");
        let interrupted = false;

        await expect(runAgentAttachmentMigration({
            rootWorkspace: root,
            mode: "apply",
            runId: "resume-test",
            observer: ({status}) => {
                if (!interrupted && status === "publishing") {
                    interrupted = true;
                    throw new Error("simulated process interruption");
                }
            },
        })).rejects.toThrow("simulated process interruption");

        const lockPath = join(root, ".nbook", "agent", "migrations", "attachment-v1.lock");
        await expect(stat(lockPath)).resolves.toBeDefined();
        await expect(readFile(sessionPath, "utf8")).resolves.toBe(source);
        const rollbackPath = join(
            root,
            ".nbook",
            "agent",
            "migrations",
            "attachment-v1",
            "resume-test",
            "rollbacks",
            ".nbook",
            "agent",
            "sessions",
            "41.jsonl.rollback",
        );
        await mkdir(dirname(rollbackPath), {recursive: true});
        await rename(sessionPath, rollbackPath);

        const report = await runAgentAttachmentMigration({
            rootWorkspace: root,
            mode: "apply",
            resume: true,
        });

        expect(report.status).toBe("complete");
        expect(report.sessions[0]?.status).toBe("verified");
        expect(await readFile(sessionPath, "utf8")).not.toContain('"type":"image"');
        await expect(stat(lockPath)).rejects.toMatchObject({code: "ENOENT"});
        const backupPath = join(
            root,
            ".nbook",
            "agent",
            "migrations",
            "attachment-v1",
            "resume-test",
            "backups",
            ".nbook",
            "agent",
            "sessions",
            "41.jsonl.backup",
        );
        await expect(readFile(backupPath, "utf8")).resolves.toBe(source);
    });

    it("initial manifest 将 unchanged session 标为 verified，WAL 不为其写无意义 transition", async () => {
        const root = await createWorkspace();
        roots.push(root);
        await writeLegacySession(root, 41);
        await writeStoredSession(root, 42);

        await interruptAtPublishing(root, "unchanged-test");

        const runRoot = join(root, ".nbook", "agent", "migrations", "attachment-v1", "unchanged-test");
        const manifest = JSON.parse(await readFile(join(runRoot, "manifest.json"), "utf8")) as {
            sessions: Array<{sourcePath: string; changed: boolean; status: string}>;
        };
        expect(manifest.sessions).toEqual(expect.arrayContaining([
            expect.objectContaining({sourcePath: ".nbook/agent/sessions/41.jsonl", changed: true, status: "pending"}),
            expect.objectContaining({sourcePath: ".nbook/agent/sessions/42.jsonl", changed: false, status: "verified"}),
        ]));
        const journal = await journalRecords(runRoot);
        expect(journal.some((record) => record.sourcePath === ".nbook/agent/sessions/42.jsonl")).toBe(false);
    });

    it("resume 只截断没有换行提交标记的 crash tail", async () => {
        const root = await createWorkspace();
        roots.push(root);
        await writeLegacySession(root, 41);
        await interruptAtPublishing(root, "partial-tail-test");
        const journalPath = join(
            root,
            ".nbook",
            "agent",
            "migrations",
            "attachment-v1",
            "partial-tail-test",
            "journal.jsonl",
        );
        const committed = await readFile(journalPath, "utf8");
        await appendFile(journalPath, "{\"version\":1,\"kind\":\"session_transition\"", "utf8");

        const report = await runAgentAttachmentMigration({rootWorkspace: root, mode: "apply", resume: true});

        expect(report.status).toBe("complete");
        const repaired = await readFile(journalPath, "utf8");
        expect(repaired.startsWith(committed)).toBe(true);
        expect(repaired).not.toContain("{\"version\":1,\"kind\":\"session_transition\"{\"version");
        expect(repaired.endsWith("\n")).toBe(true);
    });

    it("resume 拒绝带换行提交标记的完整坏行且不截断证据", async () => {
        const root = await createWorkspace();
        roots.push(root);
        await writeLegacySession(root, 41);
        await interruptAtPublishing(root, "complete-bad-line-test");
        const journalPath = join(
            root,
            ".nbook",
            "agent",
            "migrations",
            "attachment-v1",
            "complete-bad-line-test",
            "journal.jsonl",
        );
        await appendFile(journalPath, "{broken-json}\n", "utf8");
        const before = await readFile(journalPath, "utf8");

        await expect(runAgentAttachmentMigration({rootWorkspace: root, mode: "apply", resume: true}))
            .rejects.toThrow("migration journal 第");
        await expect(readFile(journalPath, "utf8")).resolves.toBe(before);
        await expect(stat(join(root, ".nbook", "agent", "migrations", "attachment-v1.lock"))).resolves.toBeDefined();
    });

    it.each(JOURNAL_CORRUPTIONS)("resume 严格拒绝被篡改的 $name delta", async ({name, expected, mutate}) => {
        const root = await createWorkspace();
        roots.push(root);
        await writeLegacySession(root, 41);
        const runId = `tamper-${name}`;
        await interruptAtPublishing(root, runId);
        const runRoot = join(root, ".nbook", "agent", "migrations", "attachment-v1", runId);
        const records = await journalRecords(runRoot);
        const first = records[0];
        expect(first?.kind).toBe("session_transition");
        if (!first) {
            throw new Error("fixture 缺少 session transition");
        }
        mutate(first);
        const journalPath = join(runRoot, "journal.jsonl");
        await writeFile(journalPath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");

        await expect(runAgentAttachmentMigration({rootWorkspace: root, mode: "apply", resume: true}))
            .rejects.toThrow(expected);
        await expect(stat(join(root, ".nbook", "agent", "migrations", "attachment-v1.lock"))).resolves.toBeDefined();
    });

    it.each([
        {
            name: "backup覆盖source",
            mutate: (session: Record<string, unknown>) => {
                session.backupPath = session.sourcePath;
            },
        },
        {
            name: "rollback指向控制文件",
            mutate: (session: Record<string, unknown>) => {
                session.rollbackPath = ".nbook/config.json";
            },
        },
    ])("resume 拒绝manifest中的$name", async ({mutate}) => {
        const root = await createWorkspace();
        roots.push(root);
        await writeLegacySession(root, 41);
        const runId = `manifest-path-${randomUUID()}`;
        await interruptAtPublishing(root, runId);
        const manifestPath = join(root, ".nbook", "agent", "migrations", "attachment-v1", runId, "manifest.json");
        const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {sessions: Record<string, unknown>[]};
        const session = manifest.sessions[0];
        if (!session) {
            throw new Error("fixture 缺少 migration session");
        }
        mutate(session);
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

        await expect(runAgentAttachmentMigration({rootWorkspace: root, mode: "apply", resume: true}))
            .rejects.toThrow("migration session 路径不属于当前 run 的确定计划");
    });

    it("resume 拒绝Session真相源目录被junction或symlink替换", async () => {
        const root = await createWorkspace();
        roots.push(root);
        await writeLegacySession(root, 41);
        const runId = `manifest-link-${randomUUID()}`;
        await interruptAtPublishing(root, runId);
        const sessionsRoot = join(root, ".nbook", "agent", "sessions");
        const externalRoot = await mkdtemp(testHostPath("nbook-attachment-external-"));
        roots.push(externalRoot);
        await copyFile(join(sessionsRoot, "41.jsonl"), join(externalRoot, "41.jsonl"));
        await rm(sessionsRoot, {recursive: true, force: true});
        await symlink(externalRoot, sessionsRoot, process.platform === "win32" ? "junction" : "dir");

        await expect(runAgentAttachmentMigration({rootWorkspace: root, mode: "apply", resume: true}))
            .rejects.toThrow("migration session 路径包含symlink或junction");
    });

    it("resume 在读取前拒绝超过固定预算的 journal", async () => {
        const root = await createWorkspace();
        roots.push(root);
        await writeLegacySession(root, 41);
        await interruptAtPublishing(root, "oversized-journal-test");
        const journalPath = join(
            root,
            ".nbook",
            "agent",
            "migrations",
            "attachment-v1",
            "oversized-journal-test",
            "journal.jsonl",
        );
        await writeFile(journalPath, Buffer.alloc(9 * 1024 * 1024, 0x78));

        await expect(runAgentAttachmentMigration({rootWorkspace: root, mode: "apply", resume: true}))
            .rejects.toThrow("migration journal 超过");
    });

    it.each(["full_scan_verified", "complete", "report_written"] as const)(
        "%s 阶段中断可恢复，且 report 始终先于 sentinel 释放",
        async (interruptedStatus) => {
            const root = await createWorkspace();
            roots.push(root);
            await writeLegacySession(root, 41);
            const runId = `run-phase-${interruptedStatus}`;
            const runRoot = join(root, ".nbook", "agent", "migrations", "attachment-v1", runId);
            const lockPath = join(root, ".nbook", "agent", "migrations", "attachment-v1.lock");
            let interrupted = false;

            await expect(runAgentAttachmentMigration({
                rootWorkspace: root,
                mode: "apply",
                runId,
                observer: async (event) => {
                    if (!interrupted && event.kind === "run" && event.status === interruptedStatus) {
                        interrupted = true;
                        await expect(stat(lockPath)).resolves.toBeDefined();
                        const reportExists = await stat(join(runRoot, "report.json"))
                            .then(() => true)
                            .catch((error: NodeJS.ErrnoException) => {
                                if (error.code === "ENOENT") return false;
                                throw error;
                            });
                        expect(reportExists).toBe(interruptedStatus === "report_written");
                        throw new Error(`interrupt ${interruptedStatus}`);
                    }
                },
            })).rejects.toThrow(`interrupt ${interruptedStatus}`);
            await expect(stat(lockPath)).resolves.toBeDefined();

            const report = await runAgentAttachmentMigration({rootWorkspace: root, mode: "apply", resume: true});

            expect(report.status).toBe("complete");
            await expect(stat(join(runRoot, "report.json"))).resolves.toBeDefined();
            await expect(stat(lockPath)).rejects.toMatchObject({code: "ENOENT"});
            const manifest = JSON.parse(await readFile(join(runRoot, "manifest.json"), "utf8")) as {status: string};
            expect(manifest.status).toBe("report_written");
        },
    );

    it("final checkpoint 与完整 WAL 可共同回放，checkpoint 后遗留 sentinel 可安全释放", async () => {
        const root = await createWorkspace();
        roots.push(root);
        await writeLegacySession(root, 41);
        const runId = "checkpoint-resume-test";
        await runAgentAttachmentMigration({rootWorkspace: root, mode: "apply", runId});
        const manifestRelative = `.nbook/agent/migrations/attachment-v1/${runId}/manifest.json`;
        const lockPath = join(root, ".nbook", "agent", "migrations", "attachment-v1.lock");
        await writeFile(lockPath, `${JSON.stringify({
            version: 1,
            runId,
            pid: process.pid,
            startedAt: new Date().toISOString(),
            manifestPath: manifestRelative,
        })}\n`, "utf8");
        const checkpointTemp = join(root, ...`${manifestRelative}.next`.split("/"));
        await writeFile(checkpointTemp, "partial checkpoint", "utf8");

        const report = await runAgentAttachmentMigration({rootWorkspace: root, mode: "apply", resume: true});

        expect(report.status).toBe("complete");
        await expect(stat(lockPath)).rejects.toMatchObject({code: "ENOENT"});
        const manifest = JSON.parse(await readFile(join(root, ...manifestRelative.split("/")), "utf8")) as {
            status: string;
            appliedSeq: number;
        };
        expect(manifest.status).toBe("report_written");
        expect(manifest.appliedSeq).toBeGreaterThan(0);
        await expect(stat(checkpointTemp)).rejects.toMatchObject({code: "ENOENT"});
    });

    it("完整apply可按同一run幂等回滚到原始session hash", async () => {
        const root = await createWorkspace();
        roots.push(root);
        const sessionPath = await writeLegacySession(root, 41);
        const source = await readFile(sessionPath, "utf8");
        await runAgentAttachmentMigration({rootWorkspace: root, mode: "apply", runId: "rollback-complete"});
        expect(await readFile(sessionPath, "utf8")).not.toBe(source);

        const report = await rollbackAgentAttachmentMigration({rootWorkspace: root, runId: "rollback-complete"});
        const repeated = await rollbackAgentAttachmentMigration({rootWorkspace: root, runId: "rollback-complete"});

        expect(report).toEqual({version: 1, runId: "rollback-complete", status: "rolled_back", restoredSessions: 1});
        expect(repeated).toEqual(report);
        await expect(readFile(sessionPath, "utf8")).resolves.toBe(source);
        const runRoot = join(root, ".nbook", "agent", "migrations", "attachment-v1", "rollback-complete");
        const manifest = JSON.parse(await readFile(join(runRoot, "manifest.json"), "utf8")) as {
            status: string;
            sessions: Array<{status: string}>;
        };
        expect(manifest.status).toBe("rolled_back");
        expect(manifest.sessions[0]?.status).toBe("rolled_back");
        await expect(stat(join(root, ".nbook", "agent", "migrations", "attachment-v1.lock")))
            .rejects.toMatchObject({code: "ENOENT"});
    });

    it("apply在initial manifest前崩溃时回滚只清理同run lock", async () => {
        const root = await createWorkspace();
        roots.push(root);
        const runId = "unstarted-rollback";
        const manifestRelative = `.nbook/agent/migrations/attachment-v1/${runId}/manifest.json`;
        const lockPath = join(root, ".nbook", "agent", "migrations", "attachment-v1.lock");
        await mkdir(dirname(lockPath), {recursive: true});
        await writeFile(lockPath, `${JSON.stringify({
            version: 1,
            runId,
            pid: process.pid,
            startedAt: new Date().toISOString(),
            manifestPath: manifestRelative,
        })}\n`, "utf8");

        const report = await rollbackAgentAttachmentMigration({rootWorkspace: root, runId});

        expect(report).toEqual({version: 1, runId, status: "not_started", restoredSessions: 0});
        await expect(stat(lockPath)).rejects.toMatchObject({code: "ENOENT"});
    });

    it("正向apply在published后中断时，rollback先完成apply再恢复原session", async () => {
        const root = await createWorkspace();
        roots.push(root);
        const sessionPath = await writeLegacySession(root, 41);
        const source = await readFile(sessionPath, "utf8");
        let interrupted = false;
        await expect(runAgentAttachmentMigration({
            rootWorkspace: root,
            mode: "apply",
            runId: "rollback-forward-interruption",
            observer: (event) => {
                if (!interrupted && event.kind === "session" && event.status === "published") {
                    interrupted = true;
                    throw new Error("interrupt after published");
                }
            },
        })).rejects.toThrow("interrupt after published");

        const report = await rollbackAgentAttachmentMigration({
            rootWorkspace: root,
            runId: "rollback-forward-interruption",
        });

        expect(report.status).toBe("rolled_back");
        await expect(readFile(sessionPath, "utf8")).resolves.toBe(source);
    });

    it("rollback自身在publishing阶段中断后可由同一run继续", async () => {
        const root = await createWorkspace();
        roots.push(root);
        const sessionPath = await writeLegacySession(root, 41);
        const source = await readFile(sessionPath, "utf8");
        await runAgentAttachmentMigration({rootWorkspace: root, mode: "apply", runId: "rollback-resume"});
        let interrupted = false;
        await expect(rollbackAgentAttachmentMigration({
            rootWorkspace: root,
            runId: "rollback-resume",
            observer: (event) => {
                if (!interrupted && event.status === "rollback_publishing") {
                    interrupted = true;
                    throw new Error("interrupt rollback publishing");
                }
            },
        })).rejects.toThrow("interrupt rollback publishing");
        await expect(stat(join(root, ".nbook", "agent", "migrations", "attachment-v1.lock"))).resolves.toBeDefined();
        const runRoot = join(root, ".nbook", "agent", "migrations", "attachment-v1", "rollback-resume");
        const rollbackPath = join(runRoot, "rollbacks", ".nbook", "agent", "sessions", "41.jsonl.rollback");
        await mkdir(dirname(rollbackPath), {recursive: true});
        await rename(sessionPath, rollbackPath);

        const report = await rollbackAgentAttachmentMigration({rootWorkspace: root, runId: "rollback-resume"});

        expect(report.status).toBe("rolled_back");
        await expect(readFile(sessionPath, "utf8")).resolves.toBe(source);
        await expect(stat(join(root, ".nbook", "agent", "migrations", "attachment-v1.lock")))
            .rejects.toMatchObject({code: "ENOENT"});
    });
});

/** 创建只包含 Agent session 根的隔离 Workspace Root。 */
async function createWorkspace(): Promise<string> {
    const root = await mkdtemp(testHostPath("nbook-agent-attachment-migration-"));
    await mkdir(join(root, ".nbook", "agent", "sessions"), {recursive: true});
    return root;
}

/** 写入一个带 Pi 内联图片 tool result 的历史 session。 */
async function writeLegacySession(
    root: string,
    sessionId: number,
    options: {includeQueue?: boolean; imageBytes?: Uint8Array} = {},
): Promise<string> {
    const sessionPath = join(root, ".nbook", "agent", "sessions", `${String(sessionId)}.jsonl`);
    const imageBytes = options.imageBytes ?? PNG_BYTES;
    const records: object[] = [
        {
            kind: "header",
            metadata: {
                sessionId,
                profileKey: "leader.default",
                initial: {},
                workspaceRoot: root,
                workspaceKey: "global",
                createdAt: 1,
            },
        },
        {
            kind: "entry",
            entry: {
                id: randomUUID(),
                parentId: null,
                timestamp: 2,
                type: "message",
                message: {
                    role: "toolResult",
                    toolCallId: "read-image",
                    toolName: "read",
                    content: [
                        {type: "text", text: "Read image file [image/png]"},
                        {type: "image", mimeType: "image/png", data: Buffer.from(imageBytes).toString("base64")},
                    ],
                    details: {path: "reference/image.png"},
                    isError: false,
                    timestamp: 2,
                },
            },
        },
    ];
    if (options.includeQueue) {
        records.push({
            kind: "entry",
            entry: {
                id: randomUUID(),
                parentId: null,
                timestamp: 3,
                type: "custom",
                key: "agent.followUpQueue",
                value: {
                    status: "ready",
                    items: [{
                        id: randomUUID(),
                        kind: "followup",
                        createdAt: 3,
                        message: {
                            text: "继续分析图片",
                            images: [{mimeType: "image/png", data: Buffer.from(imageBytes).toString("base64"), name: "queue.png"}],
                        },
                    }],
                },
            },
        });
    }
    await writeFile(sessionPath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
    return sessionPath;
}

/** 写入无需转换的 stored session，用于验证 initial verified 状态。 */
async function writeStoredSession(root: string, sessionId: number): Promise<string> {
    const sessionPath = join(root, ".nbook", "agent", "sessions", `${String(sessionId)}.jsonl`);
    const records = [
        {
            kind: "header",
            metadata: {
                sessionId,
                profileKey: "leader.default",
                initial: {},
                workspaceRoot: root,
                workspaceKey: "global",
                createdAt: 1,
            },
        },
        {
            kind: "entry",
            entry: {
                id: randomUUID(),
                parentId: null,
                timestamp: 2,
                type: "message",
                clientMessageId: randomUUID(),
                intent: "normal",
                message: {
                    role: "user",
                    content: [{type: "text", text: "already stored"}],
                    timestamp: 2,
                },
            },
        },
    ];
    await writeFile(sessionPath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
    return sessionPath;
}

/** 在 session 已持久化 publishing delta 后模拟进程中断。 */
async function interruptAtPublishing(root: string, runId: string): Promise<void> {
    let interrupted = false;
    await expect(runAgentAttachmentMigration({
        rootWorkspace: root,
        mode: "apply",
        runId,
        observer: (event) => {
            if (!interrupted && event.kind === "session" && event.status === "publishing") {
                interrupted = true;
                throw new Error("simulated process interruption");
            }
        },
    })).rejects.toThrow("simulated process interruption");
}

type JournalRecordView = {
    kind: "session_transition" | "run_transition";
    seq: number;
    sourcePath?: string;
    runId: string;
    from: string;
    to: string;
};

/** 读取测试 run 的完整 WAL 行。 */
async function journalRecords(runRoot: string): Promise<JournalRecordView[]> {
    return (await readFile(join(runRoot, "journal.jsonl"), "utf8"))
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as JournalRecordView);
}

/** 计算报告使用的文件 SHA-256。 */
function sha256(value: string | Uint8Array): string {
    return createHash("sha256").update(value).digest("hex");
}

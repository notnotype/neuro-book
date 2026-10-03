import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {createHash, randomUUID} from "node:crypto";
import {access, appendFile, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {readAgentSessionStoreSentinel} from "nbook/server/agent/session/agent-session-store";
import {
    rollbackSessionSchemaV2Migration,
    runSessionSchemaV2Migration,
} from "nbook/server/agent/session/migrations/session-v2/migration";

const MIGRATION_TIMESTAMP = 1_800_000_000_000;

describe("Session schema v2 offline migration", () => {
    const roots: string[] = [];

    afterEach(async () => {
        await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
    });

    it("dry-run完整规划v1 Session且不写sentinel、run或源文件", async () => {
        const root = nextRoot();
        const sourcePath = resolve(root, ".nbook", "agent", "sessions", "1.jsonl");
        const source = legacySessionText();
        await mkdir(dirname(sourcePath), {recursive: true});
        await writeFile(sourcePath, source, "utf8");

        const report = await runSessionSchemaV2Migration({
            rootWorkspace: root,
            mode: "dry-run",
            runId: "dry-run-test",
            migrationTimestamp: MIGRATION_TIMESTAMP,
        });

        expect(report).toMatchObject({
            version: 1,
            runId: "dry-run-test",
            mode: "dry-run",
            status: "planned",
            scannedSessions: 1,
            migratedSessions: 1,
            skippedSessions: 0,
            reviewSessions: 0,
            sessions: [{
                sessionId: 1,
                sourcePath: ".nbook/agent/sessions/1.jsonl",
                classification: "workspace_root",
                status: "pending",
            }],
        });
        await expect(readFile(sourcePath, "utf8")).resolves.toBe(source);
        await expect(exists(resolve(root, ".nbook", "agent", "migrations", "session-store.json")))
            .resolves.toBe(false);
        await expect(exists(resolve(root, ".nbook", "agent", "migrations", "session-v2", "dry-run-test")))
            .resolves.toBe(false);
    });

    it("Project inventory只接受一级物理目录中的合法manifest且不执行ensure", async () => {
        const root = nextRoot();
        const sessionsRoot = resolve(root, ".nbook", "agent", "sessions");
        const validRoot = resolve(root, "story");
        const corruptRoot = resolve(root, "broken");
        await Promise.all([
            mkdir(sessionsRoot, {recursive: true}),
            mkdir(validRoot, {recursive: true}),
            mkdir(corruptRoot, {recursive: true}),
        ]);
        await Promise.all([
            writeFile(resolve(validRoot, "project.yaml"), "kind: novel\ntitle: Story\nsummary: ''\n", "utf8"),
            writeFile(resolve(corruptRoot, "project.yaml"), "kind: [\n", "utf8"),
            writeFile(resolve(sessionsRoot, "1.jsonl"), legacySessionText({sessionId: 1, projectRoot: "story"}), "utf8"),
            writeFile(resolve(sessionsRoot, "2.jsonl"), legacySessionText({sessionId: 2, projectRoot: "broken"}), "utf8"),
        ]);

        const report = await runSessionSchemaV2Migration({
            rootWorkspace: root,
            mode: "dry-run",
            runId: "project-inventory-test",
            migrationTimestamp: MIGRATION_TIMESTAMP,
        });

        expect(report.sessions).toEqual(expect.arrayContaining([
            expect.objectContaining({sessionId: 1, classification: "managed", currentProjectRoot: "story"}),
            expect.objectContaining({sessionId: 2, classification: "stale_managed", currentProjectRoot: "broken"}),
        ]));
        await expect(readFile(resolve(corruptRoot, "project.yaml"), "utf8")).resolves.toBe("kind: [\n");
        await expect(exists(resolve(corruptRoot, ".nbook"))).resolves.toBe(false);
    });

    it("dry-run区分空的未初始化store与可信complete v2 store", async () => {
        const emptyRoot = nextRoot();
        const currentRoot = nextRoot();
        await writeCommittedStore(currentRoot, "already-current-test");

        const empty = await runSessionSchemaV2Migration({
            rootWorkspace: emptyRoot,
            mode: "dry-run",
            runId: "empty-store-test",
            migrationTimestamp: MIGRATION_TIMESTAMP,
        });
        const current = await runSessionSchemaV2Migration({
            rootWorkspace: currentRoot,
            mode: "dry-run",
            runId: "must-not-be-created",
            migrationTimestamp: MIGRATION_TIMESTAMP,
        });

        expect(empty).toMatchObject({
            runId: "empty-store-test",
            status: "planned",
            scannedSessions: 0,
            migratedSessions: 0,
        });
        expect(current).toMatchObject({
            runId: "already-current-test",
            status: "already_current",
            scannedSessions: 0,
            migratedSessions: 0,
        });
        await expect(exists(resolve(
            currentRoot,
            ".nbook",
            "agent",
            "migrations",
            "session-v2",
            "must-not-be-created",
        ))).resolves.toBe(false);
    });

    it("apply逐字节备份Session并以hash/checkpoint绑定complete sentinel", async () => {
        const root = nextRoot();
        const sourcePath = resolve(root, ".nbook", "agent", "sessions", "1.jsonl");
        const source = legacySessionText();
        await mkdir(dirname(sourcePath), {recursive: true});
        await writeFile(sourcePath, source, "utf8");

        const report = await runSessionSchemaV2Migration({
            rootWorkspace: root,
            mode: "apply",
            runId: "apply-test",
            migrationTimestamp: MIGRATION_TIMESTAMP,
        });

        expect(report).toMatchObject({
            runId: "apply-test",
            mode: "apply",
            status: "complete",
            scannedSessions: 1,
            migratedSessions: 1,
            sessions: [{sourcePath: ".nbook/agent/sessions/1.jsonl", status: "verified"}],
        });
        const target = await readFile(sourcePath, "utf8");
        expect(sessionMetadata(target)).toMatchObject({schemaVersion: 2, sessionId: 1});
        expect(sessionMetadata(target)).not.toHaveProperty("workspaceRoot");
        const runRoot = resolve(root, ".nbook", "agent", "migrations", "session-v2", "apply-test");
        await expect(readFile(resolve(
            runRoot,
            "backups",
            ".nbook",
            "agent",
            "sessions",
            "1.jsonl.backup",
        ), "utf8")).resolves.toBe(source);

        const sentinel = await readAgentSessionStoreSentinel(root);
        const manifestPath = resolve(root, ...sentinel.manifestPath.split("/"));
        const manifestText = await readFile(manifestPath, "utf8");
        const manifest = JSON.parse(manifestText) as {runId: string; status: string; appliedSeq: number};
        expect(sentinel).toMatchObject({
            state: "complete",
            sourceSchemaVersion: 1,
            targetSchemaVersion: 2,
            runId: "apply-test",
            checkpointCursor: manifest.appliedSeq,
        });
        expect(manifest).toMatchObject({runId: "apply-test", status: "report_written"});
        expect(sentinel.manifestHash).toBe(createHash("sha256").update(manifestText).digest("hex"));
    });

    it("apply中断后只通过显式resume恢复同一run并完成", async () => {
        const root = nextRoot();
        const sourcePath = resolve(root, ".nbook", "agent", "sessions", "1.jsonl");
        const source = legacySessionText();
        await mkdir(dirname(sourcePath), {recursive: true});
        await writeFile(sourcePath, source, "utf8");
        let interrupted = false;

        await expect(runSessionSchemaV2Migration({
            rootWorkspace: root,
            mode: "apply",
            runId: "resume-test",
            migrationTimestamp: MIGRATION_TIMESTAMP,
            observer: (event) => {
                if (!interrupted && event.kind === "session" && event.status === "published") {
                    interrupted = true;
                    throw new Error("injected interruption");
                }
            },
        })).rejects.toThrow("injected interruption");
        await expect(readAgentSessionStoreSentinel(root)).resolves.toMatchObject({
            state: "rollback_required",
            runId: "resume-test",
        });
        await expect(runSessionSchemaV2Migration({
            rootWorkspace: root,
            mode: "apply",
            runId: "other-run",
            resume: true,
        })).rejects.toThrow("不能恢复");

        const report = await runSessionSchemaV2Migration({
            rootWorkspace: root,
            mode: "apply",
            runId: "resume-test",
            resume: true,
        });

        expect(report).toMatchObject({
            runId: "resume-test",
            status: "complete",
            sessions: [{sourcePath: ".nbook/agent/sessions/1.jsonl", status: "verified"}],
        });
        expect(sessionMetadata(await readFile(sourcePath, "utf8"))).toMatchObject({schemaVersion: 2});
        await expect(readAgentSessionStoreSentinel(root)).resolves.toMatchObject({
            state: "complete",
            runId: "resume-test",
        });
    });

    it("rollback逐字节恢复旧Session并发布上一schema的complete sentinel", async () => {
        const root = nextRoot();
        const sourcePath = resolve(root, ".nbook", "agent", "sessions", "1.jsonl");
        const source = legacySessionText();
        await mkdir(dirname(sourcePath), {recursive: true});
        await writeFile(sourcePath, source, "utf8");
        await runSessionSchemaV2Migration({
            rootWorkspace: root,
            mode: "apply",
            runId: "rollback-test",
            migrationTimestamp: MIGRATION_TIMESTAMP,
        });

        const report = await rollbackSessionSchemaV2Migration({
            rootWorkspace: root,
            runId: "rollback-test",
        });

        expect(report).toEqual({
            version: 1,
            runId: "rollback-test",
            status: "rolled_back",
            restoredSessions: 1,
        });
        await expect(readFile(sourcePath, "utf8")).resolves.toBe(source);
        await expect(readAgentSessionStoreSentinel(root)).resolves.toMatchObject({
            state: "complete",
            sourceSchemaVersion: 2,
            targetSchemaVersion: 1,
            runId: "rollback-test",
        });
        await expect(rollbackSessionSchemaV2Migration({
            rootWorkspace: root,
            runId: "rollback-test",
        })).resolves.toEqual(report);
        await expect(readFile(sourcePath, "utf8")).resolves.toBe(source);
    });

    it("rollback可直接收敛apply中断状态并恢复旧Session", async () => {
        const root = nextRoot();
        const sourcePath = resolve(root, ".nbook", "agent", "sessions", "1.jsonl");
        const source = legacySessionText();
        await mkdir(dirname(sourcePath), {recursive: true});
        await writeFile(sourcePath, source, "utf8");
        let interrupted = false;
        await expect(runSessionSchemaV2Migration({
            rootWorkspace: root,
            mode: "apply",
            runId: "interrupted-rollback-test",
            migrationTimestamp: MIGRATION_TIMESTAMP,
            observer: (event) => {
                if (!interrupted && event.kind === "session" && event.status === "backed_up") {
                    interrupted = true;
                    throw new Error("interrupt after backup");
                }
            },
        })).rejects.toThrow("interrupt after backup");

        await expect(rollbackSessionSchemaV2Migration({
            rootWorkspace: root,
            runId: "interrupted-rollback-test",
        })).resolves.toMatchObject({status: "rolled_back", restoredSessions: 1});
        await expect(readFile(sourcePath, "utf8")).resolves.toBe(source);
        await expect(readAgentSessionStoreSentinel(root)).resolves.toMatchObject({
            state: "complete",
            targetSchemaVersion: 1,
        });
    });

    it("apply中断后拒绝开新run，只能resume或rollback", async () => {
        const root = await interruptedRoot("no-new-run-test");

        await expect(runSessionSchemaV2Migration({
            rootWorkspace: root,
            mode: "apply",
            runId: "a-different-run",
            migrationTimestamp: MIGRATION_TIMESTAMP,
        })).rejects.toMatchObject({code: "AGENT_SESSION_RECOVERY_REQUIRED"});
        await expect(exists(runRoot(root, "a-different-run"))).resolves.toBe(false);
    });

    it("WAL被追加伪造记录后拒绝resume", async () => {
        const root = await interruptedRoot("wal-tamper-test");
        const journalPath = resolve(runRoot(root, "wal-tamper-test"), "journal.jsonl");
        // seq 与真实 WAL 长度冲突的伪造记录：严格回放必须发现序号不连续。
        await appendFile(journalPath, `${JSON.stringify({
            version: 1,
            kind: "run_transition",
            seq: 999,
            runId: "wal-tamper-test",
            at: "2027-01-15T08:00:00.000Z",
            from: "running",
            to: "complete",
        })}\n`, "utf8");

        await expect(runSessionSchemaV2Migration({
            rootWorkspace: root,
            mode: "apply",
            runId: "wal-tamper-test",
            resume: true,
        })).rejects.toThrow(/journal seq 不连续/u);
    });

    it("manifest checkpoint被改成他run后拒绝resume", async () => {
        const root = await interruptedRoot("manifest-tamper-test");
        const manifestPath = resolve(runRoot(root, "manifest-tamper-test"), "manifest.json");
        const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {runId: string};
        manifest.runId = "someone-elses-run";
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

        await expect(runSessionSchemaV2Migration({
            rootWorkspace: root,
            mode: "apply",
            runId: "manifest-tamper-test",
            resume: true,
        })).rejects.toMatchObject({code: "AGENT_SESSION_STORE_CORRUPT"});
    });

    it("lease内Session文件集合变化时fullScan拒绝收尾", async () => {
        const root = nextRoot();
        const sessionsRoot = resolve(root, ".nbook", "agent", "sessions");
        await mkdir(sessionsRoot, {recursive: true});
        await writeFile(resolve(sessionsRoot, "1.jsonl"), legacySessionText(), "utf8");
        let injected = false;

        await expect(runSessionSchemaV2Migration({
            rootWorkspace: root,
            mode: "apply",
            runId: "file-set-change-test",
            migrationTimestamp: MIGRATION_TIMESTAMP,
            observer: async (event) => {
                if (injected || event.kind !== "session" || event.status !== "verified") return;
                injected = true;
                // 计划冻结之后才出现的第三方写入：全库复扫必须拒绝，不能默默放过。
                await writeFile(
                    resolve(sessionsRoot, "2.jsonl"),
                    legacySessionText({sessionId: 2}),
                    "utf8",
                );
            },
        })).rejects.toThrow(/文件集合发生变化/u);
        await expect(readAgentSessionStoreSentinel(root)).resolves.toMatchObject({
            state: "rollback_required",
            runId: "file-set-change-test",
        });
    });

    it("sentinel指向的run目录缺失时rollback fail closed", async () => {
        const root = nextRoot();
        const sourcePath = resolve(root, ".nbook", "agent", "sessions", "1.jsonl");
        await mkdir(dirname(sourcePath), {recursive: true});
        await writeFile(sourcePath, legacySessionText(), "utf8");
        await runSessionSchemaV2Migration({
            rootWorkspace: root,
            mode: "apply",
            runId: "missing-run-test",
            migrationTimestamp: MIGRATION_TIMESTAMP,
        });
        await rm(runRoot(root, "missing-run-test"), {recursive: true, force: true});

        await expect(rollbackSessionSchemaV2Migration({
            rootWorkspace: root,
            runId: "missing-run-test",
        })).rejects.toMatchObject({code: "AGENT_SESSION_STORE_CORRUPT"});
    });

    it("从未开始的run rollback返回not_started且不创建任何产物", async () => {
        const root = nextRoot();
        await mkdir(resolve(root, ".nbook", "agent", "sessions"), {recursive: true});

        await expect(rollbackSessionSchemaV2Migration({
            rootWorkspace: root,
            runId: "never-started-test",
        })).resolves.toEqual({
            version: 1,
            runId: "never-started-test",
            status: "not_started",
            restoredSessions: 0,
        });
        await expect(exists(resolve(root, ".nbook", "agent", "migrations", "session-store.json")))
            .resolves.toBe(false);
        await expect(exists(runRoot(root, "never-started-test"))).resolves.toBe(false);
    });

    it("初始manifest已写但sentinel未发布时可安全resume或rollback", async () => {
        const resumeRoot = nextRoot();
        await writeUnpublishedInitialManifest(resumeRoot, "unpublished-resume");

        await expect(runSessionSchemaV2Migration({
            rootWorkspace: resumeRoot,
            mode: "apply",
            runId: "unpublished-resume",
            resume: true,
        })).resolves.toMatchObject({status: "complete", runId: "unpublished-resume"});
        await expect(readAgentSessionStoreSentinel(resumeRoot)).resolves.toMatchObject({
            state: "complete",
            runId: "unpublished-resume",
        });

        const rollbackRoot = nextRoot();
        await writeUnpublishedInitialManifest(rollbackRoot, "unpublished-rollback");
        await expect(rollbackSessionSchemaV2Migration({
            rootWorkspace: rollbackRoot,
            runId: "unpublished-rollback",
        })).resolves.toEqual({
            version: 1,
            runId: "unpublished-rollback",
            status: "not_started",
            restoredSessions: 0,
        });
        await expect(exists(runRoot(rollbackRoot, "unpublished-rollback"))).resolves.toBe(false);
    });

    /** 为当前用例分配隔离 Workspace Root。 */
    function nextRoot(): string {
        const root = testHostPath("session-v2-migration-test", randomUUID());
        roots.push(root);
        return root;
    }

    /** 建立一个在 published 处被打断、停在 rollback_required 的 apply run。 */
    async function interruptedRoot(runId: string): Promise<string> {
        const root = nextRoot();
        const sourcePath = resolve(root, ".nbook", "agent", "sessions", "1.jsonl");
        await mkdir(dirname(sourcePath), {recursive: true});
        await writeFile(sourcePath, legacySessionText(), "utf8");
        let interrupted = false;
        await expect(runSessionSchemaV2Migration({
            rootWorkspace: root,
            mode: "apply",
            runId,
            migrationTimestamp: MIGRATION_TIMESTAMP,
            observer: (event) => {
                if (!interrupted && event.kind === "session" && event.status === "published") {
                    interrupted = true;
                    throw new Error("injected interruption");
                }
            },
        })).rejects.toThrow("injected interruption");
        return root;
    }

    /** 模拟writeInitialManifest与首次sentinel原子发布之间的进程退出。 */
    async function writeUnpublishedInitialManifest(root: string, runId: string): Promise<void> {
        const rootPath = runRoot(root, runId);
        const now = new Date(MIGRATION_TIMESTAMP).toISOString();
        await mkdir(rootPath, {recursive: true});
        await writeFile(resolve(rootPath, "manifest.json"), `${JSON.stringify({
            version: 1,
            journalVersion: 1,
            runId,
            status: "running",
            appliedSeq: 0,
            startedAt: now,
            updatedAt: now,
            sessions: [],
        }, null, 4)}\n`, "utf8");
    }
});

/** 指定 run 的迁移产物目录。 */
function runRoot(root: string, runId: string): string {
    return resolve(root, ".nbook", "agent", "migrations", "session-v2", runId);
}

/** 构造decoder可接受的最小Workspace Root schema v1 Session。 */
function legacySessionText(options: {sessionId?: number; projectRoot?: string} = {}): string {
    const sessionId = options.sessionId ?? 1;
    const messageId = `message_${String(sessionId)}`;
    const projectPath = options.projectRoot ? `workspace/${options.projectRoot}` : undefined;
    return [
        JSON.stringify({
            kind: "header",
            metadata: {
                sessionId,
                profileKey: "leader.default",
                initial: {},
                workspaceRoot: projectPath ?? "workspace",
                workspaceKey: projectPath ?? "global",
                ...(projectPath ? {projectPath} : {}),
                createdAt: MIGRATION_TIMESTAMP - 10_000,
            },
        }),
        JSON.stringify({
            kind: "batch",
            entries: [
                {
                    type: "message",
                    id: messageId,
                    parentId: null,
                    timestamp: MIGRATION_TIMESTAMP - 1_000,
                    origin: "harness",
                    message: {
                        role: "user",
                        content: [{type: "text", text: "hello"}],
                        timestamp: MIGRATION_TIMESTAMP - 1_000,
                    },
                },
                {
                    type: "leaf",
                    id: "source_leaf",
                    parentId: messageId,
                    timestamp: MIGRATION_TIMESTAMP - 500,
                    leafId: messageId,
                    origin: "auto",
                },
            ],
        }),
        "",
    ].join("\n");
}

/** 读取测试 Session 的唯一 header metadata。 */
function sessionMetadata(text: string): {[key: string]: unknown} {
    const records = text.trimEnd().split(/\r?\n/u).map((line) => JSON.parse(line) as {
        kind?: string;
        metadata?: {[key: string]: unknown};
    });
    const metadata = records.find((record) => record.kind === "header")?.metadata;
    if (!metadata) throw new Error("fixture缺少header metadata");
    return metadata;
}

/** 判断测试产物是否存在。 */
async function exists(path: string): Promise<boolean> {
    return access(path).then(() => true).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false;
        throw error;
    });
}

/** 写入 runtime 可验证的 complete v2 sentinel 与 checkpoint manifest。 */
async function writeCommittedStore(root: string, runId: string): Promise<void> {
    const manifestPath = `.nbook/agent/migrations/session-v2/${runId}/manifest.json`;
    const manifestText = `${JSON.stringify({
        version: 1,
        journalVersion: 1,
        runId,
        status: "report_written",
        appliedSeq: 3,
        startedAt: "2027-01-15T08:00:00.000Z",
        updatedAt: "2027-01-15T08:00:03.000Z",
        sessions: [],
    }, null, 2)}\n`;
    const absoluteManifest = resolve(root, ...manifestPath.split("/"));
    await mkdir(dirname(absoluteManifest), {recursive: true});
    await writeFile(absoluteManifest, manifestText, "utf8");
    await writeFile(resolve(dirname(absoluteManifest), "journal.jsonl"), [
        JSON.stringify({
            version: 1,
            kind: "run_transition",
            seq: 1,
            runId,
            at: "2027-01-15T08:00:01.000Z",
            from: "running",
            to: "full_scan_verified",
        }),
        JSON.stringify({
            version: 1,
            kind: "run_transition",
            seq: 2,
            runId,
            at: "2027-01-15T08:00:02.000Z",
            from: "full_scan_verified",
            to: "complete",
        }),
        JSON.stringify({
            version: 1,
            kind: "run_transition",
            seq: 3,
            runId,
            at: "2027-01-15T08:00:03.000Z",
            from: "complete",
            to: "report_written",
        }),
        "",
    ].join("\n"), "utf8");
    const sentinelPath = resolve(root, ".nbook", "agent", "migrations", "session-store.json");
    await writeFile(sentinelPath, `${JSON.stringify({
        sentinelVersion: 1,
        state: "complete",
        sourceSchemaVersion: 1,
        targetSchemaVersion: 2,
        runId,
        manifestPath,
        manifestHash: createHash("sha256").update(manifestText).digest("hex"),
        checkpointCursor: 3,
    }, null, 2)}\n`, "utf8");
}

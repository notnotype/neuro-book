import {lstat, mkdir, open, readFile, rename, rm} from "node:fs/promises";
import {dirname, relative, resolve} from "node:path";
import {syncParentDirectories} from "nbook/server/agent/session/migrations/shared/durable-file";
import type {
    SessionMigrationFileState,
    SessionMigrationJournalCodec,
    SessionMigrationJournalPaths,
    SessionMigrationJournalRecord,
    SessionMigrationManifest,
    SessionMigrationRunTransition,
    SessionMigrationTransition,
} from "nbook/server/agent/session/migrations/shared/types";

const JOURNAL_BYTE_LIMIT = 8 * 1024 * 1024;
const JOURNAL_LINE_BYTE_LIMIT = 64 * 1024;
const ERROR_BYTE_LIMIT = 4096;
const RUN_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const BASE_SESSION_FIELDS = [
    "sourcePath",
    "backupPath",
    "stagePath",
    "rollbackPath",
    "sourceHash",
    "targetHash",
    "changed",
    "status",
] as const;

type Manifest<
    TVersion extends number,
    TSession extends SessionMigrationFileState<TSessionStatus>,
    TSessionStatus extends string,
    TRunStatus extends string,
    TResumeStatus extends TRunStatus,
> = SessionMigrationManifest<TVersion, TSession, TSessionStatus, TRunStatus, TResumeStatus>;

type JournalRecord<TSessionStatus extends string, TRunStatus extends string> =
    SessionMigrationJournalRecord<TSessionStatus, TRunStatus>;

/**
 * Session JSONL 离线迁移的 WAL/checkpoint Module。
 *
 * Module 集中拥有 seq、状态图、crash tail、大小预算和路径 ownership；领域
 * codec 只声明序列化状态字符串与单 session 的额外计划字段。
 */
export class SessionMigrationJournal<
    TVersion extends number,
    TSessionStatus extends string,
    TRunStatus extends string,
    TResumeStatus extends TRunStatus,
    TSession extends SessionMigrationFileState<TSessionStatus>,
> {
    private readonly sessionStatuses: ReadonlySet<TSessionStatus>;
    private readonly runStatuses: ReadonlySet<TRunStatus>;
    private readonly resumeStatuses: ReadonlySet<TRunStatus>;
    private readonly sessionGraph: ReadonlyMap<TSessionStatus, readonly TSessionStatus[]>;

    /** 构造并验证领域状态映射，防止两个阶段序列化为同一个字符串。 */
    constructor(private readonly codec: SessionMigrationJournalCodec<
        TVersion,
        TSession,
        TSessionStatus,
        TRunStatus,
        TResumeStatus
    >) {
        const session = codec.status.session;
        const sessionValues = Object.values(session) as TSessionStatus[];
        if (new Set(sessionValues).size !== sessionValues.length) {
            throw new Error("migration session 状态映射存在重复值");
        }
        const run = codec.status.run;
        const runValues = Object.values(run) as TRunStatus[];
        if (new Set(runValues).size !== runValues.length) {
            throw new Error("migration run 状态映射存在重复值");
        }
        this.sessionStatuses = new Set(sessionValues);
        this.runStatuses = new Set(runValues);
        this.resumeStatuses = new Set([
            run.running,
            run.fullScanVerified,
            run.complete,
            run.rollbackRunning,
        ]);
        this.sessionGraph = new Map<TSessionStatus, readonly TSessionStatus[]>([
            [session.pending, [session.backedUp]],
            [session.backedUp, [session.prepared]],
            [session.prepared, [session.staged]],
            [session.staged, [session.publishing]],
            [session.publishing, [session.published, session.prepared]],
            [session.published, [session.verified]],
            [session.verified, [session.rollbackPending]],
            [session.rollbackPending, [session.rollbackPublishing]],
            [session.rollbackPublishing, [session.rolledBack]],
            [session.rolledBack, []],
        ]);
    }

    /** 原子写入只包含初始计划的 manifest；中间进度只进入 WAL。 */
    async writeInitialManifest(
        paths: SessionMigrationJournalPaths,
        manifest: Manifest<TVersion, TSession, TSessionStatus, TRunStatus, TResumeStatus>,
    ): Promise<void> {
        if (manifest.appliedSeq !== 0 || manifest.status !== this.codec.status.run.running) {
            throw new Error("初始 migration manifest 状态无效");
        }
        const parsed = this.parseManifest(manifest, paths);
        await this.assertManifestPathOwnership(paths, parsed);
        await writeAtomicJson(paths.manifestPath, manifest, false);
    }

    /** 在失败恢复点或终态写compact checkpoint。 */
    async checkpointManifest(
        paths: SessionMigrationJournalPaths,
        manifest: Manifest<TVersion, TSession, TSessionStatus, TRunStatus, TResumeStatus>,
    ): Promise<void> {
        const run = this.codec.status.run;
        if (manifest.status !== run.failed
            && manifest.status !== run.reportWritten
            && manifest.status !== run.rolledBack) {
            throw new Error("只有failed、report_written或rolled_back migration可以写checkpoint");
        }
        const parsed = this.parseManifest(manifest, paths);
        await this.assertManifestPathOwnership(paths, parsed);
        await writeAtomicJson(paths.manifestPath, manifest, true);
    }

    /** 读取 manifest 并严格回放连续 WAL；只截断未带换行提交标记的尾记录。 */
    async loadManifest(
        paths: SessionMigrationJournalPaths,
    ): Promise<Manifest<TVersion, TSession, TSessionStatus, TRunStatus, TResumeStatus> | null> {
        const rawManifest = await readFile(paths.manifestPath, "utf8").catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") {
                return null;
            }
            throw error;
        });
        if (rawManifest === null) {
            return null;
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(rawManifest);
        } catch (error) {
            throw new Error(`migration manifest 损坏：${errorMessage(error)}`);
        }
        const checkpoint = this.parseManifest(parsed, paths);
        await this.assertManifestPathOwnership(paths, checkpoint);
        return this.replayJournal(checkpoint, await this.readJournal(paths.journalPath));
    }

    /** append+sync 一条 session delta，成功后再更新内存状态。 */
    async transitionSession(
        paths: SessionMigrationJournalPaths,
        manifest: Manifest<TVersion, TSession, TSessionStatus, TRunStatus, TResumeStatus>,
        session: TSession,
        to: TSessionStatus,
    ): Promise<void> {
        const record: SessionMigrationTransition<TSessionStatus> = {
            version: 1,
            kind: "session_transition",
            seq: manifest.appliedSeq + 1,
            runId: manifest.runId,
            at: new Date().toISOString(),
            sourcePath: session.sourcePath,
            from: session.status,
            to,
        };
        this.validateRecord(record);
        this.assertRecordTransition(manifest, record);
        await appendRecord(paths.journalPath, record);
        this.applyRecord(manifest, record);
    }

    /** append+sync 一条 run delta；failed 保存有界错误供显式 resume。 */
    async transitionRun(
        paths: SessionMigrationJournalPaths,
        manifest: Manifest<TVersion, TSession, TSessionStatus, TRunStatus, TResumeStatus>,
        to: TRunStatus,
        error?: string,
    ): Promise<void> {
        const record: SessionMigrationRunTransition<TRunStatus> = {
            version: 1,
            kind: "run_transition",
            seq: manifest.appliedSeq + 1,
            runId: manifest.runId,
            at: new Date().toISOString(),
            from: manifest.status,
            to,
            ...(to === this.codec.status.run.failed
                ? {error: boundedText(error ?? "migration failed", ERROR_BYTE_LIMIT)}
                : {}),
        };
        this.validateRecord(record);
        this.assertRecordTransition(manifest, record);
        await appendRecord(paths.journalPath, record);
        this.applyRecord(manifest, record);
    }

    /** 从 immutable plan 还原初始状态并回放 WAL。 */
    private replayJournal(
        checkpoint: Manifest<TVersion, TSession, TSessionStatus, TRunStatus, TResumeStatus>,
        records: JournalRecord<TSessionStatus, TRunStatus>[],
    ): Manifest<TVersion, TSession, TSessionStatus, TRunStatus, TResumeStatus> {
        if (checkpoint.appliedSeq > records.length) {
            throw new Error("migration manifest appliedSeq 超出 journal");
        }
        const replay = this.initialState(checkpoint);
        let checkpointVerified = checkpoint.appliedSeq === 0;
        for (let index = 0; index < records.length; index += 1) {
            const record = records[index];
            if (!record || record.seq !== index + 1) {
                throw new Error(`migration journal seq 不连续：期望 ${String(index + 1)}`);
            }
            if (record.runId !== checkpoint.runId) {
                throw new Error(`migration journal 第 ${String(index + 1)} 条 runId 不一致`);
            }
            this.assertRecordTransition(replay, record);
            this.applyRecord(replay, record);
            if (record.seq === checkpoint.appliedSeq) {
                this.assertCheckpoint(checkpoint, replay);
                checkpointVerified = true;
            }
        }
        if (!checkpointVerified) {
            throw new Error("migration manifest checkpoint 无法由 journal 验证");
        }
        return replay;
    }

    /** 从 immutable session 计划构造 WAL 的确定性初始状态。 */
    private initialState(
        manifest: Manifest<TVersion, TSession, TSessionStatus, TRunStatus, TResumeStatus>,
    ): Manifest<TVersion, TSession, TSessionStatus, TRunStatus, TResumeStatus> {
        const session = this.codec.status.session;
        return {
            ...manifest,
            status: this.codec.status.run.running,
            appliedSeq: 0,
            updatedAt: manifest.startedAt,
            sessions: manifest.sessions.map((item) => ({
                ...item,
                status: item.changed ? session.pending : session.verified,
            })),
            resumeStatus: undefined,
            error: undefined,
        };
    }

    /** 验证 checkpoint 与对应 seq 的回放状态完全一致。 */
    private assertCheckpoint(
        checkpoint: Manifest<TVersion, TSession, TSessionStatus, TRunStatus, TResumeStatus>,
        replay: Manifest<TVersion, TSession, TSessionStatus, TRunStatus, TResumeStatus>,
    ): void {
        const checkpointState = {
            status: checkpoint.status,
            appliedSeq: checkpoint.appliedSeq,
            updatedAt: checkpoint.updatedAt,
            resumeStatus: checkpoint.resumeStatus,
            error: checkpoint.error,
            sessions: checkpoint.sessions.map((session) => [session.sourcePath, session.status]),
        };
        const replayState = {
            status: replay.status,
            appliedSeq: replay.appliedSeq,
            updatedAt: replay.updatedAt,
            resumeStatus: replay.resumeStatus,
            error: replay.error,
            sessions: replay.sessions.map((session) => [session.sourcePath, session.status]),
        };
        if (JSON.stringify(checkpointState) !== JSON.stringify(replayState)) {
            throw new Error("migration manifest checkpoint 与 journal 不一致");
        }
    }

    /** 验证 transition 与当前状态、sourcePath 和固定状态图一致。 */
    private assertRecordTransition(
        manifest: Manifest<TVersion, TSession, TSessionStatus, TRunStatus, TResumeStatus>,
        record: JournalRecord<TSessionStatus, TRunStatus>,
    ): void {
        const sessionStatus = this.codec.status.session;
        const runStatus = this.codec.status.run;
        if (record.kind === "session_transition") {
            if (manifest.status !== runStatus.running && manifest.status !== runStatus.rollbackRunning) {
                throw new Error(`migration run=${manifest.status} 时不能推进 session`);
            }
            const session = manifest.sessions.find((item) => item.sourcePath === record.sourcePath);
            if (!session) {
                throw new Error(`migration journal sourcePath 不在 manifest：${record.sourcePath}`);
            }
            if (session.status !== record.from) {
                throw new Error(`${record.sourcePath}: migration journal from=${record.from}，当前为 ${session.status}`);
            }
            const rollbackTransition = record.from === sessionStatus.verified
                || record.from === sessionStatus.rollbackPending
                || record.from === sessionStatus.rollbackPublishing;
            if (!session.changed
                || !this.sessionGraph.get(record.from)?.includes(record.to)
                || rollbackTransition !== (manifest.status === runStatus.rollbackRunning)) {
                throw new Error(`${record.sourcePath}: 非法 migration 状态转换 ${record.from} -> ${record.to}`);
            }
            return;
        }
        if (manifest.status !== record.from) {
            throw new Error(`migration run journal from=${record.from}，当前为 ${manifest.status}`);
        }
        if (record.to === runStatus.failed) {
            if (record.from === runStatus.failed || record.from === runStatus.reportWritten
                || record.from === runStatus.rolledBack || !record.error) {
                throw new Error(`非法 migration run 状态转换 ${record.from} -> ${record.to}`);
            }
            return;
        }
        if (record.from === runStatus.failed) {
            if (!manifest.resumeStatus || record.to !== manifest.resumeStatus || record.error !== undefined) {
                throw new Error(`非法 migration resume 状态转换 failed -> ${record.to}`);
            }
            return;
        }
        const allowed = (record.from === runStatus.running && record.to === runStatus.fullScanVerified)
            || (record.from === runStatus.fullScanVerified && record.to === runStatus.complete)
            || (record.from === runStatus.complete && record.to === runStatus.reportWritten)
            || (record.from === runStatus.reportWritten && record.to === runStatus.rollbackRunning)
            || (record.from === runStatus.rollbackRunning && record.to === runStatus.rolledBack);
        if (!allowed || record.error !== undefined) {
            throw new Error(`非法 migration run 状态转换 ${record.from} -> ${record.to}`);
        }
    }

    /** 将已持久化 record 应用到内存 manifest。 */
    private applyRecord(
        manifest: Manifest<TVersion, TSession, TSessionStatus, TRunStatus, TResumeStatus>,
        record: JournalRecord<TSessionStatus, TRunStatus>,
    ): void {
        if (record.kind === "session_transition") {
            const session = manifest.sessions.find((item) => item.sourcePath === record.sourcePath);
            if (!session) {
                throw new Error(`migration journal sourcePath 不在 manifest：${record.sourcePath}`);
            }
            session.status = record.to;
        } else if (record.to === this.codec.status.run.failed) {
            manifest.resumeStatus = record.from as TResumeStatus;
            manifest.error = record.error;
            manifest.status = this.codec.status.run.failed;
        } else {
            manifest.status = record.to;
            delete manifest.resumeStatus;
            delete manifest.error;
        }
        manifest.appliedSeq = record.seq;
        manifest.updatedAt = record.at;
    }

    /** 有界读取 WAL，并截断没有换行提交标记的 crash tail。 */
    private async readJournal(path: string): Promise<JournalRecord<TSessionStatus, TRunStatus>[]> {
        const handle = await open(path, "r+").catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") {
                return null;
            }
            throw error;
        });
        if (!handle) {
            return [];
        }
        try {
            const fileStat = await handle.stat();
            if (fileStat.size > JOURNAL_BYTE_LIMIT) {
                throw new Error(`migration journal 超过 ${String(JOURNAL_BYTE_LIMIT)} bytes 上限`);
            }
            let bytes = await handle.readFile();
            if (bytes.byteLength > 0 && bytes[bytes.byteLength - 1] !== 0x0a) {
                const committedBytes = bytes.lastIndexOf(0x0a) + 1;
                await handle.truncate(committedBytes);
                await handle.sync();
                bytes = bytes.subarray(0, committedBytes);
            }
            if (bytes.byteLength === 0) {
                return [];
            }
            let text: string;
            try {
                text = new TextDecoder("utf-8", {fatal: true}).decode(bytes);
            } catch (error) {
                throw new Error(`migration journal UTF-8 损坏：${errorMessage(error)}`);
            }
            return text.slice(0, -1).split("\n")
                .map((line, index) => this.parseJournalLine(line, index + 1));
        } finally {
            await handle.close();
        }
    }

    /** 解析一条带换行提交标记的 WAL；完整坏行必须拒绝恢复。 */
    private parseJournalLine(line: string, lineNumber: number): JournalRecord<TSessionStatus, TRunStatus> {
        if (!line || Buffer.byteLength(line, "utf8") > JOURNAL_LINE_BYTE_LIMIT) {
            throw new Error(`migration journal 第 ${String(lineNumber)} 条为空或超过行上限`);
        }
        let value: unknown;
        try {
            value = JSON.parse(line);
        } catch (error) {
            throw new Error(`migration journal 第 ${String(lineNumber)} 条损坏：${errorMessage(error)}`);
        }
        try {
            return this.validateRecord(value);
        } catch (error) {
            throw new Error(`migration journal 第 ${String(lineNumber)} 条无效：${errorMessage(error)}`);
        }
    }

    /** 严格解析单条 delta，不接受未知字段或弱类型。 */
    private validateRecord(value: unknown): JournalRecord<TSessionStatus, TRunStatus> {
        const record = objectValue(value, "migration journal record");
        if (record.kind === "session_transition") {
            assertExactKeys(record, ["version", "kind", "seq", "runId", "at", "sourcePath", "from", "to"]);
            assertRecordBase(record);
            if (typeof record.sourcePath !== "string" || !record.sourcePath
                || !this.isSessionStatus(record.from) || !this.isSessionStatus(record.to)) {
                throw new Error("session transition 字段无效");
            }
            return record as SessionMigrationTransition<TSessionStatus>;
        }
        if (record.kind === "run_transition") {
            assertExactKeys(record, record.error === undefined
                ? ["version", "kind", "seq", "runId", "at", "from", "to"]
                : ["version", "kind", "seq", "runId", "at", "from", "to", "error"]);
            assertRecordBase(record);
            if (!this.isRunStatus(record.from) || !this.isRunStatus(record.to)
                || (record.error !== undefined && (typeof record.error !== "string" || !record.error))) {
                throw new Error("run transition 字段无效");
            }
            return record as SessionMigrationRunTransition<TRunStatus>;
        }
        throw new Error("journal kind 无效");
    }

    /** 严格解析 manifest checkpoint 和 immutable session plan。 */
    private parseManifest(
        value: unknown,
        paths: SessionMigrationJournalPaths,
    ): Manifest<TVersion, TSession, TSessionStatus, TRunStatus, TResumeStatus> {
        const manifest = objectValue(value, "migration manifest");
        assertExactKeys(manifest, [
            "version", "journalVersion", "runId", "status", "appliedSeq", "startedAt", "updatedAt", "sessions",
            ...(manifest.resumeStatus === undefined ? [] : ["resumeStatus"]),
            ...(manifest.error === undefined ? [] : ["error"]),
        ]);
        if (manifest.version !== this.codec.manifestVersion || manifest.journalVersion !== 1
            || typeof manifest.runId !== "string" || !RUN_ID_PATTERN.test(manifest.runId)
            || !this.isRunStatus(manifest.status)
            || !Number.isSafeInteger(manifest.appliedSeq) || (manifest.appliedSeq as number) < 0
            || typeof manifest.startedAt !== "string" || !manifest.startedAt
            || typeof manifest.updatedAt !== "string" || !manifest.updatedAt
            || !Array.isArray(manifest.sessions)) {
            throw new Error("migration manifest 公共字段无效");
        }
        const expectedRunRoot = this.codec.runRoot(manifest.runId);
        if (paths.runRootRelative !== expectedRunRoot) {
            throw new Error("migration manifest runRoot 与 runId 不一致");
        }
        const sessions = manifest.sessions.map((session) => this.parseSessionState(session, expectedRunRoot));
        if (new Set(sessions.map((session) => session.sourcePath)).size !== sessions.length) {
            throw new Error("migration manifest sourcePath 重复");
        }
        if (manifest.status === this.codec.status.run.failed) {
            if (!this.isResumeStatus(manifest.resumeStatus)
                || typeof manifest.error !== "string" || !manifest.error) {
                throw new Error("failed migration manifest 缺少 resumeStatus/error");
            }
        } else if (manifest.resumeStatus !== undefined || manifest.error !== undefined) {
            throw new Error("非 failed migration manifest 不能包含 resumeStatus/error");
        }
        return {...manifest, sessions} as Manifest<TVersion, TSession, TSessionStatus, TRunStatus, TResumeStatus>;
    }

    /** 严格解析通用文件状态，再由 codec 解析领域统计字段。 */
    private parseSessionState(value: unknown, runRootRelative: string): TSession {
        const session = objectValue(value, "migration session");
        const optionalFields = this.codec.optionalSessionFields ?? [];
        assertExactKeys(session, [
            ...BASE_SESSION_FIELDS,
            ...this.codec.sessionFields,
            ...optionalFields.filter((field) => session[field] !== undefined),
        ]);
        if (typeof session.sourcePath !== "string" || !session.sourcePath
            || typeof session.backupPath !== "string" || !session.backupPath
            || typeof session.stagePath !== "string" || !session.stagePath
            || typeof session.rollbackPath !== "string" || !session.rollbackPath
            || typeof session.sourceHash !== "string" || !HASH_PATTERN.test(session.sourceHash)
            || typeof session.targetHash !== "string" || !HASH_PATTERN.test(session.targetHash)
            || typeof session.changed !== "boolean"
            || !this.isSessionStatus(session.status)
            || (!session.changed && session.status !== this.codec.status.session.verified)) {
            throw new Error("migration session 字段无效");
        }
        const base: SessionMigrationFileState<TSessionStatus> = {
            sourcePath: session.sourcePath,
            backupPath: session.backupPath,
            stagePath: session.stagePath,
            rollbackPath: session.rollbackPath,
            sourceHash: session.sourceHash,
            targetHash: session.targetHash,
            changed: session.changed,
            status: session.status,
        };
        const expectedBackup = `${runRootRelative}/backups/${base.sourcePath}.backup`;
        const expectedStage = `${runRootRelative}/stages/${base.sourcePath}.stage`;
        const expectedRollback = `${runRootRelative}/rollbacks/${base.sourcePath}.rollback`;
        if (!isSessionSourcePath(base.sourcePath)
            || base.backupPath !== expectedBackup
            || base.stagePath !== expectedStage
            || base.rollbackPath !== expectedRollback
            || new Set([base.sourcePath, base.backupPath, base.stagePath, base.rollbackPath]).size !== 4) {
            throw new Error("migration session 路径不属于当前 run 的确定计划");
        }
        const parsed = this.codec.parseSessionFields(session, base);
        if (BASE_SESSION_FIELDS.some((field) => parsed[field] !== base[field])) {
            throw new Error("migration session codec 修改了通用字段");
        }
        return parsed;
    }

    /** 验证迁移拥有的既有路径段留在 Workspace Root 且不是 symlink/junction。 */
    private async assertManifestPathOwnership(
        paths: SessionMigrationJournalPaths,
        manifest: Manifest<TVersion, TSession, TSessionStatus, TRunStatus, TResumeStatus>,
    ): Promise<void> {
        for (const session of manifest.sessions) {
            for (const path of [session.sourcePath, session.backupPath, session.stagePath, session.rollbackPath]) {
                const target = resolve(paths.rootWorkspace, ...path.split("/"));
                const inside = relative(paths.rootWorkspace, target);
                if (!inside || inside === "." || inside.startsWith("..")
                    || resolve(paths.rootWorkspace, inside) !== target) {
                    throw new Error("migration session 路径越过Workspace Root");
                }
                let current = resolve(paths.rootWorkspace);
                for (const segment of path.split("/")) {
                    current = resolve(current, segment);
                    const stats = await lstat(current).catch((error: NodeJS.ErrnoException) => {
                        if (error.code === "ENOENT") {
                            return null;
                        }
                        throw error;
                    });
                    if (!stats) {
                        break;
                    }
                    if (stats.isSymbolicLink()) {
                        throw new Error(`migration session 路径包含symlink或junction：${path}`);
                    }
                }
            }
        }
    }

    /** 判断领域 session 状态字符串。 */
    private isSessionStatus(value: unknown): value is TSessionStatus {
        return typeof value === "string" && this.sessionStatuses.has(value as TSessionStatus);
    }

    /** 判断领域 run 状态字符串。 */
    private isRunStatus(value: unknown): value is TRunStatus {
        return typeof value === "string" && this.runStatuses.has(value as TRunStatus);
    }

    /** 判断 failed 状态允许恢复到的阶段。 */
    private isResumeStatus(value: unknown): value is TResumeStatus {
        return typeof value === "string" && this.resumeStatuses.has(value as TRunStatus);
    }
}

/** append 并 sync 一条有界 WAL。 */
async function appendRecord<TSessionStatus extends string, TRunStatus extends string>(
    path: string,
    record: JournalRecord<TSessionStatus, TRunStatus>,
): Promise<void> {
    const line = `${JSON.stringify(record)}\n`;
    const lineBytes = Buffer.byteLength(line, "utf8");
    if (lineBytes > JOURNAL_LINE_BYTE_LIMIT) {
        throw new Error("migration journal record 超过行上限");
    }
    await mkdir(dirname(path), {recursive: true});
    const handle = await open(path, "a+");
    try {
        const fileStat = await handle.stat();
        if (fileStat.size + lineBytes > JOURNAL_BYTE_LIMIT) {
            throw new Error(`migration journal 超过 ${String(JOURNAL_BYTE_LIMIT)} bytes 上限`);
        }
        await handle.writeFile(line, "utf8");
        await handle.sync();
    } finally {
        await handle.close();
    }
}

/** 用同目录 temp + rename 发布 JSON，避免 checkpoint 半写截断。 */
async function writeAtomicJson(path: string, value: object, replace: boolean): Promise<void> {
    await mkdir(dirname(path), {recursive: true});
    if (!replace) {
        await readFile(path).then(() => {
            throw new Error("migration manifest 已存在");
        }).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") {
                throw error;
            }
        });
    }
    const tempPath = `${path}.next`;
    await rm(tempPath, {force: true});
    const handle = await open(tempPath, "wx");
    try {
        await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
        await handle.sync();
    } finally {
        await handle.close();
    }
    try {
        await rename(tempPath, path);
        await syncParentDirectories(tempPath, path);
    } finally {
        await rm(tempPath, {force: true});
    }
}

/** 校验 journal 公共版本、序号、runId 与时间字段。 */
function assertRecordBase(record: {[key: string]: unknown}): void {
    if (record.version !== 1
        || !Number.isSafeInteger(record.seq) || (record.seq as number) < 1
        || typeof record.runId !== "string" || !RUN_ID_PATTERN.test(record.runId)
        || typeof record.at !== "string" || !record.at) {
        throw new Error("journal 公共字段无效");
    }
}

/** Session source 只能位于 Agent Session JSONL 真相源目录。 */
function isSessionSourcePath(value: string): boolean {
    if (value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) {
        return false;
    }
    const segments = value.split("/");
    if (segments.length < 4
        || segments[0] !== ".nbook"
        || segments[1] !== "agent"
        || segments[2] !== "sessions"
        || segments.some((segment) => !segment || segment === "." || segment === "..")) {
        return false;
    }
    return segments.at(-1)?.endsWith(".jsonl") === true;
}

/** 限制 UTF-8 文本大小，避免多字节字符截成替换符。 */
function boundedText(value: string, maxBytes: number): string {
    const bytes = Buffer.from(value, "utf8");
    if (bytes.byteLength <= maxBytes) {
        return value;
    }
    return new TextDecoder("utf-8", {fatal: false}).decode(bytes.subarray(0, maxBytes)).replace(/\uFFFD$/u, "");
}

/** 断言外部 JSON 对象只包含合同声明字段。 */
function assertExactKeys(value: {[key: string]: unknown}, keys: readonly string[]): void {
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`字段集合无效：${actual.join(",")}`);
    }
}

/** 外部 JSON 必须先证明为普通对象。 */
function objectValue(value: unknown, label: string): {[key: string]: unknown} {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${label} 必须是对象`);
    }
    return value as {[key: string]: unknown};
}

/** 将未知 I/O/JSON 错误收口为审计文本。 */
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

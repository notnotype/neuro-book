/** 通用 Session JSONL 文件事务持久化的最小状态。 */
export type SessionMigrationFileState<TStatus extends string> = {
    sourcePath: string;
    backupPath: string;
    stagePath: string;
    rollbackPath: string;
    sourceHash: string;
    targetHash: string;
    changed: boolean;
    status: TStatus;
};

/** 文件事务状态的领域字符串映射；允许旧迁移保持既有序列化名称。 */
export type SessionMigrationStatusMap<TSessionStatus extends string, TRunStatus extends string> = {
    session: {
        pending: TSessionStatus;
        backedUp: TSessionStatus;
        prepared: TSessionStatus;
        staged: TSessionStatus;
        publishing: TSessionStatus;
        published: TSessionStatus;
        verified: TSessionStatus;
        rollbackPending: TSessionStatus;
        rollbackPublishing: TSessionStatus;
        rolledBack: TSessionStatus;
    };
    run: {
        running: TRunStatus;
        failed: TRunStatus;
        fullScanVerified: TRunStatus;
        complete: TRunStatus;
        reportWritten: TRunStatus;
        rollbackRunning: TRunStatus;
        rolledBack: TRunStatus;
    };
};

/** 单个文件事务阶段到领域持久化字符串的映射。 */
export type SessionFileTransactionStatuses<TSessionStatus extends string> =
    SessionMigrationStatusMap<TSessionStatus, string>["session"];

/** manifest 的通用 checkpoint 形状；领域统计只扩展单个 session state。 */
export type SessionMigrationManifest<
    TVersion extends number,
    TSession extends SessionMigrationFileState<TSessionStatus>,
    TSessionStatus extends string,
    TRunStatus extends string,
    TResumeStatus extends TRunStatus,
> = {
    version: TVersion;
    journalVersion: 1;
    runId: string;
    status: TRunStatus;
    appliedSeq: number;
    startedAt: string;
    updatedAt: string;
    sessions: TSession[];
    /** status=failed 时存在，表示 resume 应返回的先前阶段。 */
    resumeStatus?: TResumeStatus;
    /** status=failed 时存在；内容有界，避免错误对象放大 WAL。 */
    error?: string;
};

/** 单个 Session 文件的 WAL 状态变化。 */
export type SessionMigrationTransition<TSessionStatus extends string> = {
    version: 1;
    kind: "session_transition";
    seq: number;
    runId: string;
    at: string;
    sourcePath: string;
    from: TSessionStatus;
    to: TSessionStatus;
};

/** migration run 的 WAL 状态变化。 */
export type SessionMigrationRunTransition<TRunStatus extends string> = {
    version: 1;
    kind: "run_transition";
    seq: number;
    runId: string;
    at: string;
    from: TRunStatus;
    to: TRunStatus;
    /** 仅进入 failed 时存在。 */
    error?: string;
};

/** journal.jsonl 的通用合法记录联合。 */
export type SessionMigrationJournalRecord<TSessionStatus extends string, TRunStatus extends string> =
    | SessionMigrationTransition<TSessionStatus>
    | SessionMigrationRunTransition<TRunStatus>;

/** WAL、checkpoint 与路径 ownership 使用的 migration run 路径。 */
export type SessionMigrationJournalPaths = {
    rootWorkspace: string;
    runRoot: string;
    runRootRelative: string;
    manifestPath: string;
    journalPath: string;
};

/** 领域 Adapter 只解析通用 state 之外的 manifest 字段。 */
export type SessionMigrationJournalCodec<
    TVersion extends number,
    TSession extends SessionMigrationFileState<TSessionStatus>,
    TSessionStatus extends string,
    TRunStatus extends string,
    TResumeStatus extends TRunStatus,
> = {
    manifestVersion: TVersion;
    status: SessionMigrationStatusMap<TSessionStatus, TRunStatus>;
    /** 依据 runId 返回固定、portable 的 migration run 根。 */
    runRoot(runId: string): string;
    /** 单个 session state 除通用文件事务字段外允许出现的精确字段。 */
    sessionFields: readonly string[];
    /** 历史 manifest 可缺失、当前新写入必须由领域 parser 补齐的字段。 */
    optionalSessionFields?: readonly string[];
    /** 严格解析领域字段；通用字段和确定性路径已经由 journal Module 验证。 */
    parseSessionFields(
        value: {[key: string]: unknown},
        base: SessionMigrationFileState<TSessionStatus>,
    ): TSession;
};

/** migration-only decoder 交给文件事务 Module 的最小计划。 */
export type SessionFileMigrationPlan = {
    changed: boolean;
    sourceHash: string;
    targetHash: string;
};

/** 领域迁移在通用文件事务 seam 上提供的 Adapter。 */
export type SessionFileTransactionAdapter<
    TPlan extends SessionFileMigrationPlan,
    TSession extends SessionMigrationFileState<TSessionStatus>,
    TSessionStatus extends string,
> = {
    /** 从 source、backup 或 stage 的 Workspace Root-relative path 重建确定性计划。 */
    loadPlan(path: string): Promise<TPlan>;
    /** 断言重建计划仍匹配 manifest 中冻结的 source/target hash。 */
    assertPlan(session: TSession, plan: TPlan): void;
    /** 在发布 JSONL 前创建并验证领域 artifact。 */
    prepareArtifacts(session: TSession, plan: TPlan): Promise<void>;
    /** 验证已迁移 JSONL 引用的领域 artifact 可用。 */
    verifyTarget(session: TSession, plan: TPlan): Promise<void>;
    /** 返回需要写入 stage 的完整目标 JSONL。 */
    targetText(session: TSession, plan: TPlan): string;
};

/** Product-owned Application State migration catalog 中的稳定步骤标识。 */
export type ApplicationStateMigrationStepId =
    | "app-sqlite"
    | "agent-attachment-v1"
    | "agent-session-v2"
    | "agent-session-v2-review-repair";

/** 单个 catalog step 的公开执行结果。 */
export type ApplicationStateMigrationStepReport = {
    id: ApplicationStateMigrationStepId;
    runId: string;
    status: "planned" | "applied" | "skipped" | "rolled_back" | "not_started";
    changedItems: number;
    reviewItems: number;
};

/** CLI 与 Manager 之间唯一允许的 JSON 报告。 */
export type ApplicationStateMigrationReport = {
    version: 1;
    catalogVersion: number;
    runId: string;
    action: "plan" | "apply" | "resume" | "rollback";
    status: "planned" | "complete" | "already_current" | "manual_required" | "rolled_back" | "not_started";
    steps: ApplicationStateMigrationStepReport[];
    /** status=manual_required 时必须存在，指向用户可读迁移说明。 */
    guide?: string;
};

export type ApplicationStateMigrationAction = ApplicationStateMigrationReport["action"];

export type RunApplicationStateMigrationOptions = {
    rootWorkspace: string;
    action: ApplicationStateMigrationAction;
    /** apply/plan 可省略；resume/rollback 必须能从参数或 current sentinel 唯一确定。 */
    runId?: string;
};

import type {ApplicationStateMigrationStepId} from "nbook/server/runtime/application-state-migration/types";

/** Product 当前 Application State migration catalog；顺序同时定义 rollback 的逆序。 */
export const APPLICATION_STATE_MIGRATION_CATALOG_VERSION = 3 as const;

export const APPLICATION_STATE_MIGRATION_STEP_IDS = [
    "app-sqlite",
    "agent-attachment-v1",
    "agent-session-v2",
    "agent-session-v2-review-repair",
] as const satisfies readonly ApplicationStateMigrationStepId[];

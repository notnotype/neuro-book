import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {
    APPLICATION_STATE_MIGRATION_CATALOG_VERSION,
    APPLICATION_STATE_MIGRATION_STEP_IDS,
} from "nbook/server/runtime/application-state-migration/catalog";
import type {ApplicationStateMigrationStepId} from "nbook/server/runtime/application-state-migration/types";

/** Application State catalog sentinel 的固定路径。 */
export const APPLICATION_STATE_SENTINEL_RELATIVE_PATH = ".nbook/agent/migrations/application-state.json";

/** Catalog step 在 Application State sentinel 中的持久化状态。 */
export type ApplicationStateStepState = {
    id: string;
    runId: string;
    status: "pending" | "applied" | "skipped" | "rolled_back";
    changedItems: number;
    reviewItems: number;
};

/** Product migration catalog 的唯一运行时 readiness sentinel。 */
export type ApplicationStateSentinel = {
    version: 1;
    catalogVersion: number;
    runId: string;
    state: "applying" | "complete" | "rollback_required" | "rolled_back";
    steps: ApplicationStateStepState[];
};

/** Sentinel 缺失、落后或尚未 complete。 */
export class ApplicationStateMigrationRequiredError extends Error {
    readonly code = "APPLICATION_STATE_MIGRATION_REQUIRED" as const;

    constructor(message: string) {
        super(message);
        this.name = "ApplicationStateMigrationRequiredError";
    }
}

/** Sentinel 存在但结构或 catalog ownership 损坏。 */
export class ApplicationStateSentinelCorruptError extends Error {
    readonly code = "APPLICATION_STATE_SENTINEL_CORRUPT" as const;

    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "ApplicationStateSentinelCorruptError";
    }
}

/** 返回 Application State sentinel 的绝对路径。 */
export function applicationStateSentinelPath(rootWorkspace: string): string {
    return resolve(rootWorkspace, ...APPLICATION_STATE_SENTINEL_RELATIVE_PATH.split("/"));
}

/** 读取 sentinel；Fresh State Root 返回 null，损坏输入 fail closed。 */
export async function readApplicationStateSentinel(rootWorkspace: string): Promise<ApplicationStateSentinel | null> {
    const path = applicationStateSentinelPath(rootWorkspace);
    let text: string;
    try {
        text = await readFile(path, "utf8");
    } catch (error) {
        if (isNodeError(error, "ENOENT")) return null;
        throw error;
    }
    try {
        return parseApplicationStateSentinel(JSON.parse(text) as unknown);
    } catch (error) {
        if (error instanceof ApplicationStateSentinelCorruptError) throw error;
        throw new ApplicationStateSentinelCorruptError(`Application State sentinel 无法解析：${path}`, {cause: error});
    }
}

/** Nitro 启动只接受当前 catalog 的 complete sentinel。 */
export async function assertApplicationStateReady(rootWorkspace: string): Promise<ApplicationStateSentinel> {
    const sentinel = await readApplicationStateSentinel(rootWorkspace);
    if (!sentinel) {
        throw new ApplicationStateMigrationRequiredError("Application State 尚未初始化。");
    }
    if (sentinel.catalogVersion !== APPLICATION_STATE_MIGRATION_CATALOG_VERSION) {
        throw new ApplicationStateMigrationRequiredError(
            `Application State catalog ${sentinel.catalogVersion} 必须迁移到 ${APPLICATION_STATE_MIGRATION_CATALOG_VERSION}。`,
        );
    }
    if (sentinel.state !== "complete") {
        throw new ApplicationStateMigrationRequiredError(
            `Application State migration ${sentinel.runId} 处于 ${sentinel.state}，必须先 resume 或 rollback。`,
        );
    }
    assertCurrentCatalogSteps(sentinel);
    return sentinel;
}

/** 严格解析持久化 sentinel，不接受未知字段或宽松数字。 */
export function parseApplicationStateSentinel(value: unknown): ApplicationStateSentinel {
    if (!isObject(value)) throw new ApplicationStateSentinelCorruptError("Application State sentinel 必须是 JSON object。");
    assertExactKeys(value, ["version", "catalogVersion", "runId", "state", "steps"]);
    if (value.version !== 1
        || !isPositiveInteger(value.catalogVersion)
        || typeof value.runId !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value.runId)
        || (value.state !== "applying" && value.state !== "complete" && value.state !== "rollback_required" && value.state !== "rolled_back")
        || !Array.isArray(value.steps)) {
        throw new ApplicationStateSentinelCorruptError("Application State sentinel 字段无效。");
    }
    const sentinel: ApplicationStateSentinel = {
        version: 1,
        catalogVersion: value.catalogVersion,
        runId: value.runId,
        state: value.state,
        steps: value.steps.map(parseStep),
    };
    if (sentinel.state === "complete" && sentinel.steps.some((step) => step.status !== "applied" && step.status !== "skipped")) {
        throw new ApplicationStateSentinelCorruptError("Complete Application State sentinel 包含未完成 step。");
    }
    if (sentinel.state === "rolled_back" && sentinel.steps.some((step) => step.status === "applied")) {
        throw new ApplicationStateSentinelCorruptError("Rolled-back Application State sentinel 仍包含 applied step。");
    }
    return sentinel;
}

/** Catalog step runId 由 Application runId 与稳定 step id 唯一派生。 */
export function applicationStateStepRunId(runId: string, id: ApplicationStateMigrationStepId): string {
    if (id === "app-sqlite") return `${runId}-app-sqlite`;
    if (id === "agent-attachment-v1") return `${runId}-attachment`;
    if (id === "agent-session-v2") return `${runId}-session`;
    return `${runId}-session-review-repair`;
}

function assertCurrentCatalogSteps(sentinel: ApplicationStateSentinel): void {
    if (sentinel.steps.length !== APPLICATION_STATE_MIGRATION_STEP_IDS.length) {
        throw new ApplicationStateSentinelCorruptError("Application State sentinel step 数量与当前 catalog 不一致。");
    }
    sentinel.steps.forEach((step, index) => {
        const expectedId = APPLICATION_STATE_MIGRATION_STEP_IDS[index];
        if (step.id !== expectedId || step.runId !== applicationStateStepRunId(sentinel.runId, expectedId)) {
            throw new ApplicationStateSentinelCorruptError("Application State sentinel step 顺序或 runId 不一致。");
        }
    });
}

function parseStep(value: unknown): ApplicationStateStepState {
    if (!isObject(value)) throw new ApplicationStateSentinelCorruptError("Application State step 必须是 JSON object。");
    assertExactKeys(value, ["id", "runId", "status", "changedItems", "reviewItems"]);
    if (typeof value.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value.id)
        || typeof value.runId !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value.runId)
        || (value.status !== "pending" && value.status !== "applied" && value.status !== "skipped" && value.status !== "rolled_back")
        || !isNonNegativeInteger(value.changedItems)
        || !isNonNegativeInteger(value.reviewItems)) {
        throw new ApplicationStateSentinelCorruptError("Application State step 字段无效。");
    }
    return {
        id: value.id,
        runId: value.runId,
        status: value.status,
        changedItems: value.changedItems,
        reviewItems: value.reviewItems,
    };
}

function assertExactKeys(value: {[key: string]: unknown}, expected: string[]): void {
    const actual = Object.keys(value).sort();
    const sortedExpected = [...expected].sort();
    if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) {
        throw new ApplicationStateSentinelCorruptError("Application State sentinel 包含未知或缺失字段。");
    }
}

function isObject(value: unknown): value is {[key: string]: unknown} {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error && error.code === code;
}

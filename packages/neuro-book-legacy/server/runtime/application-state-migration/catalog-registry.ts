import {createHash} from "node:crypto";
import type {ApplicationStateStepState} from "nbook/server/runtime/application-state";
import {
    APPLICATION_STATE_MIGRATION_CATALOG_VERSION,
    APPLICATION_STATE_MIGRATION_STEP_IDS,
} from "nbook/server/runtime/application-state-migration/catalog";

/** migration-only 历史 catalog 描述；Nitro runtime 不得导入。 */
export type ApplicationStateCatalogDescriptor = {
    version: 1 | 2 | 3;
    steps: readonly string[];
};

/** 历史及当前 sentinel 的严格 migration 投影。 */
export type MigrationApplicationStateSentinel = {
    version: 1;
    catalogVersion: 1 | 2 | 3;
    runId: string;
    state: "applying" | "complete" | "rollback_required" | "rolled_back";
    steps: ApplicationStateStepState[];
};

/** 新 journal 保存的逐字节旧 sentinel。 */
export type PreviousSentinelBytes = {
    exists: boolean;
    bytesBase64?: string;
    sha256?: string;
};

/** v1/v2 journal 只能保存解析后的旧 sentinel；v3 起保存原始 bytes。 */
export type MigrationPreviousSentinel =
    | {kind: "historical"; sentinel: MigrationApplicationStateSentinel | null}
    | {kind: "bytes"; backup: PreviousSentinelBytes};

/** migration journal 的统一内存形状。 */
export type MigrationApplicationStateJournal = MigrationApplicationStateSentinel & {
    previousSentinel: MigrationPreviousSentinel;
};

const REGISTRY = new Map<number, ApplicationStateCatalogDescriptor>([
    [1, {version: 1, steps: ["agent-attachment-v1", "agent-session-v2"]}],
    [2, {version: 2, steps: ["app-sqlite", "agent-attachment-v1", "agent-session-v2"]}],
    [3, {version: 3, steps: APPLICATION_STATE_MIGRATION_STEP_IDS}],
]);

/** 返回受支持历史 catalog；future catalog 必须由调用方拒绝降级。 */
export function applicationStateCatalog(version: number): ApplicationStateCatalogDescriptor | null {
    return REGISTRY.get(version) ?? null;
}

/** 按所属 catalog 派生稳定 step runId。 */
export function historicalStepRunId(runId: string, id: string): string {
    if (id === "app-sqlite") return `${runId}-app-sqlite`;
    if (id === "agent-attachment-v1") return `${runId}-attachment`;
    if (id === "agent-session-v2") return `${runId}-session`;
    if (id === "agent-session-v2-review-repair") return `${runId}-session-review-repair`;
    throw new Error(`Application State catalog 包含未知 step：${id}`);
}

/** 严格解析 migration sentinel，并按其历史 descriptor 验证顺序与 ownership。 */
export function parseMigrationApplicationStateSentinel(value: unknown): MigrationApplicationStateSentinel {
    const object = objectValue(value, "Application State sentinel");
    assertExactKeys(object, ["version", "catalogVersion", "runId", "state", "steps"]);
    const descriptor = parseDescriptor(object.catalogVersion);
    if (object.version !== 1 || typeof object.runId !== "string" || !/^[A-Za-z0-9_-]+$/u.test(object.runId)
        || !isState(object.state) || !Array.isArray(object.steps)) {
        throw new Error("Application State sentinel 字段无效");
    }
    const steps = parseSteps(object.steps, object.runId, descriptor);
    assertTerminalStepStates(object.state, steps);
    return {
        version: 1,
        catalogVersion: descriptor.version,
        runId: object.runId,
        state: object.state,
        steps,
    };
}

/** 严格解析 v1/v2/v3 journal；历史 previousSentinel 只在这里接受。 */
export function parseMigrationApplicationStateJournal(
    value: unknown,
    expectedRunId: string,
): MigrationApplicationStateJournal {
    const object = objectValue(value, "Application State journal");
    assertExactKeys(object, ["version", "catalogVersion", "runId", "state", "previousSentinel", "steps"]);
    const sentinel = parseMigrationApplicationStateSentinel({
        version: object.version,
        catalogVersion: object.catalogVersion,
        runId: object.runId,
        state: object.state,
        steps: object.steps,
    });
    if (sentinel.runId !== expectedRunId) throw new Error("Application State journal runId 不匹配");
    const previousSentinel = sentinel.catalogVersion < APPLICATION_STATE_MIGRATION_CATALOG_VERSION
        ? {
            kind: "historical" as const,
            sentinel: object.previousSentinel === null
                ? null
                : parseMigrationApplicationStateSentinel(object.previousSentinel),
        }
        : {kind: "bytes" as const, backup: parsePreviousBytes(object.previousSentinel)};
    return {...sentinel, previousSentinel};
}

/** 将新 journal 的 previous sentinel bytes 做严格结构和 checksum 校验。 */
export function parsePreviousBytes(value: unknown): PreviousSentinelBytes {
    const object = objectValue(value, "previousSentinel");
    const expected = object.exists ? ["exists", "bytesBase64", "sha256"] : ["exists"];
    assertExactKeys(object, expected);
    if (typeof object.exists !== "boolean") throw new Error("previousSentinel.exists 无效");
    if (!object.exists) return {exists: false};
    if (typeof object.bytesBase64 !== "string" || typeof object.sha256 !== "string"
        || !/^[a-f0-9]{64}$/u.test(object.sha256)) {
        throw new Error("previousSentinel bytes/checksum 无效");
    }
    const bytes = Buffer.from(object.bytesBase64, "base64");
    if (bytes.toString("base64") !== object.bytesBase64 || sha256(bytes) !== object.sha256) {
        throw new Error("previousSentinel bytesBase64 与 checksum 不一致");
    }
    parseMigrationApplicationStateSentinel(JSON.parse(bytes.toString("utf8")) as unknown);
    return {exists: true, bytesBase64: object.bytesBase64, sha256: object.sha256};
}

function parseDescriptor(value: unknown): ApplicationStateCatalogDescriptor {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
        throw new Error("Application State catalogVersion 无效");
    }
    const descriptor = applicationStateCatalog(value);
    if (!descriptor) {
        if (value > APPLICATION_STATE_MIGRATION_CATALOG_VERSION) {
            throw new Error(`Application State catalog ${value} 来自未来版本，拒绝降级。`);
        }
        throw new Error(`Application State catalog ${value} 不受支持。`);
    }
    return descriptor;
}

function parseSteps(values: unknown[], runId: string, descriptor: ApplicationStateCatalogDescriptor): ApplicationStateStepState[] {
    if (values.length !== descriptor.steps.length) throw new Error("Application State step 数量与 catalog 不一致");
    return values.map((value, index) => {
        const object = objectValue(value, "Application State step");
        assertExactKeys(object, ["id", "runId", "status", "changedItems", "reviewItems"]);
        const expectedId = descriptor.steps[index];
        if (expectedId === undefined) throw new Error("Application State step 索引越界");
        if (object.id !== expectedId || object.runId !== historicalStepRunId(runId, expectedId)
            || !isStepState(object.status) || !isNonNegativeInteger(object.changedItems)
            || !isNonNegativeInteger(object.reviewItems)) {
            throw new Error("Application State step 顺序、runId 或字段无效");
        }
        return {
            id: expectedId,
            runId: object.runId,
            status: object.status,
            changedItems: object.changedItems,
            reviewItems: object.reviewItems,
        };
    });
}

function assertTerminalStepStates(state: MigrationApplicationStateSentinel["state"], steps: ApplicationStateStepState[]): void {
    if (state === "complete" && steps.some((step) => step.status !== "applied" && step.status !== "skipped")) {
        throw new Error("Complete Application State 包含未完成 step");
    }
    if (state === "rolled_back" && steps.some((step) => step.status === "applied")) {
        throw new Error("Rolled-back Application State 仍包含 applied step");
    }
}

function objectValue(value: unknown, label: string): {[key: string]: unknown} {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} 必须是 JSON object`);
    return value as {[key: string]: unknown};
}

function assertExactKeys(value: {[key: string]: unknown}, expected: string[]): void {
    const actual = Object.keys(value).sort();
    const sorted = [...expected].sort();
    if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) {
        throw new Error("Application State 持久化对象包含未知或缺失字段");
    }
}

function isState(value: unknown): value is MigrationApplicationStateSentinel["state"] {
    return value === "applying" || value === "complete" || value === "rollback_required" || value === "rolled_back";
}

function isStepState(value: unknown): value is ApplicationStateStepState["status"] {
    return value === "pending" || value === "applied" || value === "skipped" || value === "rolled_back";
}

function isNonNegativeInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function sha256(value: Uint8Array): string {
    return createHash("sha256").update(value).digest("hex");
}

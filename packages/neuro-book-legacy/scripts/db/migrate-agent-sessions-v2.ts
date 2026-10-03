import {resolve} from "node:path";
import {resolveStateWorkspaceRoot} from "nbook/server/runtime/installation-paths";
import {
    rollbackSessionSchemaV2Migration,
    runSessionSchemaV2Migration,
} from "nbook/server/agent/session/migrations/session-v2/migration";

type CliOptions = {
    action: "migrate" | "rollback";
    rootWorkspace: string;
    mode: "dry-run" | "apply";
    resume: boolean;
    /** migrate 时可省略并自动生成；rollback 时省略表示回滚 sentinel 指向的当前 run。 */
    runId?: string;
    /** 只在需要确定性重放时显式传入；普通 run 由 runner 取 Date.now()。 */
    migrationTimestamp?: number;
};

class UsageError extends Error {}

/**
 * Agent Session schema v1 -> v2 一次性硬切迁移 CLI。
 *
 * 默认 dry-run，只有 --apply 会修改 Workspace Root。所有模式都先取得 Agent Session
 * Store 的唯一独占 lease，因此 Agent runtime 正在运行时无法执行迁移。
 */
async function main(): Promise<void> {
    let options: CliOptions;
    try {
        options = parseArgs(process.argv.slice(2));
    } catch (error) {
        process.stderr.write(`${JSON.stringify({status: "failed", kind: "usage", error: errorMessage(error)})}\n`);
        process.exitCode = 2;
        return;
    }

    try {
        const report = options.action === "rollback"
            ? await rollbackSessionSchemaV2Migration({
                rootWorkspace: options.rootWorkspace,
                ...(options.runId ? {runId: options.runId} : {}),
            })
            : await runSessionSchemaV2Migration({
                rootWorkspace: options.rootWorkspace,
                mode: options.mode,
                resume: options.resume,
                ...(options.runId ? {runId: options.runId} : {}),
                ...(options.migrationTimestamp === undefined
                    ? {}
                    : {migrationTimestamp: options.migrationTimestamp}),
            });
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } catch (error) {
        process.stderr.write(`${JSON.stringify({status: "failed", kind: "migration", error: errorMessage(error)})}\n`);
        process.exitCode = 1;
    }
}

/** 解析稳定 CLI 合同；--resume 必须显式配合 --apply。 */
function parseArgs(args: string[]): CliOptions {
    let rootWorkspace = resolveStateWorkspaceRoot();
    let action: CliOptions["action"] = "migrate";
    let mode: CliOptions["mode"] = "dry-run";
    let resume = false;
    let runId: string | undefined;
    let migrationTimestamp: number | undefined;
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === undefined) throw new UsageError("命令行参数解析越界");
        if (arg === "--rollback") {
            action = "rollback";
            // rollback 的 runId 可省略：runner 会回滚 sentinel 当前指向的 run。
            const value = args[index + 1];
            if (value && !value.startsWith("--")) {
                runId = value;
                index += 1;
            }
            continue;
        }
        if (arg === "--dry-run") {
            mode = "dry-run";
            continue;
        }
        if (arg === "--apply") {
            mode = "apply";
            continue;
        }
        if (arg === "--resume") {
            resume = true;
            const resumeRunId = args[index + 1];
            if (resumeRunId && !resumeRunId.startsWith("--")) {
                runId = resumeRunId;
                index += 1;
            }
            continue;
        }
        if (arg === "--root" || arg === "--run-id" || arg === "--migration-timestamp") {
            const value = args[index + 1];
            if (!value) {
                throw new UsageError(`${arg} 必须提供值`);
            }
            if (arg === "--root") {
                rootWorkspace = resolve(value);
            } else if (arg === "--run-id") {
                runId = value;
            } else {
                migrationTimestamp = parseTimestamp(value);
            }
            index += 1;
            continue;
        }
        if (arg.startsWith("--root=")) {
            rootWorkspace = resolve(arg.slice("--root=".length));
            continue;
        }
        if (arg.startsWith("--run-id=")) {
            runId = arg.slice("--run-id=".length);
            continue;
        }
        if (arg.startsWith("--migration-timestamp=")) {
            migrationTimestamp = parseTimestamp(arg.slice("--migration-timestamp=".length));
            continue;
        }
        throw new UsageError(`未知参数：${arg}`);
    }
    if (resume && mode !== "apply") {
        throw new UsageError("--resume 必须与 --apply 一起使用");
    }
    if (action === "rollback" && resume) {
        throw new UsageError("--rollback会自动收敛中断状态，不能使用--resume");
    }
    if (action === "rollback" && mode === "apply") {
        throw new UsageError("--rollback不能与--apply一起使用");
    }
    return {
        action,
        rootWorkspace,
        mode,
        resume,
        ...(runId ? {runId} : {}),
        ...(migrationTimestamp === undefined ? {} : {migrationTimestamp}),
    };
}

/** migrationTimestamp 必须是非负安全整数毫秒。 */
function parseTimestamp(value: string): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
        throw new UsageError("--migration-timestamp 必须是非负安全整数毫秒");
    }
    return parsed;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

await main();

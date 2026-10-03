import {resolve} from "node:path";
import {resolveStateWorkspaceRoot} from "nbook/server/runtime/installation-paths";
import {
    rollbackAgentAttachmentMigration,
    runAgentAttachmentMigration,
} from "nbook/server/agent/session/migrations/attachment-v1/migration";

type CliOptions = {
    action: "migrate" | "rollback";
    rootWorkspace: string;
    mode: "dry-run" | "apply";
    resume: boolean;
    runId?: string;
};

class UsageError extends Error {}

/** Attachment v1 一次性硬切迁移 CLI。默认 dry-run，只有 --apply 会修改 Workspace Root。 */
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
            ? await rollbackAgentAttachmentMigration({
                rootWorkspace: options.rootWorkspace,
                runId: options.runId!,
            })
            : await runAgentAttachmentMigration(options);
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
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === undefined) throw new UsageError("命令行参数解析越界");
        if (arg === "--rollback") {
            const value = args[index + 1];
            if (!value || value.startsWith("--")) {
                throw new UsageError("--rollback必须提供runId");
            }
            action = "rollback";
            runId = value;
            index += 1;
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
        if (arg === "--root" || arg === "--run-id") {
            const value = args[index + 1];
            if (!value) {
                throw new UsageError(`${arg} 必须提供值`);
            }
            if (arg === "--root") {
                rootWorkspace = resolve(value);
            } else {
                runId = value;
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
        throw new UsageError(`未知参数：${arg}`);
    }
    if (resume && mode !== "apply") {
        throw new UsageError("--resume 必须与 --apply 一起使用");
    }
    if (action === "rollback" && resume) {
        throw new UsageError("--rollback会自动恢复中断状态，不能使用--resume");
    }
    return {
        action,
        rootWorkspace,
        mode,
        resume,
        ...(runId ? {runId} : {}),
    };
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

await main();

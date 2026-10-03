import {resolve} from "node:path";
import {resolveStateWorkspaceRoot} from "nbook/server/runtime/installation-paths";
import {runApplicationStateMigration} from "nbook/server/runtime/application-state-migration/runner";
import type {ApplicationStateMigrationAction} from "nbook/server/runtime/application-state-migration/types";

type CliOptions = {
    action: ApplicationStateMigrationAction;
    rootWorkspace: string;
    runId?: string;
};

class UsageError extends Error {}

/** Product-owned Application State migration CLI；stdout 永远只输出一份 JSON 报告。 */
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
        const result = await runApplicationStateMigration(options);
        process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (error) {
        process.stderr.write(`${JSON.stringify({status: "failed", kind: "migration", error: errorMessage(error)})}\n`);
        process.exitCode = 1;
    }
}

/** 四种动作互斥；resume/rollback 必须显式选择，默认不做任何猜测。 */
function parseArgs(args: string[]): CliOptions {
    let action: ApplicationStateMigrationAction | null = null;
    let rootWorkspace = resolveStateWorkspaceRoot();
    let runId: string | undefined;
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === undefined) throw new UsageError("命令行参数解析越界。");
        if (arg === "--plan" || arg === "--apply" || arg === "--resume" || arg === "--rollback") {
            if (action) throw new UsageError("--plan/--apply/--resume/--rollback 只能选择一个。");
            action = arg.slice(2) as ApplicationStateMigrationAction;
            continue;
        }
        if (arg === "--root" || arg === "--run-id") {
            const value = args[index + 1];
            if (!value || value.startsWith("--")) throw new UsageError(`${arg} 必须提供值。`);
            if (arg === "--root") rootWorkspace = resolve(value);
            else runId = value;
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
    if (!action) throw new UsageError("必须提供 --plan、--apply、--resume 或 --rollback。");
    return {action, rootWorkspace, ...(runId ? {runId} : {})};
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

await main();

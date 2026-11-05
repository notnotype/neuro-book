import {randomBytes} from "node:crypto";
import {appendFile, chmod, lstat, mkdir, readFile, writeFile} from "node:fs/promises";
import {homedir} from "node:os";
import {join} from "node:path";
import {NbdevError, systemErrorCode} from "./errors.js";

/**
 * 审计：`${XDG_CONFIG_HOME:-~/.config}/nbdev/audit.jsonl`，只追加，一行一个 JSON（Proposal 第八节第 9 条）。
 * 不放 `.local/agent/`：Agent 能读写那里。建这个目录要开发者授权，所以只由包脚本 `audit-init` 建（开发者亲手运行即授权），
 * 面板与命令行都不建它。`init.json` 记初始化的时刻，也是通知的启用时刻：早于它的答复不自动通知（t11 设计审查 I3）。
 */

export const AUDIT_SCHEMA = "nbdev.audit/v1";
export const AUDIT_INIT_SCHEMA = "nbdev.audit-init/v1";

export type AuditPaths = {dir: string; file: string; init: string};

export function auditPaths(env: NodeJS.ProcessEnv): AuditPaths {
    const configHome = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.startsWith("/") ? env.XDG_CONFIG_HOME : join(env.HOME ?? homedir(), ".config");
    const dir = join(configHome, "nbdev");
    return {dir, file: join(dir, "audit.jsonl"), init: join(dir, "init.json")};
}

export type AuditStatus =
    | {enabled: true; initAt: string; paths: AuditPaths}
    | {enabled: false; reason: "not_initialized" | "bad_owner" | "bad_mode" | "not_regular" | "unreadable"; detail: string; paths: AuditPaths};

async function statOrNull(path: string) {
    try {
        return await lstat(path);
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT") return null;
        throw error;
    }
}

/** 审计能不能用：目录与文件都在、属主是自己、权限不宽于 700 与 600、`init.json` 读得出。不能用时写明原因。 */
export async function readAuditStatus(paths: AuditPaths): Promise<AuditStatus> {
    const uid = process.getuid?.() ?? -1;
    const [dir, file] = await Promise.all([statOrNull(paths.dir), statOrNull(paths.file)]);
    if (!dir || !file) return {enabled: false, reason: "not_initialized", detail: `${paths.dir} 还没有初始化：运行 bun run --cwd packages/dev-panel audit-init`, paths};
    if (!dir.isDirectory() || !file.isFile()) return {enabled: false, reason: "not_regular", detail: `${paths.dir} 或 audit.jsonl 不是目录或普通文件（可能是符号链接）`, paths};
    if (dir.uid !== uid || file.uid !== uid) return {enabled: false, reason: "bad_owner", detail: `${paths.dir} 或 audit.jsonl 的属主不是当前用户`, paths};
    if ((dir.mode & 0o077) !== 0 || (file.mode & 0o077) !== 0) return {enabled: false, reason: "bad_mode", detail: `${paths.dir} 或 audit.jsonl 的权限比 700、600 宽`, paths};
    try {
        const value = JSON.parse(await readFile(paths.init, "utf8")) as {schema?: unknown; at?: unknown};
        if (value.schema !== AUDIT_INIT_SCHEMA || typeof value.at !== "string") throw new SyntaxError("init.json 的格式不对");
        return {enabled: true, initAt: value.at, paths};
    } catch (error) {
        if (systemErrorCode(error) !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
        return {enabled: false, reason: "unreadable", detail: `${paths.init} 读不出：${error instanceof Error ? error.message : String(error)}`, paths};
    }
}

/** 建目录（700）、空的 `audit.jsonl`（600）与 `init.json`（启用时刻）；已经初始化过就原样返回，不改启用时刻。 */
export async function initAudit(paths: AuditPaths, now: Date = new Date()): Promise<{created: boolean; initAt: string}> {
    const before = await readAuditStatus(paths);
    if (before.enabled) return {created: false, initAt: before.initAt};
    if (before.reason !== "not_initialized" && before.reason !== "unreadable") throw new NbdevError("audit_unavailable", before.detail, {details: {reason: before.reason}});
    await mkdir(paths.dir, {recursive: true, mode: 0o700});
    await chmod(paths.dir, 0o700);
    for (const [path, content] of [[paths.file, ""], [paths.init, `${JSON.stringify({schema: AUDIT_INIT_SCHEMA, at: now.toISOString()})}\n`]] as const) {
        try {
            await writeFile(path, content, {mode: 0o600, flag: "wx"});
        } catch (error) {
            if (systemErrorCode(error) !== "EEXIST") throw error;
        }
    }
    const after = await readAuditStatus(paths);
    if (!after.enabled) throw new NbdevError("audit_unavailable", after.detail, {details: {reason: after.reason}});
    return {created: true, initAt: after.initAt};
}

export type AuditAction = "notify" | "prompt" | "keys" | "takeover" | "release" | "answer" | "close_artifact" | "create_work" | "create_task" | "status" | "edit";
export type AuditEntry = {
    actionId: string;
    /** herdr 的输入类动作先写一行意图（`intent`），再写结果（`result`）；写仓库只写结果。 */
    phase: "intent" | "result";
    action: AuditAction;
    device: string;
    target: Record<string, unknown>;
    detail: Record<string, unknown>;
};

export function newActionId(): string {
    return randomBytes(8).toString("hex");
}

/**
 * 面板进程里唯一的写者：排队串行，每行一次追加（`O_APPEND`）。写之前核对状态：没初始化或权限不对时报 `audit_unavailable`，
 * 调用方据此决定拒绝动作（herdr 的输入类）还是只给警告（写仓库，见 docs/panel.md）。
 */
export function createAuditWriter(paths: AuditPaths, instance: string) {
    let queue: Promise<unknown> = Promise.resolve();
    return {
        paths,
        append(entry: AuditEntry, now: Date = new Date()): Promise<void> {
            const task = queue.then(async () => {
                const status = await readAuditStatus(paths);
                if (!status.enabled) throw new NbdevError("audit_unavailable", status.detail, {details: {reason: status.reason}});
                await appendFile(paths.file, `${JSON.stringify({schema: AUDIT_SCHEMA, at: now.toISOString(), instance, ...entry})}\n`, {mode: 0o600, flag: "a"});
            });
            queue = task.catch(() => undefined);
            return task;
        },
    };
}
export type AuditWriter = ReturnType<typeof createAuditWriter>;

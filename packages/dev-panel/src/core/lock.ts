import {randomBytes} from "node:crypto";
import {lstat, mkdir, readFile, rename, rm, stat, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {setTimeout as sleep} from "node:timers/promises";
import {NbdevError, systemErrorCode, type Warning} from "./errors.js";
import {processAlive, processStartTicks} from "./procfs.js";
import {AGENT_LOCAL_ROOT, REGISTRY_FILE} from "./registry.js";
import {WORKS_ROOT} from "./repo.js";

/** 等锁的预算要明显大于持锁者等 index.lock 的 10 秒加一次事务的耗时，否则持锁者一遇到 index.lock，所有等待者都会超时。 */
export const DEFAULT_LOCK_WAIT_MS = 30_000;
const OWNER_FILE = "owner.json";
const OWNER_SCHEMA = "nbdev.lock-owner/v1";

/** 锁目录里的持锁者信息。`token` 认这一次持锁；`pid` 加 `startTicks` 认进程（防 pid 复用）。 */
export type LockOwner = {schema: typeof OWNER_SCHEMA; token: string; pid: number; startTicks: string; startedAt: string; command: string; cwd: string};
export type LockHolder = {pid: number; startedAt: string; command: string; cwd: string; alive: boolean};

export type RecordsLock = {
    readonly token: string;
    /** 取锁时接管过的死锁（持锁者已退出或锁目录损坏），供调用方报告。 */
    readonly takeovers: readonly Warning[];
    /** 锁目录仍是本次取到的那一个。 */
    isHeld(): Promise<boolean>;
    /** 锁已不属于本进程时抛 `lock_compromised`。 */
    assertHealthy(stage: string): Promise<void>;
    /** 放锁；锁已不属于本进程时什么也不动，只返回警告。 */
    release(): Promise<Warning | null>;
};

export function agentPaths(mainRoot: string) {
    const agentRoot = resolve(mainRoot, AGENT_LOCAL_ROOT);
    return {
        agentRoot,
        registryFile: resolve(mainRoot, REGISTRY_FILE),
        lockDir: resolve(mainRoot, `${REGISTRY_FILE}.lock`),
        tmpRoot: resolve(agentRoot, "run", "tmp"),
    };
}

/**
 * 建好 `.local/agent/run/tmp`，并确认它与 `.agents/works` 在同一个文件系统上：
 * 新目录靠 `rename` 原子落位，锁目录也在这里组装后改名到位；`.local/` 属于用户区，可能被换成指向别的盘的符号链接。
 */
export async function prepareAgentDirectories(mainRoot: string): Promise<void> {
    const {tmpRoot} = agentPaths(mainRoot);
    await mkdir(tmpRoot, {recursive: true});
    const [tmpStats, worksStats] = await Promise.all([stat(tmpRoot), stat(resolve(mainRoot, WORKS_ROOT))]);
    if (tmpStats.dev !== worksStats.dev) {
        throw new NbdevError("cross_device", `${AGENT_LOCAL_ROOT}/run/tmp 与 ${WORKS_ROOT} 不在同一个文件系统上，无法原子地落位新记录`, {
            details: {tmpRoot, worksRoot: resolve(mainRoot, WORKS_ROOT)},
        });
    }
}

async function ownerAlive(owner: LockOwner): Promise<boolean> {
    return processAlive(owner);
}

/**
 * 解析持锁者文件。本实现只经“组装好再改名”建锁目录，持锁者文件不会写到一半；
 * 读不出就说明锁目录是旧格式或已损坏，`problem` 写明原因，调用方按死锁接管并报告。
 */
function parseOwner(text: string): {owner: LockOwner | null; problem: string | null} {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch (error) {
        return {owner: null, problem: `持锁者文件不是合法 JSON：${error instanceof Error ? error.message : String(error)}`};
    }
    const owner = (value && typeof value === "object" ? value : {}) as Partial<LockOwner>;
    if (owner.schema !== OWNER_SCHEMA || typeof owner.token !== "string" || typeof owner.pid !== "number" || typeof owner.startTicks !== "string") {
        return {owner: null, problem: "持锁者文件缺少 schema、token、pid 或 startTicks"};
    }
    return {owner: owner as LockOwner, problem: null};
}

/**
 * 看一眼锁目录：`ino` 与 `birthtimeMs` 一起认目录本身（inode 会被回收再分配，删掉再建时可能拿到同一个 inode），
 * `owner` 为 null 表示没有可用的持锁者信息（旧格式或损坏，原因在 `problem`）。
 */
export type LockObservation = {ino: number; birthtimeMs: number; owner: LockOwner | null; problem: string | null};

/** 锁目录不存在时为 null；读持锁者期间锁目录被换掉时为 "changed"，调用方重试即可。 */
export async function inspectLock(lockDir: string): Promise<LockObservation | null | "changed"> {
    let before;
    try {
        before = await lstat(lockDir);
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT") return null;
        throw error;
    }
    let parsed: {owner: LockOwner | null; problem: string | null} = {owner: null, problem: "锁目录里没有持锁者文件"};
    try {
        parsed = parseOwner(await readFile(join(lockDir, OWNER_FILE), "utf8"));
    } catch (error) {
        if (systemErrorCode(error) !== "ENOENT" && systemErrorCode(error) !== "ENOTDIR") throw error;
    }
    let after;
    try {
        after = await lstat(lockDir);
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT") return "changed";
        throw error;
    }
    return after.ino === before.ino && after.birthtimeMs === before.birthtimeMs ? {ino: before.ino, birthtimeMs: before.birthtimeMs, ...parsed} : "changed";
}

/**
 * 接管一个已确认持锁者已死的锁：先把锁目录改名成唯一的墓碑名，只有改名成功的一方继续；
 * 再确认改走的正是观察到的那个目录。两个等待者可能都看到同一个死锁，慢的一方改走的会是快的一方刚建的活锁，
 * 这时原样改回去，返回 "lost_race"。
 */
export async function takeOverDeadLock(lockDir: string, tmpRoot: string, observation: LockObservation): Promise<"taken" | "lost_race"> {
    const tombstone = join(tmpRoot, `lock-dead-${process.pid}-${randomBytes(4).toString("hex")}`);
    try {
        await rename(lockDir, tombstone);
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT") return "lost_race";
        throw error;
    }
    const moved = await lstat(tombstone);
    // 与 `inspectLock` 一样连创建时间一起比：`rename` 不改 inode 与创建时间，重建的目录即使复用了 inode 两者也对不上。
    if (moved.ino !== observation.ino || moved.birthtimeMs !== observation.birthtimeMs) {
        try {
            await rename(tombstone, lockDir);
        } catch (error) {
            // 改回去之前又有第三个进程建了锁目录：别人的锁已在墓碑里，那个进程的身份比对会发现并停下。
            if (systemErrorCode(error) !== "EEXIST" && systemErrorCode(error) !== "ENOTEMPTY") throw error;
        }
        return "lost_race";
    }
    await rm(tombstone, {recursive: true, force: true});
    return "taken";
}

/** 在 run/tmp 里组装好带持锁者文件的目录，再改名成锁目录：锁目录一出现就带着持锁者信息。 */
async function tryCreateLock(lockDir: string, tmpRoot: string, owner: LockOwner): Promise<boolean> {
    const staging = join(tmpRoot, `lock-new-${process.pid}-${randomBytes(4).toString("hex")}`);
    await mkdir(staging);
    try {
        await writeFile(join(staging, OWNER_FILE), `${JSON.stringify(owner, null, 4)}\n`, {encoding: "utf8", flag: "wx"});
        await rename(staging, lockDir);
        return true;
    } catch (error) {
        if (systemErrorCode(error) === "EEXIST" || systemErrorCode(error) === "ENOTEMPTY") return false;
        throw error;
    } finally {
        await rm(staging, {recursive: true, force: true});
    }
}

async function currentToken(lockDir: string): Promise<string | null> {
    try {
        return parseOwner(await readFile(join(lockDir, OWNER_FILE), "utf8")).owner?.token ?? null;
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT" || systemErrorCode(error) === "ENOTDIR") return null;
        throw error;
    }
}

/**
 * 取主工作区的记录锁 `.local/agent/registry.json.lock/`。只支持 Linux：持锁者是否存活按 `/proc/<pid>/stat` 的启动时刻判断，
 * 不靠心跳，持锁者长时间等 Git 也不会被判过期。持锁者已死就按墓碑改名接管；持锁者活着就随机退避，等到 `waitMs` 为止。
 */
export async function acquireRecordsLock(mainRoot: string, waitMs: number = DEFAULT_LOCK_WAIT_MS): Promise<RecordsLock> {
    const {lockDir, tmpRoot} = agentPaths(mainRoot);
    return acquireDirectoryLock(lockDir, tmpRoot, waitMs, "记录锁");
}

/**
 * 同一套目录锁的通用入口（`what` 写进错误与警告）：记录锁之外，`run/procs/` 的登记也用它（t14）。
 * `tmpRoot` 要与锁目录在同一个文件系统上（组装好再改名）。
 */
export async function acquireDirectoryLock(lockDir: string, tmpRoot: string, waitMs: number, what: string): Promise<RecordsLock> {
    await mkdir(tmpRoot, {recursive: true});
    const startTicks = await processStartTicks(process.pid);
    if (startTicks === null) throw new NbdevError("lock_failed", "读不到本进程的启动时刻（需要 Linux 的 /proc）");
    const owner: LockOwner = {
        schema: OWNER_SCHEMA,
        token: randomBytes(16).toString("hex"),
        pid: process.pid,
        startTicks,
        startedAt: new Date().toISOString(),
        command: process.argv.join(" "),
        cwd: process.cwd(),
    };
    const startedAt = Date.now();
    const takeovers: Warning[] = [];
    for (;;) {
        if (await tryCreateLock(lockDir, tmpRoot, owner)) break;
        const observation = await inspectLock(lockDir);
        if (observation === null || observation === "changed") continue;
        if (observation.owner === null || !await ownerAlive(observation.owner)) {
            if (await takeOverDeadLock(lockDir, tmpRoot, observation) === "taken") {
                takeovers.push({
                    code: "lock_taken_over",
                    message: observation.owner ? `接管了已退出进程 ${observation.owner.pid} 留下的${what}` : `接管了损坏的${what}：${observation.problem ?? "原因不明"}`,
                    details: {deadOwner: observation.owner, problem: observation.problem},
                });
            }
            continue;
        }
        if (Date.now() - startedAt >= waitMs) {
            const holder: LockHolder = {pid: observation.owner.pid, startedAt: observation.owner.startedAt, command: observation.owner.command, cwd: observation.owner.cwd, alive: true};
            throw new NbdevError("lock_timeout", `等${what}超过 ${Math.round(waitMs / 1000)} 秒，持锁者 pid ${holder.pid} 仍在运行`, {
                details: {lockDir, waitedMs: Date.now() - startedAt, holder},
            });
        }
        await sleep(50 + Math.floor(Math.random() * 200));
    }
    const isHeld = async () => await currentToken(lockDir) === owner.token;
    return {
        token: owner.token,
        takeovers,
        isHeld,
        async assertHealthy(stage) {
            if (!await isHeld()) throw new NbdevError("lock_compromised", `${what}在${stage}之前已不属于本进程`, {details: {stage, lockDir}});
        },
        async release() {
            if (!await isHeld()) {
                return {code: "lock_release_skipped", message: `${what}已不属于本进程，放锁时没有动它`, details: {lockDir}};
            }
            const tombstone = join(tmpRoot, `lock-released-${process.pid}-${randomBytes(4).toString("hex")}`);
            try {
                await rename(lockDir, tombstone);
            } catch (error) {
                return {code: "lock_release_failed", message: `放${what}失败：${error instanceof Error ? error.message : String(error)}`, details: {lockDir}};
            }
            try {
                await rm(tombstone, {recursive: true, force: true});
            } catch (error) {
                return {code: "lock_release_failed", message: `锁已放开，但删除旧锁目录失败：${error instanceof Error ? error.message : String(error)}`, details: {tombstone}};
            }
            return null;
        },
    };
}

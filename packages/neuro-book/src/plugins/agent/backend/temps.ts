/**
 * 会话临时目录 `temps://` 的容器与启动清理（docs/specs/agent/resources.md 输出 7、“副作用与数据”）。
 *
 * 容器是 `<系统临时目录>/nbook/<状态根标记>/sessions/`：系统临时目录是多用户共用的，三层都要核对是本用户的真实目录；
 * 状态根标记把同一用户的两个状态根分开，扫描只进本状态根的分区，不会删到另一个状态根还在用的会话目录。
 */

import {createHash} from "node:crypto";
import {lstat, mkdir, readdir, realpath, rm} from "node:fs/promises";
import {tmpdir, userInfo} from "node:os";
import {join} from "node:path";

/** 系统临时目录下的名字；被别的用户占用时换成带用户 id 的。 */
const CONTAINER = "nbook";

/** 只给本用户（POSIX）；Windows 上忽略。 */
const PRIVATE = 0o700;

/** 本用户的真实目录：不是链接、不是文件、属主是本用户（Windows 没有 uid，只核对前两条）。不存在时建它。 */
async function ownedDirectory(path: string): Promise<boolean> {
    try {
        await mkdir(path, {mode: PRIVATE});
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") return false;
    }
    const info = await lstat(path);
    if (!info.isDirectory()) return false;
    const uid = process.getuid?.();
    return uid === undefined || info.uid === uid;
}

/**
 * 建好并核对三层容器，交回 `sessions` 那一层；`nbook` 与 `nbook-<uid>` 都不可用时为 null（`temps://` 不可用）。
 * `stateRoot` 按真实路径取标记：同一个状态根经不同的写法（链接、相对路径）得到同一个分区。
 */
export async function prepareTempContainer(stateRoot: string, report: (message: string) => void): Promise<string | null> {
    const marker = createHash("sha256").update(await realpath(stateRoot)).digest("hex").slice(0, 16);
    const uid = process.getuid?.() ?? userInfo().username;
    for (const name of [CONTAINER, `${CONTAINER}-${String(uid)}`]) {
        const base = join(tmpdir(), name);
        const partition = join(base, marker);
        const sessions = join(partition, "sessions");
        if ((await ownedDirectory(base)) && (await ownedDirectory(partition)) && (await ownedDirectory(sessions))) return sessions;
        report(`${base} 不是本用户的真实目录，换一个名字`);
    }
    return null;
}

/**
 * 启动时的清理：删除本分区里已不存在或已归档的会话的临时目录。只在注册方案之前调用：这时新进程里没有工具在用它们。
 * 不是本用户真实目录的项保留并报告。
 */
export async function sweepTemps(container: string, keep: (session: string) => Promise<boolean>, report: (message: string) => void): Promise<void> {
    let names: string[];
    try {
        names = await readdir(container);
    } catch (error) {
        report(`读不了临时目录容器：${error instanceof Error ? error.message : String(error)}`);
        return;
    }
    const uid = process.getuid?.();
    for (const name of names) {
        if (await keep(name)) continue;
        const path = join(container, name);
        const info = await lstat(path).catch(() => null);
        if (info === null || !info.isDirectory() || (uid !== undefined && info.uid !== uid)) {
            report(`临时目录里的 ${name} 不是本用户的目录，保留`);
            continue;
        }
        // `rm` 递归时删除链接本身，不进入链接指向的目录。
        await rm(path, {recursive: true, force: true}).catch((error: unknown) => report(`删不掉会话 ${name} 的临时目录：${error instanceof Error ? error.message : String(error)}`));
    }
}

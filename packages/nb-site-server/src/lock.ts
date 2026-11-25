/**
 * 按模块占用数据目录：`<数据目录>/<模块>.lock`（`site.operations` 的副作用与数据一节）。启动与只迁移按模块列表逐个取，
 * 一个模块一把，拆成两个进程后各取各的，同一个数据目录照样能装两个进程。
 *
 * 用 nb-flock：不判旧，进程怎样结束锁都由系统放掉，没有“持有者暂停太久被接管”的情况。锁文件建好不删：锁跟着 inode 走，
 * 删了再建的是另一把锁。
 */

import {join} from "node:path";

import {tryLock, type FileLock} from "@notnotype/nb-flock";

export type ModuleLocks =
    /** `release()` 可以重复调用，第二次起什么都不做。 */
    | {readonly ok: true; release(): void}
    /** 另一个进程正拿着这个模块的锁。 */
    | {readonly ok: false; readonly reason: "busy"; readonly module: string}
    /**
     * 锁文件打不开（是目录、没有权限、所在的文件系统只读）：部署环境的问题，不是程序错误，报 `data_dir_unusable`。
     * `errorCode` 是系统给的码，例如 `EISDIR`。
     */
    | {readonly ok: false; readonly reason: "unusable"; readonly module: string; readonly errorCode: string};

/** 依次取每个模块的独占锁；任一个取不到或打不开就放掉已取的，返回那个模块。别的异常（例如加载不了 flock）照常抛出。 */
export function lockModules(dataDir: string, names: readonly string[]): ModuleLocks {
    const held: FileLock[] = [];
    const releaseAll = (): void => {
        for (const lock of held.splice(0).reverse()) lock.release();
    };
    try {
        for (const name of names) {
            let lock: FileLock | null;
            try {
                lock = tryLock(join(dataDir, `${name}.lock`));
            } catch (error) {
                // 打开锁文件的系统错误带字符串的 `code`；没有的不是文件的问题，交给外层照常抛出。
                const code = (error as NodeJS.ErrnoException | undefined)?.code;
                if (typeof code !== "string") throw error;
                releaseAll();
                return {ok: false, reason: "unusable", module: name, errorCode: code};
            }
            if (lock === null) {
                releaseAll();
                return {ok: false, reason: "busy", module: name};
            }
            held.push(lock);
        }
    } catch (error) {
        releaseAll();
        throw error;
    }
    return {ok: true, release: releaseAll};
}

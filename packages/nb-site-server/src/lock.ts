/**
 * 按模块占用数据目录：`<数据目录>/<模块>.lock`（`site.operations` 的副作用与数据一节）。启动与只迁移按模块列表逐个取，
 * 一个模块一把，拆成两个进程后各取各的，同一个数据目录照样能装两个进程。
 *
 * 用 nb-flock：不判旧，进程怎样结束锁都由系统放掉，没有“持有者暂停太久被接管”的情况。锁文件建好不删：锁跟着 inode 走，
 * 删了再建的是另一把锁。
 */

import {join} from "node:path";

import {tryLock, type FileLock} from "@notnotype/nb-flock";

export type ModuleLocks = {readonly ok: true; release(): void} | {readonly ok: false; readonly module: string};

/** 依次取每个模块的独占锁；任一个取不到就放掉已取的，返回取不到的那个模块。文件打不开（没有权限）照常抛出。 */
export function lockModules(dataDir: string, names: readonly string[]): ModuleLocks {
    const held: FileLock[] = [];
    const releaseAll = (): void => {
        for (const lock of held.splice(0).reverse()) lock.release();
    };
    try {
        for (const name of names) {
            const lock = tryLock(join(dataDir, `${name}.lock`));
            if (lock === null) {
                releaseAll();
                return {ok: false, module: name};
            }
            held.push(lock);
        }
    } catch (error) {
        releaseAll();
        throw error;
    }
    return {ok: true, release: releaseAll};
}

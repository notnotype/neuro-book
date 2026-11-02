/**
 * 按脚本注入失败的文件操作：包着真实的 `nodeFiles`，在第 n 次追加时只写进一部分再抛错、让 fsync 或截断失败。
 * 没有注入时行为与 `nodeFiles` 相同，由 tests/node-log.test.ts 的契约测试核对。不含断言。
 */

import {nodeFiles, type LogFiles} from "../../src/node/files";

export interface Faults {
    /** 下一次追加只写进前 `partial` 个字节再抛错（`partial` 为 0 是写之前就失败）。 */
    failAppend?: {partial: number} | null;
    /** 下一次截断抛错。 */
    failTruncate?: boolean;
}

export function faultyFiles(faults: Faults): LogFiles {
    return {
        ...nodeFiles,
        async append(path, bytes) {
            const failure = faults.failAppend;
            if (failure !== undefined && failure !== null) {
                faults.failAppend = null;
                if (failure.partial > 0) await nodeFiles.append(path, bytes.slice(0, failure.partial));
                throw new Error("EIO: injected append failure");
            }
            await nodeFiles.append(path, bytes);
        },
        async truncate(path, length) {
            if (faults.failTruncate === true) {
                faults.failTruncate = false;
                throw new Error("EIO: injected truncate failure");
            }
            await nodeFiles.truncate(path, length);
        },
    };
}

/** 进程内的锁：测试里替代跨进程锁（跨进程的锁由插件侧用真实的 holdLock 测）。 */
export function memoryLock(): {acquire(): Promise<{release: () => Promise<void>}>; held: () => boolean} {
    let locked = false;
    return {
        held: () => locked,
        async acquire() {
            while (locked) await Promise.resolve();
            locked = true;
            return {release: async () => void (locked = false)};
        },
    };
}

/**
 * 故障注入：从进程外占住某个模块的库的写锁，让被测服务看到“库不可写”。只依赖 `site.operations` 副作用与数据一节写明的
 * 数据目录布局（`<数据目录>/<模块>.db`），不读不写任何表：表的形状属于被测程序的实现，换一种实现重写时这里不用改。
 *
 * 模块将来换数据库（ADR 0061 决策 5）时，这个函数跟着换，用它的合同用例不变。
 */

import {Database} from "bun:sqlite";
import {join} from "node:path";

/**
 * 在 `<dataDir>/<module>.db` 上开一个 `BEGIN EXCLUSIVE` 事务并一直开着（WAL 下它与 `BEGIN IMMEDIATE` 一样只占写锁，读照常），
 * 返回放锁的函数；放锁函数可以重复调用。库文件必须已经存在：服务启动时建好它。用例要在 `finally` 里放锁。
 */
export function holdWriteLock(dataDir: string, module: string): () => void {
    const db = new Database(join(dataDir, `${module}.db`), {readwrite: true, create: false});
    try {
        // 服务自己正好在写时稍等；被测服务的业务连接本 Task 里不写库，正常立即拿到。
        db.exec("PRAGMA busy_timeout = 5000");
        db.exec("BEGIN EXCLUSIVE");
    } catch (error) {
        db.close();
        throw error;
    }
    let released = false;
    return () => {
        if (released) return;
        released = true;
        try {
            db.exec("ROLLBACK");
        } finally {
            db.close();
        }
    };
}

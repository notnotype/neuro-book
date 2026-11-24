/**
 * 每个模块一个库文件 `<数据目录>/<模块名>.db`（ADR 0061 决策 1；文件名是 `site.operations` 写明的数据目录布局）。
 * 只有本进程里这个模块用这条连接；进程外会碰库的只有备份的只读连接、t07 的创建管理员命令与合同测试的故障注入。
 */

import {Database} from "bun:sqlite";
import {join} from "node:path";

/** 模块名也是库文件名与日志里的 `module`，只许小写字母开头的字母数字。 */
const MODULE_NAME = /^[a-z][a-z0-9]*$/u;

/**
 * 打开（不存在就新建）一个模块的库并设好连接参数。调用方拥有返回的连接，负责 `close()`。
 * 模块名不合格或文件系统不支持 WAL 时抛错：前者是程序错误，后者让并发读写的前提不成立，不能带着别的日志模式运行。
 */
export function openModuleDb(dataDir: string, name: string): Database {
    if (!MODULE_NAME.test(name)) throw new Error(`invalid module name: ${JSON.stringify(name)}`);
    const db = new Database(join(dataDir, `${name}.db`), {create: true, strict: true});
    try {
        const mode = db.query<{journal_mode: string}, []>("PRAGMA journal_mode = WAL").get()?.journal_mode;
        if (mode !== "wal") throw new Error(`database journal mode is ${String(mode)}, expected wal`);
        db.exec("PRAGMA synchronous = NORMAL");
        db.exec("PRAGMA foreign_keys = ON");
        // `bun:sqlite` 是同步调用，等锁期间整个事件循环停着。进程内的写入天然排成一队，会等锁的只有进程外的连接
        // （备份的只读事务不挡写入；创建管理员命令、测试的故障注入会持写锁），等太久不如让就绪检查回 503。
        // 进程外出现长时间持写锁的常规写者时，这个上限要重新考虑。
        db.exec("PRAGMA busy_timeout = 250");
    } catch (error) {
        db.close();
        throw error;
    }
    return db;
}

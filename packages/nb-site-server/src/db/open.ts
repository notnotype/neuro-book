/**
 * 每个模块一个库文件 `<数据目录>/<模块名>.db`（ADR 0061 决策 1；文件名是 `site.operations` 写明的数据目录布局）。
 * 每个库在本进程里有两条连接：模块的业务连接（`openModuleDb`），以及只给就绪检查用的探测连接（`openProbeDb`）。
 * 进程外会碰库的只有备份的只读连接、模块的 `shared` 命令（t07 的创建管理员）与合同测试的故障注入。
 */

import {Database} from "bun:sqlite";
import {join} from "node:path";

/** 模块名也是库文件名与日志里的 `module`，只许小写字母开头的字母数字。 */
export const MODULE_NAME = /^[a-z][a-z0-9]*$/u;

function dbPath(dataDir: string, name: string): string {
    if (!MODULE_NAME.test(name)) throw new Error(`invalid module name: ${JSON.stringify(name)}`);
    return join(dataDir, `${name}.db`);
}

/**
 * 打开（不存在就新建）一个模块的库并设好连接参数。调用方拥有返回的连接，负责 `close()`。
 * 模块名不合格或文件系统不支持 WAL 时抛错：前者是程序错误，后者让并发读写的前提不成立，不能带着别的日志模式运行。
 * 文件不是 SQLite 库时抛 `SQLiteError`。
 */
export function openModuleDb(dataDir: string, name: string): Database {
    const db = new Database(dbPath(dataDir, name), {create: true, strict: true});
    try {
        const mode = db.query<{journal_mode: string}, []>("PRAGMA journal_mode = WAL").get()?.journal_mode;
        if (mode !== "wal") throw new Error(`database journal mode is ${String(mode)}, expected wal`);
        db.exec("PRAGMA synchronous = NORMAL");
        db.exec("PRAGMA foreign_keys = ON");
        // `bun:sqlite` 是同步调用，等锁期间整个事件循环停着：每个撞上进程外写锁的请求都让全站停至多 250 毫秒，
        // 几个这样的请求排在一起时累加。进程内的写入天然排成一队，会撞上的只有进程外的写者（创建管理员命令、
        // 测试的故障注入、部署的人开着的 sqlite3），这些都是偶发的。进程外出现常规的写者时要重新考虑这个上限。
        db.exec("PRAGMA busy_timeout = 250");
    } catch (error) {
        db.close();
        throw error;
    }
    return db;
}

/**
 * 就绪检查用的探测连接：库必须已经存在（迁移已经建过它）。`busy_timeout = 0`：库被别的进程占着写时立即报 `SQLITE_BUSY`，
 * 健康检查不等锁，也就不会让事件循环停下来（`site.operations` 输出 4）。日志模式是库文件的属性，这里不再设。
 */
export function openProbeDb(dataDir: string, name: string): Database {
    const db = new Database(dbPath(dataDir, name), {readwrite: true, create: false, strict: true});
    try {
        db.exec("PRAGMA busy_timeout = 0");
    } catch (error) {
        db.close();
        throw error;
    }
    return db;
}

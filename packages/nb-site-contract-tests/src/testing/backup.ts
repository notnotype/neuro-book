/**
 * 核对备份：按 `site.operations` 副作用与数据一节写明的布局（`<数据目录>/backups/<UTC 时间>/<模块>.db`）找到副本，
 * 只读打开、跑 SQLite 自己的 `quick_check`。不读被测模块的表：“副本是可以打开的一致快照”（输出 6）只需要 SQLite 认得它。
 */

import {Database} from "bun:sqlite";
import {readdirSync} from "node:fs";
import {join} from "node:path";

/** 一份完整备份的目录名：UTC 时间到毫秒，例如 `20261124T031500123Z`（Spec 的数据目录布局）。 */
export const BACKUP_NAME = /^\d{8}T\d{9}Z$/u;

export function backupsDir(dataDir: string): string {
    return join(dataDir, "backups");
}

/** `backups/` 下名字是备份时间的目录，按名字排序（定宽数字，即按时间）。`backups/` 不存在时为空。 */
export function listBackups(dataDir: string): string[] {
    let entries;
    try {
        entries = readdirSync(backupsDir(dataDir), {withFileTypes: true});
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
    }
    return entries
        .filter((entry) => entry.isDirectory() && BACKUP_NAME.test(entry.name))
        .map((entry) => entry.name)
        .sort();
}

/** 只读打开一个副本，返回 `PRAGMA quick_check` 的每一行；一致的库只有一行 `ok`。打不开时照常抛出。 */
export function quickCheck(path: string): string[] {
    const db = new Database(path, {readonly: true});
    try {
        return db
            .query<{quick_check: string}, []>("PRAGMA quick_check")
            .all()
            .map((row) => row.quick_check);
    } finally {
        db.close();
    }
}

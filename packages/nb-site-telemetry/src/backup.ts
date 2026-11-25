/**
 * 备份时在副本上去掉原始上报（`site.operations` 输出 6；`site.telemetry-ingest` 的副作用一节：原始上报与上报编号不进备份）。
 * 入口的备份命令写出副本之后调用它，随后对副本 `VACUUM`（删掉的内容不留在空闲页里）、`quick_check`；约定见
 * `nb-site-server/src/module.ts` 的 `SiteModule.prepareBackupCopy`：同步、返回 `undefined`、不留未提交的事务。
 *
 * 先把还没进聚合的行都算进聚合，副本因此带着截至备份那一刻的完整聚合；再清空两张原始表。聚合出错时照样清空，
 * 再抛错让这次备份失败：失败的副本也可能在 `.partial` 里留一阵，里面不能有原始上报。
 *
 * 游标与 `sqlite_sequence` 留在副本里：用副本恢复之后，新行的编号接着往上（`AUTOINCREMENT`），大于游标，照常进聚合。
 * 恢复之前记入过的上报再重发会被当成新的一份（编号没进副本），见 Spec 的副作用一节。
 *
 * 备份命令是另一个进程，不调用 `createTelemetryModule`、不读配置，所以这里只用副本这一条连接。
 */

import type {Database} from "bun:sqlite";

import {aggregateAllNow, createAggregator} from "./aggregate";

export function prepareTelemetryBackupCopy(copy: Database): undefined {
    // 副本是备份命令新开的连接，`secure_delete` 是 SQLite 的缺省（关）。不开时下面的 DELETE 只是逻辑删除，被删的单元格与
    // 索引项原样留在页里；入口在副本准备失败时不再 `VACUUM`，`.partial` 里的库文件就带着全部原始上报（w00037 t06 第 4、5 片
    // 审查第 1 条）。开了之后删掉的内容当场被抹掉，不依赖入口之后做什么。
    copy.exec("PRAGMA secure_delete = ON");
    try {
        aggregateAllNow(createAggregator(copy));
    } finally {
        // 一批出错时那个事务已经回滚，这里不在任何事务里。
        copy.exec("DELETE FROM telemetry_daily_raw");
        copy.exec("DELETE FROM telemetry_event_raw");
    }
    return undefined;
}

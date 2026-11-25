/**
 * 读统计的聚合计数，只给相邻版本测试（`adjacent-version.test.ts`）的“上一个版本在本版本写过的聚合上接着加”用（`site.operations`
 * 输出 7）。这是合同测试里唯一读被测模块的表的地方：第一版没有读聚合的接口，而这条要核的正是份数，从文件的字节看不出来。
 *
 * 依赖统计模块库里 `telemetry_daily_count` 的形状，它不是公开合同：表改了名或换了存储时这里打不开、查不到，用例报错，
 * 不会静默通过。有了读聚合的接口（`site.telemetry-dashboard`，t11）之后改经接口读，删掉本文件与允许清单里的这一行。不含断言。
 */

import {Database} from "bun:sqlite";
import {join} from "node:path";

/** `<dataDir>/telemetry.db` 里应用版本为 `appVersion` 的每日上报一共算进了几份（各服务端日、各清单版本加起来）。 */
export function aggregatedDailyReports(dataDir: string, appVersion: string): number {
    // 只读打开，服务进程可以同时开着：WAL 下读不挡写。
    const db = new Database(join(dataDir, "telemetry.db"), {readonly: true, strict: true});
    try {
        return (
            db
                .query<{reports: number}, [{$value: string}]>("SELECT coalesce(sum(reports), 0) AS reports FROM telemetry_daily_count WHERE dimension = 'app_version' AND value = $value")
                .get({$value: appVersion})?.reports ?? 0
        );
    } finally {
        db.close();
    }
}

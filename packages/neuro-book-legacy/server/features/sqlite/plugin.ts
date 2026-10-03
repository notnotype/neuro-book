/**
 * platform.sqlite 内置插件：激活时建立受管 SQLite 服务并以 `sqliteKey` 提供给声明依赖的消费者。
 *
 * 工厂只闭包驱动选择，import 与工厂调用都不做 I/O；插件本身不登记任何数据库资源——每个物理文件由
 * 数据 owner 在自己的作用域内 `register()`，提供者是进程级不等于提供者拥有所有库。服务的 `release`
 * 在全部资源随各自 owner 收口后才成功，否则报告关闭未完成并保留占用。
 */

import type {RuntimeLocation} from "nbook/runtime/lifecycle/lifecycle";
import {provide} from "nbook/runtime/plugins/plugins";
import type {PluginDefinition} from "nbook/runtime/plugins/plugins";

import {sqliteKey} from "./contracts";
import {createNodeSqliteDriver} from "./driver";
import type {SqliteDriver} from "./driver";
import {SqliteServiceImpl} from "./service";

/** 插件 id；宿主清单用它引用本插件。 */
export const sqlitePluginId = "nbook.sqlite";

export interface SqlitePluginOptions {
    /** 驱动适配器；缺省 Node 内置 `node:sqlite`。测试可注入受控驱动做故障注入。 */
    readonly driver?: SqliteDriver;
    /** 入口位置；缺省 server。 */
    readonly location?: RuntimeLocation;
}

export function createSqlitePlugin(options: SqlitePluginOptions = {}): PluginDefinition {
    return {
        id: sqlitePluginId,
        entries: [
            {
                id: "main",
                location: options.location ?? "server",
                provides: [sqliteKey],
                activate: () => {
                    const service = new SqliteServiceImpl({driver: options.driver ?? createNodeSqliteDriver()});
                    return {services: [provide(sqliteKey, service, () => service.release())]};
                },
            },
        ],
    };
}

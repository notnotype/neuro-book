/**
 * platform.sqlite：受管 SQLite 连接与事务能力的唯一公开入口。
 *
 * 消费者从这里取得服务键 `sqliteKey`、声明/句柄/结果类型、错误类 `SqliteError`、驱动适配器边界与
 * 插件定义工厂 `createSqlitePlugin()`。内部实现（`./service`、`./location`）不属于公开合同。
 * 行为合同见 docs/specs/platform/sqlite.md。
 */

export * from "./contracts";
export {createNodeSqliteDriver, driverFailureError} from "./driver";
export type {SqliteConnection, SqliteDriver, SqliteDriverOpenOptions} from "./driver";
export * from "./plugin";

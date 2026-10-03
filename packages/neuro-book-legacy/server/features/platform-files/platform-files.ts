/**
 * platform.files：受根约束的托管文件 I/O 能力的唯一公开入口。
 *
 * 消费者从这里取得：服务键与授予键（`platformFilesKey`、清单里声明的 `GrantSpec.key`）、
 * 服务接口与句柄类型、错误类，以及插件定义工厂 `createPlatformFilesPlugin()`。
 * 内部实现（`./grants`、`./paths`、`./service`）不属于公开合同。
 * 行为合同见 docs/specs/platform/files.md。
 */

export * from "./contracts";
export * from "./plugin";

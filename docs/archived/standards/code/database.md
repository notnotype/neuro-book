# 数据库领域规范

适用：`prisma/**`、`prisma.config.ts`，以及直接改变数据库 schema 或 migration 的服务端代码。

- 先确认修改属于 App SQLite 还是 Project SQLite；schema、migration、生成入口、数据 owner、备份与升级语义和相应测试必须同步。
- 生成 client 只由 `bun run generate` 产生；源码改动不能直接编辑 `server/generated/`。
- migration 使用既有目录和命名合同，显式列出列名、约束、索引和数据选择条件。表重建必须保留应保留数据并明确丢弃条件。
- SQL 标识符和字符串按目标数据库正确引用；危险操作定义前置条件、事务与失败语义以及可验证结果。
- 已进入共享历史的 migration 保持语义不变；修正通过新增后续 migration 完成。当前 schema 采用完整切换，不保留长期双写或未归属兼容列。
- 数据库执行需要用户授权；静态合同检查、聚焦测试和 client 生成不能写成真实数据升级已验证。

完成标准：schema、migration、生成入口、数据 owner、备份/恢复语义和测试形成一套合同，App 与 Project 数据没有串线。
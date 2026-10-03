# Application State 迁移记录

本目录从 0.9.0 开始记录每个会改变持久状态的发布。Release Manifest 中的 `stateMigration` 是机器可校验声明，本目录说明用户影响、备份、自动步骤和回滚方式。

## 发布规则

- `policy: none`：本版本没有状态格式变化，`steps` 必须为空。
- `policy: automatic`：Manager 在 install、update 和 start 的启动前事务中自动执行；`steps` 必须存在于 Product catalog。
- `policy: manual`：自动迁移无法安全完成，必须提供本目录下的 `guide`；Manager 在修改数据或切换 Product 前停止。

迁移依据 State Root 中的 sentinel，而不是应用版本号。因此从较老版本直接升级时，会按当前 Product catalog 顺序补齐所有缺失步骤。

## 直接运行源码或 Product

不经过 NeuroBook Manager 时，启动只检查状态，不自动写数据。先执行只读规划：

```bash
bun run migrate:application-state -- --plan
```

确认 JSON 报告后执行：

```bash
bun run migrate:application-state -- --apply
```

若进程中断，错误信息和 `.nbook/agent/migrations/application-state.json` 会指出 runId。对同一个 run 明确选择：

```bash
bun run migrate:application-state -- --resume --run-id <runId>
bun run migrate:application-state -- --rollback --run-id <runId>
```

不要删除或手工编辑 migration journal、backup、sentinel 或 Session JSONL。损坏或 checksum 不一致时先完整备份 State Root，再按对应版本说明处理。

## 版本索引

计划中的消费者迁移见 [Storage 状态首批迁移](storage-state.md)；该文档尚未绑定发布版本，
浏览器旧键导入不是 Manager 能离线执行的 Application State catalog 步骤，不改变本页已有启动与发布合同。

- [0.9.0：Application State catalog v3 与 Agent Session v2](0.9.0-session-v2.md)
- [0.9.3-canary：Job durable history、Source Dev Cache Root 与升级边界](0.9.3-canary.md)

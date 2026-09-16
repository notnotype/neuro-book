# Storage 归档实现记录

状态：实现与聚焦测试通过，等待统一类型检查与独立审查。主 Agent 以 Tasker 实现；基线 `0d66064b`。

## 已查明

- Project ZIP 的 `yazl.addFile` 提前 stat，随后才打开读流。Storage 在此期间原子替换为不同大小的值会触发 size 不匹配。
  实现选择把 policy 标记 preserve 的文件逐条复制到既有归档 staging，ZIP 读取已固定的文件，避免修改依赖类型与流所有权。
  Storage 使用原子替换，复制取得的源是完整旧文件或新文件；不承诺不同文件同一时刻。
- 完整 data 使用 fflate + 单个 createReadStream，已从实际流计算条目大小；需新增 `.locks` 目录排除及真实解包证据。
- Project path policy 由并行 t31 添加 Storage preserve/ignore；本 Task不改它。

## 已运行

- 完整 data 实际加密、解密与 ZIP 解包：两个 scope 的记录、墓碑、原件和 user identity 均保留，`.locks` 与 `.tmp` 排除。
- Project ZIP：忽略 `.nbook` 仍包含上述 Project 数据，原件字节相等；归档准备后原子替换为不同大小文件，ZIP 仍含完整旧快照。
- 首轮 backup 两文件 8 用例、Project archive 一文件 5 用例通过。
- 追加修复：目录枚举与可选顶层文件的 I/O 错误不能被当成缺失。只有全新 Workspace 的 ENOENT 可跳过，拒绝 EACCES 的用例通过。
- 最终聚焦命令（主应用 cwd）：`bun run test server/backup/backup-archive-rules.test.ts server/backup/backup-archive-service.test.ts server/workspace-files/workspace-archive.test.ts --maxWorkers 1`：3 文件 14 用例通过、exit 0。
- Windows 控制目录比较遵循大小写不敏感语义；普通 `notes/storage/.locks` 没有被当作服务端锁目录。

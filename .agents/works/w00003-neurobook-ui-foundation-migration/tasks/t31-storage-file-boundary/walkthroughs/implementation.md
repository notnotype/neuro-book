# t31 实现中与证据

状态：实现与聚焦验证完成，等待主 Agent 统一 typecheck 与最终收取。
基线：`0d66064b`（t28 精确 ready/publicId 提交）。
范围：计划切片 2 的普通文件消费与资产同步边界；未改 `server/storage`、`server/api/storage`、
`shared/storage`、Project lifecycle/session/module、`workspace-archive.ts`、`server/backup`、
两个 workbench descriptors（用户既有 dirty）。

## 接口选择

1. 新增 `server/workspace-files/workspace-storage-boundary.ts`，只消费既有 `WorkspaceFileTarget`
   与该目标的一条相对路径，按目标种类判定 Storage 根：

   | 目标种类 | 受保护相对地址 |
   |---|---|
   | `project-workspace` | `.nbook/storage`（含其后代） |
   | `user-assets` | `storage`（含其后代） |
   | `workspace-root` | `.nbook/storage` 与 `<Project>/.nbook/storage`（各含后代） |

   判定不从绝对路径 basename 推断根类别，所以 `notes/storage` 等同名普通目录不受影响。
   `workspace-root` 下单段地址既可能是 Project 目录（Storage 祖先）也可能是普通文件，
   只在 mutation 时对真实目录做一次 `lstat` 判定，不把任意 I/O 失败当"不存在"。

2. 生产边界的实际调用点：
   - 普通文件 HTTP 读/统计：`read.get.ts`、`stat.get.ts`；
   - 普通文件 HTTP 写入口（含冲突检测读盘）：`write.put.ts`；
   - 普通文件 HTTP mutation：`tracked-workspace-files.ts` 六个包装函数（写入/新建/建目录/转目录/改名/删除），
     全部在实际 fs 调用之前；
   - 上传：`workspace-upload.ts` 三个入口改为接收 `WorkspaceFileTarget`，写盘前整批校验 entry。
   - 逻辑越界/绝对路径仍由核心入口按既有错误合同拒绝，guard 不改写其错误形状。

3. 消费侧排除：
   - `project-workspace-path-policy.ts` 增加 `storage` / `storage-runtime` 类别：
     正式记录、墓碑、原件、身份域元数据 = `storage`（archive `preserve`，file-index/history `ignore`）；
     `.locks` 与 record-codec 实际临时名 = `storage-runtime`（三个消费者都 `ignore`）；
   - `project-file-index.ts` plain（user-assets / workspace-root）扫描与 watcher 复用同一判定；
   - `novel-workspace.ts` 受管资产同步在源枚举、copy 循环与三个清理函数都跳过 Storage 相对地址。

4. `WorkspaceStorageBoundaryError` 携带 `statusCode = 403`；Nitro 错误处理直接读 `error.statusCode`
   （`node_modules/nitropack/dist/runtime/internal/error/prod.mjs:19`），因此 HTTP 得到可解释的 403，
   不是任意 500。

## 命令与结果

见本轮最终报告；原始输出按需进 `evidences/`。

## 未运行与剩余项

- 未跑主应用 `typecheck`：`vitest.config.ts`、`server/storage/**`、Project lifecycle/session 正由 t30 修改，
  按 Task 归纳由主 Agent 统一执行。
- 新增测试位于 `server/**` 通配内，无需改 `vitest.config.ts`。
- 项目 ZIP / 完整 data 备份的真实解包未验证（本轮不改 `workspace-archive.ts` / `server/backup`）。
- user-assets / workspace-root 的普通 ZIP 下载仍由 `workspace-archive.ts` 决定（不在本轮范围）。
- `workspace node` CLI 走低层文件能力、无 `WorkspaceFileTarget`，未纳入守卫（Task 明确不为低层能力引入运行期全局路径）。

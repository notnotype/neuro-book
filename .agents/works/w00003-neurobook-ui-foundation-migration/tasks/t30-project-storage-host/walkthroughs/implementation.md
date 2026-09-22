# t30 Project Storage lazy module 与宿主接口：实现记录

基线 `0d66064b`；主 Agent 只读取证，本轮 Tasker 独占源码与测试。

## 接口选择

1. **claims 增加 project 绑定**：`StorageAccessContextClaims` 增加可选 `project: {publicId, projectRoot}`。
   registry 增加 `peek(contextId)`（只读签发声明）与 `revokeProject(storageRoot)`（主动失效一个 Project scope）。
   `assertSameClaims` 一并比较 project 绑定，避免 project 访问被 user 端点或另一个 Project 复用。
2. **复用 host 的鉴权与关闭协议**：把原 `resolveClaims` 拆成 `resolveDataIdentity`（客户端凭证、auth-on/off、
   session 代次、在途撤销、身份域）与 user/project 两个 claims 组装器。project 不新建鉴权、不新建 registry 或句柄池，
   只新增 `issueStorageProjectContext / performStorageProjectAction / releaseStorageProjectContext`。
3. **精确 ready 解析走 facade**：host 动态 `import("nbook/server/workspace-files/project-session")`
   （与 `server/utils/auth` 同一惰性模式），使用 t28 已有的 `requireReadyProjectByPublicId`，
   新增 facade/service 方法 `revalidateReadyProject`，Lifecycle port 增加 `revalidateWorkspace`（rootIdentity.revalidate）。
   这样 Storage 不复用“按路径取当前 generation”，也不自造 root identity。
4. **首次建根受门禁保护**：签发顺序为 精确 ready → `revalidateReadyProject`（Occupancy + 物理目录）
   → activate lazy module → data 身份域 → `mkdir ProjectRoot/.nbook/storage` → 再复核一次 → 签发 claims（含存储根身份摘要）。
   后续每个动作都携带 `expectedRootIdentity` 打开句柄，`StorageService.openHandle` 因此不创建缺失目录。
5. **身份域只来自 data**：`WorkspaceRoot/.nbook/storage/identity.json`（沿用 user 根，受 `storageRoot` 测试覆盖一致）；
   Project 根不签发 `identity.json`。
6. **已接纳动作登记**：签发与动作都跑在 `runReadyProjectOperation` 内，普通 close 先等已接纳动作 settle 再关 Module；
   lazy Module `close()` 只失效本 scope 的访问上下文，不等一个只有它自己 close 才结束的操作。
7. **HMR 换代**：宿主槽从 `__nbookStorageHostV3` 升到 `__nbookStorageHostV4`，旧 V3/V2 owner 的形状不含新 registry 方法，
   不能原地复用；新 owner 先排空旧 registry、旧 service 与旧句柄池。
8. **只保留一份 service/pool**：`StorageService` 由注册定义决定，句柄池条目键已含 contextId（每次 project 访问一个），
   因此按 Project root 再建 service/pool 只会引入任务正文禁止的“脱离生命周期的永久 Map”，
   也会制造第二处定义 authority。Project 的作用域生命周期由 lazy Module 的 close 表达。

## 文件

- `shared/storage/host.ts`：project 访问参数 DTO/结果 DTO。
- `server/storage/access-context.ts`：claims project 绑定、`peek`、`revokeProject`、`assertSameClaims`。
- `server/storage/host.ts`：数据层身份复用、project 签发/动作/释放、`revokeStorageProjectScope`、V4 换代。
- `server/storage/storage-actions.ts`：共享有界 body 读取 + project 访问参数解析。
- `server/storage/project-storage-module.ts`：lazy storage Module（token/start/close）。
- `server/workspace-files/project-module.ts`：`ProjectModuleName` 与 lazy 顺序登记 `storage`。
- `server/workspace-files/project-lifecycle.ts` / `project-session-service.ts` / `project-session.ts`：
  `revalidateWorkspace`、`revalidateReadyProject`、`requireReadyProjectByPublicId` 导出与 composition root 注册。
- `server/api/storage/project/{context.post,context.delete,action.post}.ts`：HTTP 入口。

## 结果

已实现并验证：

- project 访问上下文：`POST/DELETE /api/storage/project/context`，参数 `projectRoot + publicId`（严格 DTO），
  结果 `{contextId}`；project 值动作 `POST /api/storage/project/action`，DTO 与 user 相同。
- 签发顺序：精确 ready → `revalidateReadyProject`（Occupancy + 真实 Project 目录）→ activate lazy storage Module
  → data 身份域（`WorkspaceRoot/.nbook/storage/identity.json`）→ 首次 mkdir `ProjectRoot/.nbook/storage` → 再复核 ready → 签发。
- 每次动作/释放重新核验 data 身份、主体、客户端、session 代次与最初绑定；句柄用签发时的存储根身份摘要打开，
  因此根缺失时 `StorageService.openHandle` 不创建目录。
- lazy Module `close()` 失效本 scope 的访问上下文；已接纳动作经 `runReadyProjectOperation` 在 Module close 前收口。
- HMR：V3 → V4 槽升级，旧 registry/service/句柄池一并排空；旧形状 owner 不被复用。

### 验证命令与结果

| 命令 | 结果 |
| --- | --- |
| `bunx vitest run server/storage/project-scope.test.ts` | 5 passed（真实 Node HTTP + H3 路由 + 隔离 Workspace Root） |
| `bunx vitest run server/storage shared/storage server/api/storage server/workspace-files/project-{module,session,session-service,session-runtime,lifecycle}.test.ts server/workspace-files/project-session-hmr.test.ts` | 26 文件，337 passed / 1 skipped |
| `bunx vitest run server/storage/storage-host-hmr.test.ts` | 5 passed |
| `bun run typecheck`（主应用，cwd `packages/neuro-book`） | exit 0，无输出 |

`project-scope.test.ts` 覆盖的行为：

1. context → bind → 缺失读取 → CAS save → 重读 → release，两个 Project 互不可见（含直接读盘断言记录文件位置）；
   另断言普通 open 与 user 身份域都不在签发前创建 `.nbook/storage`。
2. 未 open、缺标识、自报 subject/storageRoot、user/project 混用、闭后重开旧 publicId 全部拒绝，
   且被拒绝的旧初始化不递归 mkdir 重建已删除的 Storage 根；关闭后旧 contextId 立即失效（Module close 已撤销）。
3. Project Storage 根被同路径替换后，保存以 403 `claims-mismatch` 在副作用前失败，新根保持为空。
4. 本标签 release 只释放自己的上下文，另一个标签的访问继续可用。
5. 句柄打开阶段设闸：已接纳保存先 settle，`closeProject` 才继续关 Module，随后旧上下文 403。

### 未运行 / 残余

- project 用例走 `resolveSubject` 注入接缝；auth-on/off 与 session 撤销由既有 `server/storage/host.test.ts` 覆盖
  同一 `resolveDataIdentity` 代码路径，未单独为 project 再跑一遍真实 auth-on HTTP。
- 等锁期间撤销授权/根替换：由共享 guard 与既有 user 用例覆盖，未为 project 另设等锁窗口用例。
- 完整 Project 根被 rename/替换（非 Storage 根）在 Windows 上因 DB 句柄占用无法在测试内稳定 rename，
  由 `project-lifecycle.test.ts` 的 `PROJECT_ROOT_REPLACED` 合同与本案的闭后重开用例分别覆盖。
- 未接入：Storage 路径的文件/备份策略、grid、迁移、UI 与命令系统（属其它 Task）。

### 观察

本轮与 t31/t32 在同一 worktree 并行；期间 `server/workspace-files/novel-workspace.ts` 一度处于半成品语法错误
（`continue` 在循环外），使 vitest 报 `Illegal continue statement` 并阻断本 Task 测试收集，待其修复后重跑通过。

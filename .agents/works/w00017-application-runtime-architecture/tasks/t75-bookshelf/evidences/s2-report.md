# t75 S2 编码子代理交付报告（2026-10-10）

子代理（opus）在独立 worktree 的分支 `t75/s2-backend` 上实现 `docs/specs/runtime/projects.md` 输出 13、14、15、17、18 的服务端部分；提交 `0a86da11`（宿主层）与 `8fb199dc`（远程合同 v2 与 `shelf`）。子代理环境不允许写报告文件，以下是它最终回复的要点，由主会话转录；主会话的审查与验证见 Task README。

## 做了什么（路径相对 `packages/neuro-book/`）

- 输出 13 作品信息（`src/server/projects/identity.ts`）：`readProjectIdentity` 多给 `metadata` 与 `problems`（不合规字段按 null 处理并带字段名）；新增 `updateProjectMetadata(path, expectedId, patch, {report})`，经 `replaceLocked` 锁 `.nbook/locks/project.json.lock`（先建锁目录），锁内核对 id、只改给出的字段、保留 `id`、`schema` 与不认识的字段；符号链接先 `realpath`，悬空为 `identity-invalid`，只读为 `read-only`。
- 输出 14 新建：`projectDirectoryName` 目录名规则；`createProjectDirectory` 做排他建目录与写身份文件（写失败只撤掉本次建的东西）；`registry.create` 做登记（失败 `register-failed` 带路径）。`no-library` 在插件入口判断（`parent` 省略时读 `librarySetting`），`ProjectCreateInput.parent` 因此必填。
- 输出 15 移出书架：`registry.unregister(id)`；`manager.ts` 按项目 id 的 Promise 队列把打开与移出串行，不在 `stopped` 的拒绝为 `project-running` 带状态。
- `projectsKey` 新增 `create`、`updateMetadata`、`unregister`、`readMetadata`。
- 输出 17、18：`backend/shelf.ts` 组装书架条目（运行中经 `{project}` 调 `current()`，其它读 `PROJECT_STATS_RECORD`；`today` 按 `clockKey` 的服务端本地日期；单项失败只影响自己并记诊断）；`backend/plugin.ts` 提供 v2，依赖新增 `settingsKey`、`storageKey`、`clockKey`；删除 `projectsRemoteContractV1`。
- 测试支持：`src/server/testing/projects.ts` 加 `prepare` 钩子、公开 `root`/`stateRoot`、提供 `clockKey`；新增子进程脚本 `src/server/projects/testing/identity-child.ts`。

## 偏离计划或 Spec 之处

1. `projectsKey` 多了 `readMetadata(id)`（插件不引用宿主内部的 `identity.ts`），失败码多一个 `read-failed`。
2. `updateProjectMetadata` 多了 `{report}` 参数（`replaceLocked` 收尾的次要错误要有诊断出口）。
3. 问运行中项目的统计设 2000 ms 超时（Spec 没写）。
4. 小规则：书名存储时去首尾空白；字数上限按码点；Windows 保留名含 COM0、LPT0 与上标数字；`no-library` 先于书名校验；身份文件不存在时 `identity-invalid`、不重建。
5. `ProjectMetadata` 在 `src/shared/projects.ts` 另写一份同形状的类型（宿主共用代码不引用插件）。
6. Spec 有三处要由主会话改：实现合同里 V1 过渡的那句；后端依赖方向；`projectsKey` 方法清单加 `readMetadata`。

## 子代理自报的验证

- `bun run typecheck`：通过。
- `bun test src/server/projects/ src/plugins/projects/projects.test.ts src/server/server-projects.test.ts`：66 pass，0 fail（改动前 37 pass）。
- 变异 4 项全部被测试抓到：去掉按 id 的队列；去掉 `today` 的日期判断；实时调用失败不退回记录；用取锁前的字节做决定。
- 整包 `bun test`：909 pass，4 fail，均与本次无关（`architecture.test.ts` 的 `editor/web/plugin.ts → workbench/shared/items`、`settings/commands.test.ts` 的切换主题、`dev/watch.test.ts` 与开发会话子进程的环境问题；前两项在 `af91c885` 已存在）。

## 留给 S3

- `projects.test.ts` 里“运行中但没有统计提供方时退回记录”一条，S3 给项目实例加上提供方后要改。
- S3 之前每次刷新书架会给每个运行中的项目记一条 info 级诊断 `projects.shelf.live-unavailable`。
- 书架每部作品各读一次登记表（`readMetadata` 按 id 解析）。

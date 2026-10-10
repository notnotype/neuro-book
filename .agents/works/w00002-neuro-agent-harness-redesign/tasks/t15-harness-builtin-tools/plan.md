# t15 实施计划：内置工具

## Context

- **为什么做**：Work 切片 7，内核的最后一片。模型要能读写作品文件；旧原型的 read/edit 直接按 cwd 解析路径、能越过 cwd，设计稿要求经受根约束的 `FileAccess`。
- **依据**：[`harness.builtin-tools`](../../../../../docs/specs/harness/builtin-tools.md)（本 Task 新写，`planned`）；[`harness.tools`](../../../../../docs/specs/harness/tools.md) 的工具协议；OMP 编辑引擎实测语义（`docs/omp-capabilities.md` 第 4 节：`input` 字段、apply 回显新标签、快照记账由引擎负责、未展示行守卫、伪造标签拒绝、陈旧标签重映射、错误文本不改写）。
- **本 Task 自己定的（记入待确认清单）**：编辑引擎自己从磁盘读当前文件（Rust 侧），`FileAccess` 只管写与 `read` 工具的读；快照存储按 `ToolContext.session.id` 分开。
- **工作方式**：同前几个 Task；全部用真实临时目录与真实 OMP 引擎，不联网。

## 关键设计

1. **`FileAccess`（`types.ts`、`local/local.ts`）**：只收根内相对路径；`resolve` 按字面规范化判越界，各操作再按 `realpath` 判一次（符号链接指向根外拒绝；不存在的目标按最近存在的父目录判）。失败码五种。
2. **快照存储（`stores.ts`）**：`Map<sessionId, EditStore>`；`release` 丢弃。
3. **read（`read.ts`）**：`stat` → 目录列一层 / 图片按扩展名以图片块返回 / 文本：NUL 检查、`offset`/`limit` 切片、按行与字节预算截断、登记 `seenLines`、输出 `[path#tag]` 头与 `N: ` 行号。
4. **edit（`edit.ts`）**：`EditSession(store, policy)`，`policy.cwd = localSandboxRoot = homeDir = root`；writer 把引擎给的绝对路径转回根内相对路径再经 `FileAccess.write/remove`（`move` 先写目标再删源）；越界或写失败在 writer 里抛本模块的 `WriteFailed`，apply 外接住变成带码结果；引擎 `isError` → `edit-rejected`，文本照引擎。
5. **入口与边界（`builtin.ts`）**：`createBuiltinTools` 用一套快照存储装两个工具成静态来源；`package.json` 加 `./builtin`、`./builtin/local`；模块表登记 `builtin`（依赖 `tools`，`pi-natives` 运行时，Node 内置模块只在 `local`）；`pi-natives` 依赖加回。

## Spec 与文档改动

| 文档 | 改什么 | 片 |
|---|---|---|
| `docs/specs/harness/builtin-tools.md` | 本 Task 新写；收口加证据 | 计划时、S2 |
| `docs/specs/README.md` | 登记；收口标“待晋升” | 计划时、S2 |
| `packages/nb-harness/package.json`、`src/architecture.test.ts` | 入口、依赖与模块表 | S1 |
| Work README | 切片 7 链接 | 计划时 |

## 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| S1 | 全部实现与合同测试（场景 1–4） | `bun test src/builtin`、`bun run typecheck`、`bun test src/architecture.test.ts` |
| S2 | Spec 证据与注册表；omp 审查 | `bun test`、仓库根 `bun run governance:check` 与 `bun run docs:check` |

## 验收映射

| `harness.builtin-tools` | 测试 |
|---|---|
| 输出 1；场景 1 | `src/builtin/local/local.test.ts` |
| 输出 2–5、7、8；场景 2 | `src/builtin/read.test.ts` |
| 输出 6、7；场景 3 | `src/builtin/edit.test.ts`（真实引擎） |
| 场景 4 | `src/builtin/runtime.test.tsx`（运行时测试装配，脚本化模型） |

## 验证

- `bun test src/builtin`、`bun run typecheck`；变异检查：越界只按字面不按真实路径、`seenLines` 登记全部行、引擎要写根外路径照写、快照存储不按会话分、`edit-rejected` 时照样落盘（不可能——引擎不调 writer，核对测试）。

## 不做与风险

- 不做：多根、项目参数、格式插件。
- 风险：OMP 引擎的回显格式与错误文本随升级变化；合同测试先失败。
- 风险：引擎自己读磁盘，`FileAccess` 的读约束对它无效；根与 `cwd`/`localSandboxRoot` 一致时读的是同一棵树，插件阶段 `nbook.files` 也落在真实文件上。

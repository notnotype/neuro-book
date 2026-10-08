# K1–K6 验收指引

第 5 步 K1–K6（内核实例与远程服务、RPC 端口、项目子进程、Storage、插件状态与公开状态、配置）已全部实现并通过各自的三方审查。开发者 2026-10-08 决定一起验收、不阻塞后续（见 [待确认清单](pending-confirmations.md) 第一行）。本文给出验收时看什么、怎么跑；发现的问题另建 Task。

| 步 | Task | 行为合同 |
|---|---|---|
| K1 内核：开放运行位置、按调用方门面、委托、远程服务、子实例租约 | [t52](tasks/t52-kernel-instances-remote/README.md)，后续 [t58](tasks/t58-service-ids-backend-dir/README.md)–[t61](tasks/t61-kernel-catalog-failure-codes/README.md) | `docs/specs/runtime/` 下 services、plugins、plugin-channel、application、plugin-manifest |
| K2 RPC 端口与浏览器连接 | [t53](tasks/t53-rpc-port-browser-connection/README.md) | `runtime/browser-host.md`、`runtime/server-host.md` |
| K3 项目子进程 | [t54](tasks/t54-project-child-process/README.md) | `runtime/projects.md` |
| K4 Storage | [t55](tasks/t55-plugin-storage/README.md) | `storage/persistence.md` |
| K5 插件状态 store 与公开状态 | [t56](tasks/t56-plugin-state/README.md) | `state/store.md`、`state/public-state.md` |
| K6 配置 | [t64](tasks/t64-plugin-settings/README.md) | `settings/configuration.md` |

插件写法的教学材料在 `packages/neuro-book/examples/`（[t62](tasks/t62-plugin-examples-in-app/README.md)）：五个示例插件与五个场景测试，是看“写一个插件要做什么”的最快入口。

## 自动检查

在 worktree `.worktree/w00017-runtime-foundation` 根执行：

```bash
bun run test:affected --typecheck --since master   # 内核与新应用的单元、合同、组件测试与三份 typecheck
bun run --cwd packages/neuro-book test:e2e          # 生产构建后的真实 Chrome 用例（约 1 分钟）
bun run --cwd packages/neuro-book smoke:server      # 打包产物 S1–S9
bun run docs:check && bun run governance:check
```

`nb-ui`（colorway 测试取不到 localStorage）、`neuro-book-test-support`（paths 测试）、`llmlint`（缺 `diff-match-patch`）的失败是分支上早已存在的，与 K1–K6 无关。`/tmp` 是内存盘，快满时 Chrome 会报磁盘配额不足，先清理旧的临时目录再跑 e2e。

## 在真实产品里看

```bash
cd packages/neuro-book && bun run build
NBOOK_STATE_ROOT=<空的临时目录> NBOOK_PORT=<空闲端口> bun run start
```

1. **多实例与项目子进程（K1–K3）**：浏览器打开首页，命令面板（`Ctrl+Shift+P`）执行“打开项目”选一个目录；地址变成 `/?project=…`，`ps` 里多出一个项目子进程。再开一个标签页打开同一项目，关掉两个标签页后子进程在宽限期后退出。
2. **断线重连（K2）**：停掉服务端再启动，已打开的页面自动重连，不需要刷新。
3. **Storage 与 store（K4、K5）**：目前只有示例插件与 e2e 使用（`e2e/storage.e2e.ts`、`examples/`）；外壳一（t65）是第一个产品使用者，布局记录随它可见。
4. **配置（K6）**：
   - 命令面板执行“切换界面语言”选 English，两个标签页同时变成英文，刷新后保持；`<状态根>/settings.json` 里原有的注释保留。
   - 用编辑器直接改 `settings.json` 的 `"nbook.workbench/theme"`（`nbook` 或 `macos`），页面即时换主题；把文件改坏，页面保持原值，修好后恢复。
   - 在项目目录的 `.nbook/settings.json` 写主题，只有绑定这个项目的窗口用它。
   - “切换明暗”选“跟随系统”，切换系统明暗时页面跟着变。

## 需要开发者判断的

[待确认清单](pending-confirmations.md) 里 t64 及以前的各行：按推荐先做了，追认或改判写在“结果”一列。

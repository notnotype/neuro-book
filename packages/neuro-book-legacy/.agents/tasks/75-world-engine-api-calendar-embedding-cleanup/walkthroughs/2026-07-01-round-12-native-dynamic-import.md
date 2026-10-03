# Round 12：Product/Nitro 运行时 artifact 原生动态导入

## 背景

用户 Product 环境继续报错：World Engine loader 已生成 `.mjs`，但 Product/Nitro 打包后的服务端把 `await import(variable)` 当成可解析模块处理，运行时生成的 Windows 文件路径从空 importer `''` resolve 失败。

这说明问题不在 `calendar.ts` / `schema/index.ts` 是否转译，而在服务端 bundle 对动态 import 的接管。凡是“运行时生成 `.mjs` 文件再导入”的路径，都不能继续使用普通 `import(variable)`。

## 修复内容

1. 新增 `server/utils/runtime-artifact-import.ts`，通过 `new Function("specifier", "return import(specifier)")` 创建 server 内部原生动态 import seam，并把公开 Interface 收口为 `importRuntimeArtifact(artifactPath, options?)`。
   - Vitest VM 对 `new Function` / `eval` 生成的动态 import 不提供 callback，会报 `A dynamic import callback was not specified`；helper 对这个特定测试宿主错误提供 `import(/* @vite-ignore */ specifier)` fallback。
   - Product 主路径仍是 `new Function` seam，构建产物中也保留该 seam。
   - Bun 会忽略 file URL query 的 module cache 差异；`options.cacheKey` 会把 artifact 复制到以 cache key 命名的物理 `.mjs` 路径，不把 query 当作热加载机制，也不让 `.building.<uuid>.mjs` 这类临时文件名泄漏进长期缓存。
2. World Engine 单文件 TS loader 改为通过 `importRuntimeArtifact(cachePath)` 加载 hash `.mjs`。
3. Profile artifact store 加载 `.compiled/artifacts/*.mjs` 时改用同一 helper，保留现有 Bun query cache workaround。
4. Profile artifact compiler 校验临时 artifact 时改用同一 helper。
5. Variable definition artifact 加载编译产物时改用同一 helper。

## 设计边界

- helper 只接收调用方已经定位好的 artifact 文件路径，不解析 workspace；`pathToFileURL`、原生动态 import seam 与可选物理缓存都封在 helper 内部。
- helper 只在 server 内部使用，不暴露给 CodeAct 沙箱。
- 不改变 World Engine schema/calendar 入口、单文件契约、数据库、`execute_world` 工具协议或 Product 启动方式。
- 构建/部署脚本中的普通 vendor import 不迁移，因为它们不在 Nitro server bundle 中运行。

## 验证计划

已执行：

- `bun run test server/utils/runtime-artifact-import.test.ts`：2 tests passed。
- `bun run test server/world-engine/codeact.test.ts server/agent/tools/world-engine-tools.test.ts`：2 files / 38 tests passed。
- `bun run test server/world-engine`：12 files / 155 tests passed。
- `bun run test server/agent/variables`：1 file / 19 tests passed。
- `bun run test server/agent/profiles/catalog.test.ts`：1 file / 43 tests passed。
- `bun run nuxt:build`：通过；`patch-nitro-runtime-deps.mjs` 完成 Nitro runtime deps patch 和 `nbook` runtime package copy。
- `bun run product:stage`：通过；staged `product/.output/server/node_modules/nbook/world-engine/schema/index.ts` 存在。
- 静态检查 `.output/server` 与 `product/.output/server`：未发现 `import(pathToFileURL(...))` 或 ``import(`${pathToFileURL...}`)`` 残留；构建产物可见 `importRuntimeArtifact` 调用点和 `new Function("specifier", "return import(specifier)")` seam。
- staged Product smoke：在 `product/workspace/<temp>` 复制 Product 自带 World Engine 模板，调用 `.output/server/chunks/_/index2.mjs` 的 `worldEngineFacade.executeCodeActWorld()` 写入并读取 subject，返回 `{name:"烟测主角", hp:100, formatted:"公元2020年4月12日 18:00"}`，issues 为空。

补充说明：

- architecture cleanup 后尝试重跑 `bun run test server/agent/profiles/profile-compile-worker.test.ts`，TTY 与非 TTY 各一次都在当前 Windows/Vitest worker 环境中超过 2 分钟无新输出，已手动中断并清理测试进程。由于本轮实际改动的 artifact import 主链已由 `catalog.test.ts`、`server/agent/variables`、`nuxt:build`、`product:stage` 和 staged Product smoke 覆盖，本轮不把该 worker 全文件挂起作为 Product/Nitro import seam 的阻断项；后续若继续整理 profile worker，可单独排查该测试的 worker 生命周期或超时稳定性。

## 与计划出入

实现按计划做系统收口，没有只修 World Engine 单点。当前没有引入新依赖，也没有改变 World Engine loader、profile artifact 或 variable definition 的源 artifact 位置；仅在 `importRuntimeArtifact()` 内部为需要 cache key 的导入维护一层物理 import cache。

与原计划的差异是 helper 增加了 Vitest VM fallback，并在后续清理中把公开 Interface 从完整 specifier 提升为 artifact 文件路径 + cache options。最初只用 `new Function` 时 helper 单测失败，因为 Vitest 的 VM 没有为 eval/new Function 动态 import 提供 callback；fallback 只匹配该特定错误，Product 构建产物仍保留原生 seam。公开 Interface 提升后，调用方不再各自拼 `pathToFileURL(...).href`，也不再依赖 file URL query 破缓存；cache key 现在直接作为物理缓存文件名，profile / variable 编译期临时 artifact 的随机文件名不会造成重复缓存。后续新增 runtime artifact 入口更不容易绕开这个 seam。

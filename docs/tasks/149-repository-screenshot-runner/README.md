# 仓库调研与剧情工作台截图运行链路

> Status: Active — 2026-08-14 已完成 Product Runtime 与 Source Dev 的真实双视口截图、严格 manifest 和 Hermes Skill 集成验收；真人 QQ 入站回传仍未验证。

## 用户请求与目标

按批准计划 `local://repository-screenshot-runner-plan.md`，为 NeuroBook 建立项目 adapter 拥有的 Preview Runtime supervisor、严格研究回执、真实 `/plot-workbench.preview` 双视口截图和 Hermes `MEDIA:` 回传链路；保持 OneBot 11 权限边界，不修改 Hermes 源码或真实 Project Workspace。

## 当前状态

- 已在 `feat/t149-repository-screenshot-runner` worktree 实现 Product-first/Source Dev fallback supervisor、隔离 State/Cache、动态 loopback 端口、lease、owner heartbeat、启动 nonce、memory-only shutdown token 和 graceful→forced 关闭收口。
- 已实现 `nbook.repository-research-run/v1` 严格 manifest 与原子写入；环境阻塞时允许 `browser.executable: null`、`service.cleanup: not-started`，不得声称通过。
- 已实现 `plot-workbench:screenshot`：同一 runtime 使用 `1440×1000` 与 `390×844` context，访问真实 `/plot-workbench.preview`，校验页面、正文文本和 Scene selector，验证 PNG 后复制到显式媒体根并输出 `MEDIA:`。
- 已新增 `settings:screenshot` 与 `scripts/research/settings-preview.profile.json`：设置页必须通过 `--media-dir` 显式指向 Hermes 既有媒体根，禁止因隔离 `HERMES_HOME` 回退到任务临时目录；页面使用独立 `/settings.preview` 和 opaque Dialog，避免主页提示框叠加。
- 已实现 Product stage `cleanup`，按 owner、operation ID、lease、pointer 与 `.agent` containment 校验后清理。
- Hermes 插件已注册通用 `repository-research` Skill，并补齐 fake context 注册断言和 integration smoke 的 Skill 能力断言。

## 实现 walkthrough

1. 先删除四处外部 `@dnd-kit/dom` `defaultPreset` 传入，避免根依赖副本与 `@dnd-kit/vue` 内置副本的 `Scroller` 身份冲突；真实预览入口 smoke 证明 `/plot-workbench.preview` 可挂载。
2. 用现有 `@notnotype/owned-process`、`waitForApplicationReady` 和 `shutdownNativeProduct` 组合 supervisor；不复制进程树管理、端口杀进程或关闭协议。每个任务独立 lease、State/Cache、动态 loopback 端口和 token；Product stage 成功后只启动 Product，`auto` 只在 Product 不可用/启动失败时 fallback 一次。
3. 用 `shared/research-run-contract.ts` 收紧 manifest 的 schema、枚举、路径 containment、loopback URL、PNG/media 限制和敏感字段边界；显式浏览器缺失在服务启动前写 `environment-blocked` manifest。
4. 让截图 runner 对真实页面的 HTTP、`.plot-workbench-preview-page`、`剧本工作台`、`[data-workbench-scene-id]`、console/page/resource failure 和 PNG magic 做行为门禁；首次 Vite `504 Outdated Optimize Dep` 仅做有限新 context 重试，不换备用页面。
5. 设置截图 adapter 对临时 `HERMES_HOME` fail-closed：没有显式绝对 `--media-dir` 就不启动截图任务；已知 Vite `net::ERR_ABORTED` 优化依赖只作为可恢复事件保留在 `browser-events.json`，非 transient 的脚本、样式、console/page 错误仍使结果失败。
6. 把 NeuroBook 命令放入 `scripts/research/plot-workbench-preview.profile.json` 与 `scripts/research/settings-preview.profile.json`，把跨项目 SOP 放入 Hermes `skills/repository-research/SKILL.md`；Skill 不包含 QQ、OneBot 或 NeuroBook 专属命令，既有权限边界未改。

## 已验证证据

### Product Runtime Image 与主路径

`bun run nuxt:build` 成功生成本地 verified Product Runtime Image：

- imageId：`sha256:3de9f0a3cf5b57b5b29e29ec3f4df2c99f69e1ad8edef06ce71e64d204790855`
- Product image：`3251 files / 136642299 bytes`
- `.output/runtime-image.json` 与 `.output/runtime-image.ready` 存在；构建输出声明 `Product commands: ... (103 files / 10770375 bytes)`。

Product-only 命令：

```text
bun run plot-workbench:screenshot -- --runtime product --browser-executable "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --evidence-dir .agent/tmp/t149-product-screenshot/evidence --media-dir .agent/tmp/t149-product-screenshot/hermes/cache/images
```

结果：`result=passed`；manifest `.agent/tmp/t149-product-screenshot/evidence/repository-research-run.json` 记录 `service.mode=product`、`productAttempt=ready`、`consoleErrors=0`、`pageErrors=0`、`cleanup.service=graceful`、`portClosed=true`、`ownedTempRootsRemoved=true`。Product stage 与 `.agent/product-runtime-acceptance/current.json` 均已清理。

随后执行同一浏览器路径的 `--runtime auto`，manifest `.agent/tmp/t149-auto-product-screenshot/evidence/repository-research-run.json` 同样为 `result=passed`、`service.mode=product`、`productAttempt=ready`；证明已有 verified image 时 auto 优先 Product，而不是先启动 Source Dev。

### 真实 Source Dev 截图

命令：

```text
bun run plot-workbench:screenshot -- --runtime source-dev --browser-executable "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --evidence-dir .agent/tmp/t149-source-screenshot-4/evidence --media-dir .agent/tmp/t149-source-screenshot-4/hermes/cache/images
```

结果：`result=passed`；manifest `.agent/tmp/t149-source-screenshot-4/evidence/repository-research-run.json` 的 run ID 为 `repository-screenshot-d2e48384-e714-4fe4-a8e2-9e4ee801f935`。

- service：`mode=source-dev`，`productAttempt=not-attempted`，端口 `1966`。
- browser：Edge，视口 `1440×1000` / `390×844`，`consoleErrors=0`、`pageErrors=0`，`browser-events.json` 的 `criticalFailures=[]`。
- evidence：桌面和移动 PNG、`browser-events.json`；PNG 文件大小分别为 `202015` 与 `120069` bytes，均小于单图 `8 MiB` 限制。
- cleanup：`browser=closed`、`service=forced`、`portClosed=true`、`ownedTempRootsRemoved=true`、`sharedCachePreserved=true`。Source Dev 的 graceful 关闭超过 `30000ms` 后转 forced，这是合同允许的关闭模式，不是成功截图的页面错误。
- Hermes 媒体已复制到任务隔离媒体根并输出两条 `MEDIA:`；没有把该隔离根伪装成用户 Hermes home。

移动视口的 manifest 字段为 `horizontalOverflow=true`；计划要求记录该事实且不因可解释的工作台横向布局伪造失败，本次没有把它改写为 `false`。桌面视口为 `false`。

### 环境阻塞与失败分类

不存在的显式浏览器路径命令退出码为 `2`，stdout 为 `result=environment-blocked`；manifest 的 `browser.executable` 保留绝对路径、`service.productAttempt=not-attempted`、`cleanup.service=not-started`、`cleanup.portClosed=true`、`result.reason=浏览器 executable 不存在或未提供；未启动 NeuroBook。`，因此没有服务残留。

前三次 Source Dev 截图因 Vite `504 (Outdated Optimize Dep)` 和动态模块加载失败判为 `product-failure`；隔离 Vite cache 与新浏览器 context 的有限重试后，第四次才生成通过证据，没有把首次失败写成通过。

### Hermes 插件

- `C:/Users/notnotype/scoop/apps/python/current/python.exe -m pytest -q`：`419 passed, 3 warnings`。
- `ruff check .`：`All checks passed!`。
- `scripts/verify_hermes_integration.py --hermes-source C:/Users/notnotype/AppData/Local/hermes/hermes-agent`：`Hermes integration smoke passed: tools=9 hooks=5 plugin_skill=True pi_ai_trigger=True reconnect=True slash_commands=True`。
- 该 integration smoke 的内部测试再次输出 `419 passed, 4 warnings`；Windows Proactor closed-pipe warning 未造成测试失败。
- 组合 smoke 使用离线 helper，不是真实模型或真人 QQ 入站证据；没有把它写成真人客服群 pipeline 已通过。

## 关键决定

1. 缺省浏览器路径不回退到 `node.exe`；缺少真实 executable 直接标记环境阻塞。
2. Source Dev 关键资源首次出现 Vite `504 Outdated Optimize Dep` 时只做有限新 context 重试；稳定错误仍标记 `product-failure`，不换用 `/dnd.preview`。
3. supervisor 复用现有 `spawnOwnedProcess`、`waitForApplicationReady` 和 `shutdownNativeProduct`，不复制进程树或关闭协议。
4. owner marker 只记录 `startupNoncePresent=true` 和 `shutdownTokenRef=memory-only`，不记录秘密值、命令参数或完整 nonce。
5. 端口未确认关闭时保留 owner/lease/state/cache，避免删除仍被使用的资源；截图 runner 的 manifest 禁止将该状态写成 `passed`。
6. 移动视口横向溢出作为可见证据字段保留，不在截图 runner 中隐藏或人为改写；页面本身仍满足真实挂载和错误门禁。

## 验证命令

- `bun --bun node_modules/vitest/vitest.mjs run --config scripts/research/research-contract-vitest.config.ts`：6 tests passed。
- `bun --bun node_modules/vitest/vitest.mjs run --config scripts/research/preview-runtime-vitest.config.ts`：6 tests passed。
- `bun --bun node_modules/vitest/vitest.mjs run --config scripts/research/product-shutdown-vitest.config.ts`：8 tests passed。
- `bunx tsc --noEmit -p tsconfig.json --pretty false`：通过。
- `bunx tsc --noEmit -p scripts/research/screenshot-tsconfig.json --pretty false`：通过。
- `bun run nuxt:build`：通过，生成上述 Product Runtime Image。
- `node --check scripts/deploy/product-runtime.mjs`：通过。
- `bun scripts/deploy/product-runtime.mjs cleanup t149-missing-operation`：`already-cleaned`。
- `bun run typecheck`：未通过，`58 diagnostics in 4 files`，集中在既有 `desktop/electron` 的 `electron`、`original-fs`、`Electron` namespace 与连带 implicit `any` 类型依赖；不是本轮根 TS 配置或截图脚本类型错误。
- `bun --bun node_modules/vitest/vitest.mjs run app server shared scripts/deploy`：未通过；命令参数按目录过滤后报告 `No test files found`，随后默认 setup 加载报告 `SyntaxError: [vite] The requested module 'zod' does not provide an export named 'z'`。新增功能合同已用上面的轻量配置独立验证，未把该默认入口失败写成全量通过。
- 默认 Vitest 的 `zod` named export 失败不纳入本任务修复：当前 checkout 的 `vitest.config.ts` 原始内容与 `origin/master` 一致，失败在本任务引入的 Vitest 配置修改之前已复现；`code-baseline.yml` 当前仅由 `pull_request` / `workflow_dispatch` 触发，没有可引用的 master push run。额外建立的干净 `origin/master` worktree 在 `bunx nuxt prepare` 阶段先因 `@babel/helper-validator-identifier` 的 `#identifier` package import 错误退出，未到 Vitest，不能伪造成 zod 因果证据。该问题保留为既有本地/平台测试环境后续项，不阻塞本任务的独立合同和真实浏览器证据。

## 未验证与后续

- 未获得目标客服群真人客户端入站，因此 QQ 顺序回传（中文回执→工具进度→后台完成→最终正文/图片）仍是未验证；已有 pytest、Hermes 组合 smoke 与受控 `MEDIA:` 路径证据不能替代真人 QQ pipeline。
- Product 主路径、auto Product 优先、Source Dev 真实页面和 Product stage cleanup 已验证；本地 `.output`、evidence 和任务隔离 media 是运行证据，不应提交为业务数据或共享缓存。
- 真实 Hermes 宿主 `register_skill` 能力仍需在目标宿主部署上下文单独确认；当前组合 smoke 的 `plugin_skill=True` 证明受控注册上下文，不扩大为所有旧宿主均已支持。
- 移动视口 `horizontalOverflow=true` 是当前页面观察结果；如果产品要求窄屏必须完全无横向滚动，应另立 UI 修复范围，不在本任务的截图 runner 中掩盖该事实。

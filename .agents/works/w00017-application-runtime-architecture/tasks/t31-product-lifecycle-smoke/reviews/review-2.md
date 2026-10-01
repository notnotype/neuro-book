# 主 Agent 审查意见（第 2 轮）

第 1 轮的四条都处理到位：子断言结构、L3/L4 用真实归档下载、L9 用路由拦截、L8 独立运行，新的基线（L3、L4、L7、L8、L9 为 fail）是可信的阶段 1 目标。归档 staging 目录残留是产品问题，本 Task 不修，我另行登记。

## 必须修改

1. **跨包深导入违反仓库规则。** `scripts/smoke/product-lifecycle.ts` 用 `../../../neuro-book-manager/src/app-commands` 与 `../../../neuro-book-manager/src/product-shutdown` 相对路径深导入 Manager 源码。`docs/modules/monorepo-boundaries.md` 规定跨包依赖必须经 workspace 包名与公开入口。改法：
   - 在 `packages/neuro-book-manager` 新增一个公开子路径（例如 `./product-control`），入口文件只重新导出 `applicationEnvironment`、`waitForApplicationReady`、`shutdownNativeProduct`。exports 写法照抄现有 `./runtime-projection`（`types`、`bun` 指向 `src`，`import`、`default` 指向 `dist`），并在 `packages/neuro-book-manager/scripts/build.mjs` 的入口列表中登记，使 `dist` 产物存在。
   - `packages/neuro-book/package.json` 的 devDependencies 声明 `@notnotype/neuro-book-manager`，写法与该文件里其它 workspace 依赖保持一致；运行 `bun install` 更新 `bun.lock`。
   - smoke 改为从 `@notnotype/neuro-book-manager/<子路径>` 导入。
   - 验证：Manager 包自己的 build、typecheck 与测试（命令查它的 `package.json`）通过；应用包 `bun run scripts:typecheck` 与 `typecheck:runtime-foundation` 通过。

2. **对照下面的禁止清单逐条自查本 Task 的全部改动**，并在汇报中逐条写出结论（符合，或改了什么）：
   - 不按错误文案做程序分支，用错误类型或错误码；不用静默的 `catch` 吞掉错误，至少写一条诊断；
   - 不为让测试或检查通过而掩盖问题：不跳过测试、不放宽断言、不把一种失败改报成另一种，不在产品代码里加测试专用分支；
   - 不删除或替换任务之外的已有代码行、配置项（例如 `package.json` 里的其它 scripts）和注释，也不顺手改写无关注释；
   - 重构时保留原有的清理与收口语句，不留下多余的第二条路径或不可达的代码；
   - 不跨包深导入其它包的源码，跨包只经包名与公开入口；
   - 不确定能否检查或实现时，先找现有的自然做法，不要直接标成“无法做到”。

## 交付

- 用 `--skip-build` 重跑完整 smoke（脚本改动不影响产品构建），覆盖 `evidences/` 下的报告、终端输出与各项日志；基线结果应与上一轮一致，不一致时说明原因。
- 汇报：改动文件列表（含 Manager 与 `bun.lock`）、各项验证结果、禁止清单的逐条自查结论。
- 约束不变：不提交、不 stash、不切分支，不动 `docs/specs/runtime/browser-host.md` 与 `packages/neuro-book/docs/research/README.md`。

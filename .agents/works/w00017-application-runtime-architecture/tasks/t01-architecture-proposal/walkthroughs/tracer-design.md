# B/S 示踪链与插件分层修订（2026-09-20）

## 范围与批准

用户明确接受必需服务插件、首批随产品发布不任意热卸载；接受 dirty/在途关闭协商、强制退出无保存保证、窗口不关闭共享后台；接受 Lab → Files → Settings。进一步要求生命周期、模块代码布局、B/S Tracer Bullet、WorldEngine/Plotbench 与 File/SQLite 分层。沿 t01 修订原 Proposal，不重启已完成 w00016，不实施产品。

## 调查证据与纠正

三个 scout 分别只读调查后端、前端与领域，不运行服务/测试。输出为 `agent://BsBackendEvidence`、`agent://BsFrontendEvidence`、`agent://DomainPluginEvidence`；可恢复结论如下，不依赖这些会话 URI 作为永久规范。

- 主树 `server/runtime/product-startup.ts:36-86`：Workspace 根 → 迁移检查 → Session Store 租约；Main 已读源码。提案保留迁移先于租约和业务接纳，不把 SQLite provider ready 当作开完所有数据库。
- 主树 `server/api/projects/index.get.ts:10-21`：只读轻量 snapshot，不扫描作品树、不开 Project SQLite、不读 Agent Session。`project-module.ts:58-59` 的 required 为 database/history/file-index，lazy 为 plot-world/agent-sql；共享树额外有 Storage。
- 主树与共享树均已有 `server/api/config/bootstrap.get.ts`。Main 核对主树 :212-217 的 readConfigBootstrap 调用，纠正一度把该 API 仅归共享树的草稿。
- `server/config/config-service.ts` 导入 project-session；`server/workspace-history/project-history.ts:24,179` 导入并调用配置核心；Project 组合根又加载 history。目标区分配置核心/Project HTTP 适配与 opening 上下文，避免把源码环带入激活等待图。
- 共享树 `app/pages/index.vue:2228-2265,2777-2811`：Project 打开/绑定后恢复编辑记录，页面 mounted 承担引导。Main 已读；`syncAuthSession()` 是 void 发起，不把它写成 await 门禁。前端仅此树的 publicId/Storage/View 结论不回填 master。
- 前端 scout 最初把 auth middleware 排在 Nuxt plugins 前，并过宽称“无任何注册表”。Main 依据 Nuxt 官方 client lifecycle 与现有注册表纠正；scout 已接受：app plugins → route middleware → mount；当前有 command/View/editor registry，但未见统一产品插件装配。
- 主树 `server/plot/index.ts:48-112` 同时创建 World/Plot；Plot 依赖 World，关闭先 Plot 后 World。Main 已读并采纳单向依赖，不承诺首批 Plot 可脱离 World。
- `server/world-engine/world-embedding.ts:40-70` 在语义搜索时取 embedding 配置；`server/utils/runtime-artifact-compiler-context.ts:29-57` 明确 authoring 身份；`server/agent/tools/world-engine-tools.ts:26-67,91-93` 通过精确 Project 调用并限定 writer readonly。目标保留这些域约束，声明 artifact-compiler/embedding 能力，不把启动变成模型调用。
- World/Plot 同用 `.nbook/project.sqlite`，但分别建 libsql/Prisma 连接；目标是单一物理数据库资源 owner 管理多连接，非声称现状单连接。subject RAG 独立 owner，不默默并入 World。
- ProjectModule 现有机制是迁移素材，不是必须保留的类/全局注册表。用户允许重新设计，不采用 scout “必须复用框架”的过强建议。

官方依据：Nuxt 4 lifecycle（https://nuxt.com/docs/4.x/guide/concepts/nuxt-lifecycle）用于客户端框架顺序；MDN import 模块缓存（https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import#module_namespace_object）用于区分停用实例与卸载 ESM 代码。没有外部 CLI、真实模型或运行产品。

## 修订结果

原 Proposal 原位补：生命周期阶段/门禁及 Spec 承接；应用包内候选代码布局；platform-files/sqlite/managed-processes 与上层领域的分层；S0–S7 启动示踪；项目选择 API 最小依赖；opening/ready 与配置断环；Grid/View 构造；World/Plot 设置、UI、工具、资源、可选缺席；热卸载五种含义及相对复杂度。根 Proposal/Spec 索引、Work 和三份 Task 合同同步，新增合同仍 reviewing。

本轮独立审查落在 t02/t03 的 `walkthroughs/tracer-review.md`；旧 review.md 不替新增设计背书。门禁由 Main 最后统一执行，结果另行追加。

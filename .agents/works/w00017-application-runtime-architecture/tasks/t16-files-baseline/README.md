---
schema: nbook.task/v2
taskId: t16-files-baseline
---

# Files 隔离基线与完成判据

## 目标与范围

执行已批准的 Files 首版计划第一单元：在自建隔离 State/Cache/Project 上测真实主页面打开与永久标签热切换，冻结后续重测预算。功能实现继续由后续 Task 承担；两项 Files 合同仍为 `planned`。

## 当前状态

基线已闭合。执行 checkout 为 `.worktree/w00017-application-runtime-architecture`，分支 `refactor/w00017-runtime-foundation`，起始 revision `026ed9b2f9e6bfc6de81c1fd45320c68f9b7fe1f`；`governance:context` 匹配且 `failures: []`。已有 t15 未提交设计文档未清理。固定样本与测量脚本、逐次原始数据在本次 Temp 根 `C:/Users/USER~1/AppData/Local/Temp/neuro-book/agent/files-v1-OfeVX1/`，owner marker 的 runId 为 `8d1a53ed-f872-4c68-84f6-20bff8fb5723`。隔离 Source Dev 实际运行 `http://127.0.0.1:42257`，Chromium 151.0.7922.34、1440×1000，开发构建；没有接现有服务或用户项目。

## 授权与边界

本次“Plan approved / Execute plan step-by-step”取代规划阶段“仅交付计划”。允许计划内本地开发、自建临时根初始化迁移、独立 loopback 服务和主页面/Lab 浏览器验收；不接用户作品、现有服务或真实模型，不提交、push、PR、合并或部署。临时根整体回收未获授权，保留并报告；文件删除验收仅涉及本次明确创建的 fixture。两项 Spec 仍 planned，未有实现/性能通过证据。

## 样本与测量

- 已初始化迁移并创建独立 `files-baseline-a`、`files-baseline-b`。A 包含 8 KiB 的 `baseline-a.md` / `baseline-b.md`、64 KiB 的 `baseline-large.md`、标题与路径不同的 `title-alias.md`、无效标题 `invalid-title.md`、`sample-chapter/index.md` 与 `notes.md`、附件 `asset.txt` 和 `sample-empty/`；根 `index.md` 是基线采样后补建在本次隔离项目中的 fixture，未作为上表性能输入。所有写入限本次临时根。
- 稳态为同一浏览器真实工作台已打开的两个 permanent 标签交替点击，3 轮×30 次，终点由对应组的可见正确正文且非忙碌状态确定；各轮结束键入并撤销 `INPUT-OWNERSHIP-PROBE`，验证输入只进入 A。独立统计源码/富文本、单/双组，点击监听在 capture 阶段记录起点，不以树高亮代替正文。源码每 90 次创建 90 个 Monaco 模型及 90 个控件；富文本每 90 次创建 90 个 Tiptap 实例；切换期间均无 `/api/workspace-files/` 请求。全部标签关闭后，Monaco 模型/控件/Tiptap DOM 计数为 0。

| 模式 | 90 次 p50 / p95（毫秒） | 每轮 p95（毫秒） | 可见异常 |
|---|---:|---:|---|
| 源码单组 | 57.3 / 66.8 | 68.2 / 63.4 / 61.8 | Monaco dispose 的 `Canceled` 3 次 |
| 源码双组 | 61.3 / 74.7 | 78.5 / 68.8 / 68.0 | 同类 `Canceled` 2 次 |
| 富文本单组 | 673.9 / 827.7 | 735.7 / 824.9 / 888.3 | 0 pageerror |
| 富文本双组 | 548.1 / 674.9 | 600.7 / 608.8 / 692.2 | 0 pageerror |

富文本单组以不强引用旧编辑器的 WeakSet 计数版本为固定基线；最初用 Set 强引用旧编辑器的单组试测为 322.4 / 469.9 ms，计量干扰与热运行波动均已保留，不能当作目标对照。冷开在新页面进入真实项目后分别点击 A、B 得到 401.5 / 269.4 ms（仅两次观测，不声称 p95）；记录真实 tree/read/events 请求与 0 pageerror。精确原始样本为 Temp 根的 `code-single-tabs-baseline.json`、`code-multi-tabs-baseline.json`、`rich-single-tabs-weak-baseline.json`、`rich-multi-tabs-baseline.json`、`cold-baseline.json`；同目录 `measure-tabs.cjs` / `cold-standalone.mjs` 为本次临时采样器。

## 已冻结的后续验收预算

同浏览器/构建/视口/样本，预热后各组至少 3×30 次；源码单/双组 p95 均 ≤ 80 ms，富文本单/双组 p95 均 ≤ 250 ms，且富文本降幅应超出以上轮间波动。永久标签 A→B→A 不发无效 read，控件不逐次重建；最后干净引用关闭后模型/实例释放。每轮检查正确正文可输入、撤销归属与页面错误；`Canceled` 需根因修复而非忽略。冷开保持可编辑且记录请求，当前两点不设伪 p95 目标。若目标未达或正确性退化，不将性能片标为完成。

## 下一步

进入排他文件原语与 Tiptap/Monaco 编辑状态可挂接实验。源码重复实例创建与 Monaco dispose 异常、富文本重复解析都作为本次基线发现，后续按单独可复现行为修复，不在本 Task 里混入性能实现。

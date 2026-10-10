---
schema: nbook.task/v2
taskId: t75-bookshelf
---

# 书架页

## 目标与范围

开发者 2026-10-10 要求重新设计没打开项目时的书架页，更贴合 NeuroBook 的产品与风格，可以不沿用旧应用的封面网格。

方向与取舍见提案 [书架页](../../../../../docs/proposals/bookshelf.md)（`reviewing`）。推荐“书房”：上半是继续写作，下半是书脊书架，另有列表视图。

后续步骤：

1. 开发者选定方向；
2. 在 Lab 做静态稿，开发者看过后定稿；
3. 写 Spec 与实施计划：`nbook.projects` 增加新建、修改作品信息、从书架移除与统计缓存，新增书架页面。

行为合同：现有 [`runtime/projects.md`](../../../../../docs/specs/runtime/projects.md) 将增加新建、修改作品信息、移除登记，书架页另建 Spec，方向选定后起草。

## 前置

[t73](../t73-lab-nb-ui-and-storage/README.md)；项目切换与 [t74](../t74-workbench-titlebar/README.md) 共用作品列表。

## 当前状态

- 2026-10-10 建立；提案起草，开发者同意全部推荐（书房方向、作品目录、今天与总字数、不做封面图），交 omp 审查后实施。
- 2026-10-10 实施计划起草（[plan.md](plan.md)），逐条回答 P10–P14、F06、F07；待 t74 之后交 omp 计划审查。
- 2026-10-10 S1 Lab 静态稿完成（提案要求先出静态稿给开发者看）：
  - 组件在 `packages/neuro-book/src/plugins/projects/web/components/`：`BookshelfPage`、`ContinueCard`、`SpineShelf`、`BookSpine`、`ShelfTitlePage`、`ShelfList`，各带同名 `.md`；只呈现数据、发出动作，接真实数据在 S4。
  - 显示规则 `web/shelf-format.ts`：字数写法（一万以上写“万字”）、今天净增（可为负）、相对时间、书脊厚度（按字数对数插值，30 到 64px）、书脊高度四档与色档（色相从主题强调色起每档转 45°）、排序、继续写作选最近编辑的那部。
  - Lab 场景：书架页 9 个（书脊与列表、一部、没有写作记录、空书架、加载、出错、英文），其余五个组件各 3 到 4 个；固定数据在 `lab/web/fixtures/shelf-fixture-data.ts`。
  - 截图（`lab:shot`，1180×980 与 390×844、明暗两种配色，全部没有溢出与页面问题）：[书脊明](evidences/s1-spines-light.png)、[书脊暗](evidences/s1-spines-dark.png)、[英文](evidences/s1-english-light.png)、[空书架](evidences/s1-empty-light.png)、[手机列表](evidences/s1-list-phone-light.png)、[手机暗色](evidences/s1-phone-dark.png)。本机没有装 nbook 主题的宋体（Source Han Serif、Noto Serif SC），截图里的书名与片段落到了黑体。
  - 验证：typecheck；`shelf-format.test.ts` 10 例、`SpineShelf.dom.test.ts` 4 例、Lab 索引与场景测试；变异 3 个全杀（Home 键、厚度上限、负数今天）。
  - 外观意见按 [待开发者确认](../../pending-confirmations.md) 的做法不阻塞后续切片。
- 2026-10-10 计划审查：omp 审查 18 条（阻断 2 条：统计写入与条件保存不相容、握手加书名破坏协议），[报告](evidences/plan-review.txt)；修订后交 fable 子代理复核，7 条必须先改与 6 条建议，[报告](evidences/plan-rereview.txt)。全部写进 [plan.md](plan.md) 的“计划审查的处理”。新增书架页 Spec 草稿 [`workbench/bookshelf.md`](../../../../../docs/specs/workbench/bookshelf.md)（`planned`）；5 条产品取舍登记在 [待开发者确认](../../pending-confirmations.md)。
- 2026-10-10 S0 完成：Spec（[`runtime/projects.md`](../../../../../docs/specs/runtime/projects.md) 输出 13–18 与验收 13–18、[`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md) 输出 36–37 与验收 40、[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md) 输出 29 与验收 15，都标 planned；提案 `accepted`）；共享合同 `projects/shared/contracts.ts`（`projectsRemoteContract` 直接是 v2，现有入口暂用 `projectsRemoteContractV1`；`projectStatsRemoteContract`；书架条目、作品信息与统计快照的 schema；作品目录设置 `librarySetting`）、`stats-record.ts`、工作台 `shared/home.ts`（`workbench.home` 的声明校验）。验证：typecheck、`docs:check`、`governance:check`、`shelf-format`、`SpineShelf.dom`、`projects.test.ts`。
- 2026-10-10 S2（编码子代理，分支 `t75/s2-backend`，提交 `0a86da11`、`8fb199dc`，[交付报告](evidences/s2-report.md)）由主会话审查 diff、自己跑测试后合入：作品信息读写（`replaceLocked`）、新建、移出书架（按 id 串行）、`projectsKey` 新方法、远程合同 v2 与 `shelf`。偏离按报告写回 Spec（`readMetadata`、`read-failed`、2 秒上限、依赖方向）。合入时解决两处冲突：`web/plugin.ts` 保留 S4 的实现并改用 v2 合同名；`server/testing/projects.ts` 取 S2 的（harness 提供时钟、`prepare` 钩子），“打开项目”的测试窗口补 Storage 浏览器插件。
- 2026-10-10 S4 完成（提交 `f0109fbb`、`9d87f58f`）：工作台 `workbench.home` 贡献点（`HomeSlot` 裁决、`createWorkbenchPages` 的 `/` 与 `/workbench`、`/workbench` 为保留路径）；书架页模型 `shelf-page.ts`（可见时每 30 秒刷新、焦点刷新、在途合并、强制刷新作废旧响应、刷新失败保留数据并提示、相邻选中、新建与作品目录、修改信息、移出、加入已有目录）、`ProjectInfoDialog`、`BookshelfHost`、偏好记录 `projects.shelf-preferences`、浏览器入口贡献首页；6 个以无项目打开外壳的 e2e 与 `settings.e2e.ts` 改开 `/workbench`。验证：typecheck；`home-slot.test.ts`、`home-page.dom.test.ts`、`window.test.ts`、`shelf-page.test.ts`（真实服务端与浏览器实例、按合同实现的测试提供方、注入时钟）、Lab 索引测试；变异 6+6 全杀。
- 2026-10-10 S5 完成：宿主导航端口加 `currentUrl()`、`replaceUrl(href)`（`src/shared/host.ts`、`window.ts`、`boot.ts`）；编辑器 `nbook.editor.open` 加 `reveal: "end"`，`area.open` 成功时给出标签 id，定位是可取消的过程（`area.ts` 的 `pendingReveal`：等文档就绪与控件句柄，推到下一个时钟刻定位；切标签、切组、关闭取消；读取失败在组顶部提示），两种控件实现 `revealEnd`；插件读地址参数 `open`、`at` 后立即去掉（`continue-writing.ts`），等编辑器区建好再打开。验证：typecheck；`area.test.ts` 新增 4 例、`continue-writing.test.ts`、`status-items`、`part-commands`、`window.test`、`mount.dom`、projects 全部测试；变异 4 个全杀（其中“切走不取消”最初存活，补强用例后杀掉）。

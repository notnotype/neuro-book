# Issue 草稿

本目录只承载尚未获远端 Issue 写入授权的临时草稿。只为重大或长期交付创建 GitHub Issue；Issue 创建后保存公开目标、总体范围与非目标、验收、重大依赖、Work 导航和交付状态。

## 路径与恢复

- 草稿按 `.agents/issues/drafts/<english-kebab-slug>.md` 懒创建；路径是远端创建前的稳定恢复键，不是 Issue ID。
- 开始或恢复 Issue 设计时先检查 `drafts/`，按目标、Proposal 和 Spec 去重；聊天不承担草稿正文。
- 草稿至少包含目标、范围、非目标、验收、重大依赖或真正子 Issue、关联 Proposal/Spec、唯一 `Draft-Key: <slug>`、拟用的一个 `type:*` 和一个 `status:*`、请求的远端动作集合及开发者授权来源。
- 草稿不得创建本地数字 Issue ID、Task 状态或 Project 状态。尚无远端编号的 current 工作可创建 `issueId: null` 的 Work；草稿只作为外部 Issue 的恢复键。
- 不值得公开长期追踪的本地治理、隔离实验和机械工作不创建 Issue 草稿，直接复用或创建 `issueId: null` 的 Work 与所需 Task。

## 迁移到 GitHub

1. 向开发者请求当前草稿列出的具体远端动作；授权不外推到 Project、PR、push 或其它远端动作。
2. 获授权后先查找精确 `Draft-Key: <slug>`：搜索所有状态 Issue 并按正文独立行复核，PR 不计入。0 个精确匹配才创建 Issue，并设置草稿中的一个 `type:*` 和一个 `status:*`；1 个精确匹配复用其正整数编号；多个精确匹配立即阻塞并记录编号。
3. 取得或复用编号后，将相关 Work 的 `issueId` 更新为 `i<编号>`；Work 内只按当前已确定结果创建 Task，不预建依赖未知结果的链。
4. 闭合 Issue、Proposal、Spec 和 Work 链接，在报告或 evidence 持久化授权来源、动作范围、Draft-Key、Issue 编号、实际标签和创建或复用结果，然后最后删除本地草稿；不得保留第二份状态正文。

每个 Work 可引用零或一个 Issue，并包含 `1..N` 个 Task。满足当前 Task 的继续条件后，根据真实结果更新路线并按需创建下一 Task。只有需要独立排期、独立验收或独立交付的结果才拆子 Issue。
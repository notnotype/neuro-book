---
schema: nbook.task/v2
taskId: t04-entry-page-polish
status: active
updated: 2026-11-27
---

# 条目页打磨：新建对话框与空条目的页头

## 目标与范围

开发者 2026-11-27：“新建条目这个 dialog 不够用户友好，可以让 gemini 做顾问审查一下”；“空白的条目非常空旷，特别是名字简介别名这个头部，头部中间和右边有很多空旷”。

范围：新建条目对话框（`NewEntryDialog`）、条目页的页头，顺带页头下面的空态（文字分页的“开始写”、人物分页的一列“填写”）。人物分页的卡片以后要改成设定组模板（同一天开发者提的第 1 项，见 Work README），这里只做不与之冲突的小改。

合同：[`canon/author-ui`](../../../../../docs/specs/canon/author-ui.md) 输出 4（新建条目）、输出 7 与 9（页头与分页）；定稿后改 Spec。

## 当前状态

- 现状截图（新建对话框两种入口、滚到底，空的普通条目与人物条目，宽编辑区的页头）在本地 `.local/agent/works/w00055-entry-rich-text/tasks/t04-entry-page-polish/shots/current/`。截图时发现：对话框最后两项（另一个身份、出场）在滚动区外，第一眼看不到。
- 请 omp `@designer`（Gemini）看了两份：[对话框](evidences/designer-dialog.txt)、[页头](evidences/designer-head.txt)（说明在同目录的 `-brief.md`）。要点：对话框首屏只留名字与种类，设定组与“位置与出场”收进带当前值摘要的折叠区，马甲紧挨上级、选条目与章节要能搜、勾过以后不再跟种类换时给“恢复默认”；页头推荐左身份右坐标的两栏（种类、分组、上级、本体、出场放右栏），宽编辑区收窄内容列。

- 第 1 轮静态稿（2026-11-27）：Lab 草稿区 `drafts/w00055-t04/` 的 `EntryHeadDraft`（页头三种排法：现在、两栏、压成两行；立绘头像；文字分页的空态）与 `NewEntryDraftDialog`（第一眼名字与种类，“设定组”“位置与出场”两段可展开、收起时写出现在的值，本体与上级挨着）；草稿分支 `w00055-t04/drafts` 已合进 master。画稿前核对过：分组与上级已在编辑区的面包屑里，右栏不重复；“在看”的位置是 w00039 t42 定的，不挪；人物卡空值写“填写”是 t41 定的，不改。[评审板](artifacts/review/index.html) v1 五道题：head-layout（推荐两栏）、head-avatar（推荐放）、text-empty（推荐一行淡的占位）、dialog-layout（推荐两段可展开）、dialog-wording（确认改名）。

## 下一步

1. 读评审板的答复，记下决定；定了以后改 Spec（author-ui 输出 4、7、9）、写计划再实施。

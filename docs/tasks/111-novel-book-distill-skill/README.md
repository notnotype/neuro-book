# 111 novel-book-distill 拆书 skill

## Relative documents refs

- `assets/workspace/.nbook/agent/skills/novel-book-distill/SKILL.md`：skill 真相源。
- `assets/workspace/.nbook/agent/skills/novel-workflow-03-lorebook-bootstrap/SKILL.md`：lorebook 节点写入契约的参照（本 skill 内联了同一套规则，不做流程衔接）。
- `reference/workspace/TERMS.md`：Project Workspace / reference 路径术语。

## User Request / Topic

- 制作一个用于写作的拆书 skill：从小说或设定文本中提取可用的设定、人设、发展情节、文风、故事线、写作手法等信息，先存储在参考文件夹中等待分类；用户最终决定使用哪些文件后，把对应文件分类放置在规定目录下。
- 用户拍板：规定目录按提案（`reference/plot-patterns/`、`reference/style/`、`reference/technique/`）；该 skill 与其他 skill **没有联动关系**，仅作为独立能力使用；最终整理所需的设定写入 lorebook 对应目录。

## Goal

新增一个 bundled workspace skill `novel-book-distill`，让应用内 Agent 能把外部文本拆解为可独立取舍的卡片并支持两阶段采纳。验证面：SKILL.md 描述的暂存区结构、卡片契约与采纳流程自洽，且不与其他 skill 建立流程依赖。约束：阶段 A 不写 lorebook / manuscript；阶段 B 只处理用户点名的卡片；不搬运原文。

## Current State

- Implemented（skill 文本已落地，未经过真实 Agent 会话实测）。

## Decisions / Discussion

- **卡片化产物**：每条提取信息是一个独立 markdown 文件（frontmatter：type/source/chapters/status/target），因为"等待分类 → 用户筛选 → 分类放置"只有以文件为最小单元才好操作。
- **两阶段管道**：阶段 A 拆解（文本 → 逐章笔记 → 六类卡片 → INDEX.md），阶段 B 采纳（用户点名 → 逐卡转写/归档 → 更新状态）。`_meta.json` 是进度与状态真相源，支持长篇分批续跑和幂等采纳。
- **六类维度与去向**：setting/character 转写进 lorebook 对应节点（按节点契约重写，非文件移动）；plot/storyline 归档 `reference/plot-patterns/`；style 归档 `reference/style/`；technique 归档 `reference/technique/`。
- **独立能力**：不在 skill 文本中引用其他 skill 名称做流程路由；lorebook 写入规范直接内联。
- **采纳进 lorebook 建正式节点**（不加草稿态），靠阶段 B 的人工筛选把关；tags 加来源书名标签（如 `拆书-某某书`）标明原型出处。
- **防搬运边界**：提取结构与抽象，仅文风卡允许少量短引文；setting/character 采纳前必须和用户确认改名/变形方案。

## Verification / Test

- 纯提示词 skill，无代码与脚本，未运行测试。
- 真实 Agent 会话实测（拆一本 `reference/` 下的书跑完阶段 A + 阶段 B）待用户后续执行。

## Implementation Walkthrough

- 新建 `assets/workspace/.nbook/agent/skills/novel-book-distill/SKILL.md`：边界 / 暂存区结构（`reference/distill/{书名}/` 下 `_meta.json` + `notes/` + `cards/` + `INDEX.md`）/ 卡片格式 / 六类提取维度 / 阶段 A 拆解流程（task checklist、分批、聚合）/ 阶段 B 采纳流程（lorebook 转写规则与 reference 归档规则）/ 完成标准。

## TODO / Follow-ups

- 真实项目实测一轮拆书（阶段 A + 阶段 B），根据 Agent 实际行为调整提示词（尤其长篇分批与聚合质量）。
- 实测后评估是否需要给 `reference/distill/` 卡片提供 UI 侧浏览/勾选入口（当前靠 INDEX.md + 对话指令）。

# NeuroBook 用户视角人工评测体系

> 状态：**已转正到 `docs/testing/manual-eval/`，尚未经过真实评测轮次验证**。跑完第一轮评测后按实际结果修订。
> 依据：PROJECT-STATUS（2026-08-07）记录的验收缺口——「浏览器人工验收、真实 Project Workspace、真实 provider/model 和作者视角写作 smoke 不能由单测替代」。

## 1. 目的

从普通作者的视角评测 NeuroBook：Agent 按「用户旅程」逐条走查真实页面，按 [浏览器工具选择](../README.md#浏览器工具) 使用可用能力，收集证据并给出初判，用户复核并终审。每轮评测产出一份结构化报告，问题按严重度分级，可跨版本对比。

本体系是**长期可复用的 standing 框架**，不是单次任务清单。它与现有资产的关系：

| 资产 | 角色 |
| --- | --- |
| `vitepress/locales/zh-Hans/tutorials/`（六篇教程） | 用户旅程步骤的权威来源，旅程按教程的黄金路径组织 |
| Task 141 浏览器验收 | 判定口径（通过/未验证/环境阻塞/发现问题）与 P2 实例的来源 |
| Task 56 真实作者流 runbook | 后续 World Engine 工作台旅程的素材 |
| Task 82 / nb-memory-bench 评测方法论 | 教训：具体问题清单比拍脑袋分数有用，本体系不设总分 |

## 2. 目录结构

```
docs/testing/manual-eval/
├── README.md            # 面向用户：目的、触发方式、提示词、覆盖矩阵、维护规则
├── agent-guide.md       # 面向 Agent：评测执行流程与约束（执行手册）
├── criteria.md          # 判定口径：维度判据、严重度、判定类别、证据要求
├── report-template.md   # 评测报告模板
└── journeys/            # 用户旅程检查项（每条旅程一个文件）
    ├── startup-check.md     # 启动检查
    ├── workspace-tour.md    # 工作台漫游
    ├── project-creation.md  # 项目创建
    ├── skill-bootstrap.md   # Skill 初始化
    ├── chapter-writing.md   # 章节写作
    └── agent-session.md     # Agent 会话与 Composer
```

## 3. 触发与流程

### 触发方式：用户主动触发

评测由用户主动发起，Agent 不自动执行浏览器评测。Agent 可以在发布候选、PR 批次合并、大功能收口等节点**提醒**用户「建议跑一轮评测」，但跑不跑、跑哪些由用户决定。

### 用户触发提示词模板

想跑一轮评测时，把下面这段话发给 Agent（可直接复制，按需改范围）：

```text
跑一轮用户视角评测（按 docs/testing/manual-eval/agent-guide.md 执行）：
- 范围：默认黄金路径（启动检查、工作台漫游、项目创建、Skill 初始化、章节写作、Agent 会话）；也可以只跑我指定的旅程
- 环境：隔离 State Root + 临时 Project；真实 provider 不可用时如实标「未验证」
- 产出：按报告模板给我初判报告；我不确认前不要建 Issue、不要改代码
```

### 执行流程

Agent 收到触发指令后按 [agent-guide.md](agent-guide.md) 执行（环境准备、逐旅程走查、证据收集、初判、出报告、复核去向）。用户只需要两件事：发触发指令、复核报告并决定问题去向。

### 收尾标准

- 本轮 P0 必须全部澄清：修复、降级判定，或明确记为已评估风险。
- P1 列出清单交用户决定处理优先级。
- 未验证项写明缺口（缺 provider / 缺前置数据 / 环境），供下轮补验，不写成通过也不写成失败。

## 4. 评测范围与覆盖矩阵

一轮评测默认范围 = 黄金路径 6 条旅程（journeys/ 下已填实的文件）。产品区域与旅程的覆盖关系：

| 产品区域 | 覆盖旅程 | 本轮状态 |
| --- | --- | --- |
| 启动、登录、设置模型 Provider | 启动检查 | 覆盖 |
| 工作台、Markdown Studio、文件树、顶栏入口 | 工作台漫游 | 覆盖 |
| 项目创建与识别 | 项目创建 | 覆盖 |
| Skill 初始化链路（novel-setup 四阶段） | Skill 初始化 | 覆盖 |
| 章节写作主链（novel-writing） | 章节写作 | 覆盖 |
| Agent 会话、Composer、Workflow、Jobs | Agent 会话 | 覆盖 |
| World Engine Workbench | World Engine 工作台 | 扩展位（本轮不跑） |
| Plot 剧情工坊 | 剧情工坊 | 扩展位（本轮不跑） |
| 角色卡导入、用户资产 | 导入与用户资产 | 扩展位（本轮不跑） |
| 设置中心、主题、窄屏整体 | 设置主题与窄屏 | 扩展位；窄屏已内嵌在工作台漫游/Agent 会话检查项 |
| 桌面外壳（Electron/Tauri） | — | 不在本体系，按 Task 143 边界另行验收 |

### 扩展旅程覆盖点（本轮不执行）

- **World Engine 工作台**：Workbench 打开、主体同步、多步 slice 推演、编辑/删除/查询、主体文件建议、历史 slice 回看。素材：Task 56 runbook、Task 141 #64 记录。
- **剧情工坊**：两棵树（承载树/因果树）、场景归属、承诺账本、决策记录。
- **导入与用户资产**：SillyTavern 角色卡导入（教程 05）、用户资产（profile/Skill/模板）管理。
- **设置主题与窄屏**：配置中心 Profile 设置、主题切换（8 套内置主题）、窄屏整体走查（Task 141 先例：390×844 无文档级横向溢出）。

## 5. 维护规则

- 每轮评测后按实际体验修订：检查项过时、新入口、口径不适用处。
- 第一轮跑完后按实际结果修订检查项与口径，必要时补充实例。
- 旅程扩展顺序：World Engine 工作台、剧情工坊（写作核心模块）→ 导入与用户资产、设置主题与窄屏（资产与设置）；桌面外壳（Electron/Tauri）按 Task 143 边界走，不在本体系。
- 评测方法论演进（口径、维度、检查项调整）记录在 criteria.md；单轮执行细节记录在对应 Task walkthrough。

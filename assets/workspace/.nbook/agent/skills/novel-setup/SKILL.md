---
name: novel-setup
description: 项目搭建四阶段总控：项目初始化（定位与最小骨架）→ 世界书框架 → 角色设计与 lorebook 细化 → World Engine 初始化。用于新开书、导入已有素材开书、续写已有作品。各阶段细节在本 skill 目录 phases/ 下按需读取。
when_to_use: 用户要开新书、从酒馆卡或已有书稿建项目、续写旧作；当前项目缺少基础定位、世界书骨架或 World Engine 时从对应阶段进入。
---

# novel-setup：项目搭建

把"我想写这本小说"收束成可以进入 `novel-writing` 循环的创作基础。四个阶段有先后依赖，但不要求一次做完：每个阶段都允许大量占位条目，后续在写作循环中按需细化。

各阶段的详细流程放在本 skill 目录下，按当前阶段读取，不要一次全读：

| 阶段 | 文件 | 产出 |
| --- | --- | --- |
| 一：项目初始化 | `phases/01-project-bootstrap.md` | 基础定位、故事概念、简介、剧情种子、最小 lorebook 骨架 |
| 二：世界书框架 | `phases/02-lorebook-bootstrap.md` | 开篇可用的世界书基础条目 + 占位条目 |
| 三：角色设计与细化 | `phases/03-character-design.md` | 主角与关键角色节点，按需完善阶段二的占位 |
| 四：World Engine 初始化 | `phases/04-world-engine-init.md` | calendar、schema、纪元锚点、开局状态 |

## 入口判断

先分流，再进入阶段一：

- **新开**：用户从零开始。若连题材、主角、核心矛盾都说不清，先转 `novel-idea-exploration` 聊出故事概述，再回来。
- **导入**：已有外部素材。酒馆卡用 `novel-import-silly-tavern-card`；整部外部书稿（txt/md/番茄目录，要进 manuscript 续写或迁移）用 `novel-import-book` 走完整导入管线；只做竞品拆书的外部书稿用 `novel-import-tomato-reference` 落 `reference/tomato/`。素材落位后，从素材现状判断四阶段各缺什么，缺哪补哪。
- **续写**：用户有已写正文（自己写的或导入的）。当作导入的特例处理：正文在 `manuscript/`（导入管线已完成切章+摘要+承载树），从正文和已有设定反推定位与世界书缺口，再按缺口走阶段；World Engine 初始化走阶段四的「续写场景」流程，只做结尾切片。

老项目中途缺某一块（比如有 lorebook 但没 World Engine）时，直接进对应阶段，不要从阶段一重走。

## 占位原则

四阶段的共同原则：**先搭框架，占位即可，按需细化**。

- 阶段二可以创建大量空白或只有 summary 的占位条目（`status: pending` 或 draft），阶段三和后续写作循环再细化。
- 不为完整性机械补全百科；只把会影响后续剧情、角色行动和写作判断的内容写实。
- 不确定的设定显式标记为待定（`PROJECT-STATUS.md` Pending Questions 或 `status: pending` 节点），不伪装成已确认事实。

## 工作方式

- 每个阶段内用 task_create 建立 checklist、task_set_status 逐步推进（各 phase 文件有建议清单），不要一次做完再汇报。
- 阶段之间向用户确认再前进；用户只想做某一阶段时不要强行走完四阶段。
- 对用户透明处理技术细节，交流用人话。

## 收尾与衔接

四阶段（或用户需要的子集）完成后：

- 汇报已建立的定位、lorebook 骨架、角色节点和 World Engine 状态，列出仍占位/待定的部分。
- 下一步进入 `novel-writing`，首轮走**开局模式**设计黄金三章（见该 skill `phases/04-opening-mode.md`）。开局剧情设计不属于本 skill——setup 阶段产出的是"剧情种子"，开局的具体剧情在写作循环里设计。

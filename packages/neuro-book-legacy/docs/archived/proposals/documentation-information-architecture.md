# 文档信息架构整理提案

状态：accepted

决策日期：2026-08-17

> 已于 2026-08-17 实施。当前合同见 [`../../README.md`](../../README.md) 与 [`../../specs/README.md`](../../specs/README.md)。

## 问题

`docs/` 曾同时包含稳定规范、Module 索引、测试合同、调研、历史实践和 VitePress 示例；根 `reference/` 又保存大量当前实现合同，并被产品 Agent/Profile 直接消费。维护者和 Agent 需要一个确定性索引判断当前规范，且迁移过程不能制造两份可独立修改的真相源。

## 决策

- `docs/specs/` 是当前产品、运行时、接口与术语规范的统一注册表。
- `docs/standards/` 保存工程、Agent 协作、编码与文档治理规范；`.omp/RULES.md` 只保留每回合必须生效的摘要和触发式指针。
- `docs/runbooks/` 保存当前有效的开发、诊断和运维步骤。
- Proposal、ADR、Task、migration、research 和 archive 各自只承担一种职责。
- VitePress 面向用户发布，不承担内部规范真相源。
- 根 `reference/` 作为产品运行期消费的冻结过渡层，按功能域逐批 clean cutover 到 `docs/specs/`。

## 目标结构

```text
docs/
├── README.md
├── specs/
├── standards/
├── proposals/
├── adr/
├── testing/
├── manual-eval/
├── migrations/
├── runbooks/
├── research/
└── archived/

.agents/tasks/    一次实现任务的合同、交接和正式证据
reference/        冻结的产品 Agent/Profile 规范消费层
vitepress/        面向用户的发布站点
.local/drafts/    用户管理的本地草案
```

## 内容分类

| 内容 | 唯一归宿 | 当前行为依据 |
|---|---|---|
| 功能行为、状态、数据、接口、失败语义与验收 | `docs/specs/` 注册的规范 | 是 |
| 工程、Agent、编码和文档治理 | `docs/standards/` | 是 |
| 当前有效的操作步骤 | `docs/runbooks/` | 是，限操作流程 |
| 未批准的长期方案与备选取舍 | `docs/proposals/` | 否 |
| 已接受架构决策及理由 | `docs/adr/` | 是，但完整行为仍在 spec |
| 一次实现的范围、进度、交接、日志和证据 | `.agents/tasks/` | 否 |
| 数据升级、备份和回滚 | `docs/migrations/` | 是，限迁移流程 |
| 第三方调查、实验和比较 | `docs/research/` | 否 |
| 用户教程和发布说明 | `vitepress/` | 否，投影自已批准行为 |
| 已过期或仅供考古的材料 | `docs/archived/` | 否 |

## 迁移合同

1. 根大写 Markdown 只保留快速入口或机器消费载荷，详细规范下沉到 `docs/`。
2. 删除 `docs/` 根层模板；把实践记录、过时模型和已失效调研移入归档，把有效操作移入 runbook。
3. 删除 `docs/modules/` 过渡层：Monorepo 进入 architecture spec，Character 进入 Proposal，旧 Plot 模型进入 archive。
4. 本批只把 Workspace 术语从 `reference/workspace/` 切换到 `docs/specs/foundation/`。
5. Agent、World Engine、Content、Plot、Theme、Media 后续逐域迁移；每批同时更新 Profile Import、投影、测试、VitePress、CI 和打包消费者，再删除旧目录。
6. 新增 `docs:check` 门禁，检查目录职责、ADR 编号、活跃 Markdown 链接和冻结 Reference 边界。

## 生效与归档

本提案批准实施上述迁移；Proposal 本身不成为当前规范。实施完成后移入 `docs/archived/proposals/`，当前合同由 `docs/README.md` 与 `docs/specs/README.md` 共同承载。
---
schema: nbook.task/v2
taskId: t01-logo-and-mascot-foundation
status: active
updated: 2026-11-11
---

# Logo 资产入库、.local 整理与看板娘人设访谈

## 目标与范围

1. **Logo 晋升入库**：将定稿品牌标识的简报、精简生成器母版（`tools/` 15 个定稿模块与 `wordmark.json`）、导出成品（`06-production/`，不含 1.2 MB 聊天 GIF）与使用规范（`07-guidelines/`）入库至仓库根 `brand/logo/`，并更新 `packages/neuro-book/src/ui/brand/README.md` 与 `docs/images/readme/README.md` 的来源指向。
2. **`.local` 分层整理**：将散落的品牌母题、Logo 早期探索（`02-research/`–`05-refine/`、`archive/`、字体）与吉祥物初版/三视图/历史批次收拢到 `.local/brand/` 下（`lore/`、`logo-archive/`、`mascot/current/`、`mascot/explorations/`）。
3. **看板娘人设深化**：与开发者通过结构化访谈共建“神谕叙事织者”的角色性格、产品内职责定位、核心视觉锚点与服饰结构重设计方向。

合同：行为合同未变（本次仅将品牌标识源资产纳入仓库管理并整理本地草稿，不改动产品运行时行为）。

## 授权与边界

- 开发者于 2026-11-11 明确指定：
  - Logo 采用“精简母版 + 成品 + 规范入库，历史草图留本地”（入库 `brand/logo/`，历史留在 `.local/brand/logo-archive/`）；
  - `.local` 采用“统一收拢到 `.local/brand/` 分层归档”；
  - 主工作区已有他人对 `AGENTS.md` 的未提交修改，严禁触碰或暂存 `AGENTS.md`。

## 当前状态

- 已完成 `brand/logo/` 入库整理与重新生成冒烟验证：
  - `uv run --no-project --with shapely python brand/logo/tools/produce.py --no-video` 通过（132 项导出，与 `packages/neuro-book/src/ui/brand/` 中的 `neurobook-mark.svg`、`neurobook-lockup.svg`、`neurobook-mood.js` 字节一致）；
  - `uv run --no-project --with shapely python brand/logo/tools/guidelines.py` 通过；
  - `bun run docs:check` 与 `bun run governance:check` 均为 `failures: []`、`warnings: []`。
- 已完成 `.local/brand/` 四层归档与目录索引文档。
- 正在进行看板娘人设深化访谈（第 1 问）。

## 下一步

- 与开发者逐轮对齐看板娘的角色身份、性格弧光、产品内触点及服饰结构方案，沉淀角色设定规范。

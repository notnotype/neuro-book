---
schema: nbook.task/v2
taskId: t01-logo-and-mascot-foundation
status: completed
updated: 2026-11-15
---

# Logo 资产入库、.local 整理与看板娘「星璃 · Lyra」形象蓝图入库

## 目标与范围

1. **Logo 晋升入库**：将定稿品牌标识的简报、精简生成器母版（`tools/` 15 个定稿模块与 `wordmark.json`）、导出成品（`06-production/`，不含 1.2 MB 聊天 GIF）与使用规范（`07-guidelines/`）入库至仓库根 `brand/logo/`，并更新 `packages/neuro-book/src/ui/brand/README.md` 与 `docs/images/readme/README.md` 的来源指向。
2. **`.local` 分层整理**：将散落的品牌母题、Logo 早期探索（`02-research/`–`05-refine/`、`archive/`、字体）与吉祥物初版/三视图/历史批次收拢到 `.local/brand/` 下（`lore/`、`logo-archive/`、`mascot/current/`、`mascot/explorations/`）。
3. **看板娘「星璃 · Lyra」定稿形象与图集入库**：
   - 确立四层名讳体系（**星璃 · Lyra** / **璃璃·小璃** / *Astria Lyra Luminis* / 跨神话古籍尊号）、三重性格内核（端庄游刃有余的智识强者 × 萝莉妈妈包容 × 慧黠少女）与完整宇宙体系（万言星海、溯言白洞、界隙水镜、忆星书庭双区与「记忆宝石」、创世星环·万界天球仪、天职圣器《万界真典》与「律政星杖」、跨界载具「折页星舟」）；
   - 采用开发者在 NovelAI V4.5 下调校定稿的新形象（图 6 `16-14-50-2948684181.png` 作为标准参考母版，默认步数 `28`，接口请求并发固定为 `1`），不再制作三视图或沿用早期 GPT 母版；
   - 精确测算 T5 512-Token 分词预算，通过 28 步同种子消融实验验证标签影响度并沉淀三档精简母版；
   - 基于新形象蓝图串行生成 12 幅立绘、插图与世界观场景并录入 [`brand/mascot/`](../../../../../brand/mascot/README.md)。

合同：行为合同未变（本次仅将品牌标识与看板娘设计资产纳入仓库 `brand/` 管理，不改动产品运行时行为）。

## 授权与边界

- 开发者于 2026-11-11 与 2026-11-14 明确指定：
  - Logo 入库 `brand/logo/`，历史留在 `.local/brand/logo-archive/`；
  - 看板娘采用新设计的 NAI V4.5 参数 + 提示词 + 图 6 参考，默认 28 步、NAI 接口并发设为 1，录入仓库 `brand/mascot/`；
  - 主工作区已有他人对 `AGENTS.md` 等文件的未提交修改，严禁触碰或暂存无关文件。

## 验证证据

- `uv run --no-project --with shapely python brand/logo/tools/produce.py --no-video` 通过；
- `uv run --no-project --with shapely python brand/logo/tools/guidelines.py` 通过；
- `bun run docs:check` 通过（`failures: []`, `warnings: []`）；
- `bun run governance:check` 通过（`failures: []`, `warnings: []`）。

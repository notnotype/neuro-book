# t05 追加范围：agent-kit 接口规范（docs/specs/）

日期：2026-09-18。来源：开发者直接要求「把 README 里的接口介绍分门别类整理到 agent-kit 的 spec 目录，先写 spec 规范，再继续补充未介绍的成员」；随后开发者更正目录为 `packages/agent-kit/docs/specs/`，文件已整体迁移并重写全部相对链接（自检脚本确认 0 断链）。

## 交付

新增 `packages/agent-kit/docs/specs/`（含包级 `AGENTS.md` 入口，按 `packages/AGENTS.md` 的包级资产规则引用根合同）：

| 文件 | 内容 |
| --- | --- |
| [`README.md`](../../../../../../packages/agent-kit/docs/specs/README.md) | **规范本身**：与 `docs/specs` 能力合同的分工与优先级、文件组织、成员条目必填结构（导入/参数/返回/失败/不变量/示例/相关）、错误约定（错误是值、`code` 是合同、`message` 不是）、状态词汇（实验/冻结/候选/内部 × 能力合同状态）、破坏性变更流程、包根聚合入口说明 |
| [`sse.md`](../../../../../../packages/agent-kit/docs/specs/sse/README.md) | `writeAgentEventStream` + 三个类型 + 候选成员 `frame`/`hub` + 内部符号 |
| [`text.md`](../../../../../../packages/agent-kit/docs/specs/text/README.md) | `truncateHead`/`truncateTail`/`createApproximateTokenCounter`/`formatSize` + `TokenCounter`/`TruncationOptions`/`TruncationResult` 全字段表 + 常量 + token 截断保证 |
| [`resources.md`](../../../../../../packages/agent-kit/docs/specs/resources/README.md) | 全部 DTO（`Result`/`ResourceError`/`ResourceReference`/`ResourceSnapshot`/`ResourceHandle`/`ResourceProvider`/`ResourceRegistry`）+ 四个工厂的失败码表与不变量 + 内部符号 |
| [`editing/`](../../../../../../packages/agent-kit/docs/specs/editing/README.md) | 命名空间索引 + [`engine.md`](../../../../../../packages/agent-kit/docs/specs/editing/engine.md)（`createEditEngine`、inspect/plan、四模式输入规则、上下文与错误 DTO）+ [`observations.md`](../../../../../../packages/agent-kit/docs/specs/editing/observations.md)（观测/tag/锚定视图/`renderEditDiff`）+ [`blocks.md`](../../../../../../packages/agent-kit/docs/specs/editing/blocks.md)（块定位）+ [`commit.md`](../../../../../../packages/agent-kit/docs/specs/editing/commit.md)（提交四态与补偿不变量） |
| [`candidates.md`](../../../../../../packages/agent-kit/docs/specs/candidates.md) | 六个候选命名空间（`shell`/`session`/`profile`/`approvals`/`attachments`/`sandbox`）与五个包内候选成员（`sse/frame`、`sse/hub`、`editing/notebook`、`resources/目录枚举`、`text/暂无`）：定位、边界、来源实现锚点、开工前必须决定的问题 |

`packages/agent-kit/README.md` 改为**总览 + 索引**：文档地图（想知道什么 → 看哪里 + 优先级）、结构约定、命名空间表（指向 spec 与能力合同）、候选一行式导航、明确不放进来、待审查问题。接口细节不再重复，避免第二真相源。

## 目录二次调整（开发者要求：按命名空间分文件夹）

结构从「一命名空间一份文件」改为「一命名空间一个文件夹 + 文件夹内 `README.md` 作索引」：

```
docs/specs/
├── README.md          规范总则（文件组织一节已改写为目录约定）
├── candidates.md      跨命名空间候选
├── sse/README.md
├── text/README.md
├── resources/README.md
└── editing/{README,engine,observations,blocks,commit}.md
```

- `editing.md`（446 行）按主题拆成 5 个文件：索引 + 组装顺序 + 内部符号放 `README.md`，其余按原文章节边界整段搬运（已用脚本核对 19 个原文标题全部仍存在，无内容丢失）。
- 全部相对链接按新深度重写（命名空间文件夹深一层）；`editing/engine.md` 指向默认块 resolver 的锚点改为跨文件 `blocks.md#createdefaultblockresolver`。
- 根 [README](../../../../../../packages/agent-kit/README.md)、包 [AGENTS.md](../../../../../../packages/agent-kit/AGENTS.md)、`candidates.md`、walkthrough 002 的链接同步更新。

**发现的检查器盲区**：`scripts/ci/check-documentation.ts` 的 `isActiveMarkdown()` 只覆盖仓库根 `docs/`、根文档、vitepress 与 `.agents/{roles,skills}`——`packages/*/docs/**` 的 markdown 链接**不在** `docs:check` 范围内（`docs:check` 报 0 failures 不代表包内链接有效）。因此新增了一次性链接解析脚本（遍历包 README/AGENTS/specs/记录文件，逐个 resolve 后判存在，跑完删除）作为本轮的实际校验手段。

## 追加成员：`countTextTokens`（开发者要求）

`./text` 新增 token 计数函数：`countTextTokens(text, options?: {tokenizer?: TokenCounter}): number`——缺省用内置近似计数，给出分词器时完全使用注入实现。

- 实现上把分词器相关符号（`TokenCounter`、`createApproximateTokenCounter`、近似算法与区间判定）从 `truncate.ts` 抽到 `src/text/tokens.ts`；公共导出名与行为不变，`src/text/index.ts` 改为显式导出（内部实例 `APPROXIMATE_TOKEN_COUNTER` 不进 barrel）。
- TDD：先写 `src/text/tokens.test.ts` 得 RED（`countTextTokens is not a function`），再实现转 GREEN；断言含 `""`/纯空白 → 0、`"hello world"` → 4、`"汉字汉字"` → 4、非 BMP 不拆、注入分词器、以及与 `truncateHead(...).totalTokens` 的等值关系。
- 规范补充 `countTextTokens` 成员条目（参数表、失败、不变量、示例）与「内部符号」一节。

## 覆盖度验证

用一次性脚本（TypeScript 编译器 API 解析 barrel 的 `export *`/`export {}`/本地声明，跑完已删除）统计每个命名空间的公共导出面，并检查每个符号名是否出现在对应规范文件：

```
sse: 4 个公共导出，未在 spec 出现 0
text: 8 个公共导出，未在 spec 出现 0     # countTextTokens 之后
resources: 15 个公共导出，未在 spec 出现 0
editing: 31 个公共导出，未在 spec 出现 0
合计 58 个导出，全部已写入规范
```

另核实规范中的可验证断言：近似计数示例值（`"hello world"` → 4、`"汉字汉字"` → 4，跑真实计数器确认后写进文档）；`createEditEngine` 不返回 `Result`（源码确认）；registry 不缓存结果、并对 provider 异常与畸形返回都归类 `io_error`（源码确认）；候选来源锚点（`bash-output-store.ts`、`approval.ts`、`session/`、`profiles/`、`attachments/`）逐一 `test -e` 确认存在。

## 门禁

```
bun run docs:check                        → {"failures":[],"checkedFiles":5524}
bun run --cwd packages/agent-kit test     → 13 files, 147 passed | 1 skipped (148)
bun run --cwd packages/agent-kit typecheck → exit 0
```

包内文档链接由一次性脚本校验（`docs:check` 不覆盖 `packages/*/docs/**`，见上）：本轮共 15 个文件，0 断链。

## 后续

- 候选成员落地后迁入对应命名空间规范，并从 `candidates.md` 移除。
- `docs/specs` 能力合同仍是仓库级真相源；本目录只是接口形状。是否需要把接口规范纳入仓库注册表由 Leader 决定（已写入包 README 待审查问题 4）。
- 开发者要求的 **model catalog**（含更新机制）仍在调研与讨论中，未开工；两个只读 scout 正在取证（pi / omp 的模型目录实现、models.dev / OpenRouter / LiteLLM 等第三方数据源），结论以决策简报呈报。
- 建议（未执行，属 CI 改动范围）：把 `packages/*/docs/**` 纳入 `check-documentation.ts` 的 `isActiveMarkdown()`，否则包内文档链接只能靠人工/一次性脚本发现。

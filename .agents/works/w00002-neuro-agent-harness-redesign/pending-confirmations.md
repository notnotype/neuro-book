# 待确认清单

[autonomous-delivery](../../skills/autonomous-delivery/SKILL.md) 推进中照推荐做、事后请开发者追认的决定。开发者追认或改判后在“结果”列写明；改判需要的改动另建 Task 或并入下一个 Task。

| 日期 | Task | 类别 | 决定 | 理由 | 改回的代价 | 链接 | 结果 |
|---|---|---|---|---|---|---|---|
| 2026-10-10 | t09 | 审查意见“成立，但接受取舍” | JSONL `create` 写会话头失败时只做 best-effort 删除文件；已存在的文件不论内容一律 `session-exists`，没有会话头的文件按 `corrupt-session` 交人工处理，不做自动回收 | 计划审查第 13 条建议临时文件加 rename 或 reserved 状态；头只有一行、失败后紧接着就删，再加一层原子重命名的收益不大 | 小：改 `create` 为临时文件加 `link`/`rename`，几十行 | [计划审查](tasks/t09-harness-foundation-session/evidences/plan-review.txt) 第 13 条 | |
| 2026-10-10 | t11 | 能力地图（writing-specs 要先交开发者确认） | 切片 3 拆成两份 Spec：`harness.config`（快照、校验、通知）与 `harness.models`（目录、选择链、能力、凭据与 OAuth），一个 Task 实现；`models` 只 `import type` `config` | 两者可各自验收，依赖单向；合成一份会把 OMP 运行时依赖带进配置校验 | 小：合并文件与注册表行 | [t11](tasks/t11-harness-config-models/README.md) | |
| 2026-10-10 | t11 | 偏离提案文字 | “内核不读环境变量”靠不走 OMP 的 `getApiKey`：API key 直接读存下的凭据，OAuth 经只看存储的 `getOAuthAccess`（OMP 的 `getApiKey` 把环境变量排在存下的 key 之前、OAuth 不可用时也回落到环境变量，没有开关） | 不这样就只能放弃 OMP 的凭据层或接受环境变量回退 | 小：改回 `getApiKey` 就是 OMP 的缺省行为 | [`harness.models`](../../docs/specs/harness/models.md) 输出 6 | |
| 2026-10-10 | t11 | 审查意见“成立，但接受取舍” | 凭据库文件头正确但内部损坏时，接受 OMP 的自动恢复（备份为 `.corrupt-…`、新建空库、打开成功、凭据为空），不另行报告；只有文件头不是 SQLite 时拒绝打开 | OMP 的 SQLite 入口固定开启恢复且不暴露备份路径，自己重写打开流程要复制它的建表逻辑 | 中：自己用 pi-utils 的 `openSqliteDatabase` 开库并接 `onCorruptionPreserved`，但要复制 OMP 私有的建表步骤 | [`harness.models`](../../docs/specs/harness/models.md) 输出 5；[计划审查](tasks/t11-harness-config-models/evidences/plan-review.txt) 第 4 条 | |

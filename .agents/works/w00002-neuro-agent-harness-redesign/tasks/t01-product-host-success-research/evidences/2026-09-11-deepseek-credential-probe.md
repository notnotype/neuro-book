# DeepSeek 凭据与端点探测（2026-09-11）

> 目的：验证 `D-TEST-01` §2.5「真实 LLM 不 mock」的前置条件——`DEEPSEEK_API_KEY` 可用、端点可达。
> 关联：`walkthroughs/006-decision-record.md`（决定）、`004-generic-package-testing-research.md` §2.5（约定）。

## 方法

`bun -e` 脚本（bun 自动加载仓库根 `.env`）执行 `GET {DEEPSEEK_API_BASE:-https://api.deepseek.com/v1}/models`，只打印 base、HTTP 状态与模型 id 列表；不打印密钥，不落盘。

## 结果

- `base: https://api.deepseek.com/v1`
- `status: 200`
- `modelIds: deepseek-flash, deepseek-v4-pro`（count 2）

## 结论与注意

- 凭据与端点可用，真实 LLM 测试可按 §2.5 直接调用。
- 本次可见模型 id 为 `deepseek-flash` 与 `deepseek-v4-pro`；后续真实 LLM 测试应从该列表选型（早期记录中的 `deepseek-v4-flash` 未出现在本次列表中，未深究原因）。
- 未做生成调用：当前两个通用包（`agent-file-tools`、`agent-sse`）不依赖 LLM，实测留待首个需要 LLM 的包。

## 密钥处理

未读取密钥值、未打印、未写入任何 Task/证据文件；`.env` 已被 `.gitignore` 忽略。

# @notnotype/nb-story

剧情图谱：把一部小说抽成按阅读位置可查的记忆图（人物、称呼与身份、谁知道什么、关系、数值与任务、悬念、时间线、情节、原文），用命令行 `nbstory`、本机网页查看器与内置问答来读它，并给 Claude Code、Codex 等外部 Agent 一份 Skill。所有查询都能只给到“读到哪里”为止的内容，不剧透。

![nbstory 的网页查看器：《西游记》秘密页，读到第 27 回时每个秘密谁知道、谁不知道，各自附原文出处](https://raw.githubusercontent.com/notnotype/neuro-book/master/packages/nb-story/docs/secrets.webp)

网页查看器的“秘密”页（《西游记》，读到第 27 回为止）：每个秘密谁知道、谁不知道、怎么知道的，各自附“章.段”出处；之后才揭晓的不出现。另有关系图、人物卡、数值、悬念、时间线、情节、原文与问答页。

想直接试：[`examples/journey-to-the-west`](https://github.com/notnotype/neuro-book/tree/master/packages/nb-story/examples/journey-to-the-west) 放着抽好的《西游记》100 回记忆图，导入就能查、能开查看器，不用调用模型；同一目录记了这次抽取的用时、token 与费用。

行为合同见 [`story.cli`](../../docs/specs/story/cli-skill.md)、[`story.queries`](../../docs/specs/story/queries.md)、[`story.viewer`](../../docs/specs/story/viewer.md)、[`story.qa`](../../docs/specs/story/qa.md)、[`story.ingest`](../../docs/specs/story/ingest.md)。

## 安装

要先装 [Bun](https://bun.sh)（1.3.14 以上），Linux、macOS 与 Windows 都能用。

```bash
bun add -g @notnotype/nb-story
nbstory --help
```

## 用起来

```bash
# 1. 配置问答模型（交互）：OMP 目录里的服务商，或自己的 OpenAI 兼容地址。配置文件默认在 ~/.config/nbstory/config.json
nbstory config init
nbstory config test

#    抽取只用 OpenAI Chat 接口。问答用的是这种自定义地址时直接沿用；用了目录里的模型时，另写一个抽取模型：
nbstory config set ingest.model --base-url https://api.example.com/v1 --model 模型名 --api-key-env EXAMPLE_API_KEY   # 也可以写成一整段 JSON
nbstory config test --ingest

# 2. 导入 TXT 原文并逐章抽取（调用模型；先加 --preview 看切章结果）
nbstory ingest 小说.txt --title 书名 --preview
nbstory ingest 小说.txt --title 书名
nbstory ingest --status

# 3. 查：按阅读位置（--at 章 或 章.段）
nbstory books
nbstory find 苏天晴 --at 38
nbstory knows --at 38

# 4. 网页查看器与问答页：打印登录链接，--open 用浏览器打开
nbstory serve --open

# 5. 内置问答
nbstory ask "苏天晴知道白灵的身份吗？" --at 38

# 6. 把 Skill 装给外部 Agent：缺省 Claude Code（~/.claude/skills），--agent codex 装进 ~/.agents/skills
nbstory skill install
```

- 书库默认在 `$XDG_DATA_HOME/nbstory`（没设时 `~/.local/share/nbstory`），换位置加 `--library <目录>`。
- 配置里只写存密钥的环境变量名，密钥本身不进配置、书库、日志与网页；模型可以选内置目录（随 OMP 的模型库打包）里的服务商，也可以写自己的 OpenAI 兼容地址（`nbstory config init --base-url <地址> --model <模型名> --api-key-env <变量名>`）；nbstory 与 OMP 等工具互相独立，不读它们的配置文件，所以在别的工具里配好的服务商要在这里再写一次。
- 密钥只认启动 nbstory 时的环境变量（`export`，或当前目录的 `.env`，后者是 Bun 启动时加载的）；放在家目录 `.env` 里的不算，`config show`、`ask`、`ingest` 对此的结论一致。
- 要结构化结果时所有命令都加 `--json`，标准输出只有一份 `{"ok": …}`。
- 全部命令与选项见 `nbstory --help`（版本号 `nbstory --version`）与 `nbstory <命令> --help`；`config` 各动作的用法见 `nbstory config <动作> --help`。
- 自己的服务商没写 `maxTokens` 时，每次回答的输出上限取 32768（OpenAI 系请求发往远端时最多 64000，本机端点按模型写的上限），网关报错说上限太大时在配置里把该模型的 `maxTokens` 调小。

## 许可证

AGPL-3.0-only，见 [LICENSE](LICENSE)。

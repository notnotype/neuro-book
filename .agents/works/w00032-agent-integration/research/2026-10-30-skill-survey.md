# 各家的 Skill：字段、参数、依赖、更新与市场（2026-10-30）

- 问题：[t15](../tasks/t15-skills/README.md) 要定 NeuroBook 的 Skill 规范。开发者要求先查清：规范里有哪些字段；要不要 Skill 参数，有没有“带参数调用就自动执行脚本”的做法；脚本依赖（Python、Node、Bun）怎样处理；更新与市场怎样做。
- 做法：3 个 Haiku 子代理分头调研（字段与参数、依赖、更新与市场），主会话在 2026-10-30 的浅克隆（Codex、OpenCode、Kimi CLI）上核对了关键处。
- 证据等级：**源码（核实）** 为主会话读过原文；**源码（走查）** 为子代理读源码；**文档** 为官方文档（经抓取工具摘要，未逐字核对）；**检索** 为搜索摘要。

## 1. 字段

Agent Skills 开放标准（[规范](https://agentskills.io/specification)，文档）只有 6 个字段，没有更新的字段：

| 字段 | 必填 | 约束 |
|---|---|---|
| `name` | 是 | 1 到 64 个字符，只有小写字母、数字、连字符，不以连字符开头结尾、不含连续连字符，必须等于目录名 |
| `description` | 是 | 1 到 1024 个字符，写做什么与什么时候用 |
| `license` | 否 | 许可证名或包里的许可证文件名 |
| `compatibility` | 否 | 1 到 500 个字符的自然语言，写环境要求（例 “Requires Python 3.14+ and uv”） |
| `metadata` | 否 | 字符串到字符串的映射，放标准之外的属性 |
| `allowed-tools` | 否 | 空格分隔的预先放行的工具，实验性 |

各家在标准之外的字段（“—”为未查到或不支持）：

| 字段 | 含义 | Claude Code | Codex | OpenCode | omp | Kimi CLI | 旧应用 |
|---|---|---|---|---|---|---|---|
| `when_to_use` | 补充触发场景，拼在说明后 | 有 | — | — | — | — | 有 |
| `disable-model-invocation` | 模型不能自己用，说明不进上下文 | 有 | 在 `agents/openai.yaml` 的 `policy.allow_implicit_invocation` | — | 有 | — | — |
| `user-invocable` | `false` 时不进 `/` 菜单 | 有 | — | — | — | — | — |
| `hide` | 不进系统提示词，仍可显式调用 | — | — | — | 有 | — | — |
| `argument-hint`、`arguments` | 参数提示与具名参数 | 有 | — | — | 只对命令文件 | — | — |
| `paths`（omp 叫 `globs`） | 处理匹配的文件时才自动启用 | 有 | — | — | 有 | — | — |
| `allowed-tools`、`disallowed-tools` | 本轮免审批的工具、启用期间去掉的工具 | 有 | — | — | — | — | — |
| `context: fork`、`agent`、`model`、`effort`、`hooks`、`shell` | 在子代理里跑、换模型、注册钩子 | 有 | — | — | — | — | — |
| `type: flow` | 带流程图的 Skill | — | — | — | — | 有 | — |
| `metadata.displayName`、`version`、`minAppVersion` | 中文展示名、版本、最低应用版本 | — | 只读 `metadata.short-description` | — | — | — | 有 |

- Claude Code 把规范之外的字段打包上传到 claude.ai 或 Skills API 时会报错（文档）；规范的客户端指南建议宽松校验：`name` 与目录名不一致只警告，缺 `description` 才跳过（检索）。
- 说明进上下文的长度：Claude Code 把 `description` 与 `when_to_use` 合计截断到 1,536 个字符（文档）。

## 2. 触发与参数

| 产品 | 用户怎样触发 | 模型怎样加载 | 参数 |
|---|---|---|---|
| Claude Code | 消息开头 `/name`（句中提到只算授权） | `Skill` 工具，受 `Skill(name)` 权限规则约束 | `$ARGUMENTS`、`$N`、具名参数；没有占位符接住时在末尾追加 `ARGUMENTS: …` |
| Codex | 消息里任意位置 `$name`（源码核实：`utils/plugins/src/mention_syntax.rs` 的 `TOOL_MENTION_SIGIL = '$'`，`skills/src/selection.rs` 从文字里提取 `$skill-name`） | 选中的 Skill 包成 `<skill>` 注入为一条用户消息 | 没有参数机制：Skill 附在这条消息上，用户的话就是参数 |
| OpenCode | 自定义命令 `/name` | `skill({name})` 工具，只有名字 | 命令有 `$ARGUMENTS`、`$N`；Skill 没有参数 |
| omp | `/skill:name` | `read skill://name` | 命令有 `$1`、`$@`、`$ARGUMENTS`；Skill 侧未查到 |
| Kimi CLI | `/skill:name 额外文字` | Skill 目录写进系统提示词 | 额外文字作为 “User request:” 追加到正文后 |
| Gemini CLI | 自定义命令 `/name` | `activate_skill`，激活要用户确认 | 命令有 `{{args}}`；Skill 没有参数 |

### 带参数自动执行脚本

| 产品 | 机制 | 审批 | 参数进命令时 | 失败 |
|---|---|---|---|---|
| Claude Code | Skill 正文里 `` !`命令` `` 在载入前执行，输出替换占位符 | 不弹窗，但每条命令过权限规则，不放行就中止；可用 `allowed-tools` 预先放行；可用设置整体关掉 | 文档没说 `$ARGUMENTS` 是否在命令里替换 | 任一命令失败就中止整次调用 |
| Gemini CLI | 自定义命令的 `!{命令}` | 执行前弹确认框，显示替换后的完整命令 | 在 `!{}` 里先做 shell 转义 | 不中止，把退出码附在提示里 |
| OpenCode | 自定义命令的 `` !`命令` `` | 源码里没有审批 | 源码（核实，`packages/core/src/config/plugin/command.ts:185-233`）：先把 `$ARGUMENTS` 原样替换进模板，再扫描执行，不转义，参数里的反引号或 `$()` 会进 shell | 抛错 |
| Codex、omp、Kimi | Skill 里没有这种机制 | — | — | — |

## 3. 脚本的依赖

| 做法 | 谁 | 怎样声明 | 什么时候装、装在哪 |
|---|---|---|---|
| 只在正文里写 | Anthropic 官方 pdf Skill（“Requires: pip install …”）、Codex 的 imagegen Skill（`uv pip install openai`） | 没有机器可读的声明 | 模型自己执行安装命令，装不了告诉用户 |
| 预装 | Claude API 的代码执行沙箱 | — | 沙箱没有网络，只能用预装的库（文档） |
| 声明加门控加按需安装 | OpenClaw | `metadata.openclaw.requires`（`bins`、`env`、`config`）与 `install`（brew、node、uv、go、download） | 加载时检查 PATH，缺了就不可用；安装时按 Homebrew、uv、node、go、download 的顺序选；下载落到 `~/.openclaw/tools/<skill>`；文档没说是否征得用户同意（文档） |
| 包文件加锁文件 | 旧应用 | `package.json` 加 `bun.lock` | 安装后依赖状态为待装，之后执行 `bun install --frozen-lockfile`；只有影响安装结果的字段变了才重装（`packages/neuro-book-legacy/assets/reference/agent/agent-asset-install.md` 的 Dependencies 一节） |

相关工具的行为（文档）：

- **uv 与 PEP 723**：脚本开头的 `# /// script` 块写依赖，`uv run` 按需建环境、缓存在 uv 的缓存目录，不留长期的虚拟环境；缺 Python 时 uv 能自动下载；`uv lock --script` 能给单个脚本生成锁文件。
- **Bun**：没有 `node_modules` 时按 `import` 自动从 npm 拉包（全局缓存）；`--frozen-lockfile` 按锁安装，不一致就报错；默认不执行依赖包的 `postinstall`（要列进 `trustedDependencies`），项目自己的生命周期脚本照常执行。

## 4. 更新与市场

| 产品 | 分发单位与索引 | 安装与记账 | 更新 | 本地改过时 | 信任 |
|---|---|---|---|---|---|
| Claude Code | 插件包（含 Skill）；索引 `.claude-plugin/marketplace.json`，来源可以是相对路径、GitHub、git 子目录、URL、压缩包、npm | `~/.claude/plugins/cache/<市场>/<插件>/<版本>/`；记安装位置、版本、市场来源 | 版本取清单的 `version`，没有就取提交号前 12 位；自动更新官方市场缺省开、其余缺省关；旧版本目录 14 天后清理 | 未查到 | 下架的插件记进 `flagged-plugins.json` 并卸载；企业可限制或屏蔽市场 |
| Codex | 曾用 `openai/skills` 仓库，已标为弃用、指向 `openai/plugins`；`.system`（随程序）、`.curated`、`.experimental` | `skill-installer` 拷到 `~/.codex/skills/<名>`，目标存在就中止，不记版本与哈希 | 没有更新命令 | — | 未查到 |
| ClawHub（OpenClaw） | Skill 目录或插件包 | 写 `.clawhub/lock.json` 与每个 Skill 的 `origin.json` | `clawhub update` 比对本地指纹；可固定版本；改动缺省升补丁号，内容没变不出新版 | 拒绝更新，`--force` 才覆盖 | 有扫描与审核状态；下架是软删除、名字保留 30 天；可撤回单个版本；举报只给管理员看 |
| omp | `@scope/name@version` 的压缩包 | 按版本存放；清单与锁文件记版本、sha512 完整性、来源 | 支持版本范围与标签，跳过已撤回的版本；解包前先验 sha512 | 未查到 | 只有完整性校验 |
| 旧应用 | 内置、Workshop、git、本地四类来源 | 账本记来源与整包内容哈希；先装到临时目录再改名 | — | 整包哈希判断是否改过，给两个出口：接受上游（旧内容进回收区）或保留本地（降为本地 Skill、不再跟踪） | 安装即允许执行脚本；Workshop 的静态检查只是质量门禁、不是沙箱；内置的卸载后留墓碑，下次启动不再种回 |

各家都没有签名。对不写代码的用户，不适合的是要求 git、npm 或命令行，要求理解锁文件、版本范围、强制覆盖，以及安装时执行依赖脚本。

## 未验证边界

- Claude Code 的 Skill 工具参数形状、依赖说明（文档在相关段落前被截断）未读到。
- Gemini CLI 的 Skill 激活参数、OpenClaw 的安装同意流程、ClawHub 的元数据原始样例未读到。
- Cursor、Gemini CLI 扩展、OpenCode、Kimi CLI 的市场没有调研。

# Agent Skill Package Contract

本文定义 NeuroBook Agent Skill 的包结构、身份、版本和依赖合同。

- 本地安装、更新、卸载和来源记账见 [Agent Asset Install Protocol](agent-asset-install.md)。
- 通过 Workshop 发布的外壳与静态校验见 [Agent Asset Package Protocol](agent-asset-package.md)。
- 任务过程记录见 [Task 120](../../docs/tasks/120-agent-skill-package-contract/README.md) 与 [Task 135](../../docs/tasks/135-agent-asset-install-protocol/README.md)。

## Compatibility Baseline

NeuroBook Skill 遵循 [Agent Skills 开放标准](https://agentskills.io/specification)。**符合该标准的外部 Skill 可以直接安装使用，不需要任何转换或补齐。**

标准约束在本项目内全部保留：

- 一个 Skill 是一个目录，固定入口 `SKILL.md`，由 YAML frontmatter 加 Markdown 正文组成。
- 可选子目录 `scripts/`、`references/`、`assets/`。
- 引用其它文件使用相对 Skill 根的路径，保持一层深度。
- Skill 不得假定安装在 `.nbook`、`.claude`、`.codex` 或其它宿主专用目录，命令从 catalog 提供的绝对根目录推导。

## Frontmatter

**`SKILL.md` frontmatter 是 Skill 身份、展示名和版本的唯一真相源。**

```yaml
---
name: rp-mode
description: 角色扮演模式的运行协议。用户要求进入 RP、扮演角色或推进 tick 时使用。
metadata:
    displayName: RP 模式
    version: "1.2.0"
    author: notnotype
---
```

| 字段 | 必填 | 约束 |
| --- | --- | --- |
| `name` | 是 | 稳定 id。≤64 字符，仅小写字母、数字和连字符，不以连字符开头结尾，不含连续连字符，**必须等于父目录名**。 |
| `description` | 是 | ≤1024 字符，写清做什么和什么时候用。触发条件写进这里。 |
| `when_to_use` | 否 | 补充触发场景，标量或 YAML 列表均可。**标准之外的既有扩展**，详见下。 |
| `metadata.displayName` | 否 | 界面展示名，允许中文和任意字符。缺省时回退到 `name`。 |
| `metadata.version` | 否 | canonical SemVer 字符串。缺省时视为无版本包，升级判定改走整包内容指纹比较。 |
| `metadata.author` | 否 | 作者标识，仅展示。 |
| `metadata.minAppVersion` | 否 | canonical SemVer。声明本 Skill 要求的最低 NeuroBook 版本，安装前和加载前都生效。**这是 frontmatter-only Skill 声明兼容性要求的唯一位置。** |
| `license` | 否 | 许可证名或包内许可证文件名。 |
| `compatibility` | 否 | ≤500 字符，自然语言环境要求。只展示，不参与门禁。 |

### when_to_use

`when_to_use` **不在 Agent Skills 标准里**，但它是既有事实：NeuroBook 的 `SkillCatalog` 真实解析它并输出 `whenToUse`，当前 6 个内置 Skill 在用（其中 2 个用 YAML 列表形态），Claude Code 也把它作为私有扩展消费。因此本项目在顶层容忍这个字段，不强制迁进 `metadata`。

```yaml
when_to_use:
  - 用户要求进入 RP
  - 用户要求推进 tick
```

标量与列表两种形态都接受；列表在进入模型可见清单时合并成一行。它是 `description` 的补充，不是替代——**只写 `when_to_use` 而 `description` 含糊，Skill 仍然不会被正确触发**。

严格标准校验器可能会因为这个顶层字段报未知 key。它不影响 Skill 在 NeuroBook 内的安装与运行，也不影响外部标准 Skill 导入。

### id 与展示名分离

`name` 是 id，不是展示名。中文名走 `metadata.displayName`。

这样安装身份、目录名、Workshop slug、下载 URL 和 `bun install --cwd` 路径全部保持 ASCII kebab-case，同时界面上呈现给用户的仍是中文。外部 Skill 没有 `displayName` 时回退到 `name`，因此对标准 Skill 零影响。

catalog 同时输出 `id` 与 `displayName`；模型可见清单和界面都消费 `displayName`。

### version 的读取顺序

1. `metadata.version`
2. 根 `package.json.version`（存在时）
3. 都没有 → 无版本包

两处同时存在且不一致时以 `metadata.version` 为准，并产生一条诊断。**新建和更新 Skill 时两处应保持同步**；只有从外部导入的 Skill 允许只有其中一处。

## Optional Root Package

`package.json` 对本地安装是**可选**的。只含提示词和参考资料的 Skill 不需要它。

以下任一情况需要根 `package.json`：

- Skill 携带 CLI、脚本或运行时依赖。
- Skill 要发布到 Workshop（发布外壳要求见 [agent-asset-package.md](agent-asset-package.md)）。

```text
<skill-id>/
├── SKILL.md
├── package.json
├── bun.lock
├── bin/ 或 scripts/
└── references/ 与 assets/ 按需
```

- `package.json.name` 必须与目录名和 frontmatter `name` 一致。
- 非空 `bin`、非空 `scripts` 或任一实际 Bun 安装输入存在时，根目录必须携带非空 `bun.lock`。纯提示词包不为形式统一生成空锁文件。

版本调整口径：

- `patch`：提示词、规则、修复或文档行为调整，公开命令和配置兼容。
- `minor`：新增向后兼容的公开能力。
- `major`：公开命令、配置或输出合同不兼容。

## Dependency Lifecycle

依赖安装由安装事务负责，状态记在 provenance 账本中，完整规则见 [agent-asset-install.md](agent-asset-install.md) 的 Dependencies 小节。本文只固定与 Skill 包直接相关的三条：

- `node_modules` 是当前用户机器上的本地派生物，不是包文件。它不进包内容指纹、不进包分发、不随回收区保留。
- 只有 `bun.lock`，或 `package.json` 中影响 Bun 安装结果的依赖、安装脚本、平台与 package-manager 字段发生变化时，依赖状态才回到 `pending`。版本号、`SKILL.md`、`references/` 与规则文件的变化不触发重装。
- 需要依赖的 Skill 在依赖状态不是 `installed` 时，任何 CLI 都必须先完成 `bun install --cwd "<skill-root>" --frozen-lockfile`。安装失败时停止，不绕过 frozen lockfile。

## Catalog Visibility

- catalog 层级是 Install Root → Project Root，同 id 时 Project Root 胜出。Seed Root 不是 catalog 层。
- 同 id 的包整体覆盖，catalog 不逐文件合并两层。
- 损坏的 Skill 包只隔离该 id 并记录服务端诊断，不拖垮其它 Skill。
- runnable Skill 真相源位于独立仓时，先更新独立仓 package，再同步随程序发布的种子包。

## Review Checklist

新增或更新 Skill 时检查：

1. 目录名、frontmatter `name` 与（若存在）`package.json.name` 三者一致，且是合法 kebab-case id。
2. 中文名写在 `metadata.displayName`，没有写进 `name`。
3. `metadata.version` 已按 SemVer 更新；存在 `package.json` 时两处版本同步。
4. 正文从 catalog 提供的绝对根目录推导 `<skill-root>`，没有硬编码宿主目录名。
5. 存在脚本、命令或 Bun 安装输入时，非空 `bun.lock` 与安装声明一致。
6. 该 Skill 能通过随 `skill-creator` 分发的 `scripts/quick_validate.py`。
7. 除既有扩展 `when_to_use` 外没有引入新的顶层非标准字段；其余自定义属性一律进 `metadata`，以便对标准 Skill 生态保持可移植。

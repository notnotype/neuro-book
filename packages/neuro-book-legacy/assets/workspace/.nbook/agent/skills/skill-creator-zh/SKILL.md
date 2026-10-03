---
name: skill-creator-zh
description: 用于在 Neuro Book 仓库中创建、改造或维护 skill。适用于新增 `.nbook/agent/skills/*`、重写现有 skill、整理 skill 目录结构、补充脚本或参考资料、修正 skill frontmatter 与触发描述等场景。通常使用 skill-creator
---

# Neuro Book Skill Creator

这个 skill 用来为 **当前项目** 编写和维护 skill，不是 Codex 通用版模板。

当前项目里，skill 的真实发现与加载方式很简单：

1. 服务端扫描 `assets/workspace/.nbook/agent/skills/*/SKILL.md` 和 `workspace/.nbook/agent/skills/*/SKILL.md`，兼容旧文件名 `skill.md`
2. catalog 只读取 frontmatter 里的 `name` 和 `description`
3. 模型先看到 catalog 元数据
4. 真正需要使用 skill 时，再通过 `read` 读取 catalog 中的 `location`

因此，编写 skill 时要把注意力放在两件事上：

- `description` 是否足够清楚，能准确表达“做什么、什么时候用”
- `SKILL.md` 正文是否足够短、足够可执行，能指导另一个 agent 完成任务

## 目录规范

一个 skill 目录通常长这样：

```text
assets/workspace/.nbook/agent/skills/<folder>/
├── SKILL.md
├── scripts/        # 可选。可执行脚本、生成器、校验器
├── references/     # 可选。需要按需读取的详细资料
└── assets/         # 可选。模板、图标、样例文件等输出资源
```

不要把下列内容当成标准组成部分：

- 旧平台的 UI 元数据 YAML
- `README.md`
- `CHANGELOG.md`
- 任何只服务于 Codex 平台、但当前项目没有消费的配置

## 命名规则

### frontmatter.name

`name` 是 catalog 与 `$技能名` 引用语法使用的真实名字。它必须满足：

- 非空
- 不能包含空格
- 首字符必须是字母、`_` 或 `-`
- 后续字符只能是字母、数字、`_` 或 `-`
- 可以使用中文，也可以使用 ASCII

合法示例：

- `novel-technique-commercial-rhythm`
- `世界观补全`
- `skill-creator`
- `plot_helper`

不合法示例：

- `爽 文`
- `123开头`
- `设定/角色`

### 目录名

目录名不必与 `name` 完全一致，但建议使用稳定、易读的 slug，例如：

- `assets/workspace/.nbook/agent/skills/shuangwen`
- `assets/workspace/.nbook/agent/skills/worldbuilding-helper`

如果用户已经指定目录名，就按用户要求来，不要擅自改动现有目录结构。

## frontmatter 规范

当前项目只认两个字段：

```yaml
---
name: 技能名
description: 一句话说明这个 skill 做什么，以及什么情况下应该使用它。
---
```

要求：

- 只写 `name` 和 `description`
- `description` 必须直接描述触发场景，不要只写抽象宣传语
- “什么时候使用”信息要写进 `description`，不要藏在正文里

好的描述示例：

- `通用商业网文节奏指导。用于设计或校验开局、危机推进、主角能动性、期待管理、低谷压迫、爽点释放、奖励兑现和章末钩子。`
- `用于整理小说世界观设定、角色关系和势力约束，适合在大纲扩写、设定补全和逻辑校对时使用。`

坏的描述示例：

- `一个很好用的创作技能`
- `帮助你完成各种任务`

## 正文写法

默认假设模型已经很强，只补充 **项目特有**、**流程特有**、**容易做错** 的信息。

编写正文时遵守这些原则：

1. 先写最小可执行流程，不要一上来堆百科说明
2. 变体很多时，把细节移到 `references/`，在正文里只写“什么时候去读哪份资料”
3. 如果某段逻辑每次都要重写，优先放进 `scripts/`
4. 如果某些模板、样例、图标会直接被拷贝或修改，放进 `assets/`
5. 不要重复写 catalog 已经提供的信息

## 推荐工作流

### 新建 skill

1. 先理解用户想让这个 skill 解决什么问题
2. 找出 2 到 3 个具体使用场景
3. 判断需要哪些可复用资源：
   - 重复执行的操作放 `scripts/`
   - 详细规范放 `references/`
   - 输出模板放 `assets/`
4. 在 `workspace/.nbook/agent/skills/<folder>/` 下创建用户 skill；只有明确修改系统基线时才写 `assets/workspace/.nbook/agent/skills/<folder>/`
5. 写 frontmatter 与正文
6. 如有 shell 能力，运行 `scripts/quick_validate.py` 校验

### 改造现有 skill

1. 先读当前 `SKILL.md`
2. 确认它和当前项目 skill 规范的偏差
3. 优先删掉当前项目不会消费的内容
4. 保留真正有价值的流程、脚本、参考资料
5. 重写 `description`，确保 catalog 层就能表达清楚用途

## 使用脚本的原则

如果当前 agent 有 `bash` 能力，可以使用本目录下的脚本加速：

- `scripts/init_skill.py`
  用于初始化 Neuro Book 风格的 skill 目录
- `scripts/quick_validate.py`
  用于做快速结构校验

如果当前 agent 没有 shell 能力，就直接使用文件工具手动创建或修改文件，不要因为无法跑脚本而停住。

## `scripts/` 什么时候值得创建

满足任一条件就值得考虑：

- 同一段代码会被反复重写
- 操作顺序固定，人工容易漏步骤
- 校验规则明确，脚本比自然语言更可靠

不满足这些条件时，优先用简单的 Markdown 指令，不要为了“看起来专业”堆脚本。

## `references/` 什么时候值得创建

适合放：

- 大量示例
- 结构化规范
- 某个细分变体的专门说明

正文里要明确写出“什么时候去读哪份 references 文件”，避免把 references 变成没人会读的杂物堆。

## `assets/` 什么时候值得创建

适合放：

- 模板文档
- 样例输入输出
- 需要被复制或二次编辑的资源

不要把本该进入上下文阅读的说明文档放进 `assets/`。

## 手工检查清单

在完成一个 skill 后，至少核对这些点：

- frontmatter 只有 `name` 和 `description`
- `name` 可以直接写成 `$技能名`
- `description` 写清楚“做什么”和“什么时候用”
- 正文没有残留旧平台环境变量、旧平台 UI 配置路径之类的术语
- 详细资料是否已按需拆到 `references/`
- 可重复操作是否已经收敛到 `scripts/`

## 对当前项目的额外提醒

- 当前 selector、catalog、prompt 只依赖 `name`、`description` 和 skill 文件路径
- 不要为了尚未接入的 UI 元数据增加额外配置协议
- 如果需要兼容旧 skill，可以保留小写 `skill.md`，但新建时优先使用标准文件名 `SKILL.md`

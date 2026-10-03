# 创建第一本书

这一节结束后，你会拥有一个新的 Project Workspace，并知道如何让 Agent 围绕这个项目工作。

## 创建项目

在应用里创建新项目时，给它一个清晰的标题和一句简介。标题可以先不完美，后面随时能改；简介最好能说明题材、主角和核心吸引力。

一个好用的起点是：

```text
标题：星灯列车
简介：一名失去记忆的列车检票员，在跨越梦境城市的夜行列车上寻找自己的真实身份。
```

创建完成后，NeuroBook 会生成一个 Project Workspace。默认模板会准备基础目录，包括 `lorebook/`、`manuscript/` 和 `world-engine/`。

## 操作路径

第一次创建项目时，按这个顺序做：

1. 打开 NeuroBook（浏览器访问 `http://localhost:3000`）。
2. 点顶栏左侧的 **Bookshelf（书架）**，在书架页创建新项目。
3. 填写标题和简介。
4. 创建后会进入这本书的工作区。
5. 确认左侧文件树里能看到 `project.yaml`、`lorebook/`、`manuscript/`、`world-engine/`。
6. 点顶栏最右侧的按钮展开 **Agent 面板**（右侧抽屉）。

![NeuroBook 工作区与文件树](/images/首页-2-文件树展开.jpg)

顶栏从左到右依次是：书架、World（世界引擎）、Plot（剧情工坊）、Trace（请求追踪）、Jobs（后台任务）、变更（文件历史）、用户资产，最右侧是 Agent 面板开关和账号菜单。窗口较窄时部分按钮会收起。

## 先理解工作边界

Project Workspace 是这本书的边界。Agent 读取和写入项目文件时，应该优先使用项目内路径，例如：

```text
lorebook/character/主角/index.md
manuscript/001-volume/001-chapter/index.md
world-engine/schema/index.ts
```

如果你只记住一件事：稳定设定放进 `lorebook/`，正式正文放进 `manuscript/`，会变化的状态交给 World Engine 时间线。

## 打开第一个 Agent

默认创作入口通常是普通创作 Leader。它像一个总编 / 制片人，负责判断你现在要做什么，然后决定是否调用 Skill、检索资料、创建写作 Agent，或者先把确认的剧情事实推进进 World Engine 时间线。

你可以直接对它说：

```text
帮我为这个新项目做一次小说初始化。先问我必要问题，然后建立最小可写的故事概念、世界书骨架和前三章方向。
```

Agent 不会凭空拥有所有项目知识。它会通过工具读取当前 Project Workspace，或者按 Skill 的说明推进任务。

## 成功标志

完成本节后，你应该看到：

```text
project.yaml
lorebook/
manuscript/
world-engine/
reference/
.nbook/
```

Agent 应该能回答“当前项目是什么”，并能说明它接下来会如何初始化这本书。

如果 Agent 说找不到当前项目，先让它检查 Current Project Workspace：

```text
请检查当前 Project Workspace 是否已设置。如果没有，请告诉我应该如何切换到刚创建的项目。
```

## Agent、profile、session、Skill 的关系

这一套名字听起来像工程术语，但使用时可以这样理解：

- profile 是 Agent 的角色设定。普通创作 Leader 负责统筹（含推进 World Engine、维护 Plot），writer 负责写正文。
- session 是工作记录。同一个 profile 可以开很多 session。
- Agent 是正在工作的那位 AI 助手。
- Skill 是流程说明书。比如 `novel-setup` 会告诉 Agent 怎么从模糊灵感落到项目文件。

如果不确定接下来该做什么，可以直接问 Agent，或者让它读取 `novel-guide` 路线图 Skill 判断当前该进入哪一步。

下一节开始，你会让 leader 调用 Skill，把一个空项目变成能写的小说项目。

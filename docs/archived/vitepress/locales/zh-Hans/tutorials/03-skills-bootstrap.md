# 用 Skill 点燃故事

这一节结束后，你会学会让 Agent 调用常用 Skill，并把灵感、项目说明、世界书和角色设计落到 Project Workspace。

Skill 不是一个按钮脚本。它更像一张写给 Agent 的工作卡：什么时候使用、先读什么、怎么和用户确认、哪些内容应该写入哪些文件。

## 第一步：探索灵感

如果你还只有一个模糊想法，先让 Agent 使用 `novel-idea-exploration`。

可以这样说：

```text
使用novel-idea-exploration和我讨论这个想法：失忆检票员、夜行列车、梦境城市。目标是得到一个可以继续开发的故事雏形。
```

这一轮不急着写正文。重点是确定题材承诺、主角欲望、核心冲突、世界奇观和读者期待。

完成后，你应该得到一段可继续开发的故事雏形。它不一定已经写进世界书，但应该足够回答：

- 这是什么类型的故事。
- 主角是谁。
- 第一卷最吸引人的承诺是什么。
- 读者为什么愿意继续看。

## 第二步：初始化小说项目

当故事雏形基本稳定后，使用 `novel-setup`（阶段一：项目初始化）。

```text
使用novel-setup为当前 Project Workspace 初始化这本书。请先列出你会创建或更新的文件，再执行。
```

这一阶段通常会整理：

- 作品概念和简介。
- 主角、关键配角和初始冲突。
- 最小可用的 `lorebook/` 骨架。
- 开篇三章的方向。

你可以要求 Agent 先列计划再写文件：

```text
在执行前，请列出你准备创建或更新的文件路径。等我确认后再写入。
```

## 第三步：建立世界书

接着继续 `novel-setup` 的阶段二（世界书框架）。世界书不是百科全书，它是 AI 的创作说明书。开局只需要足够支撑前三章，不要一口气写完整个宇宙。

推荐让 Agent 先做这些类型：

- `lorebook/character/`：主角、重要配角、反派或势力代表。
- `lorebook/location/`：开篇会出现的地点。
- `lorebook/faction/`：重要势力。
- `lorebook/item/`：关键物品。
- `lorebook/world/`：世界规则、制度、历史或异常现象。
- `lorebook/instruction/`：作品级创作说明，例如叙事边界和风格注意点。

一个最小可用世界书可以长这样：

```text
lorebook/
  character/
    protagonist/index.md
    important-npc/index.md
  location/
    opening-location/index.md
  world/
    basic-rules/index.md
  instruction/
    style/index.md
```

## 第四步：深化角色

当主角和关键人物开始清晰后，进入 `novel-setup` 的阶段三（角色设计与细化）。

```text
继续 novel-setup 的角色设计阶段，深化主角和第一位重要配角。请把稳定设定写入 lorebook。
```

角色设计的目标不是堆背景，而是让角色能推动剧情。你至少需要知道：

- 他想要什么。
- 他害怕什么。
- 他会怎么误判世界。
- 他和开篇事件有什么关系。

## 第五步：初始化世界引擎（novel-setup 阶段四）

项目方向确定、要正经写的时候，让 Agent 走 `novel-setup` 的阶段四（World Engine 初始化）。这一步会和你确认这个世界的纪年方式、故事开篇的时间点，并登记需要随剧情追踪状态的角色。

```text
继续 novel-setup 阶段四，帮我把世界引擎建起来追踪角色状态。
```

Agent 会引导你确认时间格式、设计需要追踪的角色，然后写入开局状态。完成后，你就可以直接用自然语言查询状态、记录剧情事实，例如"某角色现在在哪里""上次战斗后他受了什么伤"，不需要手动维护任何文件。

下一节写前三章时，会用到这里建立的 World Engine。

## 完成后你应该看到

Project Workspace 里至少应该有：

```text
project.yaml
lorebook/character/...
lorebook/location/...
lorebook/world/...
lorebook/instruction/...
manuscript/001-volume/
world-engine/
```

如果 Agent 只给你聊天回复，没有写入文件，可以直接追问：

```text
请把刚才已经确认的稳定设定写入当前 Project Workspace。写入前先列出目标文件路径。
```

## 常用 Skill 速览

写作早期最常用的是这些：

| Skill | 适合什么时候用 |
| --- | --- |
| `novel-guide` | 不确定当前该用哪个 skill，先看全局路线图。 |
| `novel-idea-exploration` | 只有灵感，还没有故事骨架。 |
| `novel-setup` | 项目搭建四阶段：项目初始化、世界书框架、角色设计与细化、World Engine 初始化。 |
| `novel-writing` | 剧情设计、落库、写正式章节、修改润色的主循环；开局黄金三章也在这里。 |
| `novel-technique-character-card-workshop` | 角色还只有标签和感觉，想做重型角色问答。 |

下一节会把这些准备转成前三章正文。

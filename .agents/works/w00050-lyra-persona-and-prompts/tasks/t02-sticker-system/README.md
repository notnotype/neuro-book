---
schema: nbook.task/v2
taskId: t02-sticker-system
status: active
updated: 2026-11-17
---

# 表情包系统（Discord 式标签符、Provider 提示词 Slot 与 stickers:// 虚拟目录）

## 目标与范围

为 NeuroBook 的 Agent 对话引入表情包表达能力（开发者 2026-11-17 提出设计方向，具体实现细节待开工时细化）：

1. **Discord 式标签符语法**：在消息文本中采用类似 Discord 的表情包标签符（例如 `:sticker_name:` 或带命名空间/ID 的行内标签）。
2. **表情包提供者（Provider）与提示词 Slot**：支持由表情包提供者（Provider）贡献表情包资源，并向 Profile 模板提供对应的表情包提示词 Slot（声明常用表情包与使用语境）。
3. **`stickers://` 虚拟目录**：完整的表情包目录（Catalog）挂载在 `stickers://` 虚拟目录方案下，供 Agent 按需浏览检索与前端渲染解析。

合同：[`docs/specs/agent/stickers.md`](../../../../../docs/specs/agent/stickers.md)（planned）；另改 `agent/contributions.md`、`agent/profile-settings.md`（见计划）。计划：[`plan.md`](plan.md)。

## 决定

开发者 2026-11-17 在对话里确认：

1. 写法 `:名字:`，名字可用中文，重名时 `:包/名字:`；认不出照原文显示。
2. 两种大小：夹在文字里约两倍字高，一段只有表情时显示成大图。
3. 在 Agent 回复里显示成图，用户消息不变。
4. 表情包是带清单的文件夹，照 Skill 的白名单选包（插件 Profile 在声明里写，用户 Profile 在 Profile 设置里加减）；插件可以提供表情包；星璃的包先放 `user://stickers/lyra/`。
5. 第一版不做用户发表情。
6. 先用占位图做通链路，星璃的图另起。
7. 表情写法做成 Markdown 方言，编辑器也能用。
8. 计划末尾“待确认”的默认值（大图约 120 像素、槽至多 60 个、清单上限、不设内置来源、编辑器里未知名字也变节点）照计划。
9. 后端设计审查：先开了 omp，开发者发现 omp 的缺省模型配错（gpt-6-luna），要求停掉、这次改派 Opus。
10. 设计审查后（开发者答“没问题”）：表情写法改成 nb-markdown 的内置方言，目录经宿主端口交入（插件方言晚到时已建立的视图不认）。
11. 槽里一律教带包的写法 `:包/名字:`，读时两种都认（不带包的重名会让历史回复变回原文、改掉系统块）。
12. 在 Files 修挂载点被整个换掉后一直 `root-gone` 的缺陷，并入本 Task 作为一片。
13. 同时照审查改掉、不另问的：去掉冒号两侧的边界规则（中文里紧挨汉字也认）；第一版没有内置表情包（内置插件取不到包目录，决定 8 里“由内置插件交出”作废）。

## 当前状态

2026-11-17（`active`）：设计审查做完（前端 Sonnet 12 条、后端 Opus 11 条），处理见 [`evidences/design-review-disposition.txt`](evidences/design-review-disposition.txt)；Spec 与计划已按审查修订为第二版。

切片 1（nb-markdown 的 `sticker` 方言）在分支 `feat/w00050-t02-stickers`（worktree `.worktree/w00050-t02-stickers`）提交 `0d98c87a1`，未合入：写法判断（`src/stickers.ts`）、读写与 `\:` 转义、编辑器节点与输入规则、大图装饰、宿主端口 `stickers`，neuro-book 的注入键 `markdownStickersKey` 已接到 `MarkdownControl` 与 `MarkdownHosted`（应用里还没有提供方，切片 4 接）。Lab：`MarkdownDisplay` 的 `stickers`、`stickers-late`，`EditorGroup` 的 `stickers`。验证：nb-markdown 全部 bun 与 vitest、neuro-book 的 markdown 插件测试与类型检查通过；变异 7 个杀死 6 个，活下来的是多余的 `parseHTML` 优先级，已去掉。

开发者看 Lab 后提出六条（2026-11-17），已改（提交 `5210f2a37`、`22c494e48`）：文件引用小块的图标段与文字段错开一截（w00025 遗留，图标段改成普通行内框）；注音小字太小太淡（0.6 倍改 0.7 倍、颜色加深）；提示块的粗左边框改成整圈细边框；表情的占位不对齐、前后没有间隙；Lab 占位图圆角太大；句子里的表情把行撑高（改成约 1.6 倍字高、负外边距收回，浏览器里量过有无表情的行一样高：展示器 24 像素、编辑器 33 像素）。Spec 输出 10、11 随之改。

开发者又指出表情与文字没对齐、并排的表情间隙太宽，并要求按严格的 UI 设计师角度审查“一条完整的回复”：表情对齐到汉字字形中心、只在紧挨文字的一侧留间隙（`951865348`）；UI 审查（Sonnet，15 条，[`evidences/ui-review-reply.txt`](evidences/ui-review-reply.txt)）的第 1–4、6–11、13、15 条已改（`2b70e6362`），第 5（块间距分层）、12（展示器里 `<kbd>` 按源码显示）、14（行高取整数）交开发者定，开发者答“都按推荐”：第 5 条改了（带框的大块前后 1.5 倍间距、居中小标题与下一块贴近到一半，`e55a8ea26`）；第 12 条另开 [`w00025 t26`](../../../w00025-editor/tasks/t26-display-kbd-keys/README.md)；第 14 条不改。

切片 2（Files 挂载点重开）在分支提交 `fb5a4218e`：请求在打开着的挂载点上得到 `root-gone` 时摘下它（`retire`）、按当前声明重开一次再做，旧挂载点等借用结算后关闭；`files/schemes.test.ts` 原“验收 8”断言旧行为（一直 `root-gone` 到空闲关闭），改写成新行为；变异（去掉重试）被抓住；files、agent 资源与 Skill 测试 342 条通过。收口的实现审查要专门看这一片的并发（共享路径）。

## 下一步

- 切片 3（`nbook.stickers` 后端：清单、目录、`stickers://`、取图路由、远程服务）。

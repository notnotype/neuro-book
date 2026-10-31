---
schema: nbook.task/v2
taskId: t45-fix-issue-267-stale-web-bundle
status: done
updated: 2026-10-31
---

# issue 267：从源码运行 serve 时网页包比源码旧，不提示

## 目标与范围

从源码运行 `nbstory serve`，网页包（`dist/web`）比打进它的源码旧时，启动时在标准错误提示重打。不自动重打，不改 npm 发的包的行为。

合同：[`story.cli-skill`](../../../../docs/specs/story/cli-skill.md) 新增输出 19。来源：[issue 267](https://github.com/notnotype/neuro-book/issues/267)。

## 做法

- 构建时（`vite.config.ts` 的 `webStamp` 插件）收集打包见到的模块，去掉查询串、虚拟模块和 node_modules，各记一个 SHA-1，写成 `dist/web/build-stamp.json`（`src/server/web-stamp.ts`）。当前包是 402 个文件、35 KB：自己的 `src/web`、`src/contract`，和工作区里 nb-ui、nb-agent-ui、nb-markdown、nb-form、nb-runtime 的源码。issue 建议的“只记 `src/web`”会漏掉后面这些包，所以记的是实际进包的模块。
- `serve` 启动时（`warnIfWebBundleStale`，在打印登录链接之前）重算：内容变了或文件不见了就在标准错误写一句，带打包时间（UTC）、改过的文件数与前三个文件名、重打命令。没有记录（早先版本打的包）也写一句。检查本身出错只提示，不挡启动。
- 只摘要不比修改时间：拉代码、切分支会改修改时间而内容不变。
- 是否从源码运行的判据：`src/web/index.html` 在不在。`package.json` 的 `files` 写了 `!src/web`，npm 装的包里没有它，也就不检查（那里打包用的工作区文件本来也不在了）。

## 验证

- `src/server/web-stamp.test.ts` 5 条：刚打完不旧、只改修改时间不旧；自己的源码、别的包的源码改了旧并列出相对路径；源码删了旧；node_modules 里的改了不算；没记录与没网页包各是各的状态。用真实文件。
- 真实运行：`bun run build:web`（7 秒）后 `nbstory serve --json`，标准错误为空、标准输出一份 JSON；给 `src/web/App.vue` 加一行再启动，标准错误出现“网页包比源码旧（打于 … UTC，之后有 1 个源文件改过：src/web/App.vue），先在 … 下运行 bun run build:web 重打。”，标准输出仍是一份 JSON，退出码都是 0；之后还原了那个文件。
- nb-story 类型检查通过；serve、server 相关 15 条测试通过（含“--json 时启动成功只输出一份 JSON”）。

## 当前状态

已完成并合入 master，没有单独的实现审查（新增约 100 行，没有并发和跨进程的部分）。issue 还没有回复。

## 没覆盖的

- 没有从 npm 包实装一次确认“不带 `src/web` 就不检查”。依据是 `files` 的配置和判据本身；下次发布前的 `pack-smoke` 会走这一步，那时标准错误里不该有这句。
- 工作区的目录结构变了（包改名、挪位置）时，记录里的相对路径对不上，会被当成“源文件不见了”提示重打。这时重打一次就恢复，没有处理。
- 新增的、此前没被打进包的源文件不会被发现：只有记录里的文件才查。它被某个已记录的文件导入时，那个文件也改了，照样会被查到。

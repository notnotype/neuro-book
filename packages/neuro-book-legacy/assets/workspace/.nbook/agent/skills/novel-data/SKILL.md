---
name: novel-data
description: 查询本地 NovelScope 缓存的起点、番茄小说榜单快照与书籍详情。用于小说选题、市场观察、竞品筛选、题材研究，或用户明确要求查看榜单、作品简介、分类、连载状态和字数时。数据是缓存快照，不是外站实时结果。
---

# 小说数据

用只读 CLI 查询 NovelScope。不要把缓存数据说成实时数据，也不要通过本 Skill 触发采集或刷新。

## CLI

从 SkillCatalog 读取本 Skill 的绝对 `root`，记为 `<novel-data-root>`。若只拿到 `SKILL.md` 的绝对 `location`，使用它的父目录。下文占位符必须替换为实际绝对路径：

第一次运行任何 CLI 命令前，或当前 Skill 的 `node_modules` 缺失时，先执行依赖门：

```bash
bun install --cwd "<novel-data-root>" --frozen-lockfile
```

安装成功后才能继续。安装失败时停止，不绕过 frozen lockfile，不借用其它目录的依赖。

```bash
bun "<novel-data-root>/scripts/novel-data.ts" rankings --platform qidian --board yuepiao
bun "<novel-data-root>/scripts/novel-data.ts" book-detail --platform qidian --book-id 123456
```

两个命令都支持 `--base-url <url>`。服务地址按以下顺序解析：

1. 当前命令的 `--base-url`
2. 环境变量 `NOVEL_DATA_BASE_URL`
3. `http://localhost:3000`

`platform` 只取 `qidian` 或 `fanqie`。起点榜单键为 `yuepiao`、`hotsales`、`recom`、`collect`；番茄榜单键形如 `0_1_1139`。`book-id` 使用榜单条目的 `externalBookId`，不是 NovelScope 内部 UUID。

## 结果合同

- CLI 成功时向 stdout 输出格式化 JSON，失败时向 stderr 输出错误并以非零状态退出。
- 榜单回答必须带 `fetchedAt`，说明这是该时间的缓存快照。
- 书籍详情的 `stale=true` 表示缓存已过期且刷新失败；必须明确告诉用户数据可能过期。
- 起点榜单的 `metrics` 可能为空，不要补造阅读量、字数或热度。
- 连接失败时先说明需要启动本地 NovelScope；不要改用网页抓取绕过用户的数据源选择。

## 研究流程

1. 查询一至两个与用户方向直接相关的榜单。
2. 从头部条目取 `externalBookId`，按需查询书籍详情。
3. 归纳题材分布、书名与简介钩子、连载状态和字数区间。
4. 在结论中标注快照时间、样本范围和 stale 限制，不把榜单相关性写成因果结论。

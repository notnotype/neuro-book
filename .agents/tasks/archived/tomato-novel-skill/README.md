# Tomato Novel Skill

## 用户需求

用户希望新增一个番茄小说相关 skill。当前只要求支持免费小说本地素材导入和 epub 转 Markdown，结果默认放到当前小说 workspace 下，供后续拆书、结构分析和素材参考使用。

已知输入：

- 下载器 exe：`C:\Users\<user>\Downloads\TomatoNovelDownloader-Win64-v2.4.9.exe`
- epub 样例：`C:\Users\<user>\Downloads\退役八年，复出世界级魔法少女.epub`
- 下载器结果目录：`C:\Users\<user>\Downloads\7410970999107095577_退役八年，复出世界级魔法少女`

## 当前边界

`TomatoNovelDownloader-Win64-v2.4.9.exe --help` 只暴露 Web UI、已有记录更新、自更新、数据目录等能力。非交互首次搜索和首次下载不作为第一版 CLI 承诺。

第一版只实现：

- 本地 epub 导入并转 Markdown。
- 下载器结构化目录导入并转 Markdown。
- `serve` / `update` 薄封装下载器 exe。
- 输出到 `reference/tomato/`，不写入 `manuscript/`。

后续再扩展：

- 小说基础数据与评论抓取。
- 全站搜索小说。
- 正文下载、段评、图片等更完整数据。
- 更适合拆书的章节切片和结构化摘要。

## CLI 用法

```powershell
bun assets/agent/skills/番茄小说导入/scripts/tomato-novel.ts import-epub "C:\Users\<user>\Downloads\退役八年，复出世界级魔法少女.epub" --workspace "workspace/current-novel"
bun assets/agent/skills/番茄小说导入/scripts/tomato-novel.ts import-download "C:\Users\<user>\Downloads\7410970999107095577_退役八年，复出世界级魔法少女" --workspace "workspace/current-novel"
```

默认输出结构：

```text
reference/tomato/{book-id-or-slug}/
├── metadata.json
├── full.md
├── chapters/
└── images/
```

## 验证记录

- 已通过：`python assets/agent/skills/skill-creator-zh/scripts/quick_validate.py assets/agent/skills/番茄小说导入`。
- 已通过：epub 样例导入 smoke，输出 145 章、`metadata.json`、`chapters/`、`full.md` 与封面图片。
- 已通过：下载器结果目录导入 smoke，输出 145 章、书籍 metadata 和带 `tomato-chapter-id` 的章节 Markdown。
- 已通过：`bun run test server/agent/skills/skill-catalog.test.ts`。
- 已通过：`bun run typecheck`。

---
name: novel-import-tomato-reference
description: 用于处理番茄小说、Tomato Novel Downloader、免费小说 epub、下载器结果导入、epub 转 Markdown、以及把外部小说素材整理到当前小说 Project Workspace 的 reference/tomato/ 供后续拆书分析。
---

# novel-import-tomato-reference：番茄小说导入

用于把番茄小说免费作品的本地素材整理成当前小说 Project Workspace 下的外部参考资料。第一版只做“导入 + 转换”，不承诺自动搜索或首次下载新书。

## 边界

- 默认输出到当前小说 Project Workspace 的 `reference/tomato/`。
- 不写入 `manuscript/`，避免把外部小说素材混进原创正文。
- 只处理本地 epub 或 Tomato Novel Downloader 已下载出的结构化目录。
- 当前下载器 exe 的非交互能力只适合更新已有本地记录；首次搜索和首次下载需要走 Web UI/TUI。
- 不要把搜索、评论、段评全量抓取描述成已完成能力；这些是后续扩展方向。

## CLI

脚本位置：

```powershell
bun assets/workspace/.nbook/agent/skills/novel-import-tomato-reference/scripts/tomato-novel.ts --help
```

常用命令：

```powershell
bun assets/workspace/.nbook/agent/skills/novel-import-tomato-reference/scripts/tomato-novel.ts import-epub "C:\path\book.epub" --workspace "current-novel"
bun assets/workspace/.nbook/agent/skills/novel-import-tomato-reference/scripts/tomato-novel.ts import-download "C:\path\downloaded-book-dir" --workspace "current-novel"
```

默认参数：

- `--out reference/tomato`：写入 workspace 内的外部参考资料目录。
- `--force`：允许覆盖已有同名导入目录；默认拒绝覆盖。
- `--keep-raw`：额外复制原始 epub、`status.json` 或 `downloaded_chapters.jsonl` 到 `raw/`。
- `--exe`：覆盖 Tomato Novel Downloader exe 路径。默认使用 `C:\Users\notnotype\Downloads\TomatoNovelDownloader-Win64-v2.4.9.exe`。

## 工作流

1. 确认当前小说Project Workspace。Project-bound File Scope就是当前项目目录，执行脚本时`--workspace`传`.`；手工从仓库根执行时可传`workspace/current-novel`。
2. 如果用户给的是 `.epub`，运行 `import-epub`。
3. 如果用户给的是下载器目录，且目录内有 `status.json` 或 `downloaded_chapters.jsonl`，运行 `import-download`。
4. 导入后检查 `metadata.json`、`chapters/`、`full.md` 和 `images/` 是否生成。
5. 需要拆书时，把 `reference/tomato/{book}/full.md` 或单章文件作为参考输入，再按拆书流程提炼结构，不直接把原文搬进 `manuscript/`。

## 下载器封装

`serve` 只启动下载器 Web UI，供用户手动搜索和首次下载：

```powershell
bun assets/workspace/.nbook/agent/skills/novel-import-tomato-reference/scripts/tomato-novel.ts serve --data-dir "C:\path\tomato-data"
```

`update <book-id>` 只更新下载器已经记录过的本地小说：

```powershell
bun assets/workspace/.nbook/agent/skills/novel-import-tomato-reference/scripts/tomato-novel.ts update 7410970999107095577 --data-dir "C:\path\tomato-data"
```

如果用户要全站搜索、评论、段评或正文抓取，先说明第一版 CLI 尚未实现，再建议后续基于下载器源码/API 或 Web UI 自动化扩展。

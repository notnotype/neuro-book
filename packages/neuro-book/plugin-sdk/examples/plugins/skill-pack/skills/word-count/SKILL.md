---
name: word-count
description: 数一章 Markdown 正文有多少字，按 frontmatter 里的 title 报出来。
---

# 数字数

用户要知道某一章写了多少字时，在 shell 里运行这个 Skill 的脚本，把章节文件的路径交给它：

```sh
bun skills://example.skill-pack.word-count/scripts/count.ts <章节文件>
```

脚本输出一行 JSON：`{"title": "…", "characters": 1234}`。`characters` 不算空白与标点。

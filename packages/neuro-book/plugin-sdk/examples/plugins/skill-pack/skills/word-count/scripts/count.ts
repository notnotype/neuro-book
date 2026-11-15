/**
 * word-count 的脚本：读一章 Markdown，用 `yaml` 包解析 frontmatter，数正文的字。
 *
 * 它用到 npm 包 `yaml`，但插件装好之后旁边没有 `node_modules`：`nbooke build` 把这个文件连同 `yaml` 打成一个单文件，写回
 * 同一个路径（`scripts/count.ts`），所以 SKILL.md 里写的命令不用改。脚本要找自己旁边的文件时用 `import.meta.dir`；
 * `__dirname` 会被换成构建机器上的路径，构建会拒绝。
 */

import {readFileSync} from "node:fs";

import {parse} from "yaml";

const file = process.argv[2];
if (file === undefined) {
    console.error("用法：bun scripts/count.ts <章节文件>");
    process.exit(2);
}
const text = readFileSync(file, "utf8");
const match = /^---\n([\s\S]*?)\n---\n?/u.exec(text);
const meta = (match === null ? {} : parse(match[1]!)) as {title?: unknown};
const body = match === null ? text : text.slice(match[0].length);
const characters = [...body].filter((char) => /[\p{L}\p{N}]/u.test(char)).length;
console.log(JSON.stringify({title: typeof meta.title === "string" ? meta.title : null, characters}));

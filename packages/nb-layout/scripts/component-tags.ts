/**
 * 组件的稳定性标注：`vue-tsc` 出的组件声明（`declare const _default$N`）上带不了注释，标注写在 `src/vue/index.ts` 组件那一行的
 * 行尾，打包后由这里插进声明（w00026 t48 计划第 4 稿“标注”）。插件 SDK 的 `plugin-sdk/pack.ts` 另行生成声明，按同样的写法
 * 读这一行、插同样的注释，两边各自几行，不跨包导入脚本。
 */

import {STABILITY_TAGS, type Stability} from "./api-surface";

const COMPONENT_LINE = /^export \{default as (\w+)\} from "\.\/[\w-]+\.vue";(.*)$/u;
const TRAILING_TAG = /^\s*\/\/\s*@(\w+)\s*$/u;

/** 读入口里每个组件那一行的行尾标注；缺标注或标注不认识时抛出。 */
export function componentTags(entrySource: string): Map<string, Stability> {
    const tags = new Map<string, Stability>();
    for (const line of entrySource.split("\n")) {
        const match = COMPONENT_LINE.exec(line);
        if (match === null) continue;
        const [, name, rest] = match;
        const tag = TRAILING_TAG.exec(rest!)?.[1];
        if (tag === undefined || !(STABILITY_TAGS as readonly string[]).includes(tag)) throw new Error(`component ${name} needs a trailing // @stable or // @experimental in the entry`);
        tags.set(name!, tag as Stability);
    }
    return tags;
}

/**
 * 在打包后的声明里给组件加标注：按末尾导出列表里的 `_default$N as 名字` 找到那条 `declare const`，在前面插一块 JSDoc。
 * 纯文本插入，同一份输入写出同一份字节。找不到导出或声明时抛出。
 */
export function tagComponentDeclarations(declarations: string, tags: ReadonlyMap<string, Stability>): string {
    const exportList = /^export \{([^}]*)\};\s*$/mu.exec(declarations)?.[1];
    if (exportList === undefined) throw new Error("declarations have no export list");
    const local = new Map<string, string>();
    for (const item of exportList.split(",")) {
        const parts = item.trim().split(/\s+as\s+/u);
        if (parts.length === 2) local.set(parts[1]!, parts[0]!);
    }
    let text = declarations;
    for (const [name, tag] of tags) {
        const declared = local.get(name);
        if (declared === undefined) throw new Error(`component ${name} is not in the declaration export list`);
        const pattern = new RegExp(`^declare const ${declared.replace(/\$/gu, "\\$")}:`, "mu");
        const match = pattern.exec(text);
        if (match === null) throw new Error(`component ${name} (${declared}) has no declaration`);
        text = `${text.slice(0, match.index)}/** @${tag} */\n${text.slice(match.index)}`;
    }
    return text;
}

/**
 * Agent 交回的主文字（docs/specs/canon/agent-tools.md 输出 6 的“写主文字”）：去值、`replace` 在带值写法里找与换、交回的值与当时不同时
 * 的提示。读到的是带值写法（canon.rendering 输出 8），值只给看：写入前去掉，字段不因文字里的值而改。
 */

import {parseEntryText, stripEntryText} from "@notnotype/nb-canon/grammar";

/** 交回的文字去值（canon.rendering 输出 22）：带值的 `V` 换回自闭合，去掉程序加的属性。 */
export const stripAgentText = (text: string): string => stripEntryText(text);

/** 一段带值写法里每个带值的 `V`：按（条目、地址）或式子分组，组里按出现的先后排。 */
function valuesOf(text: string): Map<string, Array<{readonly label: string; readonly value: string; readonly computed: boolean}>> {
    const found = new Map<string, Array<{readonly label: string; readonly value: string; readonly computed: boolean}>>();
    for (const tag of parseEntryText(text).tags) {
        if (tag.place !== "live" || tag.name !== "V" || tag.kind !== "paired" || tag.content === null) continue;
        const attribute = (name: string) => tag.attributes.find((candidate) => candidate.name === name)?.value;
        const of = attribute("of");
        const expr = attribute("expr");
        const entry = attribute("entry");
        const key = JSON.stringify(of !== undefined ? ["of", entry ?? "", of] : ["expr", expr ?? ""]);
        const label = of !== undefined ? (entry === undefined ? of : `${entry} 的 ${of}`) : (expr ?? "");
        const list = found.get(key) ?? [];
        list.push({label, value: text.slice(tag.content.start, tag.content.end), computed: of === undefined});
        found.set(key, list);
    }
    return found;
}

/**
 * 交回的文字里值与当时不同的几处，写成给模型的提示。按（标签名、地址或式子）配对，同一个地址出现几次按先后一一对上；配不上的
 * （新加的、删掉的）不算。
 */
export function changedValueNotes(submitted: string, current: string): string[] {
    const now = valuesOf(current);
    const notes: string[] = [];
    for (const [key, sent] of valuesOf(submitted)) {
        const was = now.get(key) ?? [];
        sent.forEach((item, index) => {
            const before = was[index];
            if (before === undefined || before.value === item.value) return;
            notes.push(item.computed ? `${item.label} 是算出来的，现在是 ${before.value}：改它依赖的字段` : `${item.label} 现在是 ${before.value}，改值用 set`);
        });
    }
    return [...new Set(notes)];
}

/** 程序加的装饰的写法（canon.rendering 输出 9）：`find` 里有这些多半是从按计划模式读到的文字抄的。 */
const DECORATED = /<\/V>|\s(?:label|incomplete|unavailable|value|name|path)="/u;

/**
 * `replace` 写到主文字的一块：在这一块按实际模式的带值写法里找 `find`（恰好一次）换成 `with`，交回整块去值后的文字。`current` 是
 * 那一块按实际模式的带值写法。
 */
export function replaceInBlock(current: string, find: string, replacement: string): {readonly text: string} | {readonly problem: string} {
    if (find === "") return {problem: "find 不能是空的。"};
    const first = current.indexOf(find);
    if (first < 0) return {problem: DECORATED.test(find) ? "这一块里找不到 find：find 里带着读到的值，值可能变了或是按计划模式读的。按实际模式重读这一块再抄。" : "这一块里找不到 find，原样抄读到的文字。"};
    if (current.indexOf(find, first + 1) >= 0) return {problem: "find 在这一块里出现了不止一次，多抄几个字让它只出现一次。"};
    return {text: current.slice(0, first) + replacement + current.slice(first + find.length)};
}

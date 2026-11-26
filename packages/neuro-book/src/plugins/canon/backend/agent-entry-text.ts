/**
 * Agent 交回的主文字（docs/specs/canon/agent-tools.md 输出 6 的“写主文字”）：去值、同一批新建条目的代号、`replace` 在带值写法里找与换、
 * 交回的值与当时不同时的提示。读到的是带值写法（canon.rendering 输出 8），值只给看：写入前去掉，字段不因文字里的值而改。
 */

import {MAX_BLOCK_LENGTH} from "@notnotype/nb-canon";
import {parseEntryText, rewriteEntryIds, stripEntryText, type ParsedEntryText} from "@notnotype/nb-canon/grammar";

/**
 * 交回的文字最多这么长才去读：去值前的带值写法比存下的源文长（值与程序加的属性），给一倍的余量；读完去值后再按内核的一块上限比。
 * 服务端进程里读这段文字，太长的不读：解析大致按长度的平方变慢，挡住的是整个服务端（canon.rendering 输出 1）。
 */
const MAX_SUBMITTED_LENGTH = MAX_BLOCK_LENGTH * 2;

const TOO_LONG = `一块主文字最多 ${String(MAX_BLOCK_LENGTH)} 字，拆成几块（addBlock）。`;

/** 一段带值写法里每个带值的 `V`：按（条目、地址）或式子分组，组里按出现的先后排。 */
type Values = Map<string, Array<{readonly label: string; readonly value: string; readonly computed: boolean}>>;

function valuesOf(parsed: ParsedEntryText): Values {
    const found: Values = new Map();
    for (const tag of parsed.tags) {
        if (tag.place !== "live" || tag.name !== "V" || tag.kind !== "paired" || tag.content === null) continue;
        const attribute = (name: string) => tag.attributes.find((candidate) => candidate.name === name)?.value;
        const of = attribute("of");
        const expr = attribute("expr");
        const entry = attribute("entry");
        const key = JSON.stringify(of !== undefined ? ["of", entry ?? "", of] : ["expr", expr ?? ""]);
        const label = of !== undefined ? (entry === undefined ? of : `${entry} 的 ${of}`) : (expr ?? "");
        const list = found.get(key) ?? [];
        list.push({label, value: parsed.source.slice(tag.content.start, tag.content.end), computed: of === undefined});
        found.set(key, list);
    }
    return found;
}

/**
 * 交回的文字里值与当时不同的几处，写成给模型的提示。按（标签名、地址或式子）配对，同一个地址出现几次按先后一一对上；配不上的
 * （新加的、删掉的）不算。
 */
function changedValueNotes(submitted: Values, current: Values): string[] {
    const notes: string[] = [];
    for (const [key, sent] of submitted) {
        const was = current.get(key) ?? [];
        sent.forEach((item, index) => {
            const before = was[index];
            if (before === undefined || before.value === item.value) return;
            notes.push(item.computed ? `${item.label} 是算出来的，现在是 ${before.value}：改它依赖的字段` : `${item.label} 现在是 ${before.value}，改值用 set`);
        });
    }
    return [...new Set(notes)];
}

/** 交回的一块写成要存的源文，带着回话里要提的值的提示。 */
export type AgentBlockText = {readonly source: string; readonly notes: readonly string[]} | {readonly problem: string};

/**
 * Agent 交回的一块主文字写成要存的源文：太长的不读；去值；指向同一批新建条目的 `$代号`（`V` 的 `entry`、`Ref` 的 `id`、式子里的
 * `ref('…')`）换成它的临时 id，发布时内核再换成正式 id（components.md 输出 18）。`keys` 是这一批到这一项为止的代号表。
 *
 * `current` 是这一块当时的带值写法（新加的块没有）：交回的值与它不同的几处写成提示。`verbatim` 时（出错的块，读到的就是源文）不去值：
 * 里面的标签没有值，去值只会把作者原来的写法改成规范写法。
 */
export function agentBlockText(submitted: string, keys: ReadonlyMap<string, string>, options: {readonly current?: string; readonly verbatim?: boolean} = {}): AgentBlockText {
    if (submitted.length > MAX_SUBMITTED_LENGTH) return {problem: TOO_LONG};
    let source = submitted;
    let notes: string[] = [];
    if (options.verbatim !== true) {
        const parsed = parseEntryText(submitted);
        source = stripEntryText(parsed);
        if (options.current !== undefined) notes = changedValueNotes(valuesOf(parsed), valuesOf(parseEntryText(options.current)));
    }
    if (source.length > MAX_BLOCK_LENGTH) return {problem: TOO_LONG};
    if (source.includes("$")) {
        const missing = new Set<string>();
        source = rewriteEntryIds(source, (id) => {
            if (!id.startsWith("$")) return id;
            const tmp = keys.get(id.slice(1));
            if (tmp === undefined) missing.add(id);
            return tmp ?? id;
        });
        if (missing.size > 0) return {problem: `主文字里的 ${[...missing].join("、")} 不是这一批前面 create 的代号；新建的条目先 create（key 写代号），再在后面的项里用“$代号”。`};
    }
    return {source, notes};
}

/** 程序加的装饰的写法（canon.rendering 输出 9）：`find` 里有这些多半是从按计划模式读到的文字抄的。 */
const DECORATED = /<\/V>|\s(?:label|incomplete|unavailable|value|name|path)="/u;

/**
 * `replace` 写到主文字的一块：在这一块按实际模式的带值写法里找 `find`（恰好一次）换成 `with`，交回换好的整块带值写法（再经
 * `agentBlockText` 去值）。`current` 是那一块按实际模式的带值写法。
 */
export function replaceInBlock(current: string, find: string, replacement: string): {readonly text: string} | {readonly problem: string} {
    if (find === "") return {problem: "find 不能是空的。"};
    const first = current.indexOf(find);
    if (first < 0) return {problem: DECORATED.test(find) ? "这一块里找不到 find：find 里带着读到的值，值可能变了或是按计划模式读的。按实际模式重读这一块再抄。" : "这一块里找不到 find，原样抄读到的文字。"};
    if (current.indexOf(find, first + 1) >= 0) return {problem: "find 在这一块里出现了不止一次，多抄几个字让它只出现一次。"};
    return {text: current.slice(0, first) + replacement + current.slice(first + find.length)};
}

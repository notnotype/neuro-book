/**
 * w00055 t01 富文本 spike（草稿，不进产品）：条目主文字的标签写法在章节语言上的一个语法模块、样本世界与条件的求值。
 *
 * 和将来正式做法不同的地方（只为让开发者上手体验）：
 * - 世界是写死的样本（星瑕、星瑾两个条目），值不随章变；
 * - `<If>` 只认同一段里的行内写法，整个条件读成一个原子节点，各支的文字在浮层里改；跨段的块级 `<If>` 原样保留；
 * - 条件的表达式由这里的小求值器算（比较、与或非、括号），不是内核的白名单；
 * - 属性按 `名字="值"` 认，值里不能有双引号。
 */

import {Node} from "@tiptap/core";
import type {JSONContent} from "@tiptap/core";

import {coreSyntax, createMarkdownLanguage} from "@notnotype/nb-markdown/language";
import type {MarkdownSyntax} from "@notnotype/nb-markdown/language";

/* ---------- 样本世界 ---------- */

export interface Field {
    readonly entry: string;
    readonly namespace: string;
    readonly id: string;
    readonly label: string;
    readonly group: string;
    readonly kind: "number" | "text";
    value: number | string | null;
}

export interface Entry {
    readonly id: string;
    readonly name: string;
}

export const ENTRIES: readonly Entry[] = [{id: "xia", name: "星瑕"}, {id: "jin", name: "星瑾"}];

/** 每次挂载给一份新的（浮层里改值会改它）。 */
export function sampleFields(): Field[] {
    return [
        {entry: "xia", namespace: "panel", id: "魔力", label: "魔力", group: "面板", kind: "number", value: 1200},
        {entry: "xia", namespace: "panel", id: "魔力上限", label: "魔力上限", group: "面板", kind: "number", value: 3000},
        {entry: "xia", namespace: "panel", id: "存款", label: "存款", group: "面板", kind: "number", value: 300},
        {entry: "xia", namespace: "panel", id: "回溯", label: "回溯", group: "面板", kind: "number", value: 3},
        {entry: "xia", namespace: "character", id: "性格", label: "性格", group: "人物", kind: "text", value: "嘴硬心软，怕麻烦"},
        {entry: "xia", namespace: "look", id: "外貌", label: "外貌", group: "形象", kind: "text", value: "银发，蓝眼，左眼下有颗痣"},
        {entry: "jin", namespace: "character", id: "身份", label: "身份", group: "人物", kind: "text", value: "联邦调查员"},
        {entry: "jin", namespace: "panel", id: "好感度", label: "好感度", group: "面板", kind: "number", value: 40},
    ];
}

/** 正在编辑的条目。 */
export const HOME = "xia";

export const SAMPLE_SOURCE = [
    "## 现在",
    "",
    "魔力 <V of=\"panel.魔力\" />/<V of=\"panel.魔力上限\" />，存款 <V of=\"panel.存款\" /> 联邦币，今天还能回溯 <V of=\"panel.回溯\" /> 次。<If test=\"panel.魔力 >= 1000\">还能变身。<Else />魔力不够变身。</If>",
    "",
    "## 原身",
    "",
    "<V of=\"look.外貌\" />。私下都用这个样子，没有人知道。",
    "",
    "## 哥哥",
    "",
    "哥哥是<V entry=\"jin\" of=\"character.身份\" />，对她的好感度 <V entry=\"jin\" of=\"panel.好感度\" />。<If test=\"ref('jin').panel.好感度 >= 80\">哥哥完全站在她这边。<ElseIf test=\"ref('jin').panel.好感度 >= 50\" />哥哥开始相信她了。<Else />哥哥还在怀疑她。</If>",
    "",
    "<Ref id=\"jin\" /> 不知道她就是那个魔法少女。",
    "",
].join("\n");

export function fieldAt(fields: readonly Field[], entry: string | null, of: string): Field | undefined {
    const [namespace = "", id = ""] = of.split(".");
    return fields.find((field) => field.entry === (entry ?? HOME) && field.namespace === namespace && field.id === id);
}

export const entryName = (id: string): string => ENTRIES.find((entry) => entry.id === id)?.name ?? "已删除的条目";

export function display(value: unknown): string {
    if (value === null || value === undefined) return "未知";
    if (typeof value === "number") return value.toLocaleString("zh-CN");
    return String(value);
}

/* ---------- 条件的求值 ---------- */

type Value = number | string | boolean | null;
/** `undefined` 是未知（三值逻辑，与内核的 canon.rendering 输出 5 同义）。 */
type Tri = Value | undefined;

/** 算一句条件；写得不对抛出 `Error`，文字给作者看。 */
export function evaluate(test: string, fields: readonly Field[]): Tri {
    const tokens = test.match(/ref\('[^']*'\)(?:\.[\p{L}\p{N}_]+)+|[\p{L}_][\p{L}\p{N}_]*(?:\.[\p{L}\p{N}_]+)+|\d+(?:\.\d+)?|"[^"]*"|'[^']*'|===|!==|==|!=|>=|<=|&&|\|\||[<>!()]/gu) ?? [];
    if (tokens.join("").replace(/\s/gu, "") !== test.replace(/\s/gu, "")) throw new Error("条件里有认不出的写法");
    let at = 0;
    const peek = (): string | undefined => tokens[at];
    const next = (): string => {
        const token = tokens[at];
        if (token === undefined) throw new Error("条件没写完");
        at += 1;
        return token;
    };
    const atom = (): Tri => {
        const token = next();
        if (token === "(") {
            const inner = or();
            if (next() !== ")") throw new Error("括号没配上");
            return inner;
        }
        if (token === "!") {
            const inner = atom();
            return inner === undefined ? undefined : !inner;
        }
        if (/^\d/u.test(token)) return Number(token);
        if (/^["']/u.test(token)) return token.slice(1, -1);
        const ref = /^ref\('([^']*)'\)\.(.+)$/u.exec(token);
        const field = ref === null ? fieldAt(fields, null, token) : fieldAt(fields, ref[1]!, ref[2]!);
        if (field === undefined) throw new Error(`没有字段 ${token}`);
        return field.value ?? undefined;
    };
    const compare = (): Tri => {
        const left = atom();
        const op = peek();
        if (op === undefined || !/^(===|!==|==|!=|>=|<=|<|>)$/u.test(op)) return left;
        next();
        const right = atom();
        if (left === undefined || right === undefined) return undefined;
        switch (op) {
            case "==": case "===": return left === right;
            case "!=": case "!==": return left !== right;
            default:
                if (typeof left !== typeof right || typeof left === "boolean") return undefined;
                return op === ">=" ? left! >= right! : op === "<=" ? left! <= right! : op === ">" ? left! > right! : left! < right!;
        }
    };
    const and = (): Tri => {
        let value = compare();
        while (peek() === "&&") {
            next();
            const right = compare();
            value = value === false || right === false ? false : value === undefined || right === undefined ? undefined : Boolean(value) && Boolean(right);
        }
        return value;
    };
    const or = (): Tri => {
        let value = and();
        while (peek() === "||") {
            next();
            const right = and();
            value = value === true || right === true ? true : value === undefined || right === undefined ? undefined : Boolean(value) || Boolean(right);
        }
        return value;
    };
    const result = or();
    if (at !== tokens.length) throw new Error("条件后面多了东西");
    return result;
}

/** 一句条件给作者看的写法：`panel.魔力 >= 1000` → `魔力 ≥ 1000`。 */
export function readableTest(test: string, fields: readonly Field[]): string {
    return test
        .replace(/ref\('([^']*)'\)\.([\p{L}\p{N}_]+\.[\p{L}\p{N}_]+)/gu, (_all, entry: string, of: string) => `${entryName(entry)}的${fieldAt(fields, entry, of)?.label ?? of}`)
        .replace(/\b[a-z]+\.([\p{L}\p{N}_]+)/gu, (all: string) => fieldAt(fields, null, all)?.label ?? all)
        .replace(/>=/gu, "≥").replace(/<=/gu, "≤").replace(/===?/gu, "=").replace(/!==?/gu, "≠").replace(/&&/gu, " 并且 ").replace(/\|\|/gu, " 或者 ");
}

export interface Branch {
    /** 这一支的条件；`null` 是“否则”。 */
    readonly test: string | null;
    /** 这一支的源文字（可以带 `<V />`）。 */
    readonly text: string;
}

/** 生效的那一支的下标；判断是未知时为 -1（哪一支都不显示，画成“未知”）。 */
export function activeBranch(branches: readonly Branch[], fields: readonly Field[]): number {
    for (const [index, branch] of branches.entries()) {
        if (branch.test === null) return index;
        let value: Tri;
        try {
            value = evaluate(branch.test, fields);
        } catch {
            return -1;
        }
        if (value === undefined) return -1;
        if (value) return index;
    }
    return branches.length;
}

/* ---------- 标签的读写 ---------- */

const attrs = (source: string): Record<string, string> => Object.fromEntries([...source.matchAll(/([A-Za-z]+)="([^"]*)"/gu)].map((match) => [match[1]!, match[2]!]));

const V_TAG = /^<V((?:\s+[A-Za-z]+="[^"]*")*)\s*\/>/u;
const REF_TAG = /^<Ref((?:\s+[A-Za-z]+="[^"]*")*)\s*\/>/u;
const IF_TAG = /^<If\s+test="([^"]*)">([\s\S]*?)<\/If>/u;

export function writeValue(of: string, entry: string | null): string {
    return entry === null ? `<V of="${of}" />` : `<V entry="${entry}" of="${of}" />`;
}

export function writeIf(branches: readonly Branch[]): string {
    const [first, ...rest] = branches;
    if (first === undefined || first.test === null) return "";
    return `<If test="${first.test}">${first.text}${rest.map((branch) => `${branch.test === null ? "<Else />" : `<ElseIf test="${branch.test}" />`}${branch.text}`).join("")}</If>`;
}

/** `<If>` 里面的几支：按 `<ElseIf />`、`<Else />` 切开。 */
export function parseIf(test: string, inner: string): Branch[] {
    const branches: Branch[] = [];
    let current: Branch = {test, text: ""};
    let rest = inner;
    for (;;) {
        const match = /<ElseIf\s+test="([^"]*)"\s*\/>|<Else\s*\/>/u.exec(rest);
        if (match === null) break;
        branches.push({...current, text: current.text + rest.slice(0, match.index)});
        current = {test: match[1] ?? null, text: ""};
        rest = rest.slice(match.index + match[0].length);
    }
    branches.push({...current, text: current.text + rest});
    return branches;
}

export const VALUE_NODE = "entryValue";
export const IF_NODE = "entryIf";
export const REF_NODE = "entryRef";

/**
 * 节点视图要的东西由宿主给：世界（字段的值）、条件的画法、点了以后怎么办。值变了宿主调 `refresh()` 让已画的小块重画。
 */
export interface AtomHost {
    fields: Field[];
    ifStyle: "active" | "both";
    activate: (kind: "value" | "if" | "ref", pos: number, dom: HTMLElement) => void;
}

const painters = new Set<() => void>();
export const refreshAtoms = (): void => {
    for (const paint of painters) paint();
};

function atomNode(name: string, attributes: Record<string, unknown>, paint: (dom: HTMLElement, attrs: Record<string, unknown>, host: AtomHost) => void, kind: "value" | "if" | "ref", host: () => AtomHost): Node {
    return Node.create({
        name,
        group: "inline",
        inline: true,
        atom: true,
        selectable: true,
        addAttributes() {
            return Object.fromEntries(Object.entries(attributes).map(([key, value]) => [key, {default: value, rendered: false}]));
        },
        parseHTML() {
            return [{tag: `span[data-${name}]`}];
        },
        renderHTML() {
            return ["span", {[`data-${name}`]: ""}];
        },
        addNodeView() {
            return ({node, getPos}) => {
                const dom = document.createElement("span");
                dom.dataset.entryAtom = kind;
                let attrsNow = node.attrs as Record<string, unknown>;
                const repaint = () => paint(dom, attrsNow, host());
                repaint();
                painters.add(repaint);
                dom.addEventListener("mousedown", (event) => {
                    // 按下时不让 ProseMirror 选中节点再弹浮层：浮层由点击打开，焦点留在编辑器里。
                    event.preventDefault();
                });
                dom.addEventListener("click", () => {
                    const pos = getPos();
                    if (typeof pos === "number") host().activate(kind, pos, dom);
                });
                return {
                    dom,
                    update: (updated) => {
                        if (updated.type.name !== name) return false;
                        attrsNow = updated.attrs as Record<string, unknown>;
                        repaint();
                        return true;
                    },
                    destroy: () => painters.delete(repaint),
                    ignoreMutation: () => true,
                };
            };
        },
    });
}

/** 一支文字里的 `<V />` 换成值（浮层与“两支都画”的画法用）。 */
export function branchText(text: string, fields: readonly Field[]): string {
    return text.replace(/<V((?:\s+[A-Za-z]+="[^"]*")*)\s*\/>/gu, (_all, source: string) => {
        const found = attrs(source);
        return display(fieldAt(fields, found.entry ?? null, found.of ?? "")?.value);
    });
}

export function createEntrySyntax(host: () => AtomHost): MarkdownSyntax {
    const valueNode = atomNode(VALUE_NODE, {of: "", entry: null}, (dom, attrsNow, h) => {
        const of = String(attrsNow.of);
        const entry = attrsNow.entry === null ? null : String(attrsNow.entry);
        const field = fieldAt(h.fields, entry, of);
        const shown = field === undefined ? "字段没了" : field.value === null || field.value === "" ? "还没填" : display(field.value);
        // 长的文字（整句的外貌描写）画成小块会断成几截贴片：退成淡底加下划线，跟着正文折行。
        const long = field !== undefined && field.value !== null && (shown.length > 20 || shown.includes("\n"));
        dom.className = `entry-chip entry-chip--value${field === undefined ? " entry-chip--missing" : field.value === null || field.value === "" ? " entry-chip--unknown" : ""}${long ? " entry-chip--long" : ""}`;
        dom.replaceChildren();
        if (entry !== null && entry !== HOME) {
            const from = document.createElement("span");
            from.className = "entry-chip__from";
            from.textContent = entryName(entry);
            dom.append(from);
        }
        dom.append(shown);
        dom.title = field === undefined ? `${of}：这个字段没了` : `${entry === null ? "" : `${entryName(entry)} · `}${field.group} · ${field.label}`;
    }, "value", host);
    const ifNode = atomNode(IF_NODE, {branches: []}, (dom, attrsNow, h) => {
        const branches = attrsNow.branches as Branch[];
        const active = activeBranch(branches, h.fields);
        dom.className = `entry-if entry-if--${h.ifStyle}${active < 0 ? " entry-if--unknown" : ""}`;
        dom.replaceChildren();
        const first = branches[0];
        dom.title = first?.test === null || first === undefined ? "" : `条件：${readableTest(first.test, h.fields)}`;
        if (h.ifStyle === "active") {
            const text = active < 0 ? "" : active >= branches.length ? "" : branchText(branches[active]!.text, h.fields);
            const span = document.createElement("span");
            // 没有一支生效（没写“否则”、条件不成立）或判断是未知时，不显示任何字就点不到也删不掉：画一个淡的占位。
            span.className = text === "" ? "entry-if__placeholder" : "entry-if__text";
            span.textContent = text !== "" ? text : active < 0 ? "条件算不出" : "条件不成立";
            dom.append(span);
            return;
        }
        const condition = document.createElement("span");
        condition.className = "entry-if__test";
        condition.textContent = first?.test === null || first === undefined ? "" : readableTest(first.test, h.fields);
        dom.append(condition);
        for (const [index, branch] of branches.entries()) {
            const span = document.createElement("span");
            span.className = `entry-if__branch${index === active ? " entry-if__branch--on" : ""}`;
            span.textContent = branchText(branch.text, h.fields) || "　";
            dom.append(span);
        }
    }, "if", host);
    const refNode = atomNode(REF_NODE, {id: ""}, (dom, attrsNow) => {
        dom.className = "entry-chip entry-chip--ref";
        dom.textContent = entryName(String(attrsNow.id));
        dom.title = "条目";
    }, "ref", host);
    const read = (raw: string): JSONContent[] | null => {
        const value = V_TAG.exec(raw);
        if (value !== null) {
            const found = attrs(value[1]!);
            return [{type: VALUE_NODE, attrs: {of: found.of ?? "", entry: found.entry ?? null}}];
        }
        const ref = REF_TAG.exec(raw);
        if (ref !== null) return [{type: REF_NODE, attrs: {id: attrs(ref[1]!).id ?? ""}}];
        const condition = IF_TAG.exec(raw);
        if (condition !== null) return [{type: IF_NODE, attrs: {branches: parseIf(condition[1]!, condition[2]!)}}];
        return null;
    };
    const tokenizer = {
        name: "entryTag",
        level: "inline" as const,
        start: (source: string) => {
            const match = /<(?:V|Ref|If)\b/u.exec(source);
            return match === null ? undefined : match.index;
        },
        tokenizer: (source: string) => {
            const match = V_TAG.exec(source) ?? REF_TAG.exec(source) ?? IF_TAG.exec(source);
            return match === null ? undefined : {type: "entryTag", raw: match[0]};
        },
    };
    return {
        name: "entry-tags-spike",
        extensions: [valueNode, ifNode, refNode],
        marked: [{extensions: [tokenizer]}],
        inlineTags: ["V", "Ref", "If", "Else", "ElseIf"],
        // 单独占一行的标签，词法器给的是 HTML 块：认成只有这一个节点的段落，免得落成不能编辑的原样块。
        read: {html: (token) => {
            const raw = token.raw.trim();
            const nodes = read(raw);
            return nodes !== null && (V_TAG.exec(raw) ?? REF_TAG.exec(raw) ?? IF_TAG.exec(raw))?.[0] === raw ? [{type: "paragraph", content: nodes}] : null;
        }},
        readInline: {entryTag: (token) => read(token.raw)},
        writeInline: {
            [VALUE_NODE]: (node) => writeValue(String(node.attrs.of), node.attrs.entry === null ? null : String(node.attrs.entry)),
            [IF_NODE]: (node) => writeIf(node.attrs.branches as Branch[]),
            [REF_NODE]: (node) => `<Ref id="${String(node.attrs.id)}" />`,
        },
    } as MarkdownSyntax;
}

export function createEntryLanguage(host: () => AtomHost) {
    return createMarkdownLanguage([createEntrySyntax(host), coreSyntax]);
}

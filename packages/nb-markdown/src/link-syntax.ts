/**
 * Markdown 行内链接与图片的写法（CommonMark 的行内链接：`[文字](地址 "标题")`、`![说明](地址)`）：编解码器写地址、Composer 认
 * 引用与图片都用这里，两边对“什么算一个链接”的判断一致（docs/specs/ui/prompt-editor.md 的文字写法）。
 *
 * 只认行内写法；引用式链接（`[文字][标签]`）要整篇的定义才能解析，Composer 的一段话里不认。不跨行。
 */

/** 文字里的一个行内链接或图片：`[start, end)` 是它的原文。 */
export interface InlineLink {
    readonly start: number;
    readonly end: number;
    readonly image: boolean;
    /** 方括号里的原文，去掉首尾空白，反斜杠转义保留。 */
    readonly label: string;
    /** 地址，去掉尖括号与反斜杠转义。 */
    readonly destination: string;
}

const ESCAPABLE = /\\([!-/:-@[-`{-~])/gu;

/** 去掉反斜杠转义（CommonMark：反斜杠后面是 ASCII 标点时转义它）。 */
export const unescapeMarkdown = (text: string): string => text.replace(ESCAPABLE, "$1");

/** 链接与图片地址：含空白、尖括号或括号不配对时写成 `<地址>`。 */
export function writeDestination(href: string): string {
    let depth = 0;
    let balanced = true;
    for (const char of href) {
        if (char === "(") depth += 1;
        else if (char === ")" && --depth < 0) balanced = false;
    }
    if (/[\s<>]/u.test(href) || !balanced || depth !== 0 || href === "") return `<${href.replace(/[<>\\]/gu, (char) => `\\${char}`)}>`;
    return href.replace(/\\(?=[!-/:-@[-`{-~])/gu, "\\\\");
}

/** 方括号里的文字：方括号与反斜杠加转义，换行换成空格（行内链接不跨行）。 */
export const writeLabel = (text: string): string => text.replace(/[[\]\\]/gu, (char) => `\\${char}`).replace(/\s*\n\s*/gu, " ");

/** `[文字](地址)` 或 `![文字](地址)`。 */
export const writeInlineLink = (label: string, href: string, image = false): string => `${image ? "!" : ""}[${writeLabel(label)}](${writeDestination(href)})`;

const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/u;

/** `index` 处是一个转义：反斜杠后面是 ASCII 标点（CommonMark）。反斜杠后面是空白、换行或别的字时它只是普通字符。 */
const isEscape = (text: string, index: number): boolean => text[index] === "\\" && ASCII_PUNCTUATION.test(text[index + 1] ?? "");

/**
 * 一段文字的扫描器。所有“往后找闭合”的查找都记住失败：同一行里从某处往后找不到某种闭合，从更靠后的地方也找不到，所以整段
 * 文字的识别是线性的；否则一行里每个没闭合的 `[`、反引号或引号都要重扫到行尾，几万字的草稿每打一个字都要卡一秒以上。
 */
class LinkScanner {
    /** 每个 `[` 配对的 `]`。 */
    readonly #pairs = new Map<number, number>();
    /** 闭合符号 → 从这个位置往后到行尾找不到它。换行时清空。 */
    #noClose = new Map<string, number>();
    #lineEnd = -1;

    constructor(readonly text: string) {
        this.#pairBrackets();
        // 配对时记下的失败只用于配对；之后从头扫链接。
        this.#noClose = new Map();
        this.#lineEnd = -1;
    }

    /** `[` 配对的 `]` 的位置；没有为 -1。 */
    close(open: number): number {
        return this.#pairs.get(open) ?? -1;
    }

    /**
     * 按栈给方括号配对：跨行的不配对（行内链接不跨行），转义的方括号与代码片段里的方括号不算。代码片段按 CommonMark：同样长度
     * 的一串反引号闭合，找不到闭合的反引号串是普通字符。
     */
    #pairBrackets(): void {
        const text = this.text;
        let stack: number[] = [];
        for (let index = 0; index < text.length; index += 1) {
            const char = text[index];
            if (isEscape(text, index)) index += 1;
            else if (char === "\n") stack = [];
            else if (char === "`") {
                let run = 1;
                while (text[index + run] === "`") run += 1;
                const close = this.#closingRun(index + run, run);
                index = (close < 0 ? index + run : close + run) - 1;
            } else if (char === "[") stack.push(index);
            else if (char === "]") {
                const open = stack.pop();
                if (open !== undefined) this.#pairs.set(open, index);
            }
        }
    }

    /** 从 `from` 往后同一行里长度正好是 `run` 的反引号串的位置；没有为 -1。 */
    #closingRun(from: number, run: number): number {
        const key = "`".repeat(run);
        if (this.#known(from, key)) return -1;
        const text = this.text;
        for (let index = from; index < text.length && text[index] !== "\n"; index += 1) {
            if (text[index] !== "`") continue;
            let length = 1;
            while (text[index + length] === "`") length += 1;
            if (length === run) return index;
            index += length - 1;
        }
        this.#noClose.set(key, from);
        return -1;
    }

    /** 从 `from` 往后找 `close` 的结果已知是“找不到”。 */
    #known(from: number, close: string): boolean {
        const text = this.text;
        if (from > this.#lineEnd) {
            // 进入新的一行：上一行记下的失败不再成立。
            const end = text.indexOf("\n", from);
            this.#lineEnd = end < 0 ? text.length : end;
            this.#noClose = new Map();
        }
        const failed = this.#noClose.get(close);
        return failed !== undefined && from >= failed;
    }

    /** 从 `index` 读地址：返回地址的原文与之后的位置；不成立返回 null。括号最多嵌套 32 层（与 CommonMark 的参考实现相同）。 */
    readDestination(index: number): {raw: string; next: number} | null {
        const text = this.text;
        if (text[index] === "<") {
            if (this.#known(index + 1, ">")) return null;
            for (let at = index + 1; at < text.length; at += 1) {
                const char = text[at];
                if (isEscape(text, at)) at += 1;
                else if (char === "<") return null;
                else if (char === "\n") break;
                else if (char === ">") return {raw: text.slice(index + 1, at), next: at + 1};
            }
            // 只有找到行尾都没有 `>` 才记下：中途遇到 `<` 失败，后面另起的 `<…>` 仍可能成立。
            this.#noClose.set(">", index + 1);
            return null;
        }
        let depth = 0;
        let at = index;
        for (; at < text.length; at += 1) {
            const char = text[at] as string;
            if (isEscape(text, at)) at += 1;
            // 只有 ASCII 空格与控制字符结束地址（CommonMark、`marked` 相同）：全角空格与不换行空格是地址的一部分。
            else if (/[ \u0000-\u001f]/u.test(char)) break;
            else if (char === "(") {
                if (++depth > 32) return null;
            } else if (char === ")") {
                if (depth === 0) break;
                depth -= 1;
            }
        }
        return depth === 0 ? {raw: text.slice(index, at), next: at} : null;
    }

    /** 从 `index`（引号或左括号）读标题，返回之后的位置；不成立返回 -1。 */
    readTitle(index: number): number {
        const text = this.text;
        const open = text[index];
        if (open !== "\"" && open !== "'" && open !== "(") return -1;
        const close = open === "(" ? ")" : open;
        if (this.#known(index + 1, close)) return -1;
        for (let at = index + 1; at < text.length; at += 1) {
            const char = text[at];
            if (isEscape(text, at)) at += 1;
            else if (open === "(" && char === "(") return -1;
            else if (char === "\n") break;
            else if (char === close) return at + 1;
        }
        this.#noClose.set(close, index + 1);
        return -1;
    }
}

const skipSpaces = (text: string, index: number): number => {
    while (text[index] === " " || text[index] === "\t") index += 1;
    return index;
};

/** 从 `start`（`[` 或 `![` 的位置）读一个行内链接；不成立返回 null。 */
function readInlineLink(scanner: LinkScanner, start: number): InlineLink | null {
    const text = scanner.text;
    const image = text[start] === "!";
    const open = image ? start + 1 : start;
    const close = scanner.close(open);
    if (close < 0 || text[close + 1] !== "(") return null;
    const destination = scanner.readDestination(skipSpaces(text, close + 2));
    if (destination === null) return null;
    let at = skipSpaces(text, destination.next);
    if (at > destination.next && text[at] !== ")") {
        at = scanner.readTitle(at);
        if (at < 0) return null;
        at = skipSpaces(text, at);
    }
    if (text[at] !== ")") return null;
    return {start, end: at + 1, image, label: text.slice(open + 1, close).trim(), destination: unescapeMarkdown(destination.raw)};
}

/**
 * 文字里所有不重叠的行内链接与图片，从左往右。链接文字里的图片（`[![图](a.png)](b.md)`）算外层的一个链接；转义的 `\[` 与代码
 * 片段里的方括号不开始链接，与编解码器用的 `marked` 一致。整段文字线性时间（见 `LinkScanner`）。
 */
export function findInlineLinks(text: string): InlineLink[] {
    const scanner = new LinkScanner(text);
    const links: InlineLink[] = [];
    for (let index = 0; index < text.length; index += 1) {
        if (isEscape(text, index)) {
            index += 1;
            continue;
        }
        const char = text[index];
        if (char !== "[" && !(char === "!" && text[index + 1] === "[")) continue;
        const link = readInlineLink(scanner, index);
        if (link === null) continue;
        links.push(link);
        index = link.end - 1;
    }
    return links;
}

const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/u;

/**
 * 每一行是否在围栏代码块里（包括围栏那两行）。块里的写法都是文字：用户贴给 Agent 的代码里的 `![x](a.png)` 不是图片附件，
 * `handlers[key](event)` 不是引用（旧版用 CommonMark 解析图片，同样排除代码）。围栏按 CommonMark：三个以上的反引号或波浪号开头，
 * 同一种符号、不短于开头的一行收尾；没收尾的到文字末尾。
 */
export function fencedLines(lines: ReadonlyArray<string>): boolean[] {
    const fenced: boolean[] = [];
    let open: string | null = null;
    for (const line of lines) {
        const fence = FENCE_PATTERN.exec(line)?.[1];
        if (open === null) {
            fenced.push(fence !== undefined);
            if (fence !== undefined) open = fence;
            continue;
        }
        fenced.push(true);
        if (fence !== undefined && fence[0] === open[0] && fence.length >= open.length && line.trim() === fence) open = null;
    }
    return fenced;
}

/** `value` 里落在围栏代码块里的位置。 */
export function fenceTest(value: string): (position: number) => boolean {
    const lines = value.split("\n");
    const fenced = fencedLines(lines);
    if (!fenced.includes(true)) return () => false;
    const ranges: Array<[number, number]> = [];
    let offset = 0;
    lines.forEach((line, index) => {
        if (fenced[index]) ranges.push([offset, offset + line.length + 1]);
        offset += line.length + 1;
    });
    return (position) => ranges.some(([start, end]) => position >= start && position < end);
}

/**
 * 文字里真正算写法的链接与图片及其原文范围：和编辑器认小块的规则一样，代码片段、转义、围栏里的不算，跨行的不算。给要按原文范围
 * 处理标签的调用方（发送时算附件的位置）：`parsePromptText` 交回的是节点，没有范围。
 */
export function findPromptLinks(text: string): InlineLink[] {
    const inFence = fenceTest(text);
    return findInlineLinks(text).filter((link) => !inFence(link.start) && !text.slice(link.start, link.end).includes("\n"));
}

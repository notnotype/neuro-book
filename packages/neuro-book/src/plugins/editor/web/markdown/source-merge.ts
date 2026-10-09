/**
 * Markdown 富文本保存时保持原文字节（docs/specs/workbench/editor.md 输出 19）。Tiptap 的序列化会改写没编辑过的部分
 * （CRLF 变 LF、`*` 列表变 `-`、标准 ruby 变属性式），所以保存不直接用序列化结果，而是按行三方合并：
 *
 * - `base`：打开时的正文序列化一次的结果（没编辑过的文档在编辑器里的样子）；
 * - `ours`：磁盘原文；
 * - `theirs`：编辑后的序列化结果。
 *
 * 只有 `theirs` 改了的行取 `theirs`，只有序列化规范化造成的差异（`ours` 与 `base` 不同、`theirs` 与 `base` 相同）保留
 * 原文，两边都改的区域取 `theirs`。行按文字比较、不看换行符；原文的行连同它自己的换行符原样写出，`theirs` 的行用原文
 * 主导的换行符。`theirs` 与 `base` 相同时原样返回原文。
 *
 * 另有 frontmatter 的拆分：按原始字符串的偏移切出开头的 `---` 块（BOM 留在前缀里），不归一化换行、不补换行，正文才交给
 * 编辑器与合并。
 */

/** 原文拆成前缀（BOM 与 frontmatter，原样）与正文。 */
export interface SourceSplit {
    readonly prefix: string;
    readonly body: string;
}

const FENCE = /^---[ \t]*(\r\n|\n)/u;
const CLOSE = /^---[ \t]*(\r\n|\n|$)/u;

export function splitFrontmatter(source: string): SourceSplit {
    const bom = source.startsWith("\uFEFF") ? "\uFEFF" : "";
    const rest = source.slice(bom.length);
    const open = FENCE.exec(rest);
    if (open === null) return {prefix: bom, body: rest};
    let offset = open[0].length;
    while (offset <= rest.length) {
        const line = rest.slice(offset);
        const close = CLOSE.exec(line);
        if (close !== null) {
            const end = offset + close[0].length;
            return {prefix: bom + rest.slice(0, end), body: rest.slice(end)};
        }
        const next = rest.indexOf("\n", offset);
        if (next < 0) break;
        offset = next + 1;
    }
    // 没有闭合的分隔线：不是 frontmatter，整段都是正文。
    return {prefix: bom, body: rest};
}

/** 一行：文字与它自己的换行符（最后一行可能没有）。 */
interface Line {
    readonly text: string;
    readonly eol: string;
}

function linesOf(source: string): Line[] {
    const lines: Line[] = [];
    let start = 0;
    while (start < source.length) {
        const next = source.indexOf("\n", start);
        if (next < 0) {
            lines.push({text: source.slice(start), eol: ""});
            break;
        }
        const crlf = next > start && source[next - 1] === "\r";
        lines.push({text: source.slice(start, crlf ? next - 1 : next), eol: crlf ? "\r\n" : "\n"});
        start = next + 1;
    }
    return lines;
}

/** 原文用得最多的换行符；没有换行时为 `\n`。 */
function dominantEol(lines: ReadonlyArray<Line>): string {
    let crlf = 0;
    let lf = 0;
    for (const line of lines) {
        if (line.eol === "\r\n") crlf += 1;
        else if (line.eol === "\n") lf += 1;
    }
    return crlf > lf ? "\r\n" : "\n";
}

const same = (left: Line, right: Line): boolean => left.text === right.text;

/** 去掉末尾的一个换行符，返回去掉之后的文字与去掉的换行符。 */
function trailing(source: string): {readonly text: string; readonly eol: string} {
    if (source.endsWith("\r\n")) return {text: source.slice(0, -2), eol: "\r\n"};
    if (source.endsWith("\n")) return {text: source.slice(0, -1), eol: "\n"};
    return {text: source, eol: ""};
}

/**
 * 两列行的公共子序列（Myers 的 O((N+M)D) 算法）：返回按顺序的对齐对 `[a 的下标, b 的下标]`。编辑通常只改几处，D 小。
 */
function matches(a: ReadonlyArray<Line>, b: ReadonlyArray<Line>): Array<readonly [number, number]> {
    const n = a.length;
    const m = b.length;
    const max = n + m;
    const offset = max + 1;
    const v = new Int32Array(2 * max + 3);
    const trace: Int32Array[] = [];
    let found = -1;
    for (let d = 0; d <= max && found < 0; d += 1) {
        trace.push(v.slice());
        for (let k = -d; k <= d; k += 2) {
            let x = k === -d || (k !== d && (v[offset + k - 1] as number) < (v[offset + k + 1] as number)) ? (v[offset + k + 1] as number) : (v[offset + k - 1] as number) + 1;
            let y = x - k;
            while (x < n && y < m && same(a[x] as Line, b[y] as Line)) {
                x += 1;
                y += 1;
            }
            v[offset + k] = x;
            if (x >= n && y >= m) {
                found = d;
                break;
            }
        }
    }
    // 回溯：从终点沿每一步的来路走回起点，记下斜线（相同的行）。
    const pairs: Array<readonly [number, number]> = [];
    let x = n;
    let y = m;
    for (let d = found; d > 0; d -= 1) {
        const previous = trace[d] as Int32Array;
        const k = x - y;
        const fromBelow = k === -d || (k !== d && (previous[offset + k - 1] as number) < (previous[offset + k + 1] as number));
        const prevK = fromBelow ? k + 1 : k - 1;
        const prevX = previous[offset + prevK] as number;
        const prevY = prevX - prevK;
        // 这一步先向下或向右走一格，再沿斜线走；斜线上的点都在 (prevX, prevY) 的右下方。
        while (x > prevX && y > prevY) {
            x -= 1;
            y -= 1;
            pairs.push([x, y]);
        }
        x = prevX;
        y = prevY;
    }
    while (x > 0 && y > 0) {
        x -= 1;
        y -= 1;
        pairs.push([x, y]);
    }
    return pairs.reverse();
}

/** 按行三方合并，见模块头。 */
export function mergeSource(ours: string, base: string, theirs: string): string {
    if (theirs === base) return ours;
    // 文件末尾的换行单独决定：编辑器的序列化从不以换行结尾，所以 base 与 theirs 末尾一样时沿用原文的，编辑本身改了
    // 末尾（例如删光再写）才跟着编辑结果。之后各行都有换行符，按文字比较。
    const [oEnd, bEnd, tEnd] = [trailing(ours), trailing(base), trailing(theirs)];
    const finalEol = (bEnd.eol === "") === (tEnd.eol === "") ? oEnd.eol : tEnd.eol === "" ? "" : dominantEol(linesOf(ours));
    const o = linesOf(oEnd.text);
    const b = linesOf(bEnd.text);
    const t = linesOf(tEnd.text);
    const eol = dominantEol(linesOf(ours));
    const toOurs = new Map(matches(b, o));
    const toTheirs = new Map(matches(b, t));
    const out: string[] = [];
    const emitOurs = (from: number, to: number): void => {
        for (let index = from; index < to; index += 1) out.push((o[index] as Line).text + (o[index] as Line).eol);
    };
    const emitTheirs = (from: number, to: number): void => {
        for (let index = from; index < to; index += 1) {
            const line = t[index] as Line;
            out.push(line.text + (index === t.length - 1 ? "" : eol));
        }
    };
    const equalSlices = (left: ReadonlyArray<Line>, from: number, to: number, right: ReadonlyArray<Line>, rFrom: number, rTo: number): boolean => {
        if (to - from !== rTo - rFrom) return false;
        for (let index = 0; index < to - from; index += 1) if (!same(left[from + index] as Line, right[rFrom + index] as Line)) return false;
        return true;
    };
    // 走 base：两边都对上的行是稳定点，稳定点之间是一个区域，按“谁改了”取舍。
    let bi = 0;
    let oi = 0;
    let ti = 0;
    for (let index = 0; index <= b.length; index += 1) {
        const stable = index === b.length || (toOurs.has(index) && toTheirs.has(index));
        if (!stable) continue;
        const oEnd = index === b.length ? o.length : (toOurs.get(index) as number);
        const tEnd = index === b.length ? t.length : (toTheirs.get(index) as number);
        // 稳定点之前的区域：base[bi, index)、ours[oi, oEnd)、theirs[ti, tEnd)。
        if (equalSlices(b, bi, index, t, ti, tEnd)) emitOurs(oi, oEnd);
        else if (equalSlices(b, bi, index, o, oi, oEnd)) emitTheirs(ti, tEnd);
        else emitTheirs(ti, tEnd);
        if (index === b.length) break;
        // 稳定行本身：原文的字节。
        emitOurs(oEnd, oEnd + 1);
        bi = index + 1;
        oi = oEnd + 1;
        ti = tEnd + 1;
    }
    return trimJoin(out, eol) + finalEol;
}

/**
 * 各段已经带着各自的换行符；原文的最后一行没有换行，却可能被放到中间（编辑在它后面加了行）：补上主导换行符。
 */
function trimJoin(parts: ReadonlyArray<string>, eol: string): string {
    return parts.map((part, index) => (index < parts.length - 1 && !part.endsWith("\n") ? part + eol : part)).join("");
}

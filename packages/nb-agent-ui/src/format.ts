/**
 * 界面上几处共用的小格式：角色行的时刻、折叠行露出的第一行。Markdown 来源的折叠行（思考、提醒）用 `markdownPreviewLine`
 * 或宿主注入的 `markdownPreview`；`firstLine` 只取原文第一行（原始视图、排队消息）。
 */
import type {AgentLocale} from "./types";

/** 24 小时制的时:分:秒，按界面语言。 */
export function formatClock(timestamp: number, locale: AgentLocale): string {
    return new Intl.DateTimeFormat(locale, {hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false}).format(timestamp);
}

const DAY_MS = 86_400_000;

/** 本地时区的日历日序号：先取年月日再按 UTC 折成天数，夏令时那天的 23 或 25 小时不会把日子算错。 */
export function localDayIndex(timestamp: number): number {
    const date = new Date(timestamp);
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
}

/**
 * 会话列表的时间（Spec“会话列表”）：与 `now` 同一天写时刻，前一天写“昨天”，同一年写月日，否则加上年。按本地时区的
 * 日历日比较；`timestamp` 晚于 `now`（多机时钟差）时按同一天写。
 */
export function formatListTime(timestamp: number, now: number, locale: AgentLocale): string {
    const days = localDayIndex(now) - localDayIndex(timestamp);
    if (days <= 0) return new Intl.DateTimeFormat(locale, {hour: "2-digit", minute: "2-digit", hour12: false}).format(timestamp);
    if (days === 1) return new Intl.RelativeTimeFormat(locale, {numeric: "auto"}).format(-1, "day");
    const sameYear = new Date(timestamp).getFullYear() === new Date(now).getFullYear();
    return new Intl.DateTimeFormat(locale, sameYear ? {month: "short", day: "numeric"} : {year: "numeric", month: "short", day: "numeric"}).format(timestamp);
}

/** 去掉首尾空白后的第一行，原样；原始视图与排队消息（用户的纯文字）只露出它。 */
export function firstLine(text: string): string {
    return text.trim().split("\n", 1)[0] ?? "";
}

// ─── Markdown 预览行 ─────────────────────────────────────────────────────

const FENCE = /^\s*(```|~~~)/u;
const THEMATIC_BREAK = /^\s*([-*_])(\s*\1){2,}\s*$/u;
const TABLE_ROW = /^\s*\|.*\|\s*$/u;
/** 行首的块标记，后面必须跟空白：`#伏笔`、`*注：`、`-5℃` 不算。可以叠着写，例如 `> - [x] 完成`。 */
const BLOCK_MARKER = /^\s*(?:#{1,6}|>|[-*+]|\d{1,9}[.)]|\[[ xX]\])\s+/u;
const HEADING_CLOSE = /\s+#+\s*$/u;
/** 反斜杠转义的 Markdown 符号；先换成私用区占位，最后还原，免得被当成标记。 */
const ESCAPE = /\\([\\`*_{}[\]()#+\-.!|~=<>])/gu;
const PLACEHOLDER_BASE = 0xe000;

/** 预览只显示一行且会被截断；只处理开头这么多字，一大段不换行的思考在流式中每次重算也不会变慢。 */
const PREVIEW_SCAN_LIMIT = 400;
/** 行内 HTML 只去常见的排版标签与带连字符的自定义标签（`<system-reminder>`）；`Promise<void>` 这类没加反引号的泛型保留。 */
const INLINE_TAG = /<\/?(?:b|i|u|s|em|strong|mark|del|ins|sub|sup|small|span|code|kbd|br|[a-z][a-z0-9]*-[a-z0-9-]*)(?:\s[^<>]*)?\/?>/giu;

/**
 * Markdown 文字折叠时露出的一行纯文字（Spec“分轮视图”的思考预览）：第一行去完标记仍非空的正文，去掉块标记与常见的行内标记。
 *
 * 不做完整解析：展开后由宿主的 Markdown 显示全文，这里让预览与展开后看到的文字一致、不露出 `**` 之类的符号；方言写法由
 * 宿主经 `markdownPreview` 自己决定。强调按 CommonMark 的左右侧规则近似：
 * - 反斜杠转义、行内代码与裸 URL 先换成占位，里面的符号原样，两侧的强调与链接照常配对；
 * - 首尾相接的粗体小标题（`**A****B**`，真实模型的思考摘要这样写）只留第一段；单独的 `****`（打码、掩码）是文字；
 * - `*` 可以夹在字里（`他的*钥匙*`、`2*3*4` 在 CommonMark 里都是强调），只要求内侧紧贴文字，`2 * 3 * 4` 不动；
 * - `_`、`__` 要求外侧是空白、标点或行首行尾，`snake_case`、`读取_章节_摘要` 不动（不用 `\b`：它把汉字当非词字符）；
 *   路径里的 `/__fixtures__/` 在 CommonMark 里同样是粗体，展开后也是，这里不另作例外；
 * - 流式生成时行首没有收尾、行尾只到一半的标记去掉。
 */
export function markdownPreviewLine(text: string): string {
    const stash: string[] = [];
    const hold = (value: string): string => {
        stash.push(value);
        return String.fromCharCode(PLACEHOLDER_BASE + stash.length - 1);
    };
    const escaped = text.replace(ESCAPE, (_, char: string) => hold(char));
    for (const candidate of escaped.split("\n")) {
        if (candidate.trim() === "" || FENCE.test(candidate) || THEMATIC_BREAK.test(candidate) || TABLE_ROW.test(candidate)) continue;
        let body = candidate.slice(0, PREVIEW_SCAN_LIMIT);
        if (/^\s*#{1,6}\s/u.test(body)) body = body.replace(HEADING_CLOSE, "");
        while (BLOCK_MARKER.test(body)) body = body.replace(BLOCK_MARKER, "");
        body = body.replace(/(`+)([^`]*?)\1/gu, (_, __: string, code: string) => hold(code));
        // 裸 URL 由 GFM 识别成链接、下划线原样；尖括号自动链接与 `](url)` 的地址留给下面的链接规则。
        body = body.replace(/(?<![<(])https?:\/\/[^\s<>()]+/gu, hold);
        const plain = stripInline(body)
            .replace(/[-]/gu, (char) => stash[char.charCodeAt(0) - PLACEHOLDER_BASE] ?? char)
            .replace(/\s+/gu, " ")
            .trim();
        // 只剩标记符号的一行（流式刚写出开头的 `**`）不是正文，往下找。
        if (!/^[*_~=]*$/u.test(plain)) return plain;
    }
    return "";
}

function stripInline(text: string): string {
    const headings = /^(.*?\*\*(?=[^\s*])[^*]*?[^\s*]\*\*)\*\*(?=[^\s*])/u.exec(text);
    let plain = (headings === null ? text : headings[1]!)
        .replace(/!\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/gu, "$1")
        .replace(/\[([^\]]+)\]\((?:[^()]|\([^()]*\))*\)/gu, "$1")
        .replace(/<((?:https?|mailto):[^>\s]+)>/gu, "$1")
        .replace(INLINE_TAG, "");
    // 成对的标记可以互相嵌套（`~~**x**~~`），一遍只去得掉内侧不贴着别的标记的那层。
    for (let pass = 0; pass < 3; pass += 1) plain = plain.replace(/(\*\*\*|\*\*|~~|==)(?=[^\s*~=])([^]*?[^\s*~=])\1/gu, "$2");
    return plain
        // 流式中只到了一半：开头的 `**`、`__` 在这一行里没有收尾时去掉，免得被下一步当成单个强调的开头。
        .replace(/^(\*{2,3}|__)(?=\S)(?![^]*?\S\1)/u, "")
        .replace(/(?<!\*)\*(?=[^\s*])([^]*?[^\s*])\*(?!\*)/gu, "$1")
        .replace(/(^|[\s\p{P}\p{S}])(__|_)(?=[^\s_])([^]*?[^\s_])\2(?=$|[\s\p{P}\p{S}])/gu, "$1$3")
        // 行尾落单的强调符号（流式中收尾的标记只到了一半）；前面也是标记符号的（`key=****`）是文字。
        .replace(/(?<=[^\s*_~=])(\*{1,3}|__|~~|==)$/u, "");
}

/**
 * 按天的分隔线写什么（ui/agent-conversation-view.md 的“分轮视图”）：`today` 是 `now` 的日序号。与它同一天（晚于它的，多机时钟差，
 * 也算）是今天，前一天是昨天，同一年写月日，否则加上年。今天、昨天的字由调用方从语言包取：线上的字单独成行，英文要首字母大写
 * （Today），`Intl.RelativeTimeFormat` 给的是句中写法（today），会话列表的时间列用的那个。
 */
export function dayDividerLabel(timestamp: number, today: number, locale: AgentLocale): {readonly kind: "today" | "yesterday"} | {readonly kind: "date"; readonly text: string} {
    const days = today - localDayIndex(timestamp);
    if (days <= 0) return {kind: "today"};
    if (days === 1) return {kind: "yesterday"};
    const sameYear = new Date(timestamp).getFullYear() === new Date(today * DAY_MS).getUTCFullYear();
    return {kind: "date", text: new Intl.DateTimeFormat(locale, sameYear ? {month: "short", day: "numeric"} : {year: "numeric", month: "short", day: "numeric"}).format(timestamp)};
}

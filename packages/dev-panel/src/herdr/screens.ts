import type {HerdrExplain} from "./client.js";

/**
 * 能不能往一格 Agent 的输入框里投一行文字（t11 通知与会话页的文字）：只认“认出空的输入框、此外没有别的界面”这一种，
 * 其余一律不可投，不分认不认得出（设计审查 B1）。herdr 认不出的确认界面会一直显示 idle，`agent.prompt` 照样粘贴加回车，
 * 所以不能用黑名单。判据来自 S0 对真实 claude 2.1.296 与 omp 的取样（`tests/fixtures/screens.json`）；它们升级后界面变了，
 * 这里认不出就判不可投，宁可漏投。纯函数，不调 herdr。
 */

export type Deliverability =
    | {ok: true}
    | {ok: false; reason: DeliverabilityReason; detail: string};

export type DeliverabilityReason =
    | "rule_missing"         // 检测清单里没有 live_prompt_box 这条规则了（清单会远程更新）
    | "not_prompt_box"       // herdr 命中的不是输入框（确认界面、选单、详细记录等）
    | "fallback"             // herdr 一条规则都没命中，靠退路判的状态
    | "input_not_empty"      // 输入框里有字（开发者打了一半）
    | "cross_check_mismatch" // herdr 的预览与屏幕上的输入框对不上
    | "unknown_screen"       // 屏幕的样子认不出
    | "agent_unsupported";   // 没有取样过的 Agent 种类

/** 一个 SGR 序列：`ESC [ 参数 m`（参数里可以有冒号写法的子参数）。 */
const SGR = /\x1b\[([0-9;:]*)m/gu;
/** 其它控制序列（光标移动等）与回车，判断文字时丢掉。 */
const OTHER_ESCAPES = /\x1b\[[0-9;?]*[A-Za-ln-z]|\x1b[()][0-9A-Za-z]|\r/gu;

function plain(line: string): string {
    return line.replace(SGR, "").replace(OTHER_ESCAPES, "");
}

/**
 * 一个 SGR 序列之后“暗色”是开是关。按标准逐个参数读：`38`、`48`、`58`（前景、背景、下划线颜色）后面的 `5;n` 或 `2;r;g;b`
 * 是颜色的值，整段跳过；冒号写法（`38:2::r:g:b`）本身就是一个参数，也跳过。只有独立的 `2` 才开暗色，`22` 与 `0`（含空参数）关。
 * 把颜色值里的 `2` 当成暗色，带 RGB 颜色的输入（Claude 给 `ultrathink` 上的彩虹色）就会被当成占位文字（t11 实现审查第 1 条）。
 */
export function applySgr(params: string, dim: boolean): boolean {
    const list = params === "" ? [""] : params.split(";");
    for (let index = 0; index < list.length; index += 1) {
        const param = list[index]!;
        if (param.includes(":")) continue;
        const code = param === "" ? 0 : Number(param);
        if (code === 38 || code === 48 || code === 58) {
            const mode = list[index + 1];
            if (mode === "5") index += 2;
            else if (mode === "2") index += 4;
            continue;
        }
        if (code === 2) dim = true;
        else if (code === 0 || code === 22) dim = false;
    }
    return dim;
}

/** 把一行带 SGR 的文字拆成（文字，是否暗色）段。 */
function segments(line: string): Array<{text: string; dim: boolean}> {
    const parts: Array<{text: string; dim: boolean}> = [];
    let dim = false;
    let last = 0;
    const source = line.replace(OTHER_ESCAPES, "");
    for (const match of source.matchAll(SGR)) {
        if (match.index! > last) parts.push({text: source.slice(last, match.index), dim});
        dim = applySgr(match[1]!, dim);
        last = match.index! + match[0].length;
    }
    if (last < source.length) parts.push({text: source.slice(last), dim});
    return parts;
}

/** 去掉提示符与空白（含不换行空格）之后的文字。 */
const squeeze = (text: string) => text.replace(/[❯\s ]/gu, "");
/**
 * 输入框上下的横线。带会话名的 Claude 会话（2.1.316 起取样到）把名字写在上沿横线的右端：`──── nbook-agent ─`，
 * 只认纯横线时这种会话全判成认不出、一次也不自动投（t19）。名字前面要有一长段横线，后面再收一小段横线。
 */
const isRule = (line: string) => /^[─━]{10,}(?:\s+\S.*?\s+[─━]+)?$/u.test(plain(line).trim());

/**
 * `❯` 之后的输入框是不是“空”：去掉空白之后，只允许什么都没有，或者紧跟在 `❯` 后面的一整段暗色文字（占位或建议文字，
 * S0 实测刚起来的 Claude 就有）。暗色之前或之后再有任何不暗的字，或者出现第二段暗色，都算开发者打了字。
 */
function promptIsEmpty(rest: ReadonlyArray<{text: string; dim: boolean}>): boolean {
    let stage: "before" | "dim" | "after" = "before";
    for (const part of rest) {
        const visible = squeeze(part.text) !== "";
        if (!visible) {
            if (stage === "dim" && !part.dim) stage = "after";
            continue;
        }
        if (!part.dim) return false;
        if (stage === "after") return false;
        stage = "dim";
    }
    return true;
}

/**
 * Claude：herdr 的 `agent.explain` 为准，屏幕只做交叉核对。
 * - 命中的规则必须是 `live_prompt_box`、没有退路，且清单里还有这条规则；
 * - 屏幕上两条横线之间、以 `❯` 开头的那一行，`❯` 之后是空的，或者只有紧跟着的一整段暗色文字（见 `promptIsEmpty`）；
 * - herdr 的区域预览与这一行 `❯` 之后的全部文字一致。
 */
function judgeClaude(explain: HerdrExplain, visibleAnsi: string): Deliverability {
    if (explain.livePromptBoxPreview === null) return {ok: false, reason: "rule_missing", detail: "检测清单里没有 live_prompt_box"};
    if (explain.fallbackReason !== null) return {ok: false, reason: "fallback", detail: `herdr 没认出这块屏幕（${explain.fallbackReason}）`};
    if (explain.matchedRule !== "live_prompt_box") return {ok: false, reason: "not_prompt_box", detail: `herdr 认出的是 ${explain.matchedRule ?? "（无）"}，不是输入框`};
    const lines = visibleAnsi.split("\n");
    let promptLine: string | null = null;
    for (let index = lines.length - 2; index >= 1; index -= 1) {
        if (plain(lines[index]!).trimStart().startsWith("❯") && isRule(lines[index - 1]!) && isRule(lines[index + 1]!)) {
            promptLine = lines[index]!;
            break;
        }
    }
    if (promptLine === null) return {ok: false, reason: "unknown_screen", detail: "屏幕上找不到夹在两条横线之间的输入框"};
    const after = segments(promptLine).map((part) => ({...part}));
    // 去掉 ❯ 以及它之前的部分。
    let seen = false;
    const rest: Array<{text: string; dim: boolean}> = [];
    for (const part of after) {
        if (seen) {
            rest.push(part);
            continue;
        }
        const at = part.text.indexOf("❯");
        if (at >= 0) {
            seen = true;
            rest.push({text: part.text.slice(at + 1), dim: part.dim});
        }
    }
    if (!promptIsEmpty(rest)) return {ok: false, reason: "input_not_empty", detail: "输入框里有字"};
    const shown = squeeze(rest.map((part) => part.text).join(""));
    if (squeeze(explain.livePromptBoxPreview) !== shown) {
        return {ok: false, reason: "cross_check_mismatch", detail: "herdr 的区域预览与屏幕上的输入框对不上"};
    }
    return {ok: true};
}

/**
 * omp：herdr 没有它的检测清单（`screen_detection_skipped`，状态靠扩展自报），只能看屏幕。S0 取样的空输入框：
 * 最后一个非空行是编辑框的底边 `╰─`，后面没有字；它上面一行是状态栏（` π > …`）。打了字、打开命令表时都不是这个样子。
 */
function judgeOmp(visibleAnsi: string): Deliverability {
    const lines = visibleAnsi.split("\n").map((line) => plain(line).replace(/\s+$/u, "")).filter((line) => line !== "");
    const last = lines.at(-1) ?? "";
    const above = lines.at(-2) ?? "";
    if (/^╰─/u.test(last) && last.replace(/^╰─/u, "").trim() !== "") return {ok: false, reason: "input_not_empty", detail: "输入框里有字"};
    if (!/^╰─\s*$/u.test(last) || !/^\s*π\s+>/u.test(above)) return {ok: false, reason: "unknown_screen", detail: "屏幕末尾不是 omp 的空编辑框"};
    return {ok: true};
}

export function judgeDeliverable(input: {agent: string | null; explain: HerdrExplain | null; visibleAnsi: string}): Deliverability {
    if (input.agent === "claude") {
        if (!input.explain) return {ok: false, reason: "rule_missing", detail: "没有拿到 agent.explain"};
        return judgeClaude(input.explain, input.visibleAnsi);
    }
    if (input.agent === "omp") return judgeOmp(input.visibleAnsi);
    return {ok: false, reason: "agent_unsupported", detail: `没有取样过 ${input.agent ?? "（未知）"} 的界面`};
}

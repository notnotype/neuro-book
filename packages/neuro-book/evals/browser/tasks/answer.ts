/**
 * 回答的格式与比对。任务原文统一要求：要回答的题在最后单独写一行“答案：……”，按题目给的格式；
 * 做不到时以“无法完成：”开头说明原因。比对先做 NFKC（全角转半角），所以全角的冒号、分号、数字都认。
 */

/** 每道题的原文都接上这一段，两边看到的一样。 */
export const ANSWER_RULE = "做完后用一两句话说明结果。题目要你回答时，在回答的最后单独写一行“答案：……”，按题目给的格式；做不到时，回答以“无法完成：”开头并说明原因，不要编造。";

/** 去掉行首的列表符号、引用符号与 Markdown 强调，再去两端空白。 */
function bare(line: string): string {
    return line.normalize("NFKC").replace(/^\s*(?:>\s*)*(?:[-*•]|\d+[.)、])?\s*/u, "").replace(/[*_`]+/gu, "").trim();
}

/** 取最后一个“答案：”行冒号后的文字（NFKC 之后的形式：全角标点与数字已成半角）；没有这样的行为 null。 */
export function parseAnswer(finalAnswer: string | null): string | null {
    if (finalAnswer === null) return null;
    const lines = finalAnswer.split(/\r?\n/u);
    for (let i = lines.length - 1; i >= 0; i--) {
        const match = /^答案\s*:\s*(.*)$/u.exec(bare(lines[i] as string));
        if (match !== null) return (match[1] as string).trim();
    }
    return null;
}

/** 回答是不是以“无法完成：”开头（前面可以有空白与强调符号），而且后面写了原因（同一行或下一行都行）。 */
export function reportsUnable(finalAnswer: string | null): boolean {
    if (finalAnswer === null) return false;
    const lines = finalAnswer.split(/\r?\n/u).map(bare);
    const first = lines.findIndex((line) => line !== "");
    const match = first === -1 ? null : /^无法完成\s*:(.*)$/u.exec(lines[first] as string);
    if (match === null) return false;
    return [match[1] as string, ...lines.slice(first + 1)].some((line) => line.trim() !== "");
}

/** 按分号（全角或半角）拆开几项。 */
export function answerParts(answer: string | null): string[] {
    if (answer === null) return [];
    return answer.normalize("NFKC").split(";").map((part) => part.trim());
}

/** 书名比对用的形式：去掉书名号、引号与空白。 */
export function titleKey(text: string): string {
    return text.normalize("NFKC").replace(/[《》<>"'“”‘’「」\s]/gu, "");
}

/** 读一个数：去掉千分位、空白与题目声明的单位；读不出为 null。 */
export function parseNumber(text: string | undefined, units: readonly string[] = []): number | null {
    if (text === undefined) return null;
    let value = text.normalize("NFKC").replace(/[,\s]/gu, "");
    for (const unit of units) value = value.split(unit.normalize("NFKC")).join("");
    if (!/^-?\d+(?:\.\d+)?$/u.test(value)) return null;
    return Number(value);
}

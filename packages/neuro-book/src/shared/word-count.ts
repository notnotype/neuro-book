/**
 * 写作字数（docs/specs/workbench/editor.md 输出 27）：编辑器状态栏的字数与书架的作品统计共用这一个算法。
 *
 * - 汉字、假名、谚文每字计 1；
 * - 连续的拉丁字母与数字计 1 个词，中间可夹 `'`、`’`、`-`（`don't`、`well-known` 各算一个词）；
 * - 标点、空白与 Markdown 标记不计（标记本身多是标点；链接地址里的字母会计入，第一版不剥离）；
 * - 开头的 YAML frontmatter 不计。
 */

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
const WORD = /[\p{Script=Latin}\p{Nd}]+(?:['’-][\p{Script=Latin}\p{Nd}]+)*/gu;

export function countWords(text: string): number {
    const body = text.replace(FRONTMATTER, "");
    // 先数中日韩的字，再把它们换成空格数拉丁词：两类紧挨着时（“第3章”）不会被当成一个词。
    let count = 0;
    const latin = body.replace(CJK, () => {
        count += 1;
        return " ";
    });
    for (const _ of latin.matchAll(WORD)) count += 1;
    return count;
}

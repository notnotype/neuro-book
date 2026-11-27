import {describe, expect, test} from "bun:test";

import {secrecyBook, TARGET, type SecrecyBook} from "../../testing/brief-world";
import * as fixed from "./fixed";
import {composeBrief, type BriefResult} from "./index";

/**
 * 简报保密的种子网（docs/specs/plot/brief.md 输出 4、5、7、8、9、13、16）：逐条用例只守得住想到的路径，这里按种子随机造书，
 * 用生成器记下的真值按 Spec 判。份内的段按那一份的真值判；共同的段（写作指示、称谓两栏）要每一份都允许。称谓左栏是叙述用的
 * 称呼，视角人物认得他且揭穿给了写手时可以写本名（开发者 2026-11-10 定）：揭穿给了写手正是本名的条件，所以左栏与别的段同样判；
 * 一行“马甲 = 本名”就是那条揭穿，要那组揭穿在每一份都给了内容。
 */

const SEEDS = Array.from({length: 40}, (_, index) => index + 1);
const digest = (text: string) => `sha:${String(text.length)}:${text.slice(0, 8)}`;
const RAW = ["<Ref", "<Image", "<V ", "<If", '{"', "[object Object]"];
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const sectionText = (result: BriefResult, part: number, key: string) => result.parts[part]!.sections.find((s) => s.key === key)?.items.map((item) => item.text).join("\n") ?? "";

/** 一本书的全部违规，每条带种子与位置。 */
function violations(seed: number, book: SecrecyBook, result: BriefResult): string[] {
    const problems: string[] = [];
    const partText = result.parts.map((part) => part.sections.filter((s) => s.key !== "address").map((s) => s.items.map((item) => item.text).join("\n")).join("\n"));
    const secrets = result.parts.map((_part, index) => sectionText(result, index, "secrets"));
    const lines = sectionText(result, 0, "address").split("\n").filter((line) => line.includes(" = ")).map((line) => ({left: line.slice(0, line.indexOf(" = ")), right: line.slice(line.indexOf(" = ") + 3)}));
    const instructionText = result.common.filter((s) => s.key === "instruction").map((s) => s.items.map((item) => item.text).join("\n")).join("\n");
    const common = [instructionText, ...lines.map((line) => line.right), ...lines.map((line) => line.left)].join("\n");
    const satisfied = (part: number, needed: readonly string[]) => needed.every((name) => secrets[part]!.includes(`真相：${name}`));
    book.parts.forEach((truth, part) => {
        for (const name of truth.hidden) {
            if (partText[part]!.includes(name)) problems.push(`第 ${String(part)} 份写出了不能写的“${name}”`);
            if (common.includes(name)) problems.push(`共同的段写出了第 ${String(part)} 份不能写的“${name}”`);
        }
        for (const [name, needed] of truth.requires) {
            if (partText[part]!.includes(name) && !satisfied(part, needed)) problems.push(`第 ${String(part)} 份写出了“${name}”，秘密段却没给 ${needed.join("、")} 的真相`);
            if (common.includes(name) && !satisfied(part, needed)) problems.push(`共同的段写出了“${name}”，第 ${String(part)} 份没给 ${needed.join("、")} 的真相`);
        }
        for (const line of lines) {
            const pair = truth.pairs.get(line.left);
            if (pair === undefined || !line.right.includes(pair.body)) continue;
            if (pair.needed === null || !satisfied(part, pair.needed)) problems.push(`称谓表写出“${line.left} = ${line.right}”，第 ${String(part)} 份没给那组揭穿的内容`);
        }
    });
    const everything = [result.text, JSON.stringify(result.record), JSON.stringify(result.hints)].join("\n");
    for (const name of book.never) if (everything.includes(name)) problems.push(`写出了已删除或之后才出场的“${name}”`);
    for (const id of book.ids) if (new RegExp(`(?<![A-Za-z0-9_:])${escape(id)}(?![A-Za-z0-9_])`, "u").test(result.text)) problems.push(`上下文里有 id“${id}”`);
    for (const raw of RAW) if (result.text.includes(raw)) problems.push(`上下文里有“${raw}”`);
    return problems.map((problem) => `种子 ${String(seed)}：${problem}`);
}

describe("brief 输出 16：随机的书（种子网）", () => {
    test("40 个种子：要遮的名字只出现在允许的地方，上下文里没有 id 与语法片段；网真的走到了各种情况", () => {
        const problems: string[] = [];
        const seen = {twoParts: 0, withheldBlock: 0, hiddenItem: 0, shownTruth: 0, mask: 0, guardedDecision: 0, payoffWithheld: 0};
        for (const seed of SEEDS) {
            const book = secrecyBook(seed);
            const result = composeBrief({view: book.w.view(), chapter: TARGET, instruction: book.instruction, outline: "细纲", targetWords: 2000, pluginVersion: "test", digest});
            if (typeof result === "string") {
                problems.push(`种子 ${String(seed)}：拼不出简报（${result}）`);
                continue;
            }
            problems.push(...violations(seed, book, result));
            if (result.parts.length === 2) seen.twoParts++;
            if (result.text.includes(fixed.WITHHELD_BLOCK)) seen.withheldBlock++;
            if (result.text.includes("有一件涉及")) seen.hiddenItem++;
            if (result.text.includes("真相：")) seen.shownTruth++;
            if (/马甲\d+号/u.test(sectionText(result, 0, "people"))) seen.mask++;
            if (result.text.includes(fixed.DECISION_ABOUT_SECRET) || result.text.includes(fixed.DECISION_DUE_ABOUT_SECRET)) seen.guardedDecision++;
            if (result.hints.some((hint) => hint.code === "nbook.plot.brief.payoffWithheld")) seen.payoffWithheld++;
        }
        expect(problems).toEqual([]);
        // 网不能是空的：每种情况都要有种子走到。
        for (const [name, count] of Object.entries(seen)) expect({name, covered: count > 0}).toEqual({name, covered: true});
    }, 120_000);
});

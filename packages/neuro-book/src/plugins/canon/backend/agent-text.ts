/**
 * Agent 工具（docs/specs/canon/agent-tools.md）给模型看的文字：读取位置与版本、修订与失败怎么写成中文。纯函数，不碰世界；字数上限
 * 在这里截。条目的字段那一段在 `../shared/agent-fields.ts`（作者界面的“给 AI 看”也用它）。
 */

import type {ReadPosition, Revision} from "@notnotype/nb-canon/schema";

import {valueText} from "../shared/agent-fields";

/** 读取结果第一行的版本串：世界版本加读取输入摘要的前 12 位。`canon_write` 原样带回，解析成读取戳（输出 3）。 */
export const STAMP_INPUT_LENGTH = 12;

export function stampText(version: number, inputDigest: string): string {
    return `${String(version)}·${inputDigest.slice(0, STAMP_INPUT_LENGTH)}`;
}

/** 解析版本串；不合写法为 null。只写版本号（没有摘要）也认，这时只比版本。 */
export function parseStamp(text: string): {readonly version: number; readonly input: string | null} | null {
    const match = /^\s*(\d+)(?:\s*[·.:]\s*([0-9a-f]{4,}))?\s*$/u.exec(text);
    if (match === null) return null;
    return {version: Number(match[1]), input: match[2] ?? null};
}

/** 读取位置写成一句话：“最初”“第 3 章（ch3）末尾”。章的序号与标题由调用方查好给。 */
export function positionText(position: ReadPosition, chapter?: {readonly index: number; readonly title: string | null}): string {
    if (position.kind === "initial") return "最初";
    // 章表的 `index` 从 1 数。
    const label = chapter === undefined ? position.chapter : `第 ${String(chapter.index)} 章${chapter.title === null ? "" : `「${chapter.title}」`}（${position.chapter}）`;
    const line = position.line === undefined || position.line === "main" ? "" : `，线 ${position.line}`;
    return `${label}${position.edge === "start" ? "开头" : "末尾"}${line}`;
}

/** 截到上限：超了写明截掉了多少字，怎么读全。 */
export function clip(text: string, limit: number, more: string): string {
    if (text.length <= limit) return text;
    return `${text.slice(0, limit)}\n……（已截断，共 ${String(text.length)} 字；${more}）`;
}

/** 修订带来的变化：前 20 处值的改前改后，加套不上的变更数与待处理的增减。 */
export function impactText(impact: Revision["impact"], names: (entry: string) => string): string {
    const lines = impact.values.slice(0, 20).map((value) => `- ${names(value.at.entry)} ${value.at.path}：${valueText(value.before)} → ${valueText(value.after)}`);
    if (impact.values.length > 20) lines.push(`- 另有 ${String(impact.values.length - 20)} 处`);
    if (impact.broken.length > 0) lines.push(`- 这次让后面 ${String(impact.broken.length)} 条剧情变更套不上（进了待处理）`);
    if (impact.pendingAdded.length > 0) lines.push(`- 新出现 ${String(impact.pendingAdded.length)} 项待处理`);
    if (impact.pendingResolved.length > 0) lines.push(`- 消掉 ${String(impact.pendingResolved.length)} 项待处理`);
    return lines.join("\n");
}

/** 一条失败写成“码、为什么、该怎么改”。`op` 是第几项（从 1 数，给模型看）。 */
export function failureText(failure: {readonly code: string} & Record<string, unknown>): string {
    const at = typeof failure.op === "number" ? `第 ${String(failure.op + 1)} 项：` : "";
    switch (failure.code) {
        case "stale-read": {
            const revisions = (failure.revisions as Array<{title: string; by: {kind: string}}> | undefined) ?? [];
            const between = revisions.length === 0 ? "" : `之间的修订：${revisions.slice(0, 5).map((revision) => `“${revision.title}”（${revision.by.kind === "author" ? "作者" : revision.by.kind === "agent" ? "Agent" : revision.by.kind}）`).join("、")}。`;
            return `stale-read：你读过之后世界变了${failure.inputChanged === true ? "（读取的输入变了，例如一章讲哪条线）" : ""}。${between}用 canon_read 重读，再带新的 version 写。`;
        }
        case "version-conflict":
            return "version-conflict：要改的条目在你读过之后被改过。用 canon_read 重读再写。";
        case "value-conflict":
            return `${at}value-conflict：读到的值已经不是现在的值（现在是 ${valueText(failure.current)}）。重读再写。`;
        case "accumulated-value":
            return `${at}accumulated-value：这个值是几笔累出来的，或是有事件的语义档，不能按“改设定”直接改。改用 intent: "story" 记一笔（op: "add" 或 "note"），或用 canon_read 的 show: ["origins"] 找到那一笔再改。`;
        case "incomplete-field":
            return `${at}incomplete-field：这个字段在这个位置不完整，不能按“改设定”改。改用 intent: "story" 赋一个值。`;
        case "field-unavailable":
            return `${at}field-unavailable：这个字段在这个位置不可用（设定组没启用、去掉了、只读或类型不在）。先 addComponent，或换个位置。`;
        case "intent-not-allowed":
            return "intent-not-allowed：在最初不能记剧情变化。给 at 一个章，或改用 intent: \"setting\"。";
        case "result-mismatch":
            return `${at}result-mismatch：写进去以后读到的不是你要的值（读到 ${valueText(failure.got)}）。看一下这个字段的来历再改。`;
        case "validation-failed": {
            const problems = ((failure.problems as Array<{code: string; path?: string; op?: number; message: string; reason?: string}> | undefined) ?? []).slice(0, 5);
            return `validation-failed：${problems.map((problem) => `${problemAt(problem.path, problem.op)}${problem.code}（${PROBLEM_HINTS[problem.code] ?? problem.message}）`).join("；")}`;
        }
        case "busy":
            return "busy：有人正在独占写入。稍后再试，不要重复发。";
        case "world-read-only":
        case "write-unknown":
            return `${failure.code}：世界现在只读。告诉作者。`;
        default:
            return `${failure.code}：${typeof failure.detail === "string" ? failure.detail : "写入没有成功"}`;
    }
}

/** 问题出在第几项：定方案时的问题路径就是 `ops[N]`，发布前校验的问题对得上哪一项时带 `op`。 */
function problemAt(path: string | undefined, op?: number): string {
    const index = op ?? (path === undefined ? undefined : /^ops\[(\d+)\]$/u.exec(path)?.[1]);
    return index === undefined ? "" : `第 ${String(Number(index) + 1)} 项 `;
}

const PROBLEM_HINTS: Readonly<Record<string, string>> = {
    "element-from-change": "这一项是某章的剧情变更加的或改过的，不能按“改设定”改或去掉；改用 intent: \"story\"",
    "created-in-batch": "这一批新建的东西，初值要写在建它的那一项里",
    "duplicate-address": "同一批里两项改了同一处，合成一项",
    "op-not-in-intent": "add、note 只能在 intent: \"story\" 里用",
    "order-exhausted": "两个兄弟之间放不下了，先把别的兄弟挪开",
    "replace-not-found": "要替换的文字在当前值里没找到",
    "replace-not-unique": "要替换的文字出现了不止一次，给更长、唯一的一段",
    "type-mismatch": "值的类型不对",
    "constraint-violated": "超出了字段的范围",
    "ref-invalid": "引用的条目不存在、已删除或种类不对",
    "unknown-field": "没有这个字段",
    "fields-not-declarable": "这组设定不能在条目上加自己的字段",
    "label-taken": "这组设定里已经有一个叫这个名字的字段，换个名字；要恢复一个去掉过的同名字段，先给现在的那个改名",
    "field-fixed": "这是设定组固定的字段，不能改名、去掉",
    "field-missing": "条目上没有这个自己加的字段，或它已经是这个状态（去掉过的再去掉、没去掉的再恢复）",
    "field-referenced": "还有别的字段拿它当上限，或上限指向的字段不在；先改那个字段",
    "id-taken": "已经有了：字段的 id 已经用过（不写 id，让系统按名字生成），或这个条目已经有这组设定",
    "number-without-basis": "数要写依据，初值这一路给不了：先不写初值（字段是未知），由作者填；剧情里的变化用 intent: \"story\" 记一笔",
};

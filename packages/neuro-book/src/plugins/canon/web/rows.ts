/**
 * 把世界服务读出来的东西折成条目页各组件的行（docs/specs/canon/author-ui.md 输出 10 到 15）。组件只管画，这里决定每行写什么：
 * 值怎么显示、哪几步带“改这一笔”、变化量怎么算、依据怎么写。都是纯函数，文字经调用方给的 `text` 取。
 */

import {displayText} from "@notnotype/nb-canon";
import type {FieldDeclaration, FieldState, OriginStep, StoryChange} from "@notnotype/nb-canon";

import type {CanonOutputs, OriginItem} from "../shared/contracts";
import {changedMark} from "./positions";
import type {CanonBoundText, PlaceLabel} from "./positions";

/** 来历的一行（输出 11、14）。 */
export interface OriginRow {
    readonly key: string;
    /** 位置；初值一行为空。 */
    readonly where: string;
    readonly what: string;
    /** 依据；估计的用警告色。 */
    readonly basis?: {readonly text: string; readonly estimate: boolean};
    /** 加减的变化量，带正负号；不是加减的步没有。 */
    readonly delta?: string;
    readonly result: string;
    /** 这一步来自哪条剧情变更：行尾的“改这一笔”打开它。 */
    readonly change?: string;
    /** 核对点一行：对没对上。 */
    readonly check?: "ok" | "mismatch";
}

/** 字段表的一行（输出 12、13）。 */
export interface FieldRow {
    /** 命名空间里的路径（`<命名空间>.<字段>`）。 */
    readonly path: string;
    readonly label: string;
    /** 值与单位；未知时是“未知”。列表字段是空串，元素在 `items`。 */
    readonly display: string;
    readonly unknown: boolean;
    readonly incomplete: boolean;
    /** “第 N 章改过”这类标记。 */
    readonly mark: string | null;
    /** 列表字段：每个元素一行。 */
    readonly items?: readonly string[];
    /** 语义档：起点与之后记下的每一句（带位置），未归纳时最后写“还没归纳”（输出 13）。 */
    readonly notes?: readonly {readonly where: string; readonly text: string}[];
    readonly notReduced?: boolean;
}

/** 情节分页的一行（输出 15）。 */
export interface PlotRow {
    readonly id: string;
    readonly where: string;
    readonly text: string;
    readonly flags: readonly ("plan" | "held" | "undone")[];
    /** 它对这个条目的改动：“存款 −300”“样子 → 哥哥”。 */
    readonly patches: readonly string[];
}

/** 值的显示：未知、列表交给调用方；数带单位。 */
export function valueText(value: unknown, declaration: FieldDeclaration | undefined, text: CanonBoundText): string {
    if (value === null || value === undefined) return text("value.unknown");
    const shown = displayText(value);
    return declaration?.unit === undefined || typeof value !== "number" ? shown : `${shown} ${declaration.unit}`;
}

function signed(delta: number): string {
    const shown = Math.abs(delta).toLocaleString("en-US", {maximumFractionDigits: 4});
    return delta < 0 ? `−${shown}` : `+${shown}`;
}

function basisRow(basis: unknown, text: CanonBoundText): OriginRow["basis"] {
    if (typeof basis !== "object" || basis === null) return undefined;
    const given = basis as {kind?: string; quote?: string; note?: string};
    if (given.kind === "quote") return {text: text("origin.basisQuote", {quote: given.quote ?? ""}), estimate: false};
    if (given.kind === "estimate") return {text: text("origin.basisEstimate", {note: given.note ?? ""}), estimate: true};
    if (given.kind === "author") return {text: text("origin.basisAuthor"), estimate: false};
    if (given.kind === "derived") return {text: text("origin.basisDerived"), estimate: false};
    return undefined;
}

/** 一步之后的值；核对点不改值，没有。 */
function stepValue(step: OriginItem | Extract<OriginStep, {kind: "init"}>): {readonly value: unknown} | null {
    if (step.kind === "init") return {value: step.value};
    if (step.kind === "patch") return {value: step.result};
    if (step.kind === "carried") return {value: step.value};
    return null;
}

/**
 * 来历的各行，最近的在上，初值一行总在最后（输出 11、验收 13）。加减一步的变化量是它与更早一步的值之差：读到的最早那一步
 * 要等下一页（或读完后的初值）才算得出，还没读到时不写变化量。
 */
export function originRows(page: Pick<CanonOutputs["origins"], "items" | "initial" | "cursor">, declaration: FieldDeclaration | undefined, place: PlaceLabel, text: CanonBoundText): OriginRow[] {
    const complete = page.cursor === undefined;
    const steps: Array<OriginItem | Extract<OriginStep, {kind: "init"}>> = [...page.items, ...(page.initial !== null ? [page.initial] : [])];
    // 没读完时，读到的最早一步与初值之间还有没读的步，不能拿初值算它的变化量。
    const known = complete ? steps : page.items;
    const show = (value: unknown): string => valueText(value, declaration, text);
    return steps.map((step, index): OriginRow => {
        if (step.kind === "init") {
            return {key: "init", where: "", what: text("origin.initial"), result: show(step.value), ...(basisRow(step.basis, text) === undefined ? {} : {basis: basisRow(step.basis, text)!})};
        }
        const where = step.at === undefined ? "" : place(step.at);
        if (step.kind === "check") {
            const verdict = step.result === "mismatch" ? "mismatch" : "ok";
            const what = `${text("origin.check", {written: show(step.written)})}${step.result === "anchor" || step.result === "skipped" ? "" : `，${text(verdict === "ok" ? "origin.checkOk" : "origin.checkMismatch")}`}`;
            return {key: `check:${step.check}`, where, what, result: "", ...(step.result === "ok" || step.result === "mismatch" ? {check: verdict} : {})};
        }
        if (step.kind === "carried") return {key: `carried:${step.change}`, where, what: text("origin.carried"), result: show(step.value)};
        const value = stepValue(step)!.value;
        let delta: string | undefined;
        if (step.op === "add" && typeof value === "number") {
            const older = known.slice(index + 1).map(stepValue).find((found) => found !== null);
            if (older !== undefined && typeof older.value === "number") delta = signed(value - older.value);
        }
        const basis = basisRow(step.basis, text);
        return {key: `patch:${step.change}:${String(index)}`, where, what: step.text ?? "", result: show(value), change: step.change, ...(delta === undefined ? {} : {delta}), ...(basis === undefined ? {} : {basis})};
    });
}

/** 字段的声明：类型固定的在前，实例声明的在后（canon.components 输出 21）；按 id 查。 */
function declarationOf(declarations: readonly FieldDeclaration[], field: string): FieldDeclaration | undefined {
    return declarations.find((declaration) => declaration.id === field);
}

/**
 * 一个命名空间的字段表：按声明的顺序，声明里没有而状态里有的排在后面（显示名用状态给的）。
 */
export function fieldRows(namespace: string, fields: Readonly<Record<string, FieldState>>, declarations: readonly FieldDeclaration[], place: PlaceLabel, text: CanonBoundText): FieldRow[] {
    const ids = [...declarations.map((declaration) => declaration.id).filter((id) => id in fields), ...Object.keys(fields).filter((id) => declarationOf(declarations, id) === undefined)];
    return ids.map((field): FieldRow => {
        const state: FieldState = fields[field]!;
        const declaration = declarationOf(declarations, field);
        const unknown = state.value === null || state.value === undefined;
        const list = declaration?.kind === "list";
        const items = list && Array.isArray(state.value) ? state.value.map((item) => displayText([item])) : undefined;
        return {
            path: `${namespace}.${field}`,
            label: declaration?.label ?? state.label ?? field,
            display: list && !unknown ? "" : valueText(state.value, declaration, text),
            unknown,
            incomplete: state.incomplete !== undefined,
            mark: changedMark(state.changedAt, place, text),
            ...(items === undefined ? {} : {items}),
            ...(state.notReduced === true ? {notReduced: true} : {}),
        };
    });
}

/** 语义档的字段是否要列出“起点与之后记下的每一句”（输出 13）。 */
export function isSemantic(declaration: FieldDeclaration | undefined): boolean {
    return declaration?.precision === "semantic";
}

/** 语义档一个字段的各句：来历里从旧到新，起点（核对点）写“起点：…”，记下的每一句写那条变更的文字。 */
export function semanticNotes(page: Pick<CanonOutputs["origins"], "items">, place: PlaceLabel, text: CanonBoundText): FieldRow["notes"] {
    return [...page.items].reverse().flatMap((step) => {
        const where = step.at === undefined ? "" : place(step.at);
        if (step.kind === "check" && step.result === "anchor") return [{where, text: text("fields.anchor", {value: displayText(step.written)})}];
        if (step.kind === "patch" && step.op === "note") return [{where, text: step.text ?? ""}];
        return [];
    });
}

/** 一条补丁对这个条目的改动写成一小段：“存款 −300”“样子 → 哥哥”。 */
function patchText(patch: StoryChange["patches"][number], labelOf: (path: string) => string): string {
    const label = labelOf(patch.at.path);
    if (patch.op === "add" && typeof patch.value === "number") return `${label} ${signed(patch.value)}`;
    if (patch.op === "set") return `${label} → ${displayText(patch.value)}`;
    return label;
}

/** 情节分页的各行：只写对这个条目的改动；标记按种类与生效状态。 */
export function plotRows(items: CanonOutputs["changes"]["items"], entry: string, labelOf: (path: string) => string, place: PlaceLabel, text: CanonBoundText): PlotRow[] {
    return items.map(({change}): PlotRow => ({
        id: change.id,
        where: place(change.at),
        text: change.text,
        flags: [...(change.kind === "plan" ? ["plan" as const] : []), ...(change.status === "held" ? ["held" as const] : []), ...(change.status === "undone" ? ["undone" as const] : [])],
        patches: change.patches.filter((patch) => patch.at.entry === entry).map((patch) => patchText(patch, labelOf)),
    }));
}

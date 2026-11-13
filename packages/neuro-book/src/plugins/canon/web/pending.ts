/**
 * 待处理视图（docs/specs/canon/author-ui.md 输出 23）的一行与详情：把 `pending` 读到的一项折成 `PendingView` 的行与
 * `PendingDetail` 的内容。内核的待处理、提示两组共二十来种，加上插件诊断的发现；每种一句，写成 `text()` 的键
 * （`pending.rows.<种类>`），插件的发现写它声明的显示名（`PendingPage.labels`，没有时“插件的一项检查”）。
 *
 * 名字与位置经调用方给的 `PendingLookups` 取（宿主按 `pendingNeeds`、`pendingDetailNeeds` 读）；读不到的（还没读到，或一页
 * 超出 `NAMED_ENTRIES_MAX` 个对象）写“一条情节”这类、不写位置。纯函数。
 */

import {canonicalJson} from "@notnotype/nb-canon/schema";
import type {Address, ChangeOutcome, Check, Decision, GroupItem, ObjectRef, Occurrence, Placement, StoryChange} from "@notnotype/nb-canon/schema";

import type {CanonBoundText} from "./positions";
import {shownValue} from "./rows";

export type PendingGroup = "pending" | "hints" | "handled";
export type PendingItem = GroupItem;

export interface PendingLookups {
    /** 读到的剧情变更、核对点或决策；没读或还没读到时为 undefined。 */
    object(ref: ObjectRef): unknown;
    /** 条目在缺省位置上的名字。 */
    entryName(id: string): string | undefined;
    /** “星瑕的存款”这样的一句。 */
    address(at: Address): string;
    place(at: Placement): string;
    /** 一章写成“第 N 章”；章表里没有时写“已删除的一章”。 */
    chapter(id: string): string;
    /** 插件诊断的显示名；这一页没带时为 undefined。 */
    label(diagnostic: string): string | undefined;
    /** 剧情变更这次套没套上（套不上的原因）；没读时为 undefined。 */
    outcome(change: string): ChangeOutcome | undefined;
}

/** 详情里可以点开的对象：剧情变更开详情页，条目开条目页。 */
export type PendingTarget = {readonly kind: "change"; readonly id: string} | {readonly kind: "entry"; readonly id: string};

export interface PendingRow {
    readonly key: string;
    /** 一句是什么。 */
    readonly text: string;
    /** 它的位置；不知道时为空。 */
    readonly place: string;
}

export interface PendingSuspect {
    readonly key: string;
    readonly text: string;
    readonly place: string;
    readonly estimate: boolean;
    readonly target: PendingTarget;
    /** `init` 一项（初值）：点开的是条目页。 */
    readonly initial: boolean;
}

export interface PendingDetailModel {
    readonly title: string;
    readonly place: string;
    /** 正文写的原句；在章节正文里时带那一章，可以“打开这一章”。 */
    readonly quote: {readonly text: string; readonly chapter: string | null} | null;
    /** 几行“名目：内容”。 */
    readonly facts: readonly {readonly label: string; readonly value: string}[];
    /** 核对点不符的嫌疑，估计的在前（内核已排好）。 */
    readonly suspects: readonly PendingSuspect[];
    readonly links: readonly {readonly label: string; readonly target: PendingTarget}[];
}

/** 会随世界变而变、认不出“同一条”的字段：算出来的数、嫌疑、跟着套不上的、原因、次数。 */
const VOLATILE = new Set(["computed", "written", "suspects", "changes", "reason", "count"]);

const stable = (value: object): string => canonicalJson(Object.fromEntries(Object.entries(value).filter(([key]) => !VOLATILE.has(key))));

/** 一条的键：选中与“消失了选下一条”都用它，世界变了以后同一条的键不变。 */
export function pendingKey(item: PendingItem): string {
    if (item.kind === "canon") return `canon:${stable(item.item)}`;
    if (item.kind === "hint") return `hint:${stable(item.hint)}`;
    return `finding:${item.diagnostic}:${canonicalJson(item.finding.key)}`;
}

/** 要读的对象与要读名字的条目。 */
export interface PendingNeeds {
    readonly refs: readonly ObjectRef[];
    readonly entries: readonly string[];
}

const change = (id: string): ObjectRef => ({kind: "change", id});
const readable = (ref: ObjectRef): boolean => ref.kind === "change" || ref.kind === "check" || ref.kind === "decision";

/** 一行要读的：它说的那个对象（名字与位置），地址里的条目。 */
export function pendingNeeds(item: PendingItem): PendingNeeds {
    if (item.kind === "finding") return {refs: [], entries: []};
    if (item.kind === "hint") {
        const hint = item.hint;
        if (hint.code === "component-unknown" || hint.code === "component-version-unsupported") return {refs: [], entries: [hint.entry]};
        if ("owner" in hint) return hint.owner.kind === "entry" ? {refs: [], entries: [hint.owner.id]} : {refs: readable(hint.owner) ? [hint.owner] : [], entries: []};
        return {refs: [], entries: []};
    }
    const canon = item.item;
    switch (canon.kind) {
        case "check-mismatch": return {refs: [{kind: "check", id: canon.check}], entries: [canon.at.entry]};
        case "cannot-apply": return {refs: [change(canon.root)], entries: []};
        case "held":
        case "time-invalid":
        case "time-placement-mismatch":
        case "fork-time-mismatch": return {refs: [change(canon.change)], entries: []};
        case "time-conflict": return {refs: canon.changes.slice(0, 1).map(change), entries: []};
        default: return canon.ref.kind === "entry" ? {refs: [], entries: [canon.ref.id]} : {refs: readable(canon.ref) ? [canon.ref] : [], entries: []};
    }
}

/** 选中那一条的详情另要读的：嫌疑的各笔、处理它的决策、发现指向的对象、时间矛盾的各条。 */
export function pendingDetailNeeds(item: PendingItem): PendingNeeds {
    const row = pendingNeeds(item);
    const refs = [...row.refs];
    const entries = [...row.entries];
    if (item.kind === "finding") {
        for (const ref of item.finding.objects) {
            if (ref.kind === "entry") entries.push(ref.id);
            else if (readable(ref)) refs.push(ref);
        }
        for (const decision of [item.handledBy, item.earlierDecision]) if (decision !== undefined) refs.push({kind: "decision", id: decision});
    }
    if (item.kind === "canon" && item.item.kind === "check-mismatch") for (const id of item.item.suspects) if (id !== "init") refs.push(change(id));
    if (item.kind === "canon" && item.item.kind === "time-conflict") refs.push(...item.item.changes.slice(1).map(change));
    return {refs, entries};
}

type Bound = CanonBoundText;

function storyChange(lookups: PendingLookups, id: string): StoryChange | undefined {
    return lookups.object(change(id)) as StoryChange | undefined;
}

/** 一个对象写成一小段：剧情变更写它的文字，别的写种类，条目写名字。 */
function what(ref: ObjectRef, lookups: PendingLookups, text: Bound): string {
    if (ref.kind === "change") {
        const found = storyChange(lookups, ref.id);
        return found === undefined ? text("pending.what.someChange") : text("pending.what.change", {text: found.text});
    }
    if (ref.kind === "entry") return lookups.entryName(ref.id) ?? text("names.someEntry");
    if (ref.kind === "check") return text("pending.what.check");
    if (ref.kind === "decision") return text("pending.what.decision");
    return text("pending.what.suggestion");
}

/** 一个对象的位置：剧情变更与核对点的安放；别的没有位置。 */
function placeOf(ref: ObjectRef, lookups: PendingLookups): string {
    if (ref.kind === "change") {
        const found = storyChange(lookups, ref.id);
        return found === undefined ? "" : lookups.place(found.at);
    }
    if (ref.kind === "check") {
        const found = lookups.object(ref) as Check | undefined;
        return found === undefined ? "" : lookups.place(found.place);
    }
    return "";
}

function occurrenceText(occurrence: Occurrence, lookups: PendingLookups, text: Bound): string {
    return text("pending.paragraph", {chapter: lookups.chapter(occurrence.chapter), paragraph: occurrence.paragraph});
}

function diagnosticLabel(diagnostic: string, lookups: PendingLookups, text: Bound): string {
    return lookups.label(diagnostic) ?? text("pending.pluginCheck");
}

export function pendingRow(item: PendingItem, lookups: PendingLookups, text: Bound): PendingRow {
    const key = pendingKey(item);
    if (item.kind === "finding") {
        const at = item.finding.at;
        const place = item.occurrence !== undefined ? occurrenceText(item.occurrence, lookups, text) : at?.kind === "placement" ? lookups.place(at.placement) : "";
        return {key, text: diagnosticLabel(item.diagnostic, lookups, text), place};
    }
    if (item.kind === "hint") {
        const hint = item.hint;
        switch (hint.code) {
            case "component-unknown":
            case "component-version-unsupported":
                return {key, text: text(`pending.rows.${hint.code}`, {entry: lookups.entryName(hint.entry) ?? text("names.someEntry")}), place: ""};
            case "diagnostic-duplicate-key":
                return {key, text: text("pending.rows.diagnostic-duplicate-key", {label: diagnosticLabel(hint.diagnostic, lookups, text)}), place: ""};
            case "binder-line-planned":
            case "binder-line-ended":
                return {key, text: text(`pending.rows.${hint.code}`, {chapter: lookups.chapter(hint.chapter)}), place: lookups.chapter(hint.chapter)};
            case "duplicate-quote":
                return {key, text: text("pending.rows.duplicate-quote", {what: what(hint.owner, lookups, text), count: hint.count}), place: placeOf(hint.owner, lookups)};
            default:
                return {key, text: text(`pending.rows.${hint.code}`, {what: what(hint.owner, lookups, text)}), place: placeOf(hint.owner, lookups)};
        }
    }
    const canon = item.item;
    switch (canon.kind) {
        case "check-mismatch":
            return {key, text: text("pending.rows.check-mismatch", {address: lookups.address(canon.at), written: shownValue(canon.written, text), computed: shownValue(canon.computed, text)}), place: placeOf({kind: "check", id: canon.check}, lookups)};
        case "cannot-apply":
            return {key, text: text("pending.rows.cannot-apply", {what: what(change(canon.root), lookups, text)}), place: placeOf(change(canon.root), lookups)};
        case "time-conflict": {
            const first = canon.changes[0];
            return {key, text: text("pending.rows.time-conflict", {count: canon.changes.length}), place: first === undefined ? "" : placeOf(change(first), lookups)};
        }
        case "held":
        case "time-invalid":
        case "time-placement-mismatch":
        case "fork-time-mismatch":
            return {key, text: text(`pending.rows.${canon.kind}`, {what: what(change(canon.change), lookups, text)}), place: placeOf(change(canon.change), lookups)};
        case "chapter-deleted":
            // 安放的章已经不在章表里：没有位置可写。
            return {key, text: text("pending.rows.chapter-deleted", {what: what(canon.ref, lookups, text)}), place: ""};
        default:
            return {key, text: text(`pending.rows.${canon.kind}`, {what: what(canon.ref, lookups, text)}), place: placeOf(canon.ref, lookups)};
    }
}

/** 一个对象能点开的话给一个链接：剧情变更开详情页，条目开条目页；核对点、决策没有自己的页面。 */
function linkTo(ref: ObjectRef, lookups: PendingLookups, text: Bound): {readonly label: string; readonly target: PendingTarget} | null {
    if (ref.kind === "change") return {label: what(ref, lookups, text), target: {kind: "change", id: ref.id}};
    if (ref.kind === "entry") return {label: what(ref, lookups, text), target: {kind: "entry", id: ref.id}};
    return null;
}

const present = <T>(value: T | null): value is T => value !== null;

/** 一条剧情变更的第一句原句：在章节正文里的带那一章。 */
function firstQuote(found: StoryChange | undefined): PendingDetailModel["quote"] {
    const telling = found?.told.find((item) => item.quote !== undefined);
    return telling?.quote === undefined ? null : {text: telling.quote, chapter: telling.source === "chapter" ? telling.chapter ?? null : null};
}

function decisionText(lookups: PendingLookups, id: string): string | undefined {
    const decision = lookups.object({kind: "decision", id}) as Decision | undefined;
    return decision === undefined ? undefined : decision.conclusion ?? decision.text;
}

function hasEstimate(found: StoryChange): boolean {
    return found.patches.some((patch) => (patch as {readonly basis?: {readonly kind?: string}}).basis?.kind === "estimate");
}

export function pendingDetail(item: PendingItem, lookups: PendingLookups, text: Bound): PendingDetailModel {
    const row = pendingRow(item, lookups, text);
    const base = {title: row.text, place: row.place, quote: null, facts: [], suspects: [], links: []};
    if (item.kind === "finding") {
        const facts: {label: string; value: string}[] = [];
        const handled = item.handledBy === undefined ? undefined : decisionText(lookups, item.handledBy);
        if (handled !== undefined) facts.push({label: text("pending.detail.decision"), value: handled});
        const earlier = item.earlierDecision === undefined ? undefined : decisionText(lookups, item.earlierDecision);
        if (earlier !== undefined) facts.push({label: text("pending.detail.earlierDecision"), value: earlier});
        return {...base, facts, links: item.finding.objects.map((ref) => linkTo(ref, lookups, text)).filter(present)};
    }
    if (item.kind === "hint") {
        const hint = item.hint;
        const ref: ObjectRef | null = "owner" in hint ? hint.owner : "entry" in hint ? {kind: "entry", id: hint.entry} : null;
        const link = ref === null ? null : linkTo(ref, lookups, text);
        const owner = ref?.kind === "change" ? storyChange(lookups, ref.id) : undefined;
        return {...base, quote: hint.code === "telling-lost" || hint.code === "duplicate-quote" || hint.code === "telling-line-mismatch" ? firstQuote(owner) : null, links: link === null ? [] : [link]};
    }
    const canon = item.item;
    switch (canon.kind) {
        case "check-mismatch": {
            const check = lookups.object({kind: "check", id: canon.check}) as Check | undefined;
            const quote = check?.told.quote === undefined ? null : {text: check.told.quote, chapter: check.told.source === "chapter" ? check.told.chapter ?? null : null};
            const suspects = canon.suspects.map((id): PendingSuspect => {
                if (id === "init") return {key: id, text: text("pending.detail.initial"), place: "", estimate: false, target: {kind: "entry", id: canon.at.entry}, initial: true};
                const found = storyChange(lookups, id);
                return {key: id, text: found?.text ?? text("pending.what.someChange"), place: found === undefined ? "" : lookups.place(found.at), estimate: found !== undefined && hasEstimate(found), target: {kind: "change", id}, initial: false};
            });
            return {
                ...base,
                quote,
                facts: [{label: text("pending.detail.written"), value: shownValue(canon.written, text)}, {label: text("pending.detail.computed"), value: shownValue(canon.computed, text)}],
                suspects,
                links: [{label: text("pending.detail.openEntry"), target: {kind: "entry", id: canon.at.entry}}],
            };
        }
        case "held": {
            const found = storyChange(lookups, canon.change);
            const note = (found as {readonly held?: {readonly note?: string}} | undefined)?.held?.note;
            const reason = text(`pending.heldReasons.${canon.reason}`);
            return {...base, quote: firstQuote(found), facts: [{label: text("pending.detail.reason"), value: note === undefined || note === "" ? reason : `${reason}：${note}`}], links: [{label: text("pending.detail.openChange"), target: {kind: "change", id: canon.change}}]};
        }
        case "cannot-apply": {
            const outcome = lookups.outcome(canon.root);
            const facts = [{label: text("pending.detail.root"), value: what(change(canon.root), lookups, text)}];
            if (outcome?.reason !== undefined) facts.push({label: text("pending.detail.reason"), value: text(`pending.applyFailures.${outcome.reason}`)});
            const followers = canon.changes.filter((id) => id !== canon.root);
            if (followers.length > 0) facts.push({label: text("pending.detail.followers"), value: text("pending.detail.followersCount", {count: followers.length})});
            return {...base, quote: firstQuote(storyChange(lookups, canon.root)), facts, links: [{label: text("pending.detail.openChange"), target: {kind: "change", id: canon.root}}]};
        }
        case "time-conflict":
            return {...base, links: canon.changes.map((id) => linkTo(change(id), lookups, text)).filter(present)};
        case "time-invalid":
        case "time-placement-mismatch":
        case "fork-time-mismatch":
            return {...base, quote: firstQuote(storyChange(lookups, canon.change)), links: [{label: text("pending.detail.openChange"), target: {kind: "change", id: canon.change}}]};
        default: {
            // 世界线的几种：线只有 id，没有给作者看的名字，不写。
            const link = linkTo(canon.ref, lookups, text);
            return {...base, links: link === null ? [] : [link]};
        }
    }
}

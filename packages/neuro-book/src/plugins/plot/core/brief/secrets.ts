/**
 * 这一场的秘密（docs/specs/plot/brief.md 输出 4）与相关的决策归属（输出 4 末几条、输出 9）。
 *
 * 保密档（secret）：给真相，加写手知道、本章在场的人按有效知情分成知道的、不知道的、误信的。绝密档（topSecret）：本章计划暗示或揭示
 * 它时给真相与“只能写到”；不暗示也不揭示时只写“有一件涉及某某的绝密设定”，在场的人里知道它的加“在人前的表现”。隐秘的目标并进它指向
 * 的知识点那一项。视角人物知道的保密秘密加一句；视角人物是绝密的持有者时只给表现并加“叙述不写他想到这件事”。
 */

import type {CanonReadView, Decision} from "@notnotype/nb-canon/schema";

import {type Secrecy} from "../../shared/declarations";
import {NO_REASON} from "../decisions";
import {bodyOf, knowingIndex} from "../knowledge";
import {goalsOf} from "../goals";
import {nameOf, isSecretPlus, secrecyAt, type Frame, type Participant} from "./context";
import * as fixed from "./fixed";
import type {BriefHint} from "./types";

export interface SecretItem {
    readonly point: string;
    readonly name: string;
    readonly secrecy: "secret" | "topSecret";
    /** 绝密、本章不暗示也不揭示：内容与目标都不给。 */
    readonly hidden: boolean;
    readonly lines: string[];
}

export interface SecretsResult {
    readonly items: SecretItem[];
    readonly hints: BriefHint[];
    /** 目标 id -> 它藏着的知识点（`隐秘`）；别的段按这个把目标改写成“某某的一个隐秘目标”。 */
    readonly hiddenGoals: ReadonlyMap<string, {readonly holder: string; readonly point: string}>;
}

const rankOf = (secrecy: Secrecy | null) => (secrecy === "topSecret" ? 0 : 1);

/** 一个知识点的“真相”写法：名字（命题），有简介时再加简介。 */
function truthOf(frame: Frame, point: string): string {
    const read = frame.view.entry(point, frame.position, "planned");
    if (read === null || read === "chapter-not-found") return point;
    return read.summary === "" ? read.name : `${read.name}（${read.summary}）`;
}

const presentOf = (participants: readonly Participant[], view: CanonReadView) => [...new Set(participants.filter((member) => member.role === "present" && member.who !== undefined).map((member) => bodyOf(view, member.who!)))];

/** 在场的人里有隐秘目标指向这个知识点的：`[持有者, 目标]`。 */
function goalsHiding(frame: Frame, holders: readonly string[], point: string) {
    return holders.flatMap((holder) => goalsOf(frame.view, holder, frame.position, "planned").filter((goal) => goal.隐秘 === point).map((goal) => ({holder, goal})));
}

export function buildSecrets(frame: Frame, points: readonly string[], participants: readonly Participant[], reveals: ReadonlyMap<string, "hint" | "explicit">, pov: string | null, povMode: string | undefined): SecretsResult {
    const view = frame.view;
    const index = knowingIndex(view, "planned", frame.position);
    const holders = presentOf(participants, view);
    // 隐秘目标的持有者只是被提到、不在场时也要遮（knowledge 输出 10 的集合按参与者收）：同一份简报不能一边遮、一边写。
    const everyone = [...new Set(participants.flatMap((member) => (member.who === undefined ? [] : [bodyOf(view, member.who)])))];
    const hints: BriefHint[] = [];
    const items: SecretItem[] = [];
    const hiddenGoals = new Map<string, {holder: string; point: string}>();
    const secretPoints = points.filter((point) => isSecretPlus(secrecyAt(frame, point))).sort((a, b) => rankOf(secrecyAt(frame, a)) - rankOf(secrecyAt(frame, b)) || (a < b ? -1 : 1));
    const povBody = pov === null ? null : bodyOf(view, pov);
    for (const point of secretPoints) {
        const secrecy = secrecyAt(frame, point) as "secret" | "topSecret";
        const reveal = reveals.get(point);
        const name = nameOf(frame, point);
        const hiding = goalsHiding(frame, everyone, point);
        for (const {holder, goal} of hiding) hiddenGoals.set(goal.id, {holder, point});
        const lines: string[] = [];
        if (secrecy === "secret" || reveal !== undefined) {
            lines.push(`真相：${truthOf(frame, point)}`);
            if (secrecy === "topSecret") lines.push(fixed.onlyWriteTo(reveal!));
            else {
                const knows: string[] = [];
                const unaware: string[] = [];
                const misbelieves: string[] = [];
                for (const person of holders) {
                    const row = index.effective(person, point);
                    const who = nameOf(frame, person);
                    if (row?.程度 === "knows") knows.push(who);
                    else if (row?.程度 === "misbelieves") misbelieves.push(`${who}（他以为：${row.他以为的 ?? ""}）`);
                    else unaware.push(row?.程度 === "suspects" ? `${who}（只是怀疑）` : who);
                }
                lines.push(`写手知道；知道的：${knows.join("、") || fixed.NONE}；不知道的：${unaware.join("、") || fixed.NONE}；误信的：${misbelieves.join("、") || fixed.NONE}`);
                if (povBody !== null && index.effective(povBody, point)?.程度 === "knows") lines.push(fixed.POV_OWN_SECRET);
            }
            for (const {holder, goal} of hiding) lines.push(`${nameOf(frame, holder)}的隐秘目标：${goal.name}${goal.为什么 === null ? "" : `；为什么：${goal.为什么}`}`);
            items.push({point, name, secrecy, hidden: false, lines});
            continue;
        }
        // 绝密、本章不暗示也不揭示。
        lines.push(fixed.topSecretOf(nameOfSubject(frame, point)));
        const knowers = holders.filter((person) => index.effective(person, point)?.程度 === "knows");
        for (const person of knowers) {
            const shown = frame.view.entry(point, frame.position, "planned");
            const presence = shown === null || shown === "chapter-not-found" ? null : shown.namespaces.point?.fields.表现?.value;
            if (typeof presence === "string" && presence !== "") lines.push(fixed.presenceOf(nameOf(frame, person), presence));
            else {
                lines.push(fixed.NO_PRESENTATION);
                hints.push({code: "nbook.plot.brief.noPresentation", objects: [{kind: "entry", id: point}]});
            }
        }
        for (const {holder} of hiding) lines.push(fixed.holderUnwritableGoal(nameOf(frame, holder)));
        if (povBody !== null && knowers.includes(povBody)) lines.push(fixed.POV_NOT_THINK);
        items.push({point, name, secrecy, hidden: true, lines});
    }
    void povMode;
    return {items, hints, hiddenGoals};
}

/** 知识点的主体（条目树里的父条目）的名字。 */
function nameOfSubject(frame: Frame, point: string): string {
    const stored = frame.view.object({kind: "entry", id: point}) as {parent?: string | null} | undefined;
    return typeof stored?.parent === "string" ? nameOf(frame, stored.parent) : fixed.NO_SUBJECT;
}

export interface DecisionRouting {
    /** 挂在某个知识点那一项里的决策原话（按知识点）。 */
    readonly inSecrets: ReadonlyMap<string, string[]>;
    /** 决策段里的行：不挂保密以上知识点的原话，加上指向那一项的和“有一条涉及保密设定的决定”。 */
    readonly inDecisions: string[];
}

const decisionText = (decision: Decision) => {
    const parts = [`结论：${decision.conclusion ?? ""}`, `理由：${decision.reason ?? NO_REASON}`];
    if ((decision.constraints ?? []).length > 0) parts.push(`约束：${decision.constraints!.join("；")}`);
    return parts.join("；");
};

/**
 * 涉及本章的已定决策怎样分到秘密与决策两段（输出 4 的末几条、输出 9）：看它 `about` 里所有保密以上的知识点（不论在不在本章
 * 涉及的集合里）。没有这样的知识点：原话写在决策段。有：其中有不在这一场的秘密里的、或有绝密而本章不暗示也不揭示的，只在决策段写
 * 一句“有一条涉及保密设定的决定”；否则原话写在它挂的知识点里排第一的那一项，其余各项写“另有关于这件事的决定，见某某一项”，
 * 决策段只写“另有关于某某的决定，见这一场的秘密”。
 */
export function routeDecisions(frame: Frame, decided: readonly Decision[], secrets: SecretsResult): DecisionRouting {
    const inSecrets = new Map<string, string[]>();
    const inDecisions: string[] = [];
    let guarded = false;
    const byPoint = new Map(secrets.items.map((item) => [item.point, item] as const));
    for (const decision of decided) {
        // 条目挂点与地址挂点的条目都算（地址挂在知识点的字段上时同样是在说这个知识点）。
        const aboutPoints = [...new Set(decision.about.flatMap((about) => { const id = about.kind === "entry" ? about.id : about.kind === "address" ? about.at.entry : null; return id !== null && isSecretPlus(secrecyAt(frame, id)) ? [id] : []; }))];
        if (aboutPoints.length === 0) {
            inDecisions.push(`${decision.text}：${decisionText(decision)}`);
            continue;
        }
        const unshown = aboutPoints.some((point) => !byPoint.has(point) || byPoint.get(point)!.hidden);
        if (unshown) {
            guarded = true;
            continue;
        }
        const ordered = [...aboutPoints].sort((a, b) => rankOf(secrecyAt(frame, a)) - rankOf(secrecyAt(frame, b)) || (a < b ? -1 : 1));
        const [first, ...rest] = ordered;
        inSecrets.set(first!, [...(inSecrets.get(first!) ?? []), `${decision.text}：${decisionText(decision)}`]);
        for (const point of rest) inSecrets.set(point, [...(inSecrets.get(point) ?? []), fixed.otherDecisionSee(byPoint.get(first!)!.name)]);
        inDecisions.push(fixed.decisionSeeSecrets(byPoint.get(first!)!.name));
    }
    if (guarded) inDecisions.push(fixed.DECISION_ABOUT_SECRET);
    return {inSecrets, inDecisions};
}


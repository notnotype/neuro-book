/**
 * 这一场的秘密（docs/specs/plot/brief.md 输出 4）与决策的去向（输出 4 末几条、输出 9）。名字、真相与秘密的种类都经关卡
 * （`gate.ts`），这里只按 Spec 排段。
 *
 * 给了内容的（保密档，或绝密而本章计划暗示、揭示）：给真相；保密档加写手知道、本章在场的人按有效知情分成知道的、不知道的、
 * 误信的；绝密加“只能写到”。不给内容的：只写“有一件涉及某某的绝密设定”，在场的人里知道它的加“在人前的表现”。隐秘的目标
 * 并进它藏着的知识点里排第一的那一项。
 */

import type {CanonReadView, Decision} from "@notnotype/nb-canon/schema";

import {ENTRY_TYPES} from "../../shared/declarations";
import {NO_REASON} from "../decisions";
import {bodyOf, knowingIndex} from "../knowledge";
import {isSecretPlus, type Participant} from "./context";
import * as fixed from "./fixed";
import type {Gate, HidingGoal} from "./gate";
import type {BriefHint} from "./types";

export interface SecretItem {
    readonly point: string;
    readonly name: string;
    readonly secrecy: "secret" | "topSecret";
    /** 不给内容：名字与内容都不写。 */
    readonly hidden: boolean;
    readonly lines: string[];
}

export interface SecretsResult {
    readonly items: SecretItem[];
    readonly hints: BriefHint[];
}

/** 秘密的先后：绝密在前，同档按 id。 */
export function byRank(gate: Gate) {
    return (a: string, b: string) => Number(gate.secrecy(b) === "topSecret") - Number(gate.secrecy(a) === "topSecret") || (a < b ? -1 : a > b ? 1 : 0);
}

const bodiesOf = (participants: readonly Participant[], view: CanonReadView, present: boolean) => [...new Set(participants.filter((member) => member.who !== undefined && (!present || member.role === "present")).map((member) => bodyOf(view, member.who!)))];

/** 参与者（含只被提到的）的目标里藏着秘密的：隐秘目标的持有者只是被提到、不在场时也要遮，同一份简报不能一边遮、一边写。 */
function hidingGoals(gate: Gate, participants: readonly Participant[]): HidingGoal[] {
    const view = gate.frame.view;
    const holders = new Set(bodiesOf(participants, view, false));
    return view.entries().flatMap((entry) => {
        // 身份不给写手的人的目标一句也不写（开发者 2026-11-10 定）。
        if (entry.deleted === true || entry.type !== ENTRY_TYPES.goal || entry.parent === null || !holders.has(entry.parent) || gate.identityWithheld(entry.parent)) return [];
        const hidden = gate.hiding(entry.id);
        return hidden === null ? [] : [hidden];
    });
}

export function buildSecrets(gate: Gate, points: readonly string[], participants: readonly Participant[], reveals: ReadonlyMap<string, "hint" | "explicit">, pov: string | null): SecretsResult {
    const view = gate.frame.view;
    const index = knowingIndex(view, "planned", gate.frame.position);
    const present = bodiesOf(participants, view, true);
    const goals = hidingGoals(gate, participants);
    const hints: BriefHint[] = [];
    const items: SecretItem[] = [];
    const povBody = pov === null ? null : bodyOf(view, pov);
    for (const point of [...new Set(points)].filter((id) => isSecretPlus(gate.secrecy(id))).sort(byRank(gate))) {
        const secrecy = gate.secrecy(point) as "secret" | "topSecret";
        const lines: string[] = [];
        const truth = gate.truth(point);
        if (truth !== null) {
            lines.push(`真相：${truth}`);
            if (secrecy === "topSecret") lines.push(fixed.onlyWriteTo(reveals.get(point) ?? "hint"));
            else {
                const knows: string[] = [];
                const unaware: string[] = [];
                const misbelieves: string[] = [];
                for (const person of present) {
                    const row = index.effective(person, point);
                    const who = gate.name(person);
                    if (row?.程度 === "knows") knows.push(who);
                    else if (row?.程度 === "misbelieves") misbelieves.push(`${who}（他以为：${row.他以为的 ?? ""}）`);
                    else unaware.push(row?.程度 === "suspects" ? `${who}（只是怀疑）` : who);
                }
                lines.push(`写手知道；知道的：${knows.join("、") || fixed.NONE}；不知道的：${unaware.join("、") || fixed.NONE}；误信的：${misbelieves.join("、") || fixed.NONE}`);
                if (povBody !== null && index.effective(povBody, point)?.程度 === "knows") lines.push(fixed.POV_OWN_SECRET);
            }
            for (const goal of goals) if (goal.state === "shown" && goal.first === point) lines.push(gate.hiddenGoal(goal.goal)!);
            items.push({point, name: gate.name(point), secrecy, hidden: false, lines});
            continue;
        }
        // 不给内容：绝密而本章不暗示也不揭示，或是不给写手的那一组揭穿。
        lines.push(fixed.topSecretOf(gate.subject(point)));
        const knowers = present.filter((person) => index.effective(person, point)?.程度 === "knows");
        const presence = view.entry(point, gate.frame.position, "planned");
        const shownAs = presence === null || presence === "chapter-not-found" ? null : presence.namespaces.point?.fields.表现?.value;
        for (const person of knowers) {
            if (typeof shownAs === "string" && shownAs !== "") lines.push(fixed.presenceOf(gate.name(person), shownAs));
            else {
                lines.push(fixed.NO_PRESENTATION);
                hints.push({code: "nbook.plot.brief.noPresentation", objects: [{kind: "entry", id: point}]});
            }
        }
        for (const goal of goals) if (goal.state === "withheld" && goal.first === point) lines.push(fixed.holderUnwritableGoal(gate.name(goal.holder)));
        if (povBody !== null && knowers.includes(povBody)) lines.push(fixed.POV_NOT_THINK);
        items.push({point, name: fixed.HIDDEN_NAME, secrecy, hidden: true, lines});
    }
    return {items, hints};
}

export interface DecisionRouting {
    /** 挂在某个知识点那一项里的决策原话（按知识点）。 */
    readonly inSecrets: ReadonlyMap<string, string[]>;
    /** 决策段里的行：不涉秘密的原话，加上指向那一项的和“有一条涉及保密设定的决定”。 */
    readonly inDecisions: string[];
}

const decisionText = (decision: Decision) => {
    const parts = [`结论：${decision.conclusion ?? ""}`, `理由：${decision.reason ?? NO_REASON}`];
    if ((decision.constraints ?? []).length > 0) parts.push(`约束：${decision.constraints!.join("；")}`);
    return parts.join("；");
};

/** 决策挂着的条目：条目挂点与地址挂点的条目都算（地址挂在知识点的字段上时同样是在说这个知识点）。 */
export const aboutEntries = (decision: Decision) => [...new Set(decision.about.flatMap((about) => (about.kind === "entry" ? [about.id] : about.kind === "address" ? [about.at.entry] : [])))];

/**
 * 已定决策分到秘密与决策两段（输出 4 的末几条、输出 9），按挂着的条目的秘密种类：有不给内容的，只在决策段写“有一条涉及
 * 保密设定的决定”；没有不给内容、有给了内容的，原话写进排第一的那一项（目标折算成它藏着的知识点），其余各项与决策段只写
 * 指向；都不涉秘密的，原话写在决策段。
 */
export function routeDecisions(gate: Gate, decided: readonly Decision[], secrets: SecretsResult): DecisionRouting {
    const inSecrets = new Map<string, string[]>();
    const inDecisions: string[] = [];
    let guarded = false;
    const byPoint = new Map(secrets.items.map((item) => [item.point, item] as const));
    for (const decision of decided) {
        const about = aboutEntries(decision);
        if (about.some((id) => gate.secretClass(id) === "withheld")) {
            guarded = true;
            continue;
        }
        const targets = [...new Set(about.filter((id) => gate.secretClass(id) === "shown").map((id) => gate.hiding(id)?.first ?? id))].sort(byRank(gate));
        if (targets.length === 0) {
            inDecisions.push(`${decision.text}：${decisionText(decision)}`);
            continue;
        }
        if (targets.some((point) => byPoint.get(point)?.hidden !== false)) {
            guarded = true;
            continue;
        }
        const [first, ...rest] = targets;
        const firstName = byPoint.get(first!)!.name;
        inSecrets.set(first!, [...(inSecrets.get(first!) ?? []), `${decision.text}：${decisionText(decision)}`]);
        for (const point of rest) inSecrets.set(point, [...(inSecrets.get(point) ?? []), fixed.otherDecisionSee(firstName)]);
        inDecisions.push(fixed.decisionSeeSecrets(firstName));
    }
    if (guarded) inDecisions.push(fixed.DECISION_ABOUT_SECRET);
    return {inSecrets, inDecisions};
}

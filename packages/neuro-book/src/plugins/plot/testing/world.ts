/**
 * 剧情插件纯计算的测试夹具：一份真实的世界（nb-canon 的 `World`，登记了剧情插件的 Component、标注种类与诊断），经发布写进去，
 * 用 `createWorldReadView` 按一张正文表读。不起世界服务与子进程；服务层的行为（快照、视图、审计）在远程用例里测。只由测试用。
 */

import {createHash} from "node:crypto";

import {buildDiagnosticRegistry, buildMarkRegistry, buildRegistry, ChapterOrder, World} from "@notnotype/nb-canon";
import type {CastMember, Decision, Entry, Mark, Patch, Placement, StoryChangeDraft, TellingDraft, WriteRequest} from "@notnotype/nb-canon";
import {createWorldReadView} from "@notnotype/nb-canon/node";
import type {CanonReadView} from "@notnotype/nb-canon/schema";

import {COMPONENT_IDS, PLOT_COMPONENTS, PLOT_DIAGNOSTICS, PLOT_MARKS, PLOT_PLUGIN_ID} from "../shared/declarations";
import {signAuthorization, TEST_PROJECT, verifyTestSource} from "./authorization";

const PERSON = {id: "test.person", label: "人物", namespace: "character", version: 1, fields: [{id: "状态", label: "状态", kind: "text" as const}]};

/** 剧情世界的登记：剧情插件的 Component、标注种类与诊断，加一个测试用的人物类型。 */
export function plotRegistries() {
    return {
        registry: buildRegistry([...PLOT_COMPONENTS, PERSON]),
        marks: buildMarkRegistry(PLOT_MARKS.map((declaration) => ({plugin: PLOT_PLUGIN_ID, declaration}))),
        diagnostics: buildDiagnosticRegistry(PLOT_DIAGNOSTICS.map((declaration) => ({plugin: PLOT_PLUGIN_ID, declaration}))),
    };
}

/** 写入请求里的对象（剧情世界与剧情服务两种夹具共用）。 */
export const drafts = {
    person: (id: string, name: string, extra: Partial<Entry> = {}): Entry => ({id, type: "人物", parent: null, folder: "", order: 0, init: {name, aliases: [], summary: "", text: [], data: {know: {type: COMPONENT_IDS.knowing, version: 1, enabled: true, fields: {知情: [], 听过的说法: null}}}}, ...extra}),
    point: (id: string, name: string, subject: string | null, fields: Record<string, unknown> = {}): Entry => ({id, type: "知识点", parent: subject, folder: "", order: 0, init: {name, aliases: [], summary: name, text: [], data: {point: {type: COMPONENT_IDS.point, version: 1, enabled: true, fields: {保密: "secret", 规则: null, 表现: null, 揭穿: null, 读者问题: null, ...fields}}}}}),
    foreshadow: (id: string, name: string, fields: Record<string, unknown> = {}): Entry => ({id, type: "伏笔", parent: null, folder: "", order: 0, init: {name, aliases: [], summary: name, text: [], data: {fs: {type: COMPONENT_IDS.foreshadow, version: 1, enabled: true, fields: {种类: "setupPayoff", 重要程度: "main", 意图: "active", 答案: null, 物件: [], 参考间隔: null, ...fields}}}}}),
    /** 一个目标，挂在持有者下面；缺省进行、主要、想要。 */
    goal: (id: string, name: string, holder: string, fields: Record<string, unknown> = {}, extra: Partial<Entry> = {}): Entry => ({id, type: "目标", parent: holder, folder: "", order: 0, init: {name, aliases: [], summary: name, text: [], data: {goal: {type: COMPONENT_IDS.goal, version: 1, enabled: true, fields: {状态: "active", 轻重: "major", 层次: "want", 为什么: null, 基于: [], 冲突: [], 后继: null, 隐秘: null, ...fields}}}}, ...extra}),
    /** 一件物件（带测试用的人物类型，补丁改它的 `character.状态`）。 */
    thing: (id: string, name: string): Entry => ({id, type: "物件", parent: null, folder: "", order: 0, init: {name, aliases: [], summary: "", text: [], data: {character: {type: "test.person", version: 1, enabled: true, fields: {状态: "原样"}}}}}),
    change: (id: string, at: Placement, options: ChangeOptions = {}): StoryChangeDraft => ({id, kind: options.kind ?? "written", text: options.text ?? id, at, told: options.told ?? [], involves: [], lines: [], links: options.links ?? [], patches: options.patches ?? [], status: "active", by: {kind: "author"}, ...(options.cast === undefined ? {} : {cast: options.cast}), ...(options.marks === undefined ? {} : {marks: options.marks})}),
};

export interface ChangeOptions {
    readonly patches?: Patch[];
    readonly cast?: CastMember[];
    readonly marks?: Mark[];
    readonly told?: TellingDraft[];
    readonly kind?: "written" | "plan";
    readonly links?: StoryChangeDraft["links"];
    readonly text?: string;
}

export class PlotWorld {
    world: World;
    readonly texts = new Map<string, string>();
    #sequence = 0;

    constructor(chapters: readonly string[]) {
        for (const chapter of chapters) this.texts.set(chapter, "");
        this.world = World.empty({
            order: new ChapterOrder(chapters),
            ...plotRegistries(),
            reductions: () => undefined,
            chapterText: (chapter) => this.texts.get(chapter),
            digest: (text) => createHash("sha256").update(text).digest("hex"),
            project: TEST_PROJECT,
            verifyAuthorSource: verifyTestSource,
        });
    }

    /** 发布一次写入（作者），返回临时 id 到正式 id 的对照。 */
    publish(puts: WriteRequest["puts"]): Readonly<Record<string, string>> {
        const result = this.world.publish({requestId: `plot-${String(++this.#sequence)}`, by: {kind: "author"}, what: "edit", title: "测试", baseVersion: this.world.version, puts}, "t");
        if (!result.ok) throw new Error(JSON.stringify(result.failure));
        this.world = result.world;
        return result.ids;
    }

    /** 新建一个条目，返回正式 id。 */
    entry(entry: Omit<Entry, "id">): string {
        const id = `tmp:e${String(++this.#sequence)}`;
        return this.publish([{ref: {kind: "entry", id}, after: {...entry, id}}])[id]!;
    }

    /** 一个人物，带知情命名空间。 */
    person(name: string, extra: Partial<Entry> = {}): string {
        const id = `tmp:p${String(++this.#sequence)}`;
        return this.publish([{ref: {kind: "entry", id}, after: drafts.person(id, name, extra)}])[id]!;
    }

    /** 一个知识点，挂在主体下面。 */
    point(name: string, subject: string | null, fields: Record<string, unknown> = {}): string {
        const id = `tmp:k${String(++this.#sequence)}`;
        return this.publish([{ref: {kind: "entry", id}, after: drafts.point(id, name, subject, fields)}])[id]!;
    }

    /** 一个伏笔条目。 */
    foreshadow(name: string, fields: Record<string, unknown> = {}): string {
        const id = `tmp:f${String(++this.#sequence)}`;
        return this.publish([{ref: {kind: "entry", id}, after: drafts.foreshadow(id, name, fields)}])[id]!;
    }

    /** 一个目标。 */
    goal(name: string, holder: string, fields: Record<string, unknown> = {}, extra: Partial<Entry> = {}): string {
        const id = `tmp:g${String(++this.#sequence)}`;
        return this.publish([{ref: {kind: "entry", id}, after: drafts.goal(id, name, holder, fields, extra)}])[id]!;
    }

    /** 一件物件。 */
    thing(name: string): string {
        const id = `tmp:t${String(++this.#sequence)}`;
        return this.publish([{ref: {kind: "entry", id}, after: drafts.thing(id, name)}])[id]!;
    }

    /** 一条剧情变更（缺省已写），返回正式 id。 */
    change(at: Placement, options: ChangeOptions = {}): string {
        const id = `tmp:c${String(++this.#sequence)}`;
        return this.publish([{ref: {kind: "change", id}, after: drafts.change(id, at, options)}])[id]!;
    }

    /** 一条决策：待定建好，有 `conclusion` 时再由作者来源转成已定。返回正式 id。 */
    decision(text: string, extra: Partial<Decision> & {conclusion?: string} = {}): string {
        // 结论、理由、约束、标注（守卫）只在已定时起作用，新建的待定决策不能带。
        const {conclusion, reason, constraints, risks, marks, ...rest} = extra;
        const id = `tmp:d${String(++this.#sequence)}`;
        const created = this.publish([{ref: {kind: "decision", id}, after: {id, text, status: "pending", about: [], hints: [], ...rest}}])[id]!;
        if (conclusion === undefined) return created;
        const stored = this.world.data.decisions.get(created)!;
        const request: WriteRequest = {requestId: `plot-${String(++this.#sequence)}`, by: {kind: "author"}, what: "edit", title: "定", baseVersion: this.world.version, puts: [{ref: {kind: "decision", id: created}, after: {...stored, status: "decided", conclusion, ...(reason === undefined ? {} : {reason}), ...(constraints === undefined ? {} : {constraints}), ...(risks === undefined ? {} : {risks}), ...(marks === undefined ? {} : {marks})}}]};
        const result = this.world.publish({...request, authorizations: [signAuthorization(request, created, "pending→decided")]}, "t");
        if (!result.ok) throw new Error(JSON.stringify(result.failure));
        this.world = result.world;
        return created;
    }

    /** 作者来源放弃一条待定决策。 */
    drop(id: string): void {
        const stored = this.world.data.decisions.get(id)!;
        const request: WriteRequest = {requestId: `plot-${String(++this.#sequence)}`, by: {kind: "author"}, what: "edit", title: "放弃", baseVersion: this.world.version, puts: [{ref: {kind: "decision", id}, after: {...stored, status: "dropped"}}]};
        const result = this.world.publish({...request, authorizations: [signAuthorization(request, id, "pending→dropped")]}, "t");
        if (!result.ok) throw new Error(JSON.stringify(result.failure));
        this.world = result.world;
    }

    view(): CanonReadView {
        return createWorldReadView(this.world, this.texts);
    }
}

export const chapter = (id: string, key = 0): Placement => ({kind: "chapter", chapter: id, key});
export const end = (id: string) => ({kind: "chapter", chapter: id, edge: "end"}) as const;
export const start = (id: string) => ({kind: "chapter", chapter: id, edge: "start"}) as const;
export const present = (who: string): CastMember => ({who, role: "present"});
export const learns = (point: string, degree?: "knows" | "suspects"): Mark => ({kind: `${PLOT_PLUGIN_ID}.presentLearns`, version: 1, point, ...(degree === undefined ? {} : {degree})});
export const addRow = (person: string, point: string, row: Record<string, unknown>): Patch => ({op: "listAdd", at: {entry: person, path: "know.知情"}, value: {id: point, ...row}});
export const setSub = (person: string, point: string, sub: string, value: unknown): Patch => ({op: "set", at: {entry: person, path: `know.知情[${point}].${sub}`}, value});

/**
 * 剧情插件纯计算的测试夹具：一份真实的世界（nb-canon 的 `World`，登记了剧情插件的 Component、标注种类与诊断），经发布写进去，
 * 用 `createWorldReadView` 按一张正文表读。不起世界服务与子进程；服务层的行为（快照、视图、审计）在远程用例里测。只由测试用。
 */

import {createHash} from "node:crypto";

import {buildDiagnosticRegistry, buildMarkRegistry, buildRegistry, ChapterOrder, World} from "@notnotype/nb-canon";
import type {CastMember, Entry, Mark, Patch, Placement, StoryChangeDraft, TellingDraft, WriteRequest} from "@notnotype/nb-canon";
import {createWorldReadView} from "@notnotype/nb-canon/node";
import type {CanonReadView} from "@notnotype/nb-canon/schema";

import {COMPONENT_IDS, PLOT_COMPONENTS, PLOT_DIAGNOSTICS, PLOT_MARKS, PLOT_PLUGIN_ID} from "../shared/declarations";

const PERSON = {id: "test.person", label: "人物", namespace: "character", version: 1, fields: [{id: "状态", label: "状态", kind: "text" as const}]};

export class PlotWorld {
    world: World;
    readonly texts = new Map<string, string>();
    #sequence = 0;

    constructor(chapters: readonly string[]) {
        for (const chapter of chapters) this.texts.set(chapter, "");
        this.world = World.empty({
            order: new ChapterOrder(chapters),
            registry: buildRegistry([...PLOT_COMPONENTS, PERSON]),
            marks: buildMarkRegistry(PLOT_MARKS.map((declaration) => ({plugin: PLOT_PLUGIN_ID, declaration}))),
            diagnostics: buildDiagnosticRegistry(PLOT_DIAGNOSTICS.map((declaration) => ({plugin: PLOT_PLUGIN_ID, declaration}))),
            reductions: () => undefined,
            chapterText: (chapter) => this.texts.get(chapter),
            digest: (text) => createHash("sha256").update(text).digest("hex"),
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
        return this.entry({type: "人物", parent: null, folder: "", order: 0, init: {name, aliases: [], summary: "", text: [], data: {know: {type: COMPONENT_IDS.knowing, version: 1, enabled: true, fields: {知情: [], 听过的说法: null}}}}, ...extra});
    }

    /** 一个知识点，挂在主体下面。 */
    point(name: string, subject: string | null, fields: Record<string, unknown> = {}): string {
        return this.entry({type: "知识点", parent: subject, folder: "", order: 0, init: {name, aliases: [], summary: name, text: [], data: {point: {type: COMPONENT_IDS.point, version: 1, enabled: true, fields: {保密: "secret", 规则: null, 表现: null, 揭穿: null, 读者问题: null, ...fields}}}}});
    }

    /** 一条剧情变更（缺省已写），返回正式 id。 */
    change(at: Placement, options: {readonly patches?: Patch[]; readonly cast?: CastMember[]; readonly marks?: Mark[]; readonly told?: TellingDraft[]; readonly kind?: "written" | "plan"; readonly links?: StoryChangeDraft["links"]} = {}): string {
        const id = `tmp:c${String(++this.#sequence)}`;
        const draft: StoryChangeDraft = {id, kind: options.kind ?? "written", text: id, at, told: options.told ?? [], involves: [], lines: [], links: options.links ?? [], patches: options.patches ?? [], status: "active", by: {kind: "author"}, ...(options.cast === undefined ? {} : {cast: options.cast}), ...(options.marks === undefined ? {} : {marks: options.marks})};
        return this.publish([{ref: {kind: "change", id}, after: draft}])[id]!;
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

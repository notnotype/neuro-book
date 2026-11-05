/**
 * 测试用的小世界：按 Spec 场景里的星瑕一家拼出条目、剧情变更与核对点。每个对象按加进来的先后得到一个
 * “新建它的版本”，排序键相同时按它排（canon.model 输出 2）。不含断言。
 */

import {buildRegistry, ChapterOrder, type Check, type ComponentDeclaration, type Entry, type Patch, type Placement, type StoryChange} from "../../src/index";
import type {EngineInputs, ReductionLookup, WorldData} from "../../src/engine/types";

export const PANEL: ComponentDeclaration = {
    id: "canon.panel",
    label: "面板",
    namespace: "panel",
    version: 1,
    instanceFields: true,
    fields: [
        {id: "存款", label: "存款", kind: "number", min: 0},
        {id: "魔力上限", label: "魔力上限", kind: "number"},
        {id: "魔力", label: "魔力", kind: "number", min: 0, max: "魔力上限"},
        {id: "物品", label: "物品", kind: "list", item: [{id: "数量", label: "数量", kind: "number"}]},
    ],
};

export const PERSON: ComponentDeclaration = {
    id: "canon.person",
    label: "人物",
    namespace: "character",
    version: 1,
    fields: [
        {id: "外观", label: "外观", kind: "text", retold: true},
        {id: "状态", label: "状态", kind: "text"},
        {id: "态度", label: "现在的态度", kind: "text", precision: "semantic"},
    ],
};

export const chapter = (id: string, key = 50): Placement => ({kind: "chapter", chapter: id, key});

export class WorldBuilder {
    readonly entries = new Map<string, Entry>();
    readonly changes = new Map<string, StoryChange>();
    readonly checks = new Map<string, Check>();
    readonly createdAt = new Map<string, number>();
    chapters: string[] = ["ch1", "ch2", "ch3", "ch4", "ch5", "ch6"];
    declarations: ComponentDeclaration[] = [PANEL, PERSON];
    reductions: ReductionLookup = () => undefined;
    #version = 0;

    entry(id: string, name: string, data: {panel?: Record<string, unknown>; character?: Record<string, unknown>} = {}, extra: Partial<Entry> = {}): this {
        const namespaces: Entry["init"]["data"] = {};
        if (data.panel !== undefined) namespaces.panel = {type: "canon.panel", version: 1, enabled: true, fields: {存款: null, 魔力上限: null, 魔力: null, 物品: [], ...data.panel}};
        if (data.character !== undefined) namespaces.character = {type: "canon.person", version: 1, enabled: true, fields: {外观: null, 状态: null, 态度: null, ...data.character}};
        const entry: Entry = {id, type: "人物", parent: null, folder: "人物", order: this.entries.size, init: {name, aliases: [], summary: "", text: [], data: namespaces}, ...extra};
        this.entries.set(id, entry);
        this.createdAt.set(id, ++this.#version);
        return this;
    }

    change(id: string, at: Placement, patches: Patch[], extra: Partial<StoryChange> = {}): this {
        this.changes.set(id, {id, kind: "written", text: id, at, told: [], involves: [...new Set(patches.map((patch) => patch.at.entry))], lines: [], links: [], patches, status: "active", by: {kind: "author"}, ...extra});
        this.createdAt.set(id, ++this.#version);
        return this;
    }

    plan(id: string, at: Placement, patches: Patch[], extra: Partial<StoryChange> = {}): this {
        return this.change(id, at, patches, {kind: "plan", ...extra});
    }

    check(id: string, entry: string, path: string, value: number, place: Placement, extra: Partial<Check> = {}): this {
        this.checks.set(id, {id, at: {entry, path}, value, told: {id: `t${id}`, source: "chapter", quote: String(value)}, place, ...extra});
        this.createdAt.set(id, ++this.#version);
        return this;
    }

    world(): WorldData {
        return {version: this.#version, entries: this.entries, changes: this.changes, checks: this.checks, decisions: new Map(), suggestions: new Map(), createdAt: this.createdAt};
    }

    inputs(): EngineInputs {
        return {world: this.world(), order: new ChapterOrder(this.chapters), registry: buildRegistry(this.declarations), reductions: this.reductions};
    }
}

export const set = (entry: string, path: string, value: unknown, extra: Partial<Patch> = {}): Patch => ({op: "set", at: {entry, path}, value, ...extra});
export const add = (entry: string, path: string, value: number, extra: Partial<Patch> = {}): Patch => ({op: "add", at: {entry, path}, value, ...extra});
export const note = (entry: string, path: string, value: string): Patch => ({op: "note", at: {entry, path}, value});
export const end = (id: string) => ({kind: "chapter", chapter: id, edge: "end"}) as const;
export const start = (id: string) => ({kind: "chapter", chapter: id, edge: "start"}) as const;

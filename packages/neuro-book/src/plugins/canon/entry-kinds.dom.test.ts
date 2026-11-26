/**
 * 条目种类的登记（`canon.entry-kinds`，docs/specs/canon/author-ui.md 输入一节）：同一个词的几条登记并成一条；默认里写到没登记的
 * 类型时，用到时当作没写、项目实例写一条诊断（每处一条）。
 */

import {rm} from "node:fs/promises";

import {afterEach, beforeEach, describe, expect, it} from "vitest";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import type {DiagnosticsService} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {BUILTIN_ENTRY_KINDS} from "./shared/components";
import {CANON_ENTRY_KINDS_POINT, defaultComponents, mergeEntryKinds} from "./shared/entry-kinds";
import {canonNodeWorld} from "./testing/node-world";
import type {CanonNodeWorld} from "./testing/node-world";

let tmp: string;
let world: CanonNodeWorld | null = null;

beforeEach(async () => {
    tmp = await createTestTmpRoot("neuro-book-canon", "entry-kinds");
});

afterEach(async () => {
    await world?.close();
    world = null;
    await rm(tmp, {recursive: true, force: true});
});

describe("条目种类的登记", () => {
    it("同一个词的几条登记：默认组内置的在前（别的插件的贡献 id 排在内置前面时也是）、并起来去重，先后取最小的；没登记的种类没有默认", () => {
        // `declarations.list` 按贡献 id 排：“acme.” 的排在 “nbook.canon.” 前面。
        const kinds = mergeEntryKinds([
            {id: "acme.magic.wand", declaration: {kind: "人物", components: ["nbook.canon.look", "x.magic"], order: 9}},
            {id: "acme.magic.kind", declaration: {kind: "法器", components: ["x.magic"], order: -1}},
            ...BUILTIN_ENTRY_KINDS,
        ]);
        expect(kinds.map((kind) => kind.kind)).toEqual(["法器", "人物", "组织", "地点", "物品"]);
        expect(kinds.find((kind) => kind.kind === "人物")).toEqual({kind: "人物", components: ["nbook.canon.person", "nbook.canon.look", "x.magic"], order: 0, icon: "i-lucide-user-round"});
        const available = new Set(["nbook.canon.person", "nbook.canon.look"]);
        expect(defaultComponents(kinds, " 人物 ", available)).toEqual(["nbook.canon.person", "nbook.canon.look"]);
        expect(defaultComponents(kinds, "城市", available)).toEqual([]);
    });

    it("默认里写到没登记的类型：项目实例写一条诊断，同一处只写一次", async () => {
        const held: {diagnostics: DiagnosticsService | null} = {diagnostics: null};
        const magic: PluginDefinition = {
            id: "x.test",
            contributions: [{capability: CANON_ENTRY_KINDS_POINT, id: "x.test.wand", declaration: {kind: "法器", components: ["x.test.missing", "nbook.canon.panel"]}}],
            entries: [defineEntry({
                id: "probe",
                location: "project",
                activationEvents: ["onStartup"],
                dependencies: [{key: diagnosticsKey}],
                activate: (context) => {
                    held.diagnostics = context.services.require(diagnosticsKey);
                    return {};
                },
            })],
        };
        world = await canonNodeWorld(tmp, {project: [magic]});
        const records = () => held.diagnostics?.query({event: "canon.entry-kinds.missing-component"}).records ?? [];
        await waitUntil("写了诊断", () => records().length > 0);
        expect(records().map((record) => record.data)).toEqual([{kind: "法器", type: "x.test.missing"}]);
    });
});

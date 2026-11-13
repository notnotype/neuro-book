/**
 * 方言的贡献（docs/specs/workspace/markdown-syntaxes.md）：真实内核的浏览器实例。拥有者用产品的两个贡献点定义与
 * `SyntaxCatalog`，带着产品描述里的内置方言声明；贡献方是测试插件 `kbdDialectPlugin`。读写经组成的语言与编解码器核对。
 */

import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

import {afterEach, describe, expect, it} from "bun:test";

import {getSchema, Mark} from "@tiptap/core";

import {createConsoleExporterFactory, createConsoleFallback} from "@notnotype/nb-host/web";
import type {Application} from "@notnotype/nb-runtime/application";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import {codecFor, coreSyntax, createMarkdownLanguage} from "@notnotype/nb-markdown/language";
import type {MarkdownLanguage} from "@notnotype/nb-markdown/language";

import {createApplication} from "nbook/application";

import {descriptor} from "../plugin";
import {MARKDOWN_DIALECTS_POINT, MARKDOWN_SYNTAXES_POINT, validateSyntaxContribution} from "../shared/contracts";
import {dialectsPoint} from "../shared/plugin";
import {languageFor} from "./language-registry";
import {builtinOrder} from "./builtin-syntaxes";
import {SyntaxCatalog} from "./syntax-catalog";
import type {InactiveCode} from "./syntax-catalog";
import {kbdDialectPlugin, kbdSyntax} from "./testing/kbd-dialect";

/** 编解码器的语料在 nb-markdown 里（`src/language/codec/corpus/`），按包入口的位置找。 */
const CORPUS = join(dirname(fileURLToPath(import.meta.resolve("@notnotype/nb-markdown/language"))), "codec", "corpus");

const silent = {error: () => undefined};
const started: Application[] = [];

afterEach(async () => {
    for (const application of started.splice(0)) await application.stop();
});

interface Owner {
    catalog: SyntaxCatalog | null;
    readonly inactive: Array<{readonly id: string; readonly code: InactiveCode}>;
}

/** 与产品的 `nbook.markdown` 浏览器定义同样的贡献点与内置声明，方言目录交给测试。 */
function owner(holder: Owner): PluginDefinition {
    return {
        id: descriptor.id,
        contributionPoints: [dialectsPoint, {id: MARKDOWN_SYNTAXES_POINT, implementation: "required", validate: validateSyntaxContribution}],
        contributions: descriptor.contributions ?? [],
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            receives: [MARKDOWN_SYNTAXES_POINT],
            activate: (context) => {
                const catalog = new SyntaxCatalog(context.declarations, (id, code) => holder.inactive.push({id, code}));
                holder.catalog = catalog;
                return {receivers: {[MARKDOWN_SYNTAXES_POINT]: catalog.receiver()}};
            },
        }],
    };
}

async function start(plugins: ReadonlyArray<PluginDefinition>): Promise<Owner> {
    const holder: Owner = {catalog: null, inactive: []};
    const identity = {location: "browser" as const, instanceId: "markdown-syntaxes"};
    const store = createDiagnosticsStore({identity});
    const diagnostics = createDiagnosticsPlugin({location: "browser", store, exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)});
    const application = createApplication(
        {identity, stopSignal: new AbortController().signal, emergency: () => undefined},
        {capabilities: [], plugins: [diagnostics, owner(holder), ...plugins], requiredPlugins: [diagnostics.id, descriptor.id], gates: []},
    );
    started.push(application);
    await application.startup;
    return holder;
}

/** 读入再不编辑写回：返回读出的第一段与写回的正文。 */
function roundTrip(language: MarkdownLanguage, source: string): {readonly first: unknown; readonly written: string | false} {
    const codec = codecFor(getSchema([...language.extensions]), language);
    const read = codec.read(source);
    const written = codec.write(read.doc, read.map);
    return {first: read.doc.child(0).toJSON().content, written: written.ok && written.text};
}

const SOURCE = "按 <kbd>Ctrl</kbd> 保存。\n";

describe("Spec workspace.markdown-syntaxes：方言的贡献", () => {
    it("输出 1、3、5：外来方言交付后生效，读成它的标记、原样写回；内置方言与核心语法照常；没有它时按原样保留（输出 8）", async () => {
        const without = await start([]);
        const plain = roundTrip(languageFor(without.catalog as SyntaxCatalog), SOURCE);
        expect(plain.first).toEqual([{type: "text", text: "按 "}, {type: "rawInline", attrs: {raw: "<kbd>Ctrl</kbd>"}}, {type: "text", text: " 保存。"}]);
        expect(plain.written).toBe(SOURCE);

        const holder = await start([kbdDialectPlugin()]);
        const catalog = await waitUntil("方言生效", () => (holder.catalog?.active.value.length === 1 ? holder.catalog : null));
        expect(catalog.active.value.map((entry) => [entry.id, entry.order])).toEqual([["test.kbd.kbd", 80]]);
        const language = languageFor(catalog);
        const read = roundTrip(language, SOURCE);
        expect(read.first).toEqual([{type: "text", text: "按 "}, {type: "text", text: "Ctrl", marks: [{type: "test-kbd"}]}, {type: "text", text: " 保存。"}]);
        expect(read.written).toBe(SOURCE);
        // 同一组生效的方言只组成一次：同时建立的视图拿到同一份语言（输出 7）。
        expect(languageFor(catalog)).toBe(language);
        expect(roundTrip(language, "<comment body=\"意见\">批注</comment>\n").written).toBe("<comment body=\"意见\">批注</comment>\n");
        expect(holder.inactive).toEqual([]);
    });

    it("输出 3 与失败码：没有声明、标签名与声明不同、加载失败的方言不生效，各记一条诊断", async () => {
        const holder = await start([
            kbdDialectPlugin({id: "test.undeclared", declaration: null}),
            kbdDialectPlugin({id: "test.mismatch", implementation: {load: async () => kbdSyntax({declaredTags: ["key"]})}}),
            kbdDialectPlugin({id: "test.broken", implementation: {load: async () => {
                throw new Error("加载失败");
            }}}),
        ]);
        await waitUntil("三条诊断", () => (holder.inactive.length === 3 ? true : null));
        expect(holder.catalog?.active.value).toEqual([]);
        expect(new Set(holder.inactive.map((entry) => `${entry.id} ${entry.code}`))).toEqual(new Set(["test.undeclared.kbd missing-declaration", "test.mismatch.kbd tag-mismatch", "test.broken.kbd load-failed"]));
    });

    it("输出 4：两种外来方言声明同一个标签，两种都不生效，与登记先后无关；与内置方言撞名的只拒外来的；别的方言照常生效", async () => {
        for (const order of [["test.a", "test.b"], ["test.b", "test.a"]]) {
            const holder = await start([
                ...order.map((id) => kbdDialectPlugin({id})),
                kbdDialectPlugin({id: "test.keys", declaration: {order: 90, inlineTags: ["key"]}, implementation: {load: async () => kbdSyntax({tag: "key"})}}),
            ]);
            await waitUntil("撞名的两种都记下", () => (holder.inactive.length >= 2 ? true : null));
            expect(new Set(holder.inactive.map((entry) => `${entry.id} ${entry.code}`))).toEqual(new Set(["test.a.kbd conflict", "test.b.kbd conflict"]));
        }
        const builtin = await start([kbdDialectPlugin({id: "test.ruby", declaration: {order: 80, inlineTags: ["ruby"]}, implementation: {load: async () => kbdSyntax({tag: "ruby"})}})]);
        await waitUntil("与内置方言撞名", () => (builtin.inactive.length === 1 ? true : null));
        expect(builtin.inactive).toEqual([{id: "test.ruby.kbd", code: "conflict"}]);
        expect(roundTrip(languageFor(builtin.catalog as SyntaxCatalog), "<ruby text=\"zhù\">注</ruby>\n").written).toBe("<ruby text=\"zhù\">注</ruby>\n");
    });

    it("输出 4：与组合扩展里的子扩展（`StarterKit` 的 `bold`）或原样语法的写法（`rawInline`）撞名的外来方言不生效，只拒它们；语言照常组成，别的外来方言照常生效", async () => {
        const key = kbdSyntax({tag: "key"});
        const pad = kbdSyntax({tag: "pad"});
        const holder = await start([
            kbdDialectPlugin({id: "test.bold", declaration: {order: 80, inlineTags: ["key"]}, implementation: {load: async () => ({...key, extensions: [...key.extensions, Mark.create({name: "bold"})]})}}),
            kbdDialectPlugin({id: "test.raw", declaration: {order: 81, inlineTags: ["pad"]}, implementation: {load: async () => ({...pad, writeInline: {rawInline: () => "x"}})}}),
            kbdDialectPlugin({id: "test.ok", declaration: {order: 82, inlineTags: ["ok"]}, implementation: {load: async () => kbdSyntax({tag: "ok"})}}),
        ]);
        const catalog = await waitUntil("三种都交付", () => (holder.catalog?.active.value.length === 3 ? holder.catalog : null));
        const language = languageFor(catalog);
        expect(new Set(holder.inactive.map((entry) => `${entry.id} ${entry.code}`))).toEqual(new Set(["test.bold.kbd conflict", "test.raw.kbd conflict"]));
        const source = "**粗** 与 <key>K</key> <ok>O</ok>\n";
        const read = roundTrip(language, source);
        expect(read.written).toBe(source);
        expect(read.first).toContainEqual({type: "text", text: "O", marks: [{type: "test-ok"}]});
    });

    it("输出 6、7：贡献方停止，方言撤回，组成新的语言；之前拿到的语言照旧能读写它", async () => {
        let contributor: ActivationContext | null = null;
        const holder = await start([kbdDialectPlugin({onActivate: (context) => {
            contributor = context;
        }})]);
        const catalog = await waitUntil("方言生效", () => (holder.catalog?.active.value.length === 1 ? holder.catalog : null));
        const before = languageFor(catalog);
        await (contributor as ActivationContext | null)?.scope.parent?.close();
        expect(catalog.active.value).toEqual([]);
        expect(languageFor(catalog)).not.toBe(before);
        expect(roundTrip(before, SOURCE).written).toBe(SOURCE);
    });

    it("输出 6、7：生效的方言集合没变（晚到的方言没生效）时不换数组，组成的语言还是同一份", async () => {
        const holder = await start([
            kbdDialectPlugin({id: "test.keys", declaration: {order: 90, inlineTags: ["key"]}, implementation: {load: async () => kbdSyntax({tag: "key"})}}),
            kbdDialectPlugin({id: "test.mismatch", activationEvents: [], implementation: {load: async () => kbdSyntax({declaredTags: ["other"]})}}),
        ]);
        const application = started.at(-1) as Application;
        const catalog = await waitUntil("一种方言生效", () => (holder.catalog?.active.value.length === 1 ? holder.catalog : null));
        const language = languageFor(catalog);
        expect(await application.plugins.activate({plugin: "test.mismatch", entry: "browser"})).toMatchObject({status: "activated"});
        await waitUntil("晚到的那种不生效", () => (holder.inactive.length === 1 ? true : null));
        expect(languageFor(catalog)).toBe(language);
    });

    it("输出 3：块级与行内分开核对（声明成块级、实现只认行内的不生效）；声明与实现出自不同插件的不配对", async () => {
        const holder = await start([
            kbdDialectPlugin({id: "test.block", declaration: {order: 80, blockTags: ["kbd"]}}),
            kbdDialectPlugin({id: "test.a", declaration: null, implementation: {load: async () => kbdSyntax({tag: "key"})}}),
            // 插件 `test` 声明的 `test.a.kbd` 合乎 id 规则（以 `test.` 开头），但实现出自插件 `test.a`。
            {id: "test", contributions: [{capability: MARKDOWN_DIALECTS_POINT, id: "test.a.kbd", declaration: {order: 85, inlineTags: ["key"]}}], entries: []},
        ]);
        await waitUntil("两条诊断", () => (holder.inactive.length === 2 ? true : null));
        expect(new Set(holder.inactive.map((entry) => `${entry.id} ${entry.code}`))).toEqual(new Set(["test.block.kbd tag-mismatch", "test.a.kbd missing-declaration"]));
    });

    it("验收 3：内置方言逐个缺席时语言照常组成（核心语法不依赖可选的方言），方言语料不编辑写回字节不变", () => {
        const corpus = ["dialect-blocks.md", "dialect-comments.md", "dialect-text.md"].map((name) => readFileSync(join(CORPUS, name), "utf8"));
        for (const absent of builtinOrder()) {
            const language = createMarkdownLanguage([...builtinOrder().filter((entry) => entry.id !== absent.id).map((entry) => entry.syntax), coreSyntax]);
            for (const source of corpus) expect([absent.id, roundTrip(language, source).written]).toEqual([absent.id, source]);
        }
    });
});

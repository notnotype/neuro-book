/**
 * `defineEntry` 的编译期核对（runtime.plugins 验收 28）。反例写在 `@ts-expect-error` 下，由 `bun run typecheck`
 * 执行：核对一旦失效，那一行的指令就成了多余的，类型检查失败。运行期只验证原样返回，以及类型分不出的 id 由
 * 激活时的产出核对报出。
 */

import {afterEach, describe, expect, it} from "bun:test";
import {Type} from "typebox";

import {createRuntimeInstance} from "../lifecycle/lifecycle";
import type {Scope} from "../lifecycle/lifecycle";
import {defineRemoteService, provideRemote} from "../remote/remote";
import type {RemoteProvision} from "../remote/remote";
import {createServiceAssembly, defineServiceKey} from "../services/services";

import {createPluginHost, defineEntry, provide, providePerConsumer} from "./plugins";
import type {ContributionDeclaration, ContributionReceiver} from "./plugins";

interface Counter {
    read(): number;
}

interface Label {
    text(): string;
}

const counterKey = defineServiceKey<Counter>("sample/counter");
const labelKey = defineServiceKey<Label>("sample/label");
/** 与 counterKey 同一服务类型、不同 id：类型上分不出来。 */
const otherCounterKey = defineServiceKey<Counter>("sample/other-counter");

const Empty = Type.Object({}, {additionalProperties: false});
const readContract = defineRemoteService({id: "sample/read", version: 1, provider: "client", callers: ["server"], methods: {read: {input: Empty, output: Type.Number(), effect: "read"}}});
const writeContract = defineRemoteService({id: "sample/write", version: 1, provider: "client", callers: ["server"], methods: {write: {input: Empty, output: Type.Null(), effect: "write"}}});

const POINT = "sample.items";
const receiver: ContributionReceiver = {};
const counter: Counter = {read: () => 1};

const readProvision = () => provideRemote(readContract, () => ({methods: {read: () => ({ok: true, value: 1})}}));
const writeProvision = () => provideRemote(writeContract, () => ({methods: {write: () => ({ok: true, value: null})}}));

describe("Spec runtime.plugins 验收 28：defineEntry 编译期核对", () => {
    it("合法的写法：字面量不用 as const，async、按调用方提供、在整个产出上按位置分支、带参数的辅助函数都能通过", () => {
        const all = defineEntry({
            id: "all", location: "browser",
            provides: [counterKey, labelKey], remoteProvides: [readContract], receives: [POINT],
            contributions: [{capability: POINT, id: "sample.one", declaration: {}}],
            activate: () => ({
                services: [provide(counterKey, counter), provide(labelKey, {text: () => "label"})],
                remote: [readProvision()],
                receivers: {[POINT]: receiver},
                contributions: {[POINT]: {"sample.one": {run: () => 1}}},
            }),
        });
        const asynchronous = defineEntry({id: "async", location: "server", provides: [counterKey], activate: async () => {
            const value: Counter = {read: () => 2};
            return {services: [providePerConsumer(counterKey, () => value)]};
        }});
        const byLocation = (location: string) => {
            const browser = location === "browser";
            const helper = (): RemoteProvision<typeof readContract> => readProvision();
            return defineEntry({id: location, location, provides: [counterKey], remoteProvides: browser ? [readContract] : [], activate: () => {
                const base = {services: [provide(counterKey, counter)]} as const;
                return browser ? {...base, remote: [helper()]} : base;
            }});
        };
        const wideDeclarations: ReadonlyArray<ContributionDeclaration> = [{capability: POINT, id: "sample.wide", declaration: {}}];
        const wide = defineEntry({id: "wide", location: "server", contributions: wideDeclarations, activate: () => ({contributions: {[POINT]: {"sample.wide": 1}}})});
        const empty = defineEntry({id: "empty", location: "server", activate: () => ({})});
        for (const entry of [all, asynchronous, byLocation("browser"), byLocation("server"), wide, empty]) {
            expect(typeof entry.activate).toBe("function");
        }
    });

    it("不一致的写法各自是类型错误", () => {
        const entries = [
            // @ts-expect-error 漏写服务
            defineEntry({id: "x", location: "server", provides: [counterKey, labelKey], activate: () => ({services: [provide(counterKey, counter)]})}),
            // @ts-expect-error 多写服务
            defineEntry({id: "x", location: "server", provides: [counterKey], activate: () => ({services: [provide(counterKey, counter), provide(labelKey, {text: () => ""})]})}),
            // @ts-expect-error 没声明却产出服务
            defineEntry({id: "x", location: "server", activate: () => ({services: [provide(counterKey, counter)]})}),
            // @ts-expect-error 服务类型不符
            defineEntry({id: "x", location: "server", provides: [counterKey], activate: () => ({services: [provide(labelKey, {text: () => ""})]})}),
            // @ts-expect-error 漏写远程提供项
            defineEntry({id: "x", location: "browser", remoteProvides: [readContract, writeContract], activate: () => ({remote: [readProvision()]})}),
            // @ts-expect-error 合同形状不符
            defineEntry({id: "x", location: "browser", remoteProvides: [readContract], activate: () => ({remote: [writeProvision()]})}),
            // @ts-expect-error 没声明却产出远程提供项
            defineEntry({id: "x", location: "browser", activate: () => ({remote: [readProvision()]})}),
            // @ts-expect-error 辅助函数返回宽类型，擦掉了要核对的合同
            defineEntry({id: "x", location: "browser", remoteProvides: [readContract], activate: () => ({remote: [((): RemoteProvision => readProvision())()]})}),
            // @ts-expect-error 漏写接收者
            defineEntry({id: "x", location: "server", receives: [POINT], activate: () => ({receivers: {}})}),
            // @ts-expect-error 多写接收者
            defineEntry({id: "x", location: "server", receives: [POINT], activate: () => ({receivers: {[POINT]: receiver, "sample.extra": receiver}})}),
            // @ts-expect-error 没声明却产出接收者（async）
            defineEntry({id: "x", location: "server", activate: async () => ({receivers: {[POINT]: receiver}})}),
            // @ts-expect-error 漏写贡献实现
            defineEntry({id: "x", location: "server", contributions: [{capability: POINT, id: "sample.one", declaration: {}}], activate: () => ({contributions: {[POINT]: {}}})}),
            // @ts-expect-error 多写贡献实现
            defineEntry({id: "x", location: "server", contributions: [{capability: POINT, id: "sample.one", declaration: {}}], activate: () => ({contributions: {[POINT]: {"sample.one": 1, "sample.two": 2}}})}),
            // @ts-expect-error 多写贡献点
            defineEntry({id: "x", location: "server", contributions: [{capability: POINT, id: "sample.one", declaration: {}}], activate: () => ({contributions: {[POINT]: {"sample.one": 1}, "sample.other": {}}})}),
            // 数值键在运行时也是字符串键，同样算多写。
            // @ts-expect-error 多写接收者（数值键）
            defineEntry({id: "x", location: "server", receives: [POINT], activate: () => ({receivers: {[POINT]: receiver, 2: receiver}})}),
            // @ts-expect-error 多写贡献实现（数值键）
            defineEntry({id: "x", location: "server", contributions: [{capability: POINT, id: "sample.one", declaration: {}}], activate: () => ({contributions: {[POINT]: {"sample.one": 1, 2: 2}}})}),
            // @ts-expect-error 多写贡献点（数值键）
            defineEntry({id: "x", location: "server", contributions: [{capability: POINT, id: "sample.one", declaration: {}}], activate: () => ({contributions: {[POINT]: {"sample.one": 1}, 2: {extra: 2}}})}),
        ];
        expect(entries).toHaveLength(17);
    });
});

describe("defineEntry 的运行期", () => {
    const roots: Scope[] = [];
    afterEach(async () => {
        await Promise.all(roots.splice(0).map((scope) => scope.close()));
    });

    function host() {
        const runtime = createRuntimeInstance({location: "server", instanceId: "define"});
        runtime.root.open();
        roots.push(runtime.root);
        return {root: runtime.root, plugins: createPluginHost(runtime, createServiceAssembly(runtime), {})};
    }

    it("原样返回入口，照常登记与激活", async () => {
        const entry = {id: "main", location: "server", provides: [counterKey], activate: () => ({services: [provide(counterKey, counter)]})};
        expect(defineEntry(entry)).toBe(entry);
        const {root, plugins} = host();
        expect(plugins.register({id: "sample", entries: [defineEntry(entry)]}, {scope: root})).toMatchObject({status: "accepted"});
        expect(await plugins.activate({plugin: "sample", entry: "main"})).toMatchObject({status: "activated"});
    });

    it("服务类型相同、id 不同：编译期分不出，激活时的产出核对报出", async () => {
        const entry = defineEntry({id: "main", location: "server", provides: [counterKey], activate: () => ({services: [provide(otherCounterKey, counter)]})});
        const {root, plugins} = host();
        expect(plugins.register({id: "sample", entries: [entry]}, {scope: root})).toMatchObject({status: "accepted"});
        expect(await plugins.activate({plugin: "sample", entry: "main"})).toMatchObject({status: "failed", stage: "output", reason: "undeclared-service"});
    });
});

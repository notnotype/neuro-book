/**
 * 由代码提供的场景图（docs/specs/theme/skins.md 输出 18）：目录层的行为，用真实的 Blob 与对象 URL。解码是浏览器的事（`Image.decode`），
 * 这里注入成可控的函数，真实浏览器里的解码、损坏图片回退由 `e2e/themes.e2e.ts` 覆盖。
 */

import {effect} from "@vue/reactivity";
import {afterEach, beforeEach, describe, expect, it} from "bun:test";

import type {ContributionHandle} from "@notnotype/nb-runtime/plugins";

import {SceneProviders} from "./web/scene-providers";
import type {SceneProviderOptions} from "./web/scene-providers";
import {MAX_SCENE_BYTES} from "./shared/themes";
import type {SceneProviderDeclaration, SceneProviderImplementation, SceneRequest, SceneResult} from "./shared/themes";

const png = (size = 8): Blob => new Blob([new Uint8Array(size)], {type: "image/png"});
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const entry = (id: string, provider = "acme.sky.clock") => ({id, declaration: {sceneProvider: provider}});

interface Fixture {
    readonly scenes: SceneProviders;
    readonly requests: Array<{request: SceneRequest; signal: AbortSignal}>;
    readonly reports: Array<readonly [string, string]>;
    readonly publish: (reply: (request: SceneRequest, signal: AbortSignal) => Promise<SceneResult>, id?: string) => ProviderHandle;
    /** 撤回提供者：和内核一样，撤回后 `implementation()` 抛错。 */
    readonly revoke: (handle: ProviderHandle) => void;
}

type ProviderHandle = ContributionHandle<SceneProviderDeclaration, SceneProviderImplementation> & {published: boolean};

function fixture(options: SceneProviderOptions = {}): Fixture {
    const reports: Array<readonly [string, string]> = [];
    const scenes = new SceneProviders({decode: async () => undefined, report: (id, problem) => reports.push([id, problem]), ...options});
    const requests: Fixture["requests"] = [];
    const receiver = scenes.receiver();
    return {
        scenes,
        requests,
        reports,
        publish: (reply, id = "acme.sky.clock") => {
            const handle: ProviderHandle = {
                capability: "workbench.theme-scenes",
                id,
                plugin: "acme.sky",
                entry: "browser",
                generation: 1,
                kind: "entry",
                declaration: {},
                published: true,
                implementation: () => {
                    if (!handle.published) throw new Error("贡献已撤回");
                    return {scene: (request, signal) => {
                        requests.push({request, signal});
                        return reply(request, signal);
                    }};
                },
            };
            receiver.published?.(handle, undefined);
            return handle;
        },
        revoke: (handle) => {
            handle.published = false;
            void receiver.revoke?.(handle, undefined, "activation-stopped");
        },
    };
}

let revoked: string[] = [];
const originalRevoke = URL.revokeObjectURL;
beforeEach(() => {
    revoked = [];
    URL.revokeObjectURL = (url: string) => {
        revoked.push(url);
        originalRevoke(url);
    };
});
afterEach(() => {
    URL.revokeObjectURL = originalRevoke;
});

describe("workbench.theme-scenes", () => {
    it("提供者发布后第一次读发起请求，画好后读到对象 URL，读过它的 effect 自动重算；明暗与状态各是一张", async () => {
        const {scenes, requests, publish} = fixture();
        publish(async () => ({image: png()}));
        const seen: Array<string | undefined> = [];
        effect(() => {
            seen.push(scenes.sceneFor(entry("acme.sky.study"), "light", false));
        });
        expect(seen).toEqual([undefined]);
        await settle();
        expect(seen).toHaveLength(2);
        expect(seen[1]).toMatch(/^blob:/u);
        expect(requests).toHaveLength(1);
        expect(requests[0]!.request).toEqual({appearance: "light", working: false});

        // 同一个键不再请求；换明暗或状态是另一个键。
        expect(scenes.sceneFor(entry("acme.sky.study"), "light", false)).toBe(seen[1]!);
        expect(scenes.sceneFor(entry("acme.sky.study"), "dark", true)).toBeUndefined();
        await settle();
        expect(requests.map(({request}) => request)).toEqual([{appearance: "light", working: false}, {appearance: "dark", working: true}]);
        scenes.dispose();
    });

    it("提供者没发布、主题没写 sceneProvider 时没有动态图，也不发请求", async () => {
        const {scenes, requests, publish} = fixture();
        expect(scenes.sceneFor(entry("acme.sky.study"), "light", false)).toBeUndefined();
        publish(async () => ({image: png()}), "acme.other.provider");
        expect(scenes.sceneFor({id: "acme.sky.plain", declaration: {}}, "light", false)).toBeUndefined();
        expect(scenes.sceneFor(entry("acme.sky.study"), "light", false)).toBeUndefined();
        await settle();
        expect(requests).toEqual([]);
        scenes.dispose();
    });

    it.each([
        ["提供者 reject", async (): Promise<SceneResult> => { throw new Error("画不出"); }, {}, "画不出"],
        ["返回的不是图片", async (): Promise<SceneResult> => ({image: new Blob(["x"], {type: "text/plain"})}), {}, "不是图片"],
        ["图片超过 4 MB", async (): Promise<SceneResult> => ({image: png(MAX_SCENE_BYTES + 1)}), {}, "超过"],
        ["浏览器解不开", async (): Promise<SceneResult> => ({image: png()}), {decode: async () => { throw new Error("EncodingError"); }}, "EncodingError"],
    ] as const)("%s：用后备图，按提供者记一次诊断，不重试", async (_name, reply, options, problem) => {
        const {scenes, requests, reports, publish} = fixture(options as SceneProviderOptions);
        publish(reply);
        scenes.sceneFor(entry("acme.sky.a"), "light", false);
        scenes.sceneFor(entry("acme.sky.b"), "light", false);
        await settle();
        expect(scenes.sceneFor(entry("acme.sky.a"), "light", false)).toBeUndefined();
        expect(requests).toHaveLength(2);
        expect(reports).toHaveLength(1);
        expect(reports[0]![0]).toBe("acme.sky.clock");
        expect(reports[0]![1]).toContain(problem);
        // 失败的图没有留下对象 URL。
        await settle();
        scenes.dispose();
    });

    it("提供者撤回：在飞的请求被取消，画好的图被撤销；重新发布后再请求", async () => {
        const {scenes, requests, publish, revoke} = fixture();
        const first = publish(async () => ({image: png()}));
        scenes.sceneFor(entry("acme.sky.study"), "light", false);
        await settle();
        const url = scenes.sceneFor(entry("acme.sky.study"), "light", false);
        expect(url).toMatch(/^blob:/u);

        revoke(first);
        expect(revoked).toContain(url!);
        expect(scenes.sceneFor(entry("acme.sky.study"), "light", false)).toBeUndefined();

        publish(async () => ({image: png(16)}));
        scenes.sceneFor(entry("acme.sky.study"), "light", false);
        await settle();
        expect(requests).toHaveLength(2);
        expect(scenes.sceneFor(entry("acme.sky.study"), "light", false)).toMatch(/^blob:/u);
        scenes.dispose();
    });

    it("在飞的请求遇到撤回：收到取消信号，迟到的结果不回写", async () => {
        const {scenes, requests, publish, revoke} = fixture();
        let finish: (result: SceneResult) => void = () => undefined;
        const handle = publish(() => new Promise<SceneResult>((resolve) => { finish = resolve; }));
        scenes.sceneFor(entry("acme.sky.study"), "light", false);
        await settle();
        expect(requests[0]!.signal.aborted).toBe(false);
        revoke(handle);
        expect(requests[0]!.signal.aborted).toBe(true);
        finish({image: png()});
        await settle();
        expect(scenes.sceneFor(entry("acme.sky.study"), "light", false)).toBeUndefined();
        scenes.dispose();
    });

    it("主题条目重新发布（代次变了）：请求中和解码中的旧结果都不被采用，解码中的旧结果撤销它的 URL", async () => {
        let release: () => void = () => undefined;
        let decoding = 0;
        const {scenes, publish} = fixture({decode: () => { decoding += 1; return new Promise<void>((resolve) => { release = resolve; }); }});
        let finish: (result: SceneResult) => void = () => undefined;
        publish(() => new Promise<SceneResult>((resolve) => { finish = resolve; }));

        // 请求中作废：图画好时已经过期，不建对象 URL。
        scenes.sceneFor(entry("acme.sky.study"), "light", false);
        await settle();
        scenes.generationChanged("acme.sky.study");
        finish({image: png()});
        await settle();
        expect(decoding).toBe(0);
        expect(scenes.sceneFor(entry("acme.sky.study"), "light", false)).toBeUndefined();

        // 解码中作废（上一次读已为新代次发起了请求）：解码完成后丢弃，撤销刚建的 URL。
        await settle();
        finish({image: png()});
        await settle();
        expect(decoding).toBe(1);
        scenes.generationChanged("acme.sky.study");
        release();
        await settle();
        expect(revoked.filter((url) => url.startsWith("blob:"))).toHaveLength(1);
        expect(scenes.sceneFor(entry("acme.sky.study"), "light", false)).toBeUndefined();
        scenes.dispose();
    });

    it("expiresAt 到点重新请求同一个键，新图解码成功后才替换，旧图被撤销", async () => {
        const {scenes, requests, publish} = fixture();
        let round = 0;
        publish(async () => {
            round += 1;
            return {image: png(round), expiresAt: round === 1 ? Date.now() + 20 : undefined};
        });
        scenes.sceneFor(entry("acme.sky.study"), "light", false);
        await settle();
        const first = scenes.sceneFor(entry("acme.sky.study"), "light", false);
        expect(first).toMatch(/^blob:/u);
        const deadline = Date.now() + 2000;
        while (requests.length < 2 && Date.now() < deadline) await settle();
        await settle();
        const second = scenes.sceneFor(entry("acme.sky.study"), "light", false);
        expect(requests).toHaveLength(2);
        expect(second).toMatch(/^blob:/u);
        expect(second).not.toBe(first);
        expect(revoked).toContain(first!);
        scenes.dispose();
    });

    it("dispose：取消在飞的请求，撤销全部对象 URL，之后不再发请求", async () => {
        const {scenes, requests, publish} = fixture();
        publish(async (request) => (request.working ? new Promise<SceneResult>(() => undefined) : {image: png()}));
        scenes.sceneFor(entry("acme.sky.study"), "light", false);
        scenes.sceneFor(entry("acme.sky.study"), "light", true);
        await settle();
        const url = scenes.sceneFor(entry("acme.sky.study"), "light", false)!;
        scenes.dispose();
        expect(requests[1]!.signal.aborted).toBe(true);
        expect(revoked).toContain(url);
        expect(scenes.sceneFor(entry("acme.sky.study"), "dark", false)).toBeUndefined();
        await settle();
        expect(requests).toHaveLength(2);
    });
});

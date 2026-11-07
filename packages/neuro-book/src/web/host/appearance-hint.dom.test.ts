/**
 * 加载页的明暗提示（runtime.browser-host 启动序列第 1 步）：宿主写下的提示与 index.html 内联脚本读的是同一份约定。
 * 内联脚本不能 import，两份 index.html 各抄一份：这里核对两份完全一致，并在 happy-dom 里执行它，读宿主真实写下的值。
 * 浏览器里的第一帧颜色由 `e2e/browser-host.e2e.ts` 验证。
 */

import {readFileSync} from "node:fs";
import {join} from "node:path";

import {afterEach, beforeEach, describe, expect, it} from "vitest";

import {pluginFilesPrefix, pluginFileUrl} from "nbook/plugin-platform/shared/plugin-files";
import {rawUrlOf, THEME_ASSET_DIRECTORY_ADDRESS} from "nbook/plugins/files/shared/contracts";
import type {ThemeDeclaration} from "nbook/plugins/workbench/shared/themes";
import {USER_THEME_PLUGIN} from "nbook/plugins/workbench/shared/user-themes";
import {themeVars} from "nbook/plugins/workbench/web/themes";

import {HOST_APPEARANCE_KEY, hostScenePath, rememberDocumentAppearance} from "./appearance-hint";

const WEB = join(import.meta.dirname, "..");

function inlineScript(file: string): string {
    const html = readFileSync(join(WEB, file), "utf8");
    const match = /<script>([\s\S]*?)<\/script>/u.exec(html);
    if (match?.[1] === undefined) throw new Error(`${file} 里没有内联脚本`);
    return match[1];
}

const root = document.documentElement;
const THEME = {"--panel-surface": "rgb(45, 41, 37)", "--text-main": "rgb(239, 233, 223)", "--text-muted": "rgb(145, 138, 126)", "--accent-main": "rgb(10, 132, 255)"};

function applyTheme(appearance: string, colors: Record<string, string>): void {
    root.dataset.nbAppearance = appearance;
    for (const [name, value] of Object.entries(colors)) root.style.setProperty(name, value);
}

function runInlineScript(): void {
    new Function(inlineScript("index.html"))();
}

beforeEach(() => {
    window.localStorage.clear();
    root.removeAttribute("style");
    root.removeAttribute("data-nb-appearance");
    root.removeAttribute("data-host-appearance");
    root.removeAttribute("data-host-scene");
    root.removeAttribute("data-host-indicator");
});

afterEach(() => {
    root.removeAttribute("style");
});

describe("加载页的明暗提示", () => {
    it("两份 index.html 的内联脚本一字不差，读的键就是宿主写的键", () => {
        expect(inlineScript("testing/index.html")).toBe(inlineScript("index.html"));
        expect(inlineScript("index.html")).toContain(`"${HOST_APPEARANCE_KEY}"`);
    });

    it("两份 index.html 的加载页标记一致：进度指示同时带定位类与形状类（少一个，指示器是 0×0 的空块）", () => {
        const loadingMain = (file: string): string => {
            const match = /<main class="nb-host-loading"[\s\S]*?<\/main>/u.exec(readFileSync(join(WEB, file), "utf8"));
            if (match === null) throw new Error(`${file} 里没有加载页`);
            return match[0];
        };
        expect(loadingMain("testing/index.html")).toBe(loadingMain("index.html"));
        expect(loadingMain("index.html")).toContain(`class="nb-host-loading__bar nb-host-indicator"`);
    });

    it("宿主记下文档根当前的明暗与颜色，主题变了跟着改；内联脚本读回后写到根上", async () => {
        const warnings: string[] = [];
        applyTheme("light", {...THEME, "--panel-surface": "rgb(255, 252, 245)"});
        const stop = rememberDocumentAppearance({root, storage: () => window.localStorage, warn: (message) => warnings.push(message)});
        expect(JSON.parse(window.localStorage.getItem(HOST_APPEARANCE_KEY) ?? "null")).toMatchObject({appearance: "light", background: "rgb(255, 252, 245)"});

        applyTheme("dark", THEME);
        await Promise.resolve();
        expect(JSON.parse(window.localStorage.getItem(HOST_APPEARANCE_KEY) ?? "null")).toEqual({appearance: "dark", background: "rgb(45, 41, 37)", text: "rgb(239, 233, 223)", muted: "rgb(145, 138, 126)", accent: "rgb(10, 132, 255)"});
        stop();

        root.removeAttribute("style");
        runInlineScript();
        expect(root.getAttribute("data-host-appearance")).toBe("dark");
        expect(root.style.colorScheme).toBe("dark");
        expect(root.style.getPropertyValue("--host-loading-background")).toBe("rgb(45, 41, 37)");
        expect(root.style.getPropertyValue("--host-loading-accent")).toBe("rgb(10, 132, 255)");
        expect(warnings).toEqual([]);
    });

    it("还没写主题时不记；本地存储不可用时只说一次，不抛错", async () => {
        const warnings: string[] = [];
        const stop = rememberDocumentAppearance({root, storage: () => window.localStorage, warn: (message) => warnings.push(message)});
        expect(window.localStorage.getItem(HOST_APPEARANCE_KEY)).toBeNull();
        stop();

        const denied = (): Storage => {
            throw new DOMException("denied", "SecurityError");
        };
        const stopDenied = rememberDocumentAppearance({root, storage: denied, warn: (message) => warnings.push(message)});
        applyTheme("dark", THEME);
        await Promise.resolve();
        applyTheme("light", THEME);
        await Promise.resolve();
        stopDenied();
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("SecurityError");
    });

    it("内联脚本不认坏的记录：明暗不合法、读不出或有一项颜色格式不对，就整条不用、什么都不写（按系统明暗）", () => {
        window.localStorage.setItem(HOST_APPEARANCE_KEY, "{坏");
        runInlineScript();
        expect(root.hasAttribute("data-host-appearance")).toBe(false);

        window.localStorage.setItem(HOST_APPEARANCE_KEY, JSON.stringify({appearance: "dim", background: "rgb(1, 2, 3)"}));
        runInlineScript();
        expect(root.hasAttribute("data-host-appearance")).toBe(false);

        window.localStorage.setItem(HOST_APPEARANCE_KEY, JSON.stringify({appearance: "dark", background: "red; display: none", text: "#efe9df", muted: "#918a7e", accent: "#0a84ff"}));
        runInlineScript();
        expect(root.hasAttribute("data-host-appearance")).toBe(false);
        expect(root.style.getPropertyValue("--host-loading-text")).toBe("");
    });
});

describe("加载页的场景图与进度样式（theme.skins 输出 19）", () => {
    const ORIGIN = window.location.origin;
    const COLORS = {appearance: "dark", background: "rgb(45, 41, 37)", text: "rgb(239, 233, 223)", muted: "rgb(145, 138, 126)", accent: "rgb(10, 132, 255)"};
    const stored = (): Record<string, unknown> => JSON.parse(window.localStorage.getItem(HOST_APPEARANCE_KEY) ?? "null") as Record<string, unknown>;

    it.each([
        ["内置素材在开发服务里是绝对地址", `${ORIGIN}/assets/study-day-3f2a.webp`, "/assets/study-day-3f2a.webp"],
        ["内置素材在产物里是 /assets 路径", "/assets/study-day-3f2a.webp", "/assets/study-day-3f2a.webp"],
        ["用户素材", "/api/nbook.files/raw/user/theme-assets/0a1b2c.webp", "/api/nbook.files/raw/user/theme-assets/0a1b2c.webp"],
        ["第三方插件素材（插件 id 里的 @ 与 + 已被转成 %xx）", "/api/runtime/plugins/acme%40skin%2Bx/files/abc123/assets/day.webp", "/api/runtime/plugins/acme%40skin%2Bx/files/abc123/assets/day.webp"],
        ["路径里的引号被 URL 解析转成 %22，不会闭合 url(\"…\")", '/assets/a"b.webp', "/assets/a%22b.webp"],
    ])("场景图地址：%s", (_name, raw, expected) => {
        expect(hostScenePath(`url("${raw}")`, window.location)).toBe(expected);
    });

    it.each([
        ["别的主机", "https://evil.example/a.webp"],
        ["协议相对地址", "//evil.example/a.webp"],
        ["data:", "data:image/svg+xml,<svg/>"],
        ["blob:", "blob:http://localhost:3000/1234"],
        ["javascript:", "javascript:alert(1)"],
        ["带用户名密码", `${ORIGIN.replace("//", "//user:pw@")}/a.webp`],
        ["带查询", "/assets/a.webp?x=1"],
        ["带片段", "/assets/a.webp#x"],
        ["路径里有括号", "/assets/a(1).webp"],
        // 解析会把反斜杠换成斜杠、去掉制表符与换行：这几样要在原始值上就拒绝，否则 `/a\\b` 会被当成 `/a/b`。
        ["原始值里有反斜杠", "/assets/a\\b.webp"],
        ["原始值里有空格", "/assets/a b.webp"],
        ["原始值里有制表符", "/assets/a\tb.webp"],
        ["原始值里有换行", "/assets/a\nb.webp"],
        // 编码的斜杠与反斜杠解析后还在，下游（服务端、反向代理）怎么解释它们不一定一致。
        ["编码的斜杠开头", "/%2f%2fevil.example/a.webp"],
        ["编码的斜杠", "/assets/a%2Fb.webp"],
        ["编码的反斜杠", "/assets/a%5cb.webp"],
        ["超过 2048 个字符", `/assets/${"a".repeat(2048)}.webp`],
    ])("场景图地址不认：%s", (_name, raw) => {
        expect(hostScenePath(`url("${raw}")`, window.location)).toBeNull();
    });

    it("不是 url(\"…\") 的值（没写、none、渐变）不认", () => {
        for (const value of ["", "none", "linear-gradient(red, blue)", "url(/a.webp)x"]) expect(hostScenePath(value, window.location)).toBeNull();
    });

    it("宿主把文档根上的加载页变量记成同源路径与进度样式；缺省的 bar、不认识的样式、跨域的地址都不记", async () => {
        applyTheme("dark", {...THEME, "--skin-loading-scene": `url("${ORIGIN}/assets/study-night-9z.webp")`, "--skin-loading-indicator": "page"});
        const stop = rememberDocumentAppearance({root, storage: () => window.localStorage, warn: () => undefined});
        expect(stored()).toMatchObject({appearance: "dark", scene: "/assets/study-night-9z.webp", indicator: "page"});

        applyTheme("dark", {"--skin-loading-scene": 'url("https://evil.example/a.webp")', "--skin-loading-indicator": "bar"});
        await Promise.resolve();
        expect(stored()).not.toHaveProperty("scene");
        expect(stored()).not.toHaveProperty("indicator");
        applyTheme("dark", {"--skin-loading-indicator": "spinner"});
        await Promise.resolve();
        expect(stored()).not.toHaveProperty("indicator");
        stop();
    });

    it("真实的地址转换器给出的用户素材与第三方插件素材地址，经 themeVars 写到文档根后，宿主能记下、内联脚本能读回", () => {
        const declaration: ThemeDeclaration = {title: "x", base: "nbook", light: {scene: "0a1b2c.webp", loading: {scene: true, indicator: "dots"}}, dark: {}};
        const pluginPrefix = pluginFilesPrefix("/api/runtime", "acme@skin+x", "abc123");
        const urls = {
            user: (_plugin: string, path: string) => rawUrlOf(`${THEME_ASSET_DIRECTORY_ADDRESS}/${path}`, null),
            plugin: (_plugin: string, path: string) => pluginFileUrl(pluginPrefix, `assets/${path}`),
        };
        for (const [kind, assetUrl] of Object.entries(urls)) {
            const vars = themeVars({id: `${kind}.theme`, plugin: kind === "user" ? USER_THEME_PLUGIN : "acme@skin+x", declaration}, "light", assetUrl).vars;
            const loadingScene = vars["--skin-loading-scene"];
            expect(loadingScene, kind).toMatch(/^url\("\/api\//u);
            root.removeAttribute("style");
            window.localStorage.clear();
            applyTheme("light", {...THEME, "--skin-loading-scene": loadingScene ?? ""});
            rememberDocumentAppearance({root, storage: () => window.localStorage, warn: () => undefined})();
            const scene = stored().scene;
            expect(typeof scene, kind).toBe("string");
            root.removeAttribute("style");
            runInlineScript();
            expect(root.style.getPropertyValue("--host-loading-scene"), kind).toBe(`url("${String(scene)}")`);
            expect(root.hasAttribute("data-host-scene"), kind).toBe(true);
            root.removeAttribute("data-host-scene");
        }
    });

    it("内联脚本读回：场景图写成 --host-loading-scene 并标 data-host-scene，进度样式标 data-host-indicator", () => {
        window.localStorage.setItem(HOST_APPEARANCE_KEY, JSON.stringify({...COLORS, scene: "/assets/study-night-9z.webp", indicator: "dots"}));
        runInlineScript();
        expect(root.style.getPropertyValue("--host-loading-scene")).toBe('url("/assets/study-night-9z.webp")');
        expect(root.hasAttribute("data-host-scene")).toBe(true);
        expect(root.getAttribute("data-host-indicator")).toBe("dots");
    });

    it("两个字段各自独立判定：场景图不合格只丢场景图，进度样式不合格只丢进度样式，颜色都照常用", () => {
        const rejected = ["//evil.example/a.webp", "https://evil.example/a.webp", "/a(1).webp", "/a.webp?x=1", "/%2f%2fevil.example/a.webp", "/a%5Cb.webp", "/a\\b.webp", "/a b.webp", "/a\tb.webp", `/${"a".repeat(3000)}.webp`, 3];
        for (const scene of rejected) {
            root.removeAttribute("style");
            root.removeAttribute("data-host-scene");
            root.removeAttribute("data-host-indicator");
            window.localStorage.setItem(HOST_APPEARANCE_KEY, JSON.stringify({...COLORS, scene, indicator: "pulse"}));
            runInlineScript();
            expect(root.hasAttribute("data-host-scene"), String(scene).slice(0, 40)).toBe(false);
            expect(root.style.getPropertyValue("--host-loading-scene")).toBe("");
            expect(root.getAttribute("data-host-indicator")).toBe("pulse");
            expect(root.style.getPropertyValue("--host-loading-accent")).toBe("rgb(10, 132, 255)");
        }
        for (const indicator of ["spinner", "bar", "", 3, null]) {
            root.removeAttribute("style");
            root.removeAttribute("data-host-scene");
            root.removeAttribute("data-host-indicator");
            window.localStorage.setItem(HOST_APPEARANCE_KEY, JSON.stringify({...COLORS, scene: "/assets/a.webp", indicator}));
            runInlineScript();
            expect(root.hasAttribute("data-host-indicator"), String(indicator)).toBe(false);
            expect(root.hasAttribute("data-host-scene")).toBe(true);
        }
    });

    it("颜色不合格整条不认时，场景图与进度样式也不用（只有一部分会让底色与文字明暗混在一起）", () => {
        window.localStorage.setItem(HOST_APPEARANCE_KEY, JSON.stringify({...COLORS, background: "red; display: none", scene: "/assets/a.webp", indicator: "page"}));
        runInlineScript();
        expect(root.hasAttribute("data-host-scene")).toBe(false);
        expect(root.hasAttribute("data-host-indicator")).toBe(false);
    });
});

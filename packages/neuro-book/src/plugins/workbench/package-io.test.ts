/**
 * 主题包的导出与导入（docs/specs/theme/editor.md 输出 15、16 与验收 9、10）：导出的包读得回来；坏包整个拒绝并说出原因，不交出任何东西。
 */

import {describe, expect, it} from "bun:test";
import {unzipSync, zipSync} from "fflate";

import {THEME_ICON_MAX_BYTES} from "nbook/plugins/files/shared/contracts";
import {exportPackage, PACKAGE_LIMITS, readPackage} from "./web/components/theme-editor/package-io";
import type {UserTheme} from "./shared/user-themes";

const HASH_DAY = `${"a".repeat(64)}.webp`;
const HASH_NIGHT = `${"b".repeat(64)}.png`;
/** 只有文件头的“图片”：判定按开头的字节。 */
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9]);

const theme = (extra: Partial<UserTheme["declaration"]> = {}): UserTheme => ({
    id: "user:00000000-0000-4000-8000-000000000001",
    declaration: {title: {"zh-CN": "夜读", "en-US": "Night Reading"}, base: "nbook", light: {colors: {"--bg-main": "#fff"}, scene: HASH_DAY}, dark: {scene: HASH_NIGHT}, crop: {empty: {position: "50% 50%"}}, ...extra},
});

const assets: Record<string, Uint8Array> = {[HASH_DAY]: WEBP, [HASH_NIGHT]: PNG};
const reader = async (name: string): Promise<Uint8Array | null> => assets[name] ?? null;
const text = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
const identity = {name: "x", publisher: "local", version: "0.1.0", engines: {neurobook: ">=0.1.0"}};
const manifestOf = (declaration: unknown) => ({...identity, contributes: [{capability: "workbench.themes", id: "local.x.x", declaration}]});

describe("导出", () => {
    it("得到不写代码的主题插件：package.json 加 assets，声明里的场景是包内路径", async () => {
        const result = await exportPackage(theme(), reader);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.package.fileName).toBe("night-reading.zip");
        const files = unzipSync(result.package.bytes);
        expect(Object.keys(files).sort()).toEqual([`assets/${HASH_DAY}`, `assets/${HASH_NIGHT}`, "package.json"].sort());
        const manifest = JSON.parse(new TextDecoder().decode(files["package.json"])) as {name: string; publisher: string; contributes: Array<{capability: string; id: string; declaration: {light: {scene: string}; dark: {scene: string}}}>};
        expect(manifest).toMatchObject({name: "night-reading", publisher: "local"});
        expect(manifest.contributes[0]).toMatchObject({capability: "workbench.themes", id: "local.night-reading.night-reading"});
        expect(manifest.contributes[0]?.declaration.light.scene).toBe(`assets/${HASH_DAY}`);
        expect(files[`assets/${HASH_DAY}`]).toEqual(WEBP);
    });

    it("标题写不出包名时用主题 id 的前八位；读不到某张图时整个失败并说出是哪张", async () => {
        const result = await exportPackage(theme({title: {"zh-CN": "夜读", "en-US": "夜读"}}), reader);
        expect(result.ok && result.package.fileName).toBe("theme-00000000.zip");
        expect(await exportPackage(theme(), async () => null)).toEqual({ok: false, reason: HASH_DAY});
    });

    it("没有场景图的主题也能导出", async () => {
        const result = await exportPackage(theme({light: {}, dark: {}}), reader);
        expect(result.ok).toBe(true);
    });
});

describe("导入", () => {
    it("导出的包读得回来：声明与素材一一对应", async () => {
        const exported = await exportPackage(theme(), reader);
        if (!exported.ok) throw new Error("导出失败");
        const read = readPackage(exported.package.bytes);
        expect(read.ok).toBe(true);
        if (!read.ok) return;
        expect(read.themes).toHaveLength(1);
        const [imported] = read.themes;
        expect(imported?.declaration.title).toEqual({"zh-CN": "夜读", "en-US": "Night Reading"});
        expect(imported?.declaration.light.scene).toBe(`assets/${HASH_DAY}`);
        expect([...(imported?.assets.keys() ?? [])].sort()).toEqual([`assets/${HASH_DAY}`, `assets/${HASH_NIGHT}`].sort());
        expect(imported?.assets.get(`assets/${HASH_DAY}`)).toEqual(WEBP);
    });

    it("仓库里的示例主题插件（theme-dusk）也读得进来", async () => {
        const root = new URL("../../../plugin-sdk/examples/external/theme-dusk/", import.meta.url);
        const files: Record<string, Uint8Array> = {"package.json": new Uint8Array(await Bun.file(new URL("package.json", root)).arrayBuffer())};
        for (const name of ["dusk-day.webp", "dusk-night.webp", "dusk-day-working.webp", "dusk-night-working.webp"]) files[`assets/${name}`] = new Uint8Array(await Bun.file(new URL(`assets/${name}`, root)).arrayBuffer());
        const read = readPackage(zipSync(files));
        expect(read.ok).toBe(true);
    });

    it("图标与工作态场景往返：两套明暗共用的文件在包里只有一份，两处声明指向同一个包内路径；场景提供者保留", async () => {
        const WORKING = `${"c".repeat(64)}.webp`;
        const FILES = `${"d".repeat(64)}.svg`;
        const SEARCH = `${"e".repeat(64)}.svg`;
        const withAll = theme({sceneProvider: "acme.sky.clock", light: {scene: HASH_DAY, workingScene: WORKING, icons: {files: FILES, search: SEARCH}}, dark: {scene: HASH_NIGHT, workingScene: WORKING, icons: {files: FILES}}});
        const svg = new TextEncoder().encode('<svg viewBox="0 0 24 24"><path d="M0 0h4"/></svg>');
        const bytes: Record<string, Uint8Array> = {...assets, [WORKING]: WEBP, [FILES]: svg, [SEARCH]: svg};
        const exported = await exportPackage(withAll, async (name) => bytes[name] ?? null);
        if (!exported.ok) throw new Error(exported.reason);
        const files = unzipSync(exported.package.bytes);
        expect(Object.keys(files).sort()).toEqual([`assets/${HASH_DAY}`, `assets/${HASH_NIGHT}`, `assets/${WORKING}`, `assets/${FILES}`, `assets/${SEARCH}`, "package.json"].sort());

        const read = readPackage(exported.package.bytes);
        expect(read.ok).toBe(true);
        const [imported] = read.ok ? read.themes : [];
        expect(imported?.declaration.light).toEqual({scene: `assets/${HASH_DAY}`, workingScene: `assets/${WORKING}`, icons: {files: `assets/${FILES}`, search: `assets/${SEARCH}`}});
        expect(imported?.declaration.dark).toEqual({scene: `assets/${HASH_NIGHT}`, workingScene: `assets/${WORKING}`, icons: {files: `assets/${FILES}`}});
        expect(imported?.declaration.sceneProvider).toBe("acme.sky.clock");
        expect([...(imported?.assets.keys() ?? [])].sort()).toEqual([`assets/${HASH_DAY}`, `assets/${HASH_NIGHT}`, `assets/${WORKING}`, `assets/${FILES}`, `assets/${SEARCH}`].sort());
    });

    it("满额的主题（4 张位图、每套 64 个图标）导出的包，自己导得回来", async () => {
        const icons = (tag: string) => Object.fromEntries(Array.from({length: 64}, (_unused, index) => [`icon-${String(index)}`, `${String(index).padStart(2, "0")}${tag.repeat(62)}.svg`]));
        const full = theme({light: {scene: HASH_DAY, workingScene: `${"c".repeat(64)}.webp`, icons: icons("a")}, dark: {scene: HASH_NIGHT, workingScene: `${"d".repeat(64)}.webp`, icons: icons("b")}});
        const read = async (name: string): Promise<Uint8Array | null> => (name.endsWith(".svg") ? new TextEncoder().encode(`<svg viewBox="0 0 1 1"><title>${name}</title></svg>`) : WEBP);
        const exported = await exportPackage(full, read);
        if (!exported.ok) throw new Error(exported.reason);
        expect(Object.keys(unzipSync(exported.package.bytes))).toHaveLength(4 + 128 + 1);
        expect(readPackage(exported.package.bytes).ok).toBe(true);
    });

    const good = {title: "x", base: "nbook", light: {}, dark: {}};
    it.each<[string, Record<string, Uint8Array> | Uint8Array, RegExp]>([
        ["不是 zip", new Uint8Array([1, 2, 3, 4]), /读不了/u],
        ["路径往上走", {"package.json": text(manifestOf(good)), "../evil.txt": new Uint8Array([1])}, /路径/u],
        ["路径从根开始", {"package.json": text(manifestOf(good)), "/etc/x": new Uint8Array([1])}, /路径/u],
        ["路径带反斜杠", {"package.json": text(manifestOf(good)), "a\\b.txt": new Uint8Array([1])}, /路径/u],
        ["路径是 ./ 开头", {"package.json": text(manifestOf(good)), "./x.txt": new Uint8Array([1])}, /路径/u],
        ["路径里有空段", {"package.json": text(manifestOf(good)), "a//b.txt": new Uint8Array([1])}, /路径/u],
        ["路径是盘符", {"package.json": text(manifestOf(good)), "C:/x.txt": new Uint8Array([1])}, /路径/u],
        ["package.json 是 null（曾抛未捕获的异常）", {"package.json": text(null)}, /不合格/u],
        ["contributes 里有 null（曾抛未捕获的异常）", {"package.json": text({...identity, contributes: [null]})}, /不合格/u],
        ["没有插件身份（缺 name、publisher、engines）", {"package.json": text({contributes: [{capability: "workbench.themes", id: "x", declaration: good}]})}, /不合格/u],
        ["主题 id 不以插件 id 开头", {"package.json": text({...identity, contributes: [{capability: "workbench.themes", id: "foreign.x.theme", declaration: good}]})}, /以插件 id 开头/u],
        ["主题 id 重复", {"package.json": text({...identity, contributes: [{capability: "workbench.themes", id: "local.x.a", declaration: good}, {capability: "workbench.themes", id: "local.x.a", declaration: good}]})}, /重复/u],
        ["带运行入口的插件", {"package.json": text({...identity, entries: {browser: {location: "browser", main: "browser.js"}}, contributes: [{capability: "workbench.themes", id: "local.x.a", declaration: good}]}), "browser.js": new Uint8Array([1])}, /运行入口/u],
        ["没有 package.json", {"readme.txt": new Uint8Array([1])}, /package\.json/u],
        ["package.json 不是 JSON", {"package.json": new Uint8Array([123, 123])}, /JSON/u],
        ["没有 contributes", {"package.json": text(identity)}, /没有主题/u],
        ["声明形状不对", {"package.json": text(manifestOf({title: "x", base: "other", light: {}, dark: {}}))}, /不合格/u],
        ["声明里引外部资源", {"package.json": text(manifestOf({...good, light: {colors: {"--bg-main": "url(https://example.com/x.png)"}}}))}, /url\(\)/u],
        ["场景图不在包里", {"package.json": text(manifestOf({...good, light: {scene: "assets/missing.webp"}}))}, /不在包里/u],
        ["图标不在包里", {"package.json": text(manifestOf({...good, light: {icons: {files: "assets/files.svg"}}}))}, /图标 assets\/files\.svg 不在包里/u],
        ["图标超过上限", {"package.json": text(manifestOf({...good, light: {icons: {files: "assets/files.svg"}}})), "assets/files.svg": new Uint8Array(THEME_ICON_MAX_BYTES + 1)}, /超过/u],
        ["图标路径不是 .svg", {"package.json": text(manifestOf({...good, light: {icons: {files: "assets/files.png"}}})), "assets/files.png": new Uint8Array([1])}, /只收 \.svg/u],
        ["工作态场景不在包里", {"package.json": text(manifestOf({...good, light: {workingScene: "assets/w.webp"}}))}, /不在包里/u],
        ["工作态场景不是图片", {"package.json": text(manifestOf({...good, light: {workingScene: "assets/w.webp"}})), "assets/w.webp": new Uint8Array([1, 2, 3, 4])}, /不是 PNG/u],
        ["场景图不是图片", {"package.json": text(manifestOf({...good, light: {scene: "assets/x.webp"}})), "assets/x.webp": new Uint8Array([1, 2, 3, 4])}, /不是 PNG/u],
        ["没有主题贡献", {"package.json": text({...identity, contributes: [{capability: "commands", id: "local.x.c", declaration: {}}]})}, /没有主题|不合格/u],
    ])("坏包：%s，整个拒绝", (_name, content, reason) => {
        const archive = content instanceof Uint8Array ? content : zipSync(content);
        const result = readPackage(archive);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toMatch(reason);
    });

    it("文件太多、单个文件解压后太大、全部文件总量太大（压缩后很小的包）：解压到上限就停，拒绝", () => {
        const many: Record<string, Uint8Array> = {"package.json": text(manifestOf(good))};
        for (let index = 0; index < PACKAGE_LIMITS.files; index += 1) many[`f${String(index)}.txt`] = new Uint8Array([1]);
        const tooMany = readPackage(zipSync(many));
        expect(tooMany.ok).toBe(false);
        if (!tooMany.ok) expect(tooMany.reason).toMatch(/文件太多/u);

        const bomb = zipSync({"package.json": text(manifestOf(good)), "big.bin": new Uint8Array(PACKAGE_LIMITS.fileBytes + 1)}, {level: 9});
        expect(bomb.byteLength).toBeLessThan(1024 * 1024);
        const single = readPackage(bomb);
        expect(single.ok).toBe(false);
        if (!single.ok) expect(single.reason).toMatch(/太大/u);

        // 每个文件都不超单个上限，合起来超总量：三个各 20 MiB 的全零文件（压缩后几十 KB）。
        const sum = zipSync({"package.json": text(manifestOf(good)), "a.bin": new Uint8Array(PACKAGE_LIMITS.fileBytes), "b.bin": new Uint8Array(PACKAGE_LIMITS.fileBytes), "c.bin": new Uint8Array(PACKAGE_LIMITS.fileBytes)}, {level: 9});
        expect(sum.byteLength).toBeLessThan(1024 * 1024);
        const total = readPackage(sum);
        expect(total.ok).toBe(false);
        if (!total.ok) expect(total.reason).toMatch(/总量/u);
    });

    it("同一个包里有几个主题就读出几个", () => {
        const manifest = {...identity, contributes: [{capability: "workbench.themes", id: "local.x.a", declaration: good}, {capability: "workbench.themes", id: "local.x.b", declaration: {...good, title: "y"}}]};
        const result = readPackage(zipSync({"package.json": text(manifest)}));
        expect(result.ok && result.themes.length).toBe(2);
    });
});

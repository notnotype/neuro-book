/**
 * 表情目录、`stickers://`、取图路由与浏览器目录（docs/specs/agent/stickers.md 输出 1–6、13、18 与“边界与兼容”、验收 6、7）：
 * 真实服务端内核实例装真实的 `nbook.files` 与 `nbook.stickers`，表情包在真实临时目录里，图片由 `Bun.Image` 现做；时间用场地的
 * 手动时钟推进。插件来源经 `pluginPackRoots` 接一个按目录交回临时文件夹的插件包查询（平台的安装另有测试）。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {chmod, mkdir, rename, rm, symlink, utimes, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {ContributionHandle, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {definitionAt} from "nbook/manifest";
import {filesBackendPlugin} from "nbook/plugins/files/backend/plugin";
import {descriptor as filesDescriptor} from "nbook/plugins/files/plugin";
import {workspaceFilesKey} from "nbook/plugins/files/shared/workspace-files";
import type {WorkspaceFiles} from "nbook/plugins/files/shared/workspace-files";
import {settingsWorld} from "nbook/plugins/settings/testing/world";
import type {SettingsWorld} from "nbook/plugins/settings/testing/world";

import {browserCatalog, browserSummaries} from "./backend/browser-catalog";
import {StickerCatalog} from "./backend/catalog";
import {stickersBackendPlugin} from "./backend/plugin";
import {pluginPackRoots} from "./backend/plugin-roots";
import {createStickerRoutes} from "./backend/routes";
import {descriptor} from "./plugin";
import {BROWSER_BYTES_MAX, BROWSER_STICKERS_MAX, stickerImageUrl, stickersServiceKey} from "./shared/contracts";
import type {StickerPackEntry, StickerPacksDeclaration, StickersService} from "./shared/contracts";

const PIXEL = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (char) => char.charCodeAt(0));
const png = (width: number, height: number): Promise<Uint8Array> => new Bun.Image(PIXEL).resize(width, height).png().bytes();
const webp = (width: number, height: number): Promise<Uint8Array> => new Bun.Image(PIXEL).resize(width, height).webp().bytes();

let tmp = "";
let counter = 0;
const worlds: SettingsWorld[] = [];
const catalogs: StickerCatalog[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-stickers", "catalog");
});
afterEach(async () => {
    for (const catalog of catalogs.splice(0)) await catalog.close();
    for (const world of worlds.splice(0)) await world.close();
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 写一个表情包文件夹：清单与图片。 */
async function pack(directory: string, manifest: unknown, images: Readonly<Record<string, Uint8Array>> = {}): Promise<void> {
    await mkdir(directory, {recursive: true});
    await writeFile(join(directory, "stickers.json"), typeof manifest === "string" ? manifest : JSON.stringify(manifest));
    for (const [name, bytes] of Object.entries(images)) await writeFile(join(directory, name), bytes);
}

/** 星璃的表情包：两个常用、一个不常用、一个名字取自文件名，一个文件不在、一个名字不合规则、一个文件名当不了名字、一个字节不是图片、一张太大。 */
async function lyra(directory: string): Promise<void> {
    await pack(directory, {
        title: "星璃",
        description: "星璃的表情",
        stickers: [
            {name: "开心", file: "happy.png", description: "被夸的时候", common: true},
            {name: "害羞", file: "shy.webp", description: "被问到私事", common: true},
            {name: "比心", file: "heart.png"},
            {file: "困.png", common: true},
            {file: "1.png"},
            {name: "没有图", file: "missing.png"},
            {name: "1坏名字", file: "happy.png"},
            {name: "假图", file: "fake.png"},
            {name: "太大", file: "big.png"},
        ],
    }, {"happy.png": await png(64, 64), "shy.webp": await webp(96, 64), "heart.png": await png(32, 32), "fake.png": new TextEncoder().encode("not an image"), "big.png": await png(1100, 20), "困.png": await png(16, 16), "1.png": await png(8, 8)});
}

interface Scene {
    readonly world: SettingsWorld;
    readonly user: string;
    readonly files: WorkspaceFiles;
    readonly service: StickersService;
    readonly events: () => ReadonlyArray<{readonly event: string; readonly data: unknown}>;
}

function consumer(holder: {files: WorkspaceFiles | null; service: StickersService | null}): PluginDefinition {
    return {id: "x.consumer", entries: [defineEntry({
        id: "server",
        location: "server",
        activationEvents: ["onStartup"],
        dependencies: [{key: workspaceFilesKey}, {key: stickersServiceKey}],
        activate: (context) => {
            holder.files = context.services.require(workspaceFilesKey);
            holder.service = context.services.require(stickersServiceKey);
            return {};
        },
    })]};
}

async function scene(prepare: (user: string) => Promise<void> = async () => undefined): Promise<Scene> {
    counter += 1;
    const root = join(tmp, `w${String(counter)}`);
    const user = join(root, "state", "user", "stickers");
    await mkdir(user, {recursive: true});
    await prepare(user);
    const holder = {files: null as WorkspaceFiles | null, service: null as StickersService | null};
    const world = await settingsWorld(root, [definitionAt("server", filesDescriptor, filesBackendPlugin), definitionAt("server", descriptor, stickersBackendPlugin), consumer(holder)]);
    worlds.push(world);
    if (holder.files === null || holder.service === null) throw new Error("测试插件没有激活");
    const events = () => world.diagnostics("hub").query({}).records.filter((record) => record.event.startsWith("stickers.")).map((record) => ({event: record.event, data: record.data}));
    return {world, user, files: holder.files, service: holder.service, events};
}

const byId = (service: StickersService, id: string): StickerPackEntry | undefined => service.list().find((entry) => entry.id === id);

describe("表情目录", () => {
    test("输出 1–5：有效的表情按清单顺序、带宽高与版本；无效的表情只隔离它一项；无效的表情包照样列出；诊断每种一条，重扫不重复", async () => {
        const {world, user, service, events} = await scene(async (user) => {
            await lyra(join(user, "lyra"));
            await mkdir(join(user, "empty"));
            await pack(join(user, "Bad-Name"), {stickers: []});
            await pack(join(user, "broken"), "{不是 JSON");
            await pack(join(user, "fields"), {title: 3, stickers: [{name: "嗨", file: "hi.png", common: "yes"}]}, {"hi.png": await png(8, 8)});
        });
        const lyraPack = byId(service, "user.lyra");
        expect(lyraPack).toMatchObject({folder: "lyra", source: "user", title: "星璃", description: "星璃的表情", status: "ok"});
        expect(lyraPack?.stickers.map(({name, file, description, common, width, height}) => ({name, file, description, common, width, height}))).toEqual([
            {name: "开心", file: "happy.png", description: "被夸的时候", common: true, width: 64, height: 64},
            {name: "害羞", file: "shy.webp", description: "被问到私事", common: true, width: 96, height: 64},
            {name: "比心", file: "heart.png", description: undefined, common: false, width: 32, height: 32},
            {name: "困", file: "困.png", description: undefined, common: true, width: 16, height: 16},
        ]);
        // 没有清单不算无效：空文件夹是一个没有表情的表情包。
        expect(byId(service, "user.empty")).toMatchObject({status: "ok", stickers: []});
        expect(byId(service, "user.Bad-Name")).toMatchObject({status: "invalid", problem: {code: "folder-name"}});
        expect(byId(service, "user.broken")).toMatchObject({status: "invalid", problem: {code: "manifest-unreadable"}});
        // 可选字段不合规只忽略字段；`common` 不合规是这一项不合规。
        expect(byId(service, "user.fields")).toMatchObject({status: "ok", title: "fields", stickers: []});
        const stickerInvalid = events().filter((item) => item.event === "stickers.sticker-invalid").map((item) => (item.data as {id: string; stickers: string[]}));
        expect(stickerInvalid.find((item) => item.id === "user.lyra")?.stickers).toHaveLength(5);
        expect(events().filter((item) => item.event === "stickers.field-ignored")).toHaveLength(1);
        expect(events().filter((item) => item.event === "stickers.pack-invalid")).toHaveLength(2);

        // 清单里加一个有效的表情，等它出现（重扫做完了）：别的问题没变，不再写诊断。
        const before = events().length;
        const manifest = JSON.parse(await Bun.file(join(user, "lyra", "stickers.json")).text()) as {stickers: unknown[]};
        await writeFile(join(user, "lyra", "stickers.json"), JSON.stringify({...manifest, stickers: [...manifest.stickers, {name: "晚安", file: "heart.png"}]}));
        await waitUntil("重扫出新加的表情", () => {
            world.clock.advance(200);
            return byId(service, "user.lyra")?.stickers.some((sticker) => sticker.name === "晚安") || null;
        });
        expect(events().length).toBe(before);
    });

    test("没有表情列表：每张图片一个表情，按文件名排、名字取文件名、都算常用；当不了名字与重名的写诊断，别的文件不报；写了列表只认列表；加图随监视出现", async () => {
        const {world, user, service, events} = await scene(async (user) => {
            const cat = join(user, "cat");
            await mkdir(join(cat, "sub"), {recursive: true});
            // 子文件夹不算表情，扩展名像图片的也一样。
            await mkdir(join(cat, "相册.png"));
            for (const [file, bytes] of Object.entries({"开心.png": await png(16, 16), "开心.webp": await webp(16, 16), "困.webp": await webp(24, 16), "1.png": await png(8, 8), ".hidden.png": await png(8, 8), "readme.txt": new TextEncoder().encode("说明")})) await writeFile(join(cat, file), bytes);
            await writeFile(join(cat, "sub", "里面.png"), await png(8, 8));
            await symlink(join(cat, "开心.png"), join(cat, "链接.png"));
            await pack(join(user, "titled"), {title: "有标题"}, {"a.png": await png(8, 8)});
            await pack(join(user, "listed"), {stickers: [{file: "a.png"}]}, {"a.png": await png(8, 8), "b.png": await png(8, 8)});
        });
        expect(byId(service, "user.cat")?.stickers.map(({name, file, description, common}) => ({name, file, description, common}))).toEqual([
            {name: "困", file: "困.webp", description: undefined, common: true},
            {name: "开心", file: "开心.png", description: undefined, common: true},
        ]);
        expect(byId(service, "user.cat")).toMatchObject({status: "ok", title: "cat"});
        const catProblems = events().find((item) => item.event === "stickers.sticker-invalid" && (item.data as {id: string}).id === "user.cat")?.data as {stickers: string[]} | undefined;
        expect(catProblems?.stickers).toEqual([expect.stringMatching(/^1\.png：文件名当不了表情名（/u), "开心.webp：名字 开心 与前面的表情重名", "链接：文件是链接"]);
        expect(byId(service, "user.titled")).toMatchObject({status: "ok", title: "有标题", stickers: [{name: "a", common: true}]});
        expect(byId(service, "user.listed")?.stickers.map((sticker) => sticker.name)).toEqual(["a"]);

        await writeFile(join(user, "cat", "晚安.png"), await png(8, 8));
        await waitUntil("加的图片出现", () => {
            world.clock.advance(200);
            return byId(service, "user.cat")?.stickers.some((sticker) => sticker.name === "晚安") || null;
        });
    });

    test("输出 2：表情包文件夹读不了时是无效的，不当成没有清单或空的表情包", async () => {
        const locked: string[] = [];
        try {
            const {service} = await scene(async (user) => {
                // 只能进、不能列：查得到没有清单，列不出图片。只能列、不能进：查不了有没有清单。
                for (const [folder, mode] of [["unlisted", 0o100], ["unsearchable", 0o400]] as const) {
                    const directory = join(user, folder);
                    await mkdir(directory);
                    await writeFile(join(directory, "a.png"), await png(8, 8));
                    await chmod(directory, mode);
                    locked.push(directory);
                }
            });
            expect(byId(service, "user.unlisted")).toMatchObject({status: "invalid", problem: {code: "folder-unreadable"}, stickers: []});
            expect(byId(service, "user.unsearchable")).toMatchObject({status: "invalid", problem: {code: "manifest-unreadable"}, stickers: []});
        } finally {
            for (const directory of locked) await chmod(directory, 0o700);
        }
    });

    test("输出 1：新放进的表情包、整个换掉的表情包都随监视重扫出现；链接的表情包是无效的", async () => {
        const {world, user, service} = await scene();
        expect(service.list()).toEqual([]);
        await lyra(join(user, "lyra"));
        await waitUntil("新表情包出现", () => {
            world.clock.advance(200);
            return byId(service, "user.lyra")?.status === "ok" || null;
        });
        await rm(join(user, "lyra"), {recursive: true});
        await pack(join(user, "lyra"), {stickers: [{name: "新的", file: "new.png"}]}, {"new.png": await png(16, 16)});
        await waitUntil("换掉后是新内容", () => {
            world.clock.advance(200);
            return byId(service, "user.lyra")?.stickers.map((sticker) => sticker.name).join() === "新的" || null;
        });
        await symlink(join(user, "lyra"), join(user, "alias"));
        await waitUntil("链接的表情包无效", () => {
            world.clock.advance(200);
            return byId(service, "user.alias")?.problem?.code === "symlink" || null;
        });
    });

    test("输出 5：有问题的表情包删掉再放回来，诊断再写一次", async () => {
        const {world, user, service, events} = await scene(async (user) => pack(join(user, "broken"), "{不是 JSON"));
        const invalid = () => events().filter((item) => item.event === "stickers.pack-invalid").length;
        expect(invalid()).toBe(1);
        await rm(join(user, "broken"), {recursive: true});
        await waitUntil("删掉后不列", () => {
            world.clock.advance(200);
            return byId(service, "user.broken") === undefined || null;
        });
        await pack(join(user, "broken"), "{不是 JSON");
        await waitUntil("放回来又写一次", () => {
            world.clock.advance(200);
            return invalid() === 2 || null;
        });
    });

    test("“边界与兼容”的版本：图片换成另一个文件后，大小与修改时间都相同，版本照样变", async () => {
        counter += 1;
        const user = join(tmp, `v${String(counter)}`);
        await lyra(join(user, "lyra"));
        const path = join(user, "lyra", "happy.png");
        // 整秒的修改时间：写回时不丢精度，替换前后确实相同。
        const time = 1_700_000_000;
        await utimes(path, time, time);
        const root = {key: "user", source: "user" as const, prefix: "user", root: user, watch: false};
        const catalog = await StickerCatalog.open({roots: [root], clock: {now: () => 0, schedule: () => () => undefined} as never, report: () => undefined});
        catalogs.push(catalog);
        const version = () => catalog.item("user.lyra")?.entry.stickers.find((sticker) => sticker.name === "开心")?.version;
        const before = version();
        await writeFile(`${path}.tmp`, await png(64, 64));
        await utimes(`${path}.tmp`, time, time);
        await rename(`${path}.tmp`, path);
        await catalog.addRoot(root);
        expect(version()).toBeDefined();
        expect(version()).not.toBe(before);
    });

    test("输出 6：插件来源随贡献的发布与撤回出现、消失；目录不可用写诊断；同一插件两个贡献里同名的文件夹取码元顺序先到的", async () => {
        counter += 1;
        const root = join(tmp, `p${String(counter)}`);
        await lyra(join(root, "a", "lyra"));
        await pack(join(root, "b", "lyra"), {stickers: []});
        const reports: string[] = [];
        const catalog = await StickerCatalog.open({roots: [], clock: {now: () => 0, schedule: () => () => undefined} as never, report: (code) => reports.push(code)});
        catalogs.push(catalog);
        const receiver = pluginPackRoots({catalog, packages: {directory: async (_plugin, path) => (path === "nowhere" ? null : join(root, path)), title: () => "示例插件"}, report: (code) => reports.push(code)});
        const handle = (id: string, directory: string) => ({id, plugin: "acme.cute", declaration: {directory}}) as unknown as ContributionHandle<StickerPacksDeclaration>;
        const publish = (contribution: ContributionHandle<StickerPacksDeclaration>) => receiver.published?.(contribution, undefined);
        publish(handle("acme.cute.b", "b"));
        publish(handle("acme.cute.a", "a"));
        publish(handle("acme.cute.c", "nowhere"));
        await waitUntil("两个根都加上", async () => {
            await catalog.settled();
            return catalog.list().length === 1 && reports.includes("pack-duplicate") ? true : null;
        });
        expect(catalog.list()[0]).toMatchObject({id: "acme.cute.lyra", source: "plugin", plugin: {id: "acme.cute", title: "示例插件"}, title: "星璃"});
        expect(reports).toContain("root-unavailable");
        await receiver.revoke?.(handle("acme.cute.a", "a"), undefined, "activation-stopped");
        await receiver.revoke?.(handle("acme.cute.b", "b"), undefined, "activation-stopped");
        expect(catalog.list()).toEqual([]);
    });
});

describe("stickers://", () => {
    test("输出 13：根列出表情包；表情包的文件能读能列、不能写；整个文件夹换掉后读到新的", async () => {
        const {world, user, files} = await scene(async (user) => lyra(join(user, "lyra")));
        const listed = await files.list("stickers://");
        expect(listed.ok && "kind" in listed.value && listed.value.entries.map((entry) => [entry.name, entry.title, entry.meta?.stickers])).toEqual([["user.lyra", "星璃", "4"]]);
        const manifest = await files.read("stickers://user.lyra/stickers.json");
        expect(manifest.ok && new TextDecoder().decode(manifest.value.bytes)).toContain("被夸的时候");
        // 方案没有写能力，文件服务这一层就拒绝；Agent 的资源层对它分类为不可写（agent/resources.md），工具得 permission-denied。
        expect(await files.write("stickers://user.lyra/x.json", "{}", {expect: {hash: "0"}})).toMatchObject({ok: false, code: "unsupported-capability"});
        await rm(join(user, "lyra"), {recursive: true});
        await pack(join(user, "lyra"), {title: "新星璃", stickers: []});
        await waitUntil("换掉后读到新的清单", async () => {
            world.clock.advance(200);
            const read = await files.read("stickers://user.lyra/stickers.json");
            return (read.ok && new TextDecoder().decode(read.value.bytes).includes("新星璃")) || null;
        });
    });
});

describe("取图路由", () => {
    test("只给有效的表情；字节类型、版本与缓存、跨站；读的时候文件已被换成不是图片的给 404", async () => {
        const {user, files} = await scene(async (user) => lyra(join(user, "lyra")));
        const catalog = await StickerCatalog.open({roots: [{key: "user", source: "user", prefix: "user", root: user, watch: false}], clock: {now: () => 0, schedule: () => () => undefined} as never, report: () => undefined});
        catalogs.push(catalog);
        const routes = createStickerRoutes({catalog, files: () => files});
        const happy = catalog.item("user.lyra")?.entry.stickers.find((sticker) => sticker.name === "开心");
        if (happy === undefined) throw new Error("没有开心");
        const url = stickerImageUrl("user.lyra", happy).replace("/api/nbook.stickers", "");
        const ok = await routes.request(url);
        expect(ok.status).toBe(200);
        expect(ok.headers.get("content-type")).toBe("image/png");
        expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
        expect(ok.headers.get("content-security-policy")).toBe("sandbox");
        expect(ok.headers.get("cache-control")).toContain("immutable");
        expect(Buffer.from(await ok.arrayBuffer()).equals(Buffer.from(await png(64, 64)))).toBe(true);
        expect((await routes.request(url.replace(/\?v=.*/u, "?v=old"))).headers.get("cache-control")).toBe("no-cache");
        expect((await routes.request(url, {headers: {"if-none-match": `"${happy.version}"`}})).status).toBe(304);
        expect((await routes.request(url, {headers: {"sec-fetch-site": "cross-site"}})).status).toBe(403);
        expect((await routes.request("/image/user.lyra/fake.png")).status).toBe(404);
        expect((await routes.request("/image/user.lyra/stickers.json")).status).toBe(404);
        expect((await routes.request("/image/user.none/happy.png")).status).toBe(404);
        await writeFile(join(user, "lyra", "happy.png"), "now text");
        expect((await routes.request(url)).status).toBe(404);
    });
});

describe("浏览器目录", () => {
    test("输出 18：只带显示要用的字段；合计超过上限时放不下的表情包整包不进、写诊断", () => {
        const entry = (id: string, count: number): StickerPackEntry => ({id, folder: id.split(".")[1] as string, source: "user", title: id, status: "ok", stickers: Array.from({length: count}, (_, index) => ({name: `n${String(index)}`, file: `f${String(index)}.png`, description: "说明", common: false, width: 8, height: 8, version: "1-1"}))});
        const reports: string[] = [];
        const result = browserCatalog([entry("user.a", BROWSER_STICKERS_MAX - 1), entry("user.b", 2), entry("user.c", 1)], (code) => reports.push(code));
        expect(result.map((pack) => pack.id)).toEqual(["user.a", "user.c"]);
        expect(result[1]?.stickers[0]).toEqual({name: "n0", width: 8, height: 8, url: "/api/nbook.stickers/image/user.c/f0.png?v=1-1"});
        expect(reports).toEqual(["catalog-truncated"]);
    });

    test("输出 18、19：目录与设置页的概要序列化后不超过远程消息的预算，放不下的表情包整包不进、写诊断", () => {
        const longFile = `${"f".repeat(240)}.png`;
        const packs = Array.from({length: 12}, (_, pack): StickerPackEntry => ({id: `user.p${String(pack).padStart(2, "0")}`, folder: `p${String(pack)}`, source: "user", title: "长".repeat(200), description: "说".repeat(200), status: "ok", stickers: Array.from({length: 400}, (_, index) => ({name: `名${String(index)}`, file: longFile, common: false, width: 8, height: 8, version: "1-1"}))}));
        const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
        const reports: string[] = [];
        const result = browserCatalog(packs, (code) => reports.push(code));
        expect(result.length).toBeGreaterThan(0);
        expect(result.length).toBeLessThan(packs.length);
        expect(bytes(result)).toBeLessThanOrEqual(BROWSER_BYTES_MAX);
        expect(reports).toEqual(["catalog-truncated"]);
        const many = Array.from({length: 3000}, (_, index) => ({...packs[0] as StickerPackEntry, id: `user.s${String(index).padStart(4, "0")}`, stickers: []}));
        const summaries = browserSummaries(many, (code) => reports.push(code));
        expect(summaries.length).toBeLessThan(many.length);
        expect(bytes(summaries)).toBeLessThanOrEqual(BROWSER_BYTES_MAX);
        expect(reports).toEqual(["catalog-truncated", "catalog-truncated"]);
    });
});

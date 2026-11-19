/**
 * 表情目录、`stickers://`、取图路由与浏览器目录（docs/specs/agent/stickers.md 输出 1–6、13、18 与“边界与兼容”、验收 6、7）：
 * 真实服务端内核实例装真实的 `nbook.files` 与 `nbook.stickers`，表情包在真实临时目录里，图片由 `Bun.Image` 现做；时间用场地的
 * 手动时钟推进。插件来源经 `pluginPackRoots` 接一个按目录交回临时文件夹的插件包查询（平台的安装另有测试）。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {access, chmod, mkdir, readdir, readFile, rename, rm, symlink, utimes, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {strToU8, zipSync} from "fflate";

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {ActivationContext, ContributionHandle, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {openExistingFolder} from "nbook/backend/open-folder";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {definitionAt} from "nbook/manifest";
import {filesBackendPlugin} from "nbook/plugins/files/backend/plugin";
import {descriptor as filesDescriptor} from "nbook/plugins/files/plugin";
import {workspaceFilesKey} from "nbook/plugins/files/shared/workspace-files";
import type {WorkspaceFiles} from "nbook/plugins/files/shared/workspace-files";
import {settingsWorld} from "nbook/plugins/settings/testing/world";
import type {SettingsWorld} from "nbook/plugins/settings/testing/world";

import {browserCatalog, browserSummaries} from "./backend/browser-catalog";
import {locateBuiltinStickers} from "./backend/builtin-root";
import {StickerCatalog} from "./backend/catalog";
import type {StickerPackItem} from "./backend/catalog";
import {packDetail} from "./backend/pack-detail";
import {unpackZip} from "./backend/archive";
import {StickerEditor} from "./backend/editor";
import {revealPath} from "./backend/reveal";
import {createStickersBackendPlugin, stickersBackendPlugin} from "./backend/plugin";
import {pluginPackRoots} from "./backend/plugin-roots";
import {createStickerRoutes, Gate, UPLOAD_MAX_BYTES} from "./backend/routes";
import {descriptor} from "./plugin";
import {BROWSER_BYTES_MAX, BROWSER_STICKERS_MAX, EXTRAS_MAX, REPLACED_PREFIX, STAGING_PREFIX, stickerImageUrl, stickersCatalogContract, stickersServiceKey} from "./shared/contracts";
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

async function scene(prepare: (user: string) => Promise<void> = async () => undefined, plugin: PluginDefinition = stickersBackendPlugin): Promise<Scene> {
    counter += 1;
    const root = join(tmp, `w${String(counter)}`);
    const user = join(root, "state", "user", "stickers");
    await mkdir(user, {recursive: true});
    await prepare(user);
    const holder = {files: null as WorkspaceFiles | null, service: null as StickersService | null};
    const world = await settingsWorld(root, [definitionAt("server", filesDescriptor, filesBackendPlugin), definitionAt("server", descriptor, plugin), consumer(holder)]);
    worlds.push(world);
    if (holder.files === null || holder.service === null) throw new Error("测试插件没有激活");
    const events = () => world.diagnostics("hub").query({}).records.filter((record) => record.event.startsWith("stickers.")).map((record) => ({event: record.event, data: record.data}));
    return {world, user, files: holder.files, service: holder.service, events};
}

const byId = (service: StickersService, id: string): StickerPackEntry | undefined => service.list().find((entry) => entry.id === id);
/** 用户的表情包：应用自带的内置包总在目录里，只看用户的那几条断言用它。 */
const mine = (service: StickersService): readonly StickerPackEntry[] => service.list().filter((entry) => entry.source === "user");

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
        expect(mine(service)).toEqual([]);
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
        const receiver = pluginPackRoots({catalog, packages: {directory: async (_plugin, path) => (path === "nowhere" ? null : join(root, path)), file: async () => null, title: () => "示例插件"}, report: (code) => reports.push(code)});
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

    test("输出 1：应用的安装里找不到内置表情包的目录时，目录里没有内置的包、写诊断 root-unavailable，用户的包照常", async () => {
        const {service, events} = await scene(async (user) => lyra(join(user, "lyra")), createStickersBackendPlugin(() => null));
        expect(service.list().map((entry) => entry.id)).toEqual(["user.lyra"]);
        expect(events()).toContainEqual({event: "stickers.root-unavailable", data: {source: "builtin"}});
    });

    test("输出 1：内置来源启动时扫一遍、不监视：之后放进安装目录的包到下次启动才出现", async () => {
        counter += 1;
        const builtinRoot = join(tmp, `b${String(counter)}`);
        await lyra(join(builtinRoot, "lyra"));
        const {world, user, service} = await scene(async () => undefined, createStickersBackendPlugin(() => builtinRoot));
        expect(service.list().map((entry) => [entry.id, entry.source])).toEqual([["builtin.lyra", "builtin"]]);
        await lyra(join(builtinRoot, "later"));
        // 同时往用户的目录放一个：它出现说明监视已经处理过这段时间的变化，内置的那个仍不在。
        await lyra(join(user, "mine"));
        await waitUntil("用户的新包出现", () => {
            world.clock.advance(200);
            return byId(service, "user.mine")?.status === "ok" || null;
        });
        expect(byId(service, "builtin.later")).toBeUndefined();
    });
});

describe("stickers://", () => {
    test("输出 13：根列出表情包；表情包的文件能读能列、不能写；整个文件夹换掉后读到新的", async () => {
        const {world, user, files} = await scene(async (user) => lyra(join(user, "lyra")));
        const listed = await files.list("stickers://");
        expect(listed.ok && "kind" in listed.value && listed.value.entries.filter((entry) => entry.name.startsWith("user.")).map((entry) => [entry.name, entry.title, entry.meta?.stickers])).toEqual([["user.lyra", "星璃", "4"]]);
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

describe("表情包页的读取", () => {
    /** 只扫不监视的目录（手动时钟，不会自己重扫）。 */
    async function quietCatalog(user: string, report: (code: string, message: string, data?: unknown) => void = () => undefined): Promise<StickerCatalog> {
        const catalog = await StickerCatalog.open({roots: [{key: "user", source: "user", prefix: "user", root: user, watch: false}], clock: {now: () => 0, schedule: () => () => undefined} as never, report, identify: async (folders) => folders.map((folder) => `token-${folder}`)});
        catalogs.push(catalog);
        return catalog;
    }

    test("输出 26、27：详情里有表情、认不出的与没加进来的图，概要带两个计数；这两类图能取、不长期缓存", async () => {
        const {user, files} = await scene(async (user) => {
            await lyra(join(user, "lyra"));
            await writeFile(join(user, "lyra", "摸摸头.png"), await png(24, 24));
            await mkdir(join(user, "cat"));
            for (const file of ["开心.png", "1.png"]) await writeFile(join(user, "cat", file), await png(16, 16));
        });
        const catalog = await quietCatalog(user);
        const cat = catalog.item("user.cat");
        if (cat === undefined) throw new Error("没有 cat");
        const catDetail = packDetail(cat);
        expect(catDetail).toMatchObject({listed: false, token: "token-cat", summary: {id: "user.cat", count: 1, unrecognized: 1, unlisted: 0}});
        expect(catDetail.stickers.map(({name, file, bytes}) => ({name, file, bytes: bytes > 0}))).toEqual([{name: "开心", file: "开心.png", bytes: true}]);
        expect(catDetail.extras.map(({file, reason, raw}) => ({file, reason, raw}))).toEqual([{file: "1.png", reason: "name", raw: null}]);
        // 有表情列表的：清单里名字不合规的项（写了名字的带原样）与文件夹里没列的图。
        const lyraDetail = packDetail(catalog.item("user.lyra")!);
        expect(lyraDetail).toMatchObject({listed: true, summary: {unrecognized: 2, unlisted: 1}});
        expect(lyraDetail.extras.map(({file, reason, raw}) => ({file, reason, raw}))).toEqual([
            {file: "1.png", reason: "name", raw: null},
            {file: "happy.png", reason: "name", raw: "1坏名字"},
            {file: "摸摸头.png", reason: "unlisted", raw: null},
        ]);
        expect(browserSummaries(catalog.list(), () => undefined, (id) => catalog.item(id)?.counts).find((summary) => summary.id === "user.lyra")).toMatchObject({unrecognized: 2, unlisted: 1});

        const routes = createStickerRoutes({catalog, files: () => files});
        const extra = lyraDetail.extras.find((item) => item.reason === "unlisted")!;
        const url = extra.url.replace("/api/nbook.stickers", "");
        const response = await routes.request(url);
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-cache");
        expect(response.headers.get("etag")).toBeNull();
        expect((await routes.request(url, {headers: {"if-none-match": `"${extra.url.split("v=")[1] ?? ""}"`}})).status).toBe(200);
    });

    test("详情序列化后不超过远程消息的预算：放不下的 extras 从后面截，计数照实", () => {
        const long = `${"长".repeat(70)}.png`;
        const item: StickerPackItem = {
            directory: "/x",
            root: "user",
            listed: true,
            entry: {id: "user.big", folder: "big", source: "user", title: "big", status: "ok", stickers: []},
            extras: Array.from({length: 3000}, (_, index) => ({file: `${String(index)}${long}`, reason: "unlisted" as const, raw: null, width: 8, height: 8, version: "1-1", bytes: 8})),
            counts: {unrecognized: 0, unlisted: 3000},
            token: null,
        };
        const detail = packDetail(item);
        expect(new TextEncoder().encode(JSON.stringify(detail)).length).toBeLessThanOrEqual(BROWSER_BYTES_MAX);
        expect(detail.extras.length).toBeGreaterThan(0);
        expect(detail.extras.length).toBeLessThan(3000);
        expect(detail.summary.unlisted).toBe(3000);
    });

    test("输出 36：打开目录时删掉没提交的暂存；替换时挪开的旧包不动、写诊断；两者都不是表情包", async () => {
        counter += 1;
        const user = join(tmp, `s${String(counter)}`);
        await lyra(join(user, `${STAGING_PREFIX}abc`));
        await lyra(join(user, `${REPLACED_PREFIX}lyra-abc`));
        const reports: string[] = [];
        const catalog = await quietCatalog(user, (code) => reports.push(code));
        expect(catalog.list()).toEqual([]);
        expect(await access(join(user, `${STAGING_PREFIX}abc`)).then(() => true, () => false)).toBe(false);
        expect(await access(join(user, `${REPLACED_PREFIX}lyra-abc`, "stickers.json")).then(() => true, () => false)).toBe(true);
        expect(reports).toEqual(["replace-leftover"]);
    });

    test("写完立刻 refresh：不等监视的合并，目录已是写完的样子", async () => {
        counter += 1;
        const user = join(tmp, `r${String(counter)}`);
        await mkdir(user, {recursive: true});
        const catalog = await quietCatalog(user);
        let changed = 0;
        catalog.onChanged(() => (changed += 1));
        await lyra(join(user, "lyra"));
        await catalog.refresh("user");
        expect(catalog.item("user.lyra")?.entry.status).toBe("ok");
        expect(changed).toBe(1);
        // 只多了一张没列进清单的图：表情不变，也算变了（表情包页要显示它）。
        await writeFile(join(user, "lyra", "新图.png"), await png(8, 8));
        await catalog.refresh("user");
        expect(catalog.item("user.lyra")?.counts.unlisted).toBe(1);
        expect(changed).toBe(2);
    });

    test("refresh：根读不了（被普通文件占了）时 reject，上一次发布的目录原样保留，不当成空目录", async () => {
        counter += 1;
        const user = join(tmp, `f${String(counter)}`);
        await lyra(join(user, "lyra"));
        const reports: string[] = [];
        const catalog = await quietCatalog(user, (code) => reports.push(code));
        await rm(user, {recursive: true});
        await writeFile(user, "不是文件夹");
        await expect(catalog.refresh("user")).rejects.toThrow();
        expect(catalog.item("user.lyra")?.entry.status).toBe("ok");
        expect(reports).toContain("scan-failed");
    });

    test("计数变了就通知：没列的图超过 extras 上限后再多一张，列表不变、总数变", async () => {
        counter += 1;
        const user = join(tmp, `n${String(counter)}`);
        const small = await png(8, 8);
        await pack(join(user, "many"), {stickers: []}, Object.fromEntries(Array.from({length: EXTRAS_MAX}, (_, index) => [`${String(index).padStart(4, "0")}.png`, small])));
        const catalog = await quietCatalog(user);
        let changed = 0;
        catalog.onChanged(() => (changed += 1));
        expect(catalog.item("user.many")?.counts.unlisted).toBe(EXTRAS_MAX);
        await writeFile(join(user, "many", "9999.png"), small);
        await catalog.refresh("user");
        expect(catalog.item("user.many")?.counts.unlisted).toBe(EXTRAS_MAX + 1);
        expect(catalog.item("user.many")?.extras.length).toBe(EXTRAS_MAX);
        expect(changed).toBe(1);
    });

    test("输出 37：插件撤回后、目录项还没拿掉的窗口里，不打开它的文件夹", async () => {
        counter += 1;
        const user = join(tmp, `p${String(counter)}`);
        const plugin = join(tmp, `p${String(counter)}-plugin`);
        await mkdir(user, {recursive: true});
        await lyra(join(plugin, "lyra"));
        const catalog = await quietCatalog(user);
        await catalog.addRoot({key: "acme.cute.packs", source: "plugin", prefix: "acme.cute", root: plugin, watch: false});
        expect(await revealPath(catalog, user, "acme.cute.lyra")).toBe(join(plugin, "lyra"));
        const removal = catalog.removeRoot("acme.cute.packs");
        expect(catalog.item("acme.cute.lyra")).toBeDefined();
        expect(await revealPath(catalog, user, "acme.cute.lyra")).toBeNull();
        await removal;
    });

    test("输出 37：只打开目录里这个表情包的真实文件夹；被换成链接的、不在的不打开；没有桌面时不打开、不建文件夹", async () => {
        counter += 1;
        const user = join(tmp, `o${String(counter)}`);
        await lyra(join(user, "lyra"));
        await lyra(join(user, "cat"));
        const catalog = await quietCatalog(user);
        expect(await revealPath(catalog, user, "user.lyra")).toBe(join(user, "lyra"));
        expect(await revealPath(catalog, user, "user.none")).toBeNull();
        // 扫描之后 cat 被换成指向别处的链接：目录还是旧的，按真实路径拒绝。
        await rename(join(user, "cat"), join(tmp, `o${String(counter)}-elsewhere`));
        await symlink(join(tmp, `o${String(counter)}-elsewhere`), join(user, "cat"));
        expect(await revealPath(catalog, user, "user.cat")).toBeNull();

        expect(await openExistingFolder(join(user, "lyra"), {}, "linux")).toEqual({ok: false, code: "no-desktop"});
        const missing = join(user, "missing");
        expect(await openExistingFolder(missing, {}, "linux")).toMatchObject({ok: false, code: "open-failed"});
        expect(await access(missing).then(() => true, () => false)).toBe(false);
    });
});

describe("表情包页的写入", () => {
    /** 窗口里的探针：拿到浏览器一侧的远程调用，像表情包页那样调 `nbook.stickers` 的方法。 */
    async function api(world: SettingsWorld) {
        const holder: {remote: ActivationContext["remote"] | null} = {remote: null};
        await world.window(`w${String(counter)}`, [{id: "x.page", entries: [defineEntry({id: "browser", location: "browser", activationEvents: ["onStartup"], activate: (context) => {
            holder.remote = context.remote;
            return {};
        }})]}], {bound: false});
        if (holder.remote === null) throw new Error("探针没有激活");
        return holder.remote.use(stickersCatalogContract);
    }
    const manifestOf = async (user: string, folder: string): Promise<{title?: string; description?: string; stickers?: Array<Record<string, unknown>>}> => JSON.parse(await readFile(join(user, folder, "stickers.json"), "utf8"));
    const exists = (path: string): Promise<boolean> => access(path).then(() => true, () => false);

    test("输出 31、28、30：新建；改显示名与说明；没有表情列表时改表情先补列表；名字的核对；加进来、删文件、删表情；返回时目录已是写完的样子", async () => {
        const {world, user, service} = await scene();
        const remote = await api(world);
        expect(await remote.createPack({folder: "cat", title: "猫猫"})).toEqual({ok: true, value: {id: "user.cat"}});
        expect(service.list().find((entry) => entry.id === "user.cat")).toMatchObject({title: "猫猫", status: "ok"});
        expect(await remote.createPack({folder: "cat", title: null})).toMatchObject({ok: false, code: "pack-exists"});
        expect(await remote.createPack({folder: "Cat", title: null})).toMatchObject({ok: false, code: "folder-invalid"});
        expect(await remote.pack({id: "user.none"})).toMatchObject({ok: false, code: "pack-missing"});
        // 不在目录里的不打开（真的打开会在测试机上弹出文件管理器，这里只测拒绝的一侧）。
        expect(await remote.revealPack({id: "user.none"})).toMatchObject({ok: false, code: "pack-missing"});

        for (const file of ["开心.png", "1.png"]) await writeFile(join(user, "cat", file), await png(16, 16));
        expect(await remote.updatePack({id: "user.cat", title: "猫", description: "喵喵"})).toEqual({ok: true, value: {}});
        // 只改头不补列表：仍按文件夹里的图片。
        expect(await manifestOf(user, "cat")).toEqual({title: "猫", description: "喵喵"});
        expect((await remote.pack({id: "user.cat"})).ok && (await remote.pack({id: "user.cat"}))).toMatchObject({value: {listed: false, summary: {unrecognized: 1}}});

        // 给认不出的 1.png 写名字：先补列表（两张、都常用），再改这一项；文件不改名。
        expect(await remote.updateSticker({id: "user.cat", file: "1.png", name: null, change: {name: "一", description: "第一张"}})).toEqual({ok: true, value: {}});
        expect((await manifestOf(user, "cat")).stickers).toEqual([{file: "1.png", common: true, name: "一", description: "第一张"}, {file: "开心.png", common: true}]);
        const detail = await remote.pack({id: "user.cat"});
        if (!detail.ok) throw new Error(detail.code);
        expect(detail.value.stickers.map((sticker) => sticker.name)).toEqual(["一", "开心"]);
        expect(detail.value.listed).toBe(true);
        expect(await remote.updateSticker({id: "user.cat", file: "开心.png", name: null, change: {name: "一"}})).toMatchObject({ok: false, code: "name-duplicate"});
        expect(await remote.updateSticker({id: "user.cat", file: "开心.png", name: null, change: {name: "1坏"}})).toMatchObject({ok: false, code: "name-invalid"});
        expect(await remote.updateSticker({id: "user.cat", file: "没有.png", name: null, change: {common: false}})).toMatchObject({ok: false, code: "sticker-missing"});
        expect(await remote.updateSticker({id: "user.cat", file: "开心.png", name: null, change: {common: false}})).toEqual({ok: true, value: {}});

        // 有了列表，后放进去的图是没加进来的：加进来一张、删掉另一张的文件。
        await writeFile(join(user, "cat", "冲.png"), await png(8, 8));
        await writeFile(join(user, "cat", "删.png"), await png(8, 8));
        expect(await remote.listFiles({id: "user.cat", files: ["冲.png"]})).toEqual({ok: true, value: {added: 1}});
        expect(await remote.deleteFile({id: "user.cat", file: "删.png"})).toEqual({ok: true, value: {}});
        expect(await exists(join(user, "cat", "删.png"))).toBe(false);
        expect(await remote.deleteFile({id: "user.cat", file: "冲.png"})).toMatchObject({ok: false, code: "sticker-missing"});

        // 删表情：清单里删那一项，文件没别的项用就删文件。
        expect(await remote.deleteSticker({id: "user.cat", file: "开心.png", name: null})).toEqual({ok: true, value: {}});
        expect(await exists(join(user, "cat", "开心.png"))).toBe(false);
        expect((await manifestOf(user, "cat")).stickers?.map((entry) => entry.file)).toEqual(["1.png", "冲.png"]);
        expect(service.list().find((entry) => entry.id === "user.cat")?.stickers.map((sticker) => sticker.name)).toEqual(["一", "冲"]);
    });

    test("输出 30：同一个文件写了两项时，删一项不删文件；没有表情列表的包里删表情就删文件", async () => {
        const {world, user} = await scene(async (user) => {
            await pack(join(user, "pair"), {stickers: [{name: "甲", file: "a.png"}, {name: "乙", file: "a.png"}]}, {"a.png": await png(8, 8)});
            await mkdir(join(user, "loose"));
            await writeFile(join(user, "loose", "开心.png"), await png(8, 8));
        });
        const remote = await api(world);
        expect(await remote.deleteSticker({id: "user.pair", file: "a.png", name: "甲"})).toEqual({ok: true, value: {}});
        expect(await exists(join(user, "pair", "a.png"))).toBe(true);
        expect((await manifestOf(user, "pair")).stickers).toEqual([{name: "乙", file: "a.png"}]);
        expect(await remote.deleteSticker({id: "user.loose", file: "开心.png", name: "开心"})).toEqual({ok: true, value: {}});
        expect(await exists(join(user, "loose", "开心.png"))).toBe(false);
        expect(await exists(join(user, "loose", "stickers.json"))).toBe(false);
    });

    test("输出 30：删除只认包里的图片文件：清单、别的文件、子文件夹都拒绝（sticker-missing）且内容不变", async () => {
        const {world, user} = await scene(async (user) => {
            await pack(join(user, "listed"), {stickers: [{file: "a.png", common: true}]}, {"a.png": await png(8, 8)});
            await writeFile(join(user, "listed", "readme.txt"), "说明");
            await mkdir(join(user, "listed", "sub"));
            await writeFile(join(user, "listed", "sub", "x.png"), await png(8, 8));
            await mkdir(join(user, "loose", "sub"), {recursive: true});
            await writeFile(join(user, "loose", "开心.png"), await png(8, 8));
            await writeFile(join(user, "loose", "readme.txt"), "说明");
            await writeFile(join(user, "loose", "sub", "x.png"), await png(8, 8));
        });
        const remote = await api(world);
        for (const file of ["stickers.json", "readme.txt", "sub", "没有.png"]) {
            expect(await remote.deleteFile({id: "user.listed", file})).toMatchObject({ok: false, code: "sticker-missing"});
            expect(await remote.deleteSticker({id: "user.loose", file, name: null})).toMatchObject({ok: false, code: "sticker-missing"});
        }
        expect(await readdir(join(user, "listed"))).toEqual(expect.arrayContaining(["stickers.json", "readme.txt", "sub", "a.png"]));
        expect(await readFile(join(user, "listed", "sub", "x.png"))).toEqual(Buffer.from(await png(8, 8)));
        expect((await readdir(join(user, "loose"))).sort()).toEqual(["readme.txt", "sub", "开心.png"]);
        expect(await manifestOf(user, "listed")).toEqual({stickers: [{file: "a.png", common: true}]});
    });

    test("输出 28、30：同一个文件在清单里写了两项（省略名字与写了同名）时，按清单里的原样名字各改各的、各删各的", async () => {
        const {world, user} = await scene(async (user) => {
            await pack(join(user, "dup"), {stickers: [{file: "a.png"}, {file: "a.png", name: "a"}]}, {"a.png": await png(8, 8)});
        });
        const remote = await api(world);
        // 第二项与第一项推出的名字相同，成了认不出的那一类；两项的定位值（null 与 "a"）不同，能分别改。
        expect(await remote.updateSticker({id: "user.dup", file: "a.png", name: "a", change: {name: "乙", description: "二"}})).toEqual({ok: true, value: {}});
        expect((await manifestOf(user, "dup")).stickers).toEqual([{file: "a.png"}, {file: "a.png", name: "乙", description: "二"}]);
        expect(await remote.deleteSticker({id: "user.dup", file: "a.png", name: null})).toEqual({ok: true, value: {}});
        expect((await manifestOf(user, "dup")).stickers).toEqual([{file: "a.png", name: "乙", description: "二"}]);
        expect(await exists(join(user, "dup", "a.png"))).toBe(true);
        // 推出来的名字不是定位值：这一项写了名字“乙”，用文件名主干 a 找不到。
        expect(await remote.updateSticker({id: "user.dup", file: "a.png", name: "a", change: {common: true}})).toMatchObject({ok: false, code: "sticker-missing"});
    });

    test("输出 33、34：改包名、删除都带打开时的令牌；文件夹被别处换掉的不动；改名后旧 id 没了", async () => {
        const {world, user, service} = await scene(async (user) => lyra(join(user, "lyra")));
        const remote = await api(world);
        const token = async (id: string): Promise<string> => {
            const detail = await remote.pack({id});
            if (!detail.ok || detail.value.token === null) throw new Error("没有令牌");
            return detail.value.token;
        };
        expect(await remote.renamePack({id: "user.lyra", folder: "xingli", token: await token("user.lyra")})).toEqual({ok: true, value: {id: "user.xingli"}});
        expect(mine(service).map((entry) => entry.id)).toEqual(["user.xingli"]);
        const stale = await token("user.xingli");
        // 别处删掉再放进同名的新文件夹：令牌对不上，改名、删除都不做。
        await rm(join(user, "xingli"), {recursive: true});
        await lyra(join(user, "xingli"));
        expect(await remote.renamePack({id: "user.xingli", folder: "other", token: stale})).toMatchObject({ok: false, code: "pack-changed"});
        expect(await remote.deletePack({id: "user.xingli", token: stale})).toMatchObject({ok: false, code: "pack-changed"});
        expect(await exists(join(user, "xingli", "stickers.json"))).toBe(true);
        expect(await remote.deletePack({id: "user.xingli", token: await token("user.xingli")})).toEqual({ok: true, value: {}});
        expect(await exists(join(user, "xingli"))).toBe(false);
        expect(mine(service)).toEqual([]);
    });

    test("改清单：清单满了不写；清单读不懂的不改；同一个包的两次写入排队，两个改动都在", async () => {
        const {world, user} = await scene(async (user) => {
            await pack(join(user, "full"), {stickers: Array.from({length: 500}, (_, index) => ({name: `n${String(index)}`, file: "a.png"}))}, {"a.png": await png(8, 8), "b.png": await png(8, 8)});
            await pack(join(user, "two"), {stickers: [{name: "甲", file: "a.png"}, {name: "乙", file: "b.png"}]}, {"a.png": await png(8, 8), "b.png": await png(8, 8)});
        });
        const remote = await api(world);
        expect(await remote.listFiles({id: "user.full", files: "all"})).toMatchObject({ok: false, code: "manifest-full"});
        const [first, second] = await Promise.all([
            remote.updateSticker({id: "user.two", file: "a.png", name: "甲", change: {description: "一"}}),
            remote.updateSticker({id: "user.two", file: "b.png", name: "乙", change: {description: "二"}}),
        ]);
        expect([first.ok, second.ok]).toEqual([true, true]);
        expect((await manifestOf(user, "two")).stickers?.map((entry) => entry.description)).toEqual(["一", "二"]);
        await writeFile(join(user, "two", "stickers.json"), "{不是 JSON");
        expect(await remote.updateSticker({id: "user.two", file: "a.png", name: "甲", change: {common: true}})).toMatchObject({ok: false, code: "write-failed"});
    });

    test("内置来源（输出 1、13、25、26、32）：应用自带两个包、全部常用、只读；复制到我的得 user.lyra，内置的随之标“被我的同名包盖住”、包段改写 id", async () => {
        const {world, user, files, service} = await scene();
        const builtinRoot = locateBuiltinStickers();
        if (builtinRoot === null) throw new Error("找不到内置表情包的目录");
        const manifest = JSON.parse(await readFile(join(builtinRoot, "lyra", "stickers.json"), "utf8")) as {stickers: Array<{file: string}>};
        expect(byId(service, "builtin.lyra")).toMatchObject({source: "builtin", folder: "lyra", title: "星璃", status: "ok"});
        expect(byId(service, "builtin.lyra")?.stickers.map((sticker) => sticker.file)).toEqual(manifest.stickers.map((item) => item.file));
        expect(byId(service, "builtin.lyra")?.stickers.every((sticker) => sticker.common && sticker.width === 512)).toBe(true);
        // Spec“内置来源”一表的名字与顺序。
        expect(byId(service, "builtin.lyra")?.stickers.map((sticker) => sticker.name)).toEqual(["开心", "嘿嘿", "比心", "害羞", "期待", "惊讶", "疑问", "嗯", "无语", "烦", "生气", "委屈", "大哭", "困", "偷看"]);
        expect(byId(service, "builtin.lyra-chibi")).toMatchObject({source: "builtin", title: "星璃 · 半身", status: "ok"});
        expect(byId(service, "builtin.lyra-chibi")?.stickers.map((sticker) => sticker.common)).toEqual(Array.from({length: 12}, () => true));

        // stickers:// 根写来源；内置的同插件的只能读。
        const listed = await files.list("stickers://");
        expect(listed.ok && "kind" in listed.value && listed.value.entries.find((entry) => entry.name === "builtin.lyra")?.meta?.source).toBe("内置");
        const read = await files.read("stickers://builtin.lyra/stickers.json");
        expect(read.ok).toBe(true);
        expect(await files.write("stickers://builtin.lyra/x.json", "{}", {expect: {hash: "0"}})).toMatchObject({ok: false, code: "unsupported-capability"});
        const remote = await api(world);
        expect(await remote.updatePack({id: "builtin.lyra", title: "改", description: null})).toMatchObject({ok: false, code: "not-user-pack"});
        expect(await remote.listFiles({id: "builtin.lyra", files: "all"})).toMatchObject({ok: false, code: "not-user-pack"});

        const marks = async () => {
            const packs = await remote.packs({});
            const catalog = await remote.catalog({});
            if (!packs.ok || !catalog.ok) throw new Error("取不到目录");
            const summary = (id: string) => packs.value.find((pack) => pack.id === id);
            return {
                summary: Object.fromEntries(["user.lyra", "builtin.lyra"].map((id) => [id, summary(id) === undefined ? null : [summary(id)?.writing, summary(id)?.shadowed ?? false]])),
                catalog: Object.fromEntries(catalog.value.filter((pack) => pack.folder === "lyra").map((pack) => [pack.id, pack.writing])),
            };
        };
        expect(await marks()).toEqual({summary: {"user.lyra": null, "builtin.lyra": ["lyra", false]}, catalog: {"builtin.lyra": "lyra"}});

        // 复制成我的 lyra（包名没被用，不加 -2）：图与清单都过来；之后按文件夹名认的是我的，内置的写 id、标被盖住。
        expect(await remote.copyPack({id: "builtin.lyra"})).toEqual({ok: true, value: {id: "user.lyra"}});
        expect((await readdir(join(user, "lyra"))).sort()).toEqual(["stickers.json", ...manifest.stickers.map((item) => item.file)].sort());
        expect(await manifestOf(user, "lyra")).toMatchObject({title: "星璃", description: byId(service, "builtin.lyra")?.description});
        expect((await manifestOf(user, "lyra")).description).toContain("星璃");
        expect(await marks()).toEqual({summary: {"user.lyra": ["lyra", false], "builtin.lyra": ["builtin.lyra", true]}, catalog: {"user.lyra": "lyra", "builtin.lyra": "builtin.lyra"}});
        const detail = await remote.pack({id: "builtin.lyra"});
        expect(detail.ok && detail.value.summary).toMatchObject({writing: "builtin.lyra", shadowed: true});
    });

    test("输出 32：复制插件的包成用户的包（清单与顶层图片），包名被用了加 -2；插件途中换了版本不留半个包；插件的包不能改", async () => {
        const {user, files} = await scene(async (user) => {
            await mkdir(join(user, "lyra"), {recursive: true});
        });
        counter += 1;
        const plugin = join(tmp, `c${String(counter)}`);
        await lyra(join(plugin, "lyra"));
        await mkdir(join(plugin, "lyra", "sub"));
        await writeFile(join(plugin, "lyra", "notes.txt"), "说明");
        const catalog = await StickerCatalog.open({roots: [{key: "user", source: "user", prefix: "user", root: user, watch: false}], clock: {now: () => 0, schedule: () => () => undefined} as never, report: () => undefined});
        catalogs.push(catalog);
        await catalog.addRoot({key: "acme.cute.packs", source: "plugin", prefix: "acme.cute", root: plugin, watch: false});
        const editor = new StickerEditor({files: () => files, catalog});
        expect(await editor.updatePack("acme.cute.lyra", {title: "改"})).toMatchObject({ok: false, code: "not-user-pack"});
        expect(await editor.copyPack("acme.cute.lyra")).toEqual({ok: true, value: {id: "user.lyra-2"}});
        expect(catalog.item("user.lyra-2")?.entry).toMatchObject({title: "星璃", status: "ok"});
        expect(await exists(join(user, "lyra-2", "notes.txt"))).toBe(false);
        expect(await exists(join(user, "lyra-2", "sub"))).toBe(false);
        expect(await exists(join(user, "lyra-2", "happy.png"))).toBe(true);

        // 复制途中插件撤回再登记（换了版本）：丢弃暂存。
        const slow = new StickerEditor({files: () => files, catalog: {...catalog, item: (id) => catalog.item(id), refresh: (key) => catalog.refresh(key), rootVersion: (key) => {
            const version = catalog.rootVersion(key);
            return key === "acme.cute.packs" && copies++ > 0 ? (version ?? 0) + 1 : version;
        }}});
        let copies = 0;
        expect(await slow.copyPack("acme.cute.lyra")).toMatchObject({ok: false, code: "pack-changed"});
        expect(catalog.list().filter((entry) => entry.id.startsWith("user.lyra-")).map((entry) => entry.id)).toEqual(["user.lyra-2"]);
        expect((await readdir(user)).filter((name) => name.startsWith(STAGING_PREFIX))).toEqual([]);
    });
});

describe("表情包页的上传、导入与导出", () => {
    const jpeg = (width: number, height: number): Promise<Uint8Array> => new Bun.Image(PIXEL).resize(width, height).jpeg().bytes();
    const names = async (directory: string): Promise<string[]> => (await readdir(directory)).sort();

    async function page(prepare: (user: string) => Promise<void>, options: {idleMs?: number; gate?: Gate} = {}) {
        const {user, files} = await scene(prepare);
        const catalog = await StickerCatalog.open({roots: [{key: "user", source: "user", prefix: "user", root: user, watch: false}], clock: {now: () => 0, schedule: () => () => undefined} as never, report: () => undefined});
        catalogs.push(catalog);
        const editor = new StickerEditor({files: () => files, catalog});
        const routes = createStickerRoutes({catalog, files: () => files, editor, ...options});
        const put = (id: string, file: string, body: Uint8Array, headers: Record<string, string> = {}) => routes.request(`/packs/${id}/images/${encodeURIComponent(file)}`, {method: "PUT", body, headers});
        const post = (query: string, body: Uint8Array, headers: Record<string, string> = {}) => routes.request(`/import?${query}`, {method: "POST", body, headers});
        return {user, catalog, editor, routes, put, post};
    }
    const stream = (chunks: number, size: number): ReadableStream<Uint8Array> => {
        let sent = 0;
        return new ReadableStream({pull(controller) {
            if (sent >= chunks) return controller.close();
            sent += 1;
            controller.enqueue(new Uint8Array(size));
        }});
    };
    const streamed = (body: ReadableStream<Uint8Array>): RequestInit => ({method: "PUT", body, duplex: "half"} as RequestInit);
    const catZip = async (extra: Record<string, Uint8Array> = {}): Promise<Uint8Array> => zipSync({"cat/stickers.json": strToU8(JSON.stringify({title: "猫", stickers: [{file: "a.png", common: true}]})), "cat/a.png": await png(16, 16), ...extra});

    test("输出 29：上传的图写进包里（超限的缩小）、撞名顺延、有表情列表的同时进清单；不合格的拒绝；跨站、插件的包不收", async () => {
        const {user, catalog, put} = await page(async (user) => {
            await pack(join(user, "listed"), {stickers: [{file: "a.png", name: "甲"}]}, {"a.png": await png(8, 8)});
            await mkdir(join(user, "loose"));
            await writeFile(join(user, "loose", "开心.png"), await png(8, 8));
        });
        const big = await put("user.listed", "大.jpg", await jpeg(2000, 1500));
        expect(await big.json()).toEqual({file: "大.jpg", resized: true});
        expect((await put("user.listed", "大.jpg", await jpeg(20, 20))).status).toBe(200);
        expect(await names(join(user, "listed"))).toEqual(["a.png", "stickers.json", "大-2.jpg", "大.jpg"]);
        expect((await manifestOfDisk(user, "listed")).stickers).toEqual([{file: "a.png", name: "甲"}, {file: "大.jpg"}, {file: "大-2.jpg"}]);
        expect(catalog.item("user.listed")?.entry.stickers.find((sticker) => sticker.file === "大.jpg")).toMatchObject({width: 1024, height: 768});

        // 没有表情列表的包：只写文件，不生成清单。
        expect((await put("user.loose", "困.png", await png(8, 8))).status).toBe(200);
        expect(await names(join(user, "loose"))).toEqual(["困.png", "开心.png"]);
        expect(catalog.item("user.loose")?.entry.stickers.map((sticker) => sticker.name)).toEqual(["困", "开心"]);

        const rejected = await put("user.loose", "假.png", strToU8("不是图片"));
        expect(rejected.status).toBe(422);
        expect(await rejected.json()).toMatchObject({error: {code: "image-rejected", reason: "type-mismatch"}});
        expect((await put("user.loose", "a.png", await png(8, 8), {"sec-fetch-site": "cross-site"})).status).toBe(403);
        expect((await put("user.loose", "a.png", await png(8, 8), {"sec-fetch-site": "none"})).status).toBe(403);
        expect((await put("user.none", "a.png", await png(8, 8))).status).toBe(404);
    });

    test("输出 29：没有表情列表、文件夹里已有 500 张图的包再加得 manifest-full；插件的包不收上传", async () => {
        const {put, catalog, user} = await page(async (user) => {
            await mkdir(join(user, "full"));
            const bytes = await png(8, 8);
            for (let index = 0; index < 500; index += 1) await writeFile(join(user, "full", `a${String(index)}.png`), bytes);
        });
        const full = await put("user.full", "多.png", await png(8, 8));
        expect(full.status).toBe(409);
        expect(await full.json()).toMatchObject({error: {code: "manifest-full"}});
        expect(await names(join(user, "full"))).toHaveLength(500);
        // 插件的包：只读。
        counter += 1;
        const plugin = join(tmp, `u${String(counter)}`);
        await lyra(join(plugin, "lyra"));
        await catalog.addRoot({key: "acme.cute.packs", source: "plugin", prefix: "acme.cute", root: plugin, watch: false});
        const refused = await put("acme.cute.lyra", "a.png", await png(8, 8));
        expect(refused.status).toBe(403);
        expect(await refused.json()).toMatchObject({error: {code: "not-user-pack"}});
    });

    test("输出 29：有表情列表、清单已满 500 项的包，图写进去后清单加不了项：图片删掉、整张算失败", async () => {
        const {put, user} = await page(async (user) => {
            await pack(join(user, "full"), {stickers: Array.from({length: 500}, (_, index) => ({name: `n${String(index)}`, file: "a.png"}))}, {"a.png": await png(8, 8)});
        });
        const refused = await put("user.full", "多.png", await png(8, 8));
        expect(refused.status).toBe(409);
        expect(await refused.json()).toMatchObject({error: {code: "manifest-full"}});
        expect(await names(join(user, "full"))).toEqual(["a.png", "stickers.json"]);
    });

    test("归档锁：同时导出的排队，队列满了得 busy（在跑的加排队的至多 5 个）", async () => {
        const {routes} = await page(async (user) => lyra(join(user, "lyra")));
        const responses = await Promise.all(Array.from({length: 6}, () => routes.request("/export/user.lyra")));
        expect(responses.map((response) => response.status).sort()).toEqual([200, 200, 200, 200, 200, 429]);
    });

    test("上传的体积：流式超过 32 MiB 得 413 且什么都没写；很久没有新字节得 408", async () => {
        const {user, routes} = await page(async (user) => {
            await mkdir(join(user, "loose"));
        }, {idleMs: 30});
        const over = await routes.request("/packs/user.loose/images/a.png", streamed(stream(33, 1024 * 1024)));
        expect(over.status).toBe(413);
        expect(UPLOAD_MAX_BYTES).toBe(32 * 1024 * 1024);
        expect(await names(join(user, "loose"))).toEqual([]);
        const stalled = await routes.request("/packs/user.loose/images/a.png", streamed(new ReadableStream({start: () => undefined})));
        expect(stalled.status).toBe(408);
    });

    test("名额：队列满了得 429；排队的请求取消就退出队列", async () => {
        const full = await page(async (user) => {
            await mkdir(join(user, "loose"));
        }, {gate: new Gate(0, 0)});
        const busy = await full.put("user.loose", "a.png", await png(8, 8));
        expect(busy.status).toBe(429);
        expect(await busy.json()).toMatchObject({error: {code: "busy"}});

        const gate = new Gate(1, 1);
        const first = await gate.enter(new AbortController().signal);
        const aborter = new AbortController();
        const queued = gate.enter(aborter.signal);
        expect(await gate.enter(new AbortController().signal)).toBeNull();
        aborter.abort();
        expect(await queued).toBeNull();
        // 取消的退出了队列：下一个可以排队，前一个放了名额它就进。
        const next = gate.enter(new AbortController().signal);
        first?.();
        const entered = await next;
        expect(entered).not.toBeNull();
        entered?.();
    });

    test("输出 36：导入 zip；同名先问，不写任何东西；另存为下一个空的包名；替换要带令牌，对不上不替换；替换后旧的没留下", async () => {
        const {user, catalog, post, routes} = await page(async () => undefined);
        const archive = await catZip();
        const first = await post("name=cat.zip", archive);
        expect(await first.json()).toEqual({id: "user.cat"});
        expect(catalog.item("user.cat")?.entry).toMatchObject({title: "猫", status: "ok"});

        const again = await post("name=cat.zip", archive);
        expect(again.status).toBe(409);
        const conflict = (await again.json()) as {error: {code: string}; conflict: {existing: {title: string; count: number; files: string[]; token: string}; copyAs: string}};
        expect(conflict.error.code).toBe("import-conflict");
        expect(conflict.conflict).toMatchObject({existing: {title: "猫", count: 1, files: ["a.png"]}, copyAs: "cat-2"});
        expect(await names(user)).toEqual(["cat"]);

        const copied = await post("name=cat.zip&mode=copy", archive);
        expect(await copied.json()).toEqual({id: "user.cat-2"});
        expect(await names(user)).toEqual(["cat", "cat-2"]);

        const stale = await post(`name=cat.zip&mode=replace&token=${encodeURIComponent("不对的令牌")}`, archive);
        expect(stale.status).toBe(409);
        expect(await stale.json()).toMatchObject({error: {code: "pack-changed"}});

        // 换成另一个内容：token 对上了才换，旧的 b.png 没了，没有 .nbook-stickers-replaced-* 留下。
        await writeFile(join(user, "cat", "b.png"), await png(9, 9));
        await catalog.refresh("user");
        const latest = (await (await post("name=cat.zip", archive)).json()) as {conflict: {existing: {token: string}}};
        const replaced = await post(`name=cat.zip&mode=replace&token=${encodeURIComponent(latest.conflict.existing.token)}`, await catZip({"cat/c.png": await png(12, 12)}));
        expect(await replaced.json()).toEqual({id: "user.cat"});
        expect(await names(join(user, "cat"))).toEqual(["a.png", "c.png", "stickers.json"]);
        expect(await names(user)).toEqual(["cat", "cat-2"]);
        expect(routes).toBeDefined();
    });

    test("输出 36：不合格的 zip 整个不导入、不留暂存；跨站不收；zip 炸弹（压得很小、解开很大）被挡下", async () => {
        const {user, post} = await page(async () => undefined);
        const bomb = zipSync({"cat/大.png": new Uint8Array(40 * 1024 * 1024)});
        expect(bomb.length).toBeLessThan(1024 * 1024);
        const refused = [
            await post("name=cat.zip", zipSync({"cat/../开心.png": await png(8, 8)})),
            await post("name=cat.zip", zipSync({"cat/readme.txt": strToU8("没有图")})),
            await post("name=cat.zip", zipSync({"cat/stickers.json": strToU8("{不是 JSON"), "cat/a.png": await png(8, 8)})),
            await post("name=cat.zip", zipSync({"cat/a.png": strToU8("不是图片")})),
            await post("name=猫猫.zip", zipSync({"a.png": await png(8, 8)})),
            await post("name=cat.zip", bomb),
        ];
        expect(refused.map((response) => response.status)).toEqual([422, 422, 422, 422, 422, 422]);
        for (const response of refused) expect(await response.json()).toMatchObject({error: {code: "import-invalid"}});
        expect((await post("name=cat.zip", await catZip(), {"sec-fetch-site": "cross-site"})).status).toBe(403);
        expect(await names(user)).toEqual([]);
    });

    test("输出 35：导出是一个以包名命名的 zip，导回来内容一样；没有图片、无效的、超过 64 MiB 的不导出；插件的包能导出；内置的包能导出、能在文件夹中显示", async () => {
        const {user, catalog, routes, post} = await page(async (user) => {
            await lyra(join(user, "lyra"));
            await mkdir(join(user, "empty"));
            await pack(join(user, "bad"), "{不是 JSON");
            await mkdir(join(user, "huge"));
            for (const name of ["a", "b", "c"]) await writeFile(join(user, "huge", `${name}.png`), new Uint8Array(30 * 1024 * 1024));
        });
        const exported = await routes.request("/export/user.lyra");
        expect(exported.status).toBe(200);
        expect(exported.headers.get("content-type")).toBe("application/zip");
        expect(exported.headers.get("content-disposition")).toBe("attachment; filename*=UTF-8''lyra.zip");
        const bytes = new Uint8Array(await exported.arrayBuffer());
        const unpacked = unpackZip(bytes);
        if (!unpacked.ok) throw new Error(unpacked.reason);
        expect(unpacked.folder).toBe("lyra");
        expect([...unpacked.files.keys()].sort()).toEqual(["big.png", "fake.png", "happy.png", "heart.png", "shy.webp", "stickers.json", "困.png", "1.png"].sort());
        // 导回：删掉原包再导入，表情与导出前一样。
        const before = catalog.item("user.lyra")?.entry.stickers.map((sticker) => sticker.name);
        await rm(join(user, "lyra"), {recursive: true});
        await catalog.refresh("user");
        expect(await (await post("name=lyra.zip", bytes)).json()).toEqual({id: "user.lyra"});
        expect(catalog.item("user.lyra")?.entry.stickers.map((sticker) => sticker.name)).toEqual(before);

        expect(await (await routes.request("/export/user.empty")).json()).toMatchObject({error: {code: "export-empty"}});
        const invalid = await routes.request("/export/user.bad");
        expect(invalid.status).toBe(422);
        expect(await invalid.json()).toMatchObject({error: {code: "pack-invalid"}});
        const huge = await routes.request("/export/user.huge");
        expect(huge.status).toBe(413);
        expect(await huge.json()).toMatchObject({error: {code: "export-too-large"}});
        expect((await routes.request("/export/user.none")).status).toBe(404);
        expect((await routes.request("/export/user.lyra", {headers: {"sec-fetch-site": "cross-site"}})).status).toBe(403);

        // 内置的包同插件的包：能导出、能在文件夹中显示（打开应用自带的目录）。
        const builtinRoot = locateBuiltinStickers();
        if (builtinRoot === null) throw new Error("找不到内置表情包的目录");
        await catalog.addRoot({key: "builtin", source: "builtin", prefix: "builtin", root: builtinRoot, watch: false});
        const builtin = await routes.request("/export/builtin.lyra");
        expect(builtin.status).toBe(200);
        const builtinUnpacked = unpackZip(new Uint8Array(await builtin.arrayBuffer()));
        if (!builtinUnpacked.ok) throw new Error(builtinUnpacked.reason);
        expect(builtinUnpacked.folder).toBe("lyra");
        expect([...builtinUnpacked.files.keys()].sort()).toEqual((await readdir(join(builtinRoot, "lyra"))).sort());
        expect(await revealPath(catalog, user, "builtin.lyra")).toBe(join(builtinRoot, "lyra"));
    });

    test("输出 35：导出前按导入端的规则核对：只差大小写的重名、超过 32 MiB 的单个文件都不导出，不让用户拿到导不回来的备份", async () => {
        const {routes} = await page(async (user) => {
            await mkdir(join(user, "case"));
            await writeFile(join(user, "case", "Happy.png"), await png(8, 8));
            await writeFile(join(user, "case", "happy.png"), await png(9, 9));
            await mkdir(join(user, "big"));
            await writeFile(join(user, "big", "a.png"), await png(8, 8));
            await writeFile(join(user, "big", "b.png"), new Uint8Array(33 * 1024 * 1024));
        });
        const sameName = await routes.request("/export/user.case");
        expect(sameName.status).toBe(409);
        expect(await sameName.json()).toMatchObject({error: {code: "export-conflict"}});
        const oversize = await routes.request("/export/user.big");
        expect(oversize.status).toBe(413);
        expect(await oversize.json()).toMatchObject({error: {code: "export-too-large"}});
    });

    test("取消：客户端断开后，读体立即停（不等空闲超时）、什么都没写；已取消的请求不再写进包或暂存", async () => {
        const {user, routes, editor} = await page(async (user) => {
            await mkdir(join(user, "loose"));
        }, {idleMs: 60_000});
        const aborter = new AbortController();
        const request = new Request("http://localhost/packs/user.loose/images/a.png", {method: "PUT", body: new ReadableStream({start: () => undefined}), duplex: "half", signal: aborter.signal} as RequestInit);
        const pending = routes.request(request);
        aborter.abort();
        const response = await pending;
        expect(response.status).toBe(408);
        expect(await response.json()).toMatchObject({error: {code: "request-aborted"}});
        expect(await names(join(user, "loose"))).toEqual([]);

        // 已读完体、排在编辑器锁上的请求，客户端断开后轮到它时不再动盘。
        const gone = AbortSignal.abort();
        expect(await editor.addImage("user.loose", "a.png", await png(8, 8), gone)).toMatchObject({ok: false, code: "request-aborted"});
        expect(await editor.importZip(await catZip(), "cat.zip", undefined, gone)).toMatchObject({ok: false, code: "request-aborted"});
        expect(await names(join(user, "loose"))).toEqual([]);
        expect(await names(user)).toEqual(["loose"]);
    });

    test("输出 29：清单写不进去时撤回刚写的图；撤回前文件已被别处换掉的不删，如实报部分完成", async () => {
        const {user, files} = await scene(async (user) => {
            await pack(join(user, "full"), {stickers: Array.from({length: 500}, (_, index) => ({name: `n${String(index)}`, file: "a.png"}))}, {"a.png": await png(8, 8)});
        });
        const catalog = await StickerCatalog.open({roots: [{key: "user", source: "user", prefix: "user", root: user, watch: false}], clock: {now: () => 0, schedule: () => () => undefined} as never, report: () => undefined});
        catalogs.push(catalog);
        const replacement = await png(33, 33);
        // 清单写失败之前，别处把刚写的图换成了另一份内容。
        const swapping: WorkspaceFiles = {...files, update: async (address, edit, options) => {
            await writeFile(join(user, "full", "多.png"), replacement);
            return files.update(address, edit, options);
        }};
        const editor = new StickerEditor({files: () => swapping, catalog});
        const result = await editor.addImage("user.full", "多.png", await png(8, 8));
        expect(result).toMatchObject({ok: false, code: "write-failed"});
        expect(await readFile(join(user, "full", "多.png"))).toEqual(Buffer.from(replacement));
    });
});

async function manifestOfDisk(user: string, folder: string): Promise<{stickers?: Array<Record<string, unknown>>}> {
    return JSON.parse(await readFile(join(user, folder, "stickers.json"), "utf8")) as {stickers?: Array<Record<string, unknown>>};
}

describe("浏览器目录", () => {
    test("输出 18：只带显示要用的字段；合计超过上限时放不下的表情包整包不进、写诊断", () => {
        const entry = (id: string, count: number): StickerPackEntry => ({id, folder: id.split(".")[1] as string, source: "user", title: id, status: "ok", stickers: Array.from({length: count}, (_, index) => ({name: `n${String(index)}`, file: `f${String(index)}.png`, description: "说明", common: false, width: 8, height: 8, version: "1-1", bytes: 8}))});
        const reports: string[] = [];
        const result = browserCatalog([entry("user.a", BROWSER_STICKERS_MAX - 1), entry("user.b", 2), entry("user.c", 1)], (code) => reports.push(code));
        expect(result.map((pack) => pack.id)).toEqual(["user.a", "user.c"]);
        expect(result[1]?.stickers[0]).toEqual({name: "n0", width: 8, height: 8, url: "/api/nbook.stickers/image/user.c/f0.png?v=1-1"});
        expect(reports).toEqual(["catalog-truncated"]);
    });

    test("输出 7、14、18、41：带显示名、来源、插件与写法的包段；同名文件夹按来源分级（我的、插件、内置），胜出且唯一的写文件夹名，其余写 id；包段在完整目录上算", () => {
        const sticker = {name: "开心", file: "a.png", common: true, width: 8, height: 8, version: "1-1", bytes: 8};
        const plugin = (id: string, folder: string, extra: Partial<StickerPackEntry> = {}): StickerPackEntry => ({id, folder, source: "plugin", plugin: {id: id.slice(0, id.lastIndexOf(".")), title: "可爱"}, title: id, status: "ok", stickers: [sticker], ...extra});
        const builtin = (folder: string): StickerPackEntry => ({id: `builtin.${folder}`, folder, source: "builtin", title: folder, status: "ok", stickers: [sticker]});
        const packs: StickerPackEntry[] = [
            // 我的 lyra 没有表情、不进浏览器目录，照样盖住插件与内置的 lyra：包段在完整目录上算。
            {id: "user.lyra", folder: "lyra", source: "user", title: "星璃", status: "ok", stickers: []},
            plugin("acme.cute.lyra", "lyra"),
            builtin("lyra"),
            // 插件与内置同名：插件胜出。
            plugin("acme.cute.cat", "cat"),
            builtin("cat"),
            // 两个插件同名：同一级不止一个，都写 id；内置的那个也认不到。
            plugin("acme.cute.dog", "dog"),
            plugin("zoo.dog", "dog"),
            builtin("dog"),
            // 无效的包不算同名：它不进写法（输出 7 只在有效的包里认）。
            {id: "user.fox", folder: "fox", source: "user", title: "坏", status: "invalid", problem: {code: "manifest-invalid"}, stickers: []},
            builtin("fox"),
        ];
        const result = browserCatalog(packs, () => undefined);
        expect(Object.fromEntries(result.map((pack) => [pack.id, pack.writing]))).toEqual({
            "acme.cute.lyra": "acme.cute.lyra",
            "builtin.lyra": "builtin.lyra",
            "acme.cute.cat": "cat",
            "builtin.cat": "builtin.cat",
            "acme.cute.dog": "acme.cute.dog",
            "zoo.dog": "zoo.dog",
            "builtin.dog": "builtin.dog",
            "builtin.fox": "fox",
        });
        expect(result.find((pack) => pack.id === "acme.cute.cat")).toMatchObject({title: "acme.cute.cat", source: "plugin", plugin: {id: "acme.cute", title: "可爱"}});
        expect(result.find((pack) => pack.id === "builtin.cat")?.source).toBe("builtin");

        // 设置页的概要带同样的包段与“被我的同名包盖住”：只有我的有效包盖得住，插件盖不住内置的标注。
        const summaries = browserSummaries(packs, () => undefined);
        const marks = Object.fromEntries(summaries.map((summary) => [summary.id, [summary.writing ?? null, summary.shadowed ?? false]]));
        expect(marks).toMatchObject({
            "user.lyra": ["lyra", false],
            "acme.cute.lyra": ["acme.cute.lyra", true],
            "builtin.lyra": ["builtin.lyra", true],
            "builtin.cat": ["builtin.cat", false],
            "user.fox": [null, false],
            "builtin.fox": ["fox", false],
        });
    });

    test("输出 18、19：目录与设置页的概要序列化后不超过远程消息的预算，放不下的表情包整包不进、写诊断", () => {
        const longFile = `${"f".repeat(240)}.png`;
        const packs = Array.from({length: 12}, (_, pack): StickerPackEntry => ({id: `user.p${String(pack).padStart(2, "0")}`, folder: `p${String(pack)}`, source: "user", title: "长".repeat(200), description: "说".repeat(200), status: "ok", stickers: Array.from({length: 400}, (_, index) => ({name: `名${String(index)}`, file: longFile, common: false, width: 8, height: 8, version: "1-1", bytes: 8}))}));
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

/**
 * 表情包页的取数与写入（docs/specs/agent/stickers.md 输出 25、31 到 34、38）：加载与失败、选中规则、晚到的旧结果、写入排队、
 * 失败码变成文字、结果不知道时重取、加图汇总通知。远程服务与 HTTP 用内存里的替身，行为按真实合同写（返回值形状同合同的输出与失败）。
 */

import {describe, expect, test} from "bun:test";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import type {NotificationInput} from "nbook/plugins/workbench/shared/contracts";
import {boundText} from "nbook/shared/use-plugin-text";
import {testTextPort} from "nbook/shared/testing/text-port";

import type zhCN from "../locales/zh-CN.json";
import type {StickerPackDetail, StickerPackSummary} from "../shared/contracts";
import {STICKERS_TEXT_NAMESPACE} from "../shared/text";
import {createPacksModel} from "./packs-page";
import type {StickersHttp, StickersRemote} from "./packs-page";
import {stickersCatalogs} from "./text";

const t = boundText<typeof zhCN>(testTextPort("zh-CN", {[STICKERS_TEXT_NAMESPACE]: stickersCatalogs}), STICKERS_TEXT_NAMESPACE);

const summary = (id: string, source: "user" | "plugin" = "user"): StickerPackSummary => ({
    id, folder: id.slice(id.lastIndexOf(".") + 1), source, ...(source === "plugin" ? {plugin: {id: "acme", title: "示例"}} : {}), title: id, status: "ok", count: 1, thumbnail: null, unrecognized: 0, unlisted: 0,
});
const detailOf = (id: string): StickerPackDetail => ({summary: summary(id), listed: true, token: `token-${id}`, stickers: [], extras: []});

/** 内存里的服务：目录、事件、写入；`hold` 让某个方法挂起以便测晚到与排队。 */
function world(initial: string[]) {
    const ids = [...initial];
    const handlers = new Set<() => void>();
    const calls: string[] = [];
    const gates = new Map<string, Array<() => void>>();
    let packsFail: string | null = null;
    let nextWrite: {code: string; detail?: unknown} | null = null;
    const hold = (name: string): Promise<void> => new Promise((resolve) => {
        if (!gates.has(name)) return resolve();
        gates.get(name)!.push(resolve);
    });
    const fire = (): void => void [...handlers].forEach((handler) => handler());
    const write = async (name: string, change?: () => void) => {
        calls.push(`start ${name}`);
        await hold(name);
        calls.push(`end ${name}`);
        if (nextWrite !== null) {
            const failure = nextWrite;
            nextWrite = null;
            return {ok: false as const, code: failure.code, detail: failure.detail ?? {detail: ""}};
        }
        change?.();
        return {ok: true as const, value: {}};
    };
    const remote = {
        packs: async () => (calls.push("packs"), packsFail === null ? {ok: true as const, value: ids.map((id) => summary(id, id.startsWith("acme.") ? "plugin" : "user"))} : {ok: false as const, code: packsFail}),
        pack: async ({id}: {id: string}) => {
            await hold(`pack ${id}`);
            return ids.includes(id) ? {ok: true as const, value: detailOf(id)} : {ok: false as const, code: "pack-missing", detail: {}};
        },
        events: {changed: {subscribe: async (_filter: unknown, handler: () => void) => {
            handlers.add(handler);
            return {ok: true as const, value: {release: () => handlers.delete(handler)}};
        }}},
        createPack: async ({folder}: {folder: string}) => {
            const result = await write("createPack", () => ids.push(`user.${folder}`));
            return result.ok ? {ok: true as const, value: {id: `user.${folder}`}} : result;
        },
        renamePack: async ({id, folder, token}: {id: string; folder: string; token: string}) => {
            calls.push(`rename token=${token}`);
            const result = await write("renamePack", () => ids.splice(ids.indexOf(id), 1, `user.${folder}`));
            return result.ok ? {ok: true as const, value: {id: `user.${folder}`}} : result;
        },
        copyPack: async ({id}: {id: string}) => {
            const result = await write("copyPack", () => ids.push(`user.${id.slice(id.indexOf(".") + 1)}-2`));
            return result.ok ? {ok: true as const, value: {id: `user.${id.slice(id.indexOf(".") + 1)}-2`}} : result;
        },
        deletePack: async ({id}: {id: string}) => write("deletePack", () => ids.splice(ids.indexOf(id), 1)),
        updatePack: async () => write("updatePack"),
        updateSticker: async ({change}: {change: {description?: string | null}}) => write(`updateSticker ${String(change.description)}`),
        deleteSticker: async () => write("deleteSticker"),
        listFiles: async () => write("listFiles"),
        deleteFile: async () => write("deleteFile"),
        revealPack: async ({id}: {id: string}) => (id === "user.nodesk" ? {ok: false as const, code: "no-desktop", detail: {path: "/x/nodesk"}} : {ok: true as const, value: {}}),
    } as unknown as StickersRemote;
    return {
        remote, ids, calls, fire,
        gate: (name: string) => gates.set(name, []),
        open: (name: string) => {
            for (const release of gates.get(name) ?? []) release();
            gates.delete(name);
        },
        failPacks: (code: string | null) => (packsFail = code),
        failNextWrite: (code: string, detail?: unknown) => (nextWrite = {code, detail}),
    };
}

function model(initial: string[], http: Partial<StickersHttp> = {}) {
    const fake = world(initial);
    const notices: NotificationInput[] = [];
    const reports: string[] = [];
    const created = createPacksModel({
        remote: fake.remote,
        t,
        http: {upload: async () => ({ok: true, file: "a.png", resized: false}), importZip: async () => ({ok: true, id: "user.x"}), exportPack: async () => ({ok: true}), ...http},
        notify: (input) => notices.push(input),
        report: (code) => reports.push(code),
    });
    return {...fake, model: created, notices, reports};
}

describe("加载与选中", () => {
    test("加载中到就绪；第一次打开选中“我的”里的第一个并取它的详情", async () => {
        const {model: m} = model(["acme.z", "user.b", "user.a"]);
        expect(m.state.value).toBe("loading");
        m.start();
        await waitUntil("就绪并选中", () => (m.state.value === "ready" && m.detail.value !== null ? true : null));
        expect(m.selected.value).toBe("user.a");
        expect(m.detail.value?.summary.id).toBe("user.a");
    });

    test("第一次读失败显示失败页，重试后就绪；已就绪时重取失败不换成失败页", async () => {
        const w = model(["user.a"]);
        w.failPacks("unavailable");
        w.model.start();
        await waitUntil("失败页", () => (typeof w.model.state.value === "object" ? true : null));
        expect(w.model.state.value).toEqual({failed: "unavailable"});
        w.failPacks(null);
        w.model.retry();
        await waitUntil("就绪", () => (w.model.state.value === "ready" ? true : null));
        w.failPacks("unavailable");
        w.fire();
        await waitUntil("记了诊断", () => (w.reports.includes("packs-reload-failed") ? true : null));
        expect(w.model.state.value).toBe("ready");
    });

    test("晚到的旧详情丢掉：选中 B 之后 A 的详情才到，不显示 A", async () => {
        const w = model(["user.a", "user.b"]);
        w.gate("pack user.a");
        w.model.start();
        await waitUntil("就绪", () => (w.model.state.value === "ready" ? true : null));
        w.model.select("user.b");
        await waitUntil("B 的详情", () => (w.model.detail.value?.summary.id === "user.b" ? true : null));
        w.open("pack user.a");
        await waitUntil("A 的请求回来了", () => (w.calls.length >= 0 ? true : null));
        expect(w.model.detail.value?.summary.id).toBe("user.b");
    });

    test("选中的包被别处删掉：回到第一项；自己做的操作之后选中结果包，不被弹回第一项", async () => {
        const w = model(["user.a", "user.b"]);
        w.model.start();
        await waitUntil("就绪", () => (w.model.detail.value?.summary.id === "user.a" ? true : null));
        w.model.select("user.b");
        await waitUntil("B", () => (w.model.detail.value?.summary.id === "user.b" ? true : null));
        w.ids.splice(w.ids.indexOf("user.b"), 1);
        w.fire();
        await waitUntil("回到 A", () => (w.model.selected.value === "user.a" ? true : null));

        expect(await w.model.createPack("cat", "猫")).toEqual({id: "user.cat"});
        expect(w.model.selected.value).toBe("user.cat");
        await waitUntil("详情是新包", () => (w.model.detail.value?.summary.id === "user.cat" ? true : null));
        expect(w.model.packs.value.map((pack) => pack.id)).toContain("user.cat");
    });
});

describe("写入", () => {
    test("改包名带打开时的令牌，改完选中结果包；令牌没有（详情还没到）得 pack-changed 的文字", async () => {
        const w = model(["user.a"]);
        w.model.start();
        await waitUntil("详情", () => (w.model.detail.value !== null ? true : null));
        expect(await w.model.renamePack("user.a", "b")).toEqual({id: "user.b"});
        expect(w.calls).toContain("rename token=token-user.a");
        expect(w.model.selected.value).toBe("user.b");
        expect(await w.model.renamePack("user.zzz", "c")).toEqual({reason: t("error.pack-changed")});
    });

    test("同一个包的写入按到达顺序做，前一个做完后一个才开始", async () => {
        const w = model(["user.a"]);
        w.model.start();
        await waitUntil("就绪", () => (w.model.detail.value !== null ? true : null));
        w.gate("updateSticker 一");
        const first = w.model.updateSticker("user.a", {file: "a.png", name: "a"}, {description: "一"});
        const second = w.model.updateSticker("user.a", {file: "a.png", name: "a"}, {description: "二"});
        await waitUntil("第一个开始", () => (w.calls.includes("start updateSticker 一") ? true : null));
        expect(w.calls).not.toContain("start updateSticker 二");
        w.open("updateSticker 一");
        expect(await first).toBeNull();
        expect(await second).toBeNull();
        expect(w.calls.filter((call) => call.startsWith("start updateSticker"))).toEqual(["start updateSticker 一", "start updateSticker 二"]);
    });

    test("失败码变成文字：业务码按目录，图片被拒的原因按稳定码翻译；pack-changed 之后重取", async () => {
        const w = model(["user.a"]);
        w.model.start();
        await waitUntil("就绪", () => (w.model.detail.value !== null ? true : null));
        w.failNextWrite("name-duplicate");
        expect(await w.model.updateSticker("user.a", {file: "a.png", name: "a"}, {name: "b"})).toEqual({reason: t("error.name-duplicate")});
        w.failNextWrite("pack-changed");
        const reloads = (): number => w.calls.filter((call) => call === "packs").length;
        const before = reloads();
        expect(await w.model.updatePack("user.a", {title: "新"})).toEqual({reason: t("error.pack-changed")});
        expect(reloads()).toBeGreaterThan(before);
        // 别的失败（名字重名这类）不重取。
        w.failNextWrite("name-duplicate");
        const mid = reloads();
        await w.model.updatePack("user.a", {title: "新"});
        expect(reloads()).toBe(mid);
        w.failNextWrite("image-rejected", {detail: "type-mismatch"});
        expect(await w.model.deleteFile("user.a", "a.png")).toEqual({reason: t("error.image-rejected", {reason: t("reject.type-mismatch")})});
        w.failNextWrite("something-new");
        expect(await w.model.deleteFile("user.a", "a.png")).toEqual({reason: t("error.unavailable")});
    });

    test("结果不知道（断开在写之后）：通知、重取、交回原因", async () => {
        const w = model(["user.a"]);
        w.model.start();
        await waitUntil("就绪", () => (w.model.detail.value !== null ? true : null));
        w.failNextWrite("unknown-outcome");
        const result = await w.model.updatePack("user.a", {title: "新"});
        expect(result).toEqual({reason: t("notify.unknownOutcome")});
        expect(w.notices.map((notice) => notice.message)).toContain(t("notify.unknownOutcome"));
    });

    test("导入：成功选中并通知；同名交回冲突信息；别的失败交回原因", async () => {
        const conflict = {existing: {id: "user.cat", title: "猫", count: 3, files: ["a.png"], token: "t"}, copyAs: "cat-2"};
        const responses = [{ok: true as const, id: "user.cat"}, {ok: false as const, code: "import-conflict" as const, conflict}, {ok: false as const, code: "import-invalid", reason: "zip 里没有图片"}];
        const w = model(["user.a"], {importZip: async () => responses.shift()!});
        w.model.start();
        await waitUntil("就绪", () => (w.model.state.value === "ready" ? true : null));
        w.ids.push("user.cat");
        const file = new File([new Uint8Array([1])], "cat.zip");
        expect(await w.model.importZip(file)).toEqual({id: "user.cat"});
        expect(w.model.selected.value).toBe("user.cat");
        expect(w.notices.at(-1)?.message).toBe(t("notify.imported", {name: "cat"}));
        expect(await w.model.importZip(file)).toEqual({conflict});
        expect(await w.model.importZip(file)).toEqual({reason: t("error.import-invalid", {reason: "zip 里没有图片"})});
    });

    test("在文件夹中显示：没有桌面时通知写出路径", async () => {
        const w = model(["user.nodesk"]);
        await w.model.revealPack("user.nodesk");
        expect(w.notices.at(-1)?.message).toBe(t("notify.revealNoDesktop", {path: "/x/nodesk"}));
    });
});

describe("加图", () => {
    test("一次添加做完后汇总：没加进去的写文件名与原因，缩小过的写个数；做完重取", async () => {
        const responses: Record<string, Awaited<ReturnType<StickersHttp["upload"]>>> = {
            "a.png": {ok: true, file: "a.png", resized: true},
            "b.png": {ok: false, code: "image-rejected", reason: "gif-too-large"},
            "c.png": {ok: true, file: "c.png", resized: true},
        };
        const w = model(["user.a"], {upload: async (_id, file) => responses[file.name]!});
        w.model.start();
        await waitUntil("就绪", () => (w.model.detail.value !== null ? true : null));
        const image = (name: string): File => new File([new Uint8Array([1])], name, {type: "image/png"});
        await w.model.addImages("user.a", [image("a.png"), image("b.png"), image("c.png"), new File([], "相册", {type: ""})]);
        expect(w.notices.map((notice) => notice.message)).toEqual([
            t("notify.uploaded", {list: `b.png（${t("reject.gif-too-large")}）；相册（${t("reject.folder")}）`}),
            t("notify.resized", {count: "2"}),
        ]);
        expect(w.model.uploads.value).toEqual([]);
    });
});

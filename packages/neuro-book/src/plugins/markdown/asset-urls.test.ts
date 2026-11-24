/**
 * 图片的地址（docs/specs/workspace/markdown-dialect.md 输出 18）：真实的文件服务场地（服务端、项目实例与窗口三个实例），地址经
 * 字节路由取 URL，磁盘上的文件变了通知订阅者并换新 URL。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {watch} from "node:fs";
import {mkdir, rename, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {BATCH_DELAY_MS, MAX_BATCH_PATHS} from "nbook/plugins/files/backend/changes";
import {files, filesScene} from "nbook/plugins/files/testing/scene";

import {createAssetUrls} from "./web/parts/asset-urls";

let tmp = "";
let counter = 0;
let fences = 0;
const closers: Array<() => Promise<void>> = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-markdown", "asset-urls");
});
afterEach(async () => {
    for (const close of closers.splice(0).reverse()) await close();
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/**
 * 做完写入之后，等这些写入的原始事件全部投递给文件服务的监视器：再到场景之外写一个屏障文件，等本测试自己的监视器看到它。
 * Bun 的全部 `fs.watch` 共用一个 inotify 实例、由同一个线程按发生顺序投递，屏障到了，前面每个文件的事件也已到了。
 * 不等的话，轮询里推进手动时钟会在事件陆续到达的途中就把批切走，每批都不超过上限，就不会失同步（慢的机器上稳定复现）。
 * 与 `files/changes.test.ts` 的 `writeAndSee` 同一做法。
 */
async function writeAndSee(write: () => Promise<void>): Promise<void> {
    fences += 1;
    const fence = join(tmp, `fence-${String(fences)}`);
    await mkdir(fence);
    let seen = false;
    const probe = watch(fence, (_event, filename) => {
        if (filename === "fence") seen = true;
    });
    try {
        await write();
        await writeFile(join(fence, "fence"), "");
        await waitUntil("屏障文件的原始事件", () => seen);
    } finally {
        probe.close();
    }
}

/** 建场地与地址服务，订阅一张图片，等窗口的订阅建立。返回收到通知的次数与当前 URL。 */
async function watched(layout: Readonly<Record<string, string>>, address: string) {
    counter += 1;
    const created = await filesScene(join(tmp, `case-${String(counter)}`), {project: layout});
    closers.push(async () => {
        await created.world.close();
    });
    const client = files(created.window);
    const assets = createAssetUrls(client);
    closers.push(async () => assets.dispose());
    const state = {notified: 0};
    const stop = assets.onChange(address, () => {
        state.notified += 1;
    });
    let ready = false;
    /** 窗口收到的变化：同一窗口同一方案共用一条订阅，地址服务看到的就是这些。 */
    const changedPaths: string[] = [];
    const probe = client.watch("project", (message) => {
        if (message.kind === "ready") ready = true;
        if (message.kind === "batch") changedPaths.push(...message.events.map((event) => event.path));
    });
    closers.push(async () => probe());
    await waitUntil("订阅建立", () => (ready ? true : null));
    const url = () => assets.resolve(null, address.replace("project://", "/"))?.url;
    const notifiedAfter = async (what: string) => {
        const before = state.notified;
        await waitUntil(what, () => {
            created.world.clock.advance(BATCH_DELAY_MS);
            return state.notified > before ? true : null;
        });
    };
    return {created, assets, state, stop, url, notifiedAfter, changedPaths};
}

describe("Spec workspace.markdown-dialect 输出 18：图片的地址", () => {
    it("作品里的图片经字节路由，外部图片原样，根以外的不显示；文件在磁盘上变了，订阅者收到通知、URL 换成新的", async () => {
        counter += 1;
        const created = await filesScene(join(tmp, `case-${String(counter)}`), {project: {"正文/第一章.md": "![图](images/a.png)", "正文/images/a.png": "一"}});
        closers.push(async () => {
            await created.world.close();
        });
        const client = files(created.window);
        const assets = createAssetUrls(client);
        closers.push(async () => assets.dispose());
        const base = "project://正文/第一章.md";
        const first = assets.resolve(base, "images/a.png");
        expect(first).toEqual({url: client.rawUrl("project://正文/images/a.png") as string, address: "project://正文/images/a.png"});
        expect(assets.resolve(base, "https://example.com/a.png")).toEqual({url: "https://example.com/a.png", address: null});
        expect(assets.resolve(base, "../../外面.png")).toBeNull();
        expect(assets.resolve(base, "chapter://c1")).toBeNull();

        let notified = 0;
        const stop = assets.onChange("project://正文/images/a.png", () => {
            notified += 1;
        });
        // 同一窗口同一方案共用一条订阅：它推了 `ready` 之后，这里的订阅也在了，之后的修改都看得到。
        let ready = false;
        const probe = client.watch("project", (message) => {
            if (message.kind === "ready") ready = true;
        });
        closers.push(async () => probe());
        await waitUntil("订阅建立", () => (ready ? true : null));
        await writeFile(join(created.project, "正文/images/a.png"), "二");
        await waitUntil("外部修改通知到订阅者", () => {
            created.world.clock.advance(BATCH_DELAY_MS);
            return notified > 0 ? true : null;
        });
        const second = assets.resolve(base, "images/a.png");
        expect(second?.url).not.toBe(first?.url);
        expect(second?.url.startsWith(first?.url ?? "")).toBe(true);
        stop();
    });

    it("图片所在的目录改名、上级目录被删：旧地址的订阅者收到通知，URL 换成新的", async () => {
        const moved = await watched({"正文/images/a.png": "一"}, "project://正文/images/a.png");
        const before = moved.url();
        await rename(join(moved.created.project, "正文/images"), join(moved.created.project, "正文/pics"));
        await moved.notifiedAfter("目录改名通知到旧地址");
        expect(moved.url()).not.toBe(before);

        const removed = await watched({"正文/images/b.png": "一"}, "project://正文/images/b.png");
        await rm(join(removed.created.project, "正文"), {recursive: true});
        await removed.notifiedAfter("上级目录删除通知到后代");
    });

    it("失同步（一批变化过多）：订阅者收到通知，订阅了与没订阅的地址 URL 都换成新的；`dispose` 之后不再通知", async () => {
        const scene = await watched({"正文/a.png": "一", "正文/b.png": "一"}, "project://正文/a.png");
        const before = scene.url();
        const unwatched = scene.assets.resolve(null, "/正文/b.png")?.url;
        await mkdir(join(scene.created.project, "批量"), {recursive: true});
        await writeAndSee(async () => {
            await Promise.all(Array.from({length: MAX_BATCH_PATHS + 1}, (_unused, index) => writeFile(join(scene.created.project, "批量", `f${String(index)}.md`), "x")));
        });
        await scene.notifiedAfter("失同步通知到订阅者");
        expect(scene.url()).not.toBe(before);
        expect(scene.assets.resolve(null, "/正文/b.png")?.url).not.toBe(unwatched);

        scene.assets.dispose();
        const after = scene.state.notified;
        // 等这次修改确实到了窗口（探针的订阅还在），再断言地址服务没有通知。
        scene.changedPaths.length = 0;
        await writeFile(join(scene.created.project, "正文/a.png"), "二");
        await waitUntil("修改到达窗口", () => {
            scene.created.world.clock.advance(BATCH_DELAY_MS);
            return scene.changedPaths.includes("正文/a.png") ? true : null;
        });
        expect(scene.state.notified).toBe(after);
    });
});

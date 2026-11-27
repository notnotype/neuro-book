/**
 * 图片的存放与列出（docs/specs/workbench/markdown-editing.md 输出 54、56、58）：目录与文件名的规则，存放目录里最近的图、
 * 按名字找图，三种状态。文件服务的 `list` 用 Lab 的内存文件（真实的目录项形状与排序），`find` 与 `upload` 记下收到的入参。
 */

import {describe, expect, it} from "bun:test";

import type {ImageLocation} from "nbook/plugins/editor/shared/contracts";
import type {FilesResult, FilesService, FindResult} from "nbook/plugins/files/shared/contracts";
import type {UploadResult} from "nbook/plugins/files/shared/upload";
import {createMemoryFiles} from "nbook/plugins/explorer/web/lab/memory-files";

import {createMarkdownMedia, IMAGE_EXTENSIONS, MEDIA_LIST_LIMIT} from "./media";
import type {MediaSources} from "./media";

const CURRENT = "project://卷一/第一章.md";

function setup(options: {readonly project?: ReadonlyArray<string | readonly [string, string]>; readonly bound?: boolean; readonly location?: ImageLocation; readonly folder?: string; readonly find?: MediaSources["find"]; readonly now?: Date} = {}) {
    const memory = createMemoryFiles({project: options.project ?? [], user: []});
    const settings = {location: options.location ?? "folder" as ImageLocation, folder: options.folder ?? "插图"};
    const uploads: Array<{address: string; body: Blob | Uint8Array; options: unknown}> = [];
    const files: Pick<FilesService, "list" | "upload" | "rawUrl"> = {
        list: memory.files.list,
        upload: (address, body, uploadOptions): Promise<UploadResult> => {
            uploads.push({address, body, options: uploadOptions});
            return Promise.resolve({ok: true, address, renamed: false});
        },
        rawUrl: (address) => `/raw/${address.slice("project://".length)}`,
    };
    const media = createMarkdownMedia({files, find: options.find ?? null, bound: options.bound ?? true, settings: {location: () => settings.location, folder: () => settings.folder}, ...(options.now === undefined ? {} : {now: () => options.now as Date})});
    return {media, settings, uploads, memory};
}

describe("destination：按设置算存放的地址（输出 56）", () => {
    it("四种位置；设置变了下一次就用新的", () => {
        const {media, settings} = setup();
        expect(media.destination(CURRENT, "a.png")).toBe("project://插图/a.png");
        settings.location = "root";
        expect(media.destination(CURRENT, "a.png")).toBe("project://a.png");
        settings.location = "same";
        expect(media.destination(CURRENT, "a.png")).toBe("project://卷一/a.png");
        settings.location = "sibling";
        settings.folder = "图/大图";
        expect(media.destination(CURRENT, "a.png")).toBe("project://卷一/图/大图/a.png");
        settings.folder = "../外面";
        expect(media.destination(CURRENT, "a.png")).toBe("project://卷一/插图/a.png");
    });

    it("没有绑定作品、当前文件不在作品里、没有地址：没有存放地址", () => {
        expect(setup({bound: false}).media.destination(CURRENT, "a.png")).toBeNull();
        const {media} = setup();
        expect(media.destination("user://笔记.md", "a.png")).toBeNull();
        expect(media.destination(null, "a.png")).toBeNull();
    });
});

describe("文件名", () => {
    it("粘贴的图：粘贴的图片 年月日-时分秒，扩展名按类型，本机时间，补零", () => {
        const {media} = setup({now: new Date(2026, 10, 7, 4, 5, 9)});
        expect(media.pastedName("image/png")).toBe("粘贴的图片 20261107-040509.png");
        expect(media.pastedName("image/jpeg")).toBe("粘贴的图片 20261107-040509.jpg");
        expect(media.pastedName("image/gif")).toBe("粘贴的图片 20261107-040509.gif");
        expect(media.pastedName("image/webp")).toBe("粘贴的图片 20261107-040509.webp");
        expect(media.pastedName("image/svg+xml")).toBeNull();
        expect(media.pastedName("")).toBeNull();
    });

    it("选的本机文件保留原名；JPEG 的扩展名不是 .jpg、.jpeg 时换成 .jpg", () => {
        const {media} = setup();
        expect(media.localName({name: "封面.png", type: "image/png"})).toBe("封面.png");
        expect(media.localName({name: "照片.JPG", type: "image/jpeg"})).toBe("照片.JPG");
        expect(media.localName({name: "照片.jpeg", type: "image/jpeg"})).toBe("照片.jpeg");
        expect(media.localName({name: "照片.jfif", type: "image/jpeg"})).toBe("照片.jpg");
        expect(media.localName({name: "a.b.jpe", type: "image/jpeg"})).toBe("a.b.jpg");
        // 类型对不上的不改：交给服务端按文件头判（扩展名对不上会被拒）。
        expect(media.localName({name: "照片.jfif", type: "image/png"})).toBe("照片.jfif");
    });
});

describe("upload：重名加序号、不覆盖", () => {
    it("带 rename 与取消信号", async () => {
        const {media, uploads} = setup();
        const abort = new AbortController();
        const body = new Blob([new Uint8Array([1, 2, 3])]);
        expect(await media.upload("project://插图/a.png", body, abort.signal)).toEqual({ok: true, address: "project://插图/a.png", renamed: false});
        expect(uploads).toEqual([{address: "project://插图/a.png", body, options: {exists: "rename", signal: abort.signal}}]);
    });
});

describe("recent：存放目录里的图（输出 54）", () => {
    it("只列图片文件，名字倒序，至多 12 张，多的标 truncated；目录与别的文件不列", async () => {
        const names = Array.from({length: 14}, (_, index) => `粘贴的图片 20261107-0405${String(index).padStart(2, "0")}.png`);
        const {media} = setup({project: [...names, ["插图/说明.txt", "x"], "插图/子目录/", ["插图/封面.JPG", ""], ["插图/无扩展名", ""]].map((entry) => (typeof entry === "string" ? `插图/${entry}` : entry)) as never});
        const listed = await media.recent(CURRENT);
        if (!listed.ok) throw new Error(listed.detail);
        expect(listed.truncated).toBe(true);
        expect(listed.images).toHaveLength(MEDIA_LIST_LIMIT);
        expect(listed.images[0]).toEqual({address: "project://插图/粘贴的图片 20261107-040513.png", name: "粘贴的图片 20261107-040513.png", directory: "插图"});
        expect(listed.images.map((image) => image.name)).toEqual([...listed.images.map((image) => image.name)].sort().reverse());
        expect(listed.images.some((image) => image.name === "说明.txt" || image.name === "子目录" || image.name === "无扩展名")).toBe(false);
    });

    it("少于 12 张不标 truncated，扩展名不分大小写，svg、avif、bmp 也算图片", async () => {
        const {media} = setup({project: [["插图/b.JPG", ""], ["插图/a.png", ""], ["插图/c.svg", ""], ["插图/d.avif", ""], ["插图/e.bmp", ""]]});
        const listed = await media.recent(CURRENT);
        expect(listed).toEqual({ok: true, truncated: false, images: ["e.bmp", "d.avif", "c.svg", "b.JPG", "a.png"].map((name) => ({address: `project://插图/${name}`, name, directory: "插图"}))});
    });

    it("存放目录还没有建出来：空；位置设为作品根时列根下的图；当前文件旁的设置按当前文件算", async () => {
        const {media, settings} = setup({project: [["a.png", ""], ["卷一/图/b.png", ""]]});
        expect(await media.recent(CURRENT)).toEqual({ok: true, images: [], truncated: false});
        settings.location = "root";
        expect(await media.recent(CURRENT)).toMatchObject({ok: true, images: [{address: "project://a.png", directory: ""}]});
        settings.location = "sibling";
        settings.folder = "图";
        expect(await media.recent(CURRENT)).toMatchObject({ok: true, images: [{address: "project://卷一/图/b.png", directory: "卷一/图"}]});
    });

    it("没有绑定作品、当前文件不在作品里：空，不去读；存放目录读不了：给原因", async () => {
        expect(await setup({bound: false, project: [["插图/a.png", ""]]}).media.recent(CURRENT)).toEqual({ok: true, images: [], truncated: false});
        expect(await setup({project: [["插图/a.png", ""]]}).media.recent("user://笔记.md")).toEqual({ok: true, images: [], truncated: false});
        // 存放目录是个文件：读目录失败，原因交给卡片显示。
        const blocked = await setup({project: [["插图", "我是文件"]]}).media.recent(CURRENT);
        expect(blocked.ok).toBe(false);
    });
});

describe("find：按名字在整部作品里找（输出 54）", () => {
    const found = (value: FindResult): MediaSources["find"] => () => Promise.resolve<FilesResult<FindResult>>({ok: true, value});

    it("按图片扩展名找、限 12 条；结果换成地址与所在目录，truncated 照搬", async () => {
        const calls: unknown[] = [];
        const {media} = setup({find: (input, options) => {
            calls.push({input, options});
            return Promise.resolve({ok: true, value: {items: [{path: "卷二/图/林雪.png", name: "林雪.png"}, {path: "封面.jpg", name: "封面.jpg"}], truncated: true}});
        }});
        const abort = new AbortController();
        expect(await media.find("林", {signal: abort.signal})).toEqual({ok: true, truncated: true, images: [{address: "project://卷二/图/林雪.png", name: "林雪.png", directory: "卷二/图"}, {address: "project://封面.jpg", name: "封面.jpg", directory: ""}]});
        expect(calls).toEqual([{input: {query: "林", limit: MEDIA_LIST_LIMIT, extensions: IMAGE_EXTENSIONS}, options: {signal: abort.signal}}]);
    });

    it("没有绑定作品、没有 find：空；find 失败：给原因", async () => {
        expect(await setup({bound: false, find: found({items: [{path: "a.png", name: "a.png"}], truncated: false})}).media.find("a")).toEqual({ok: true, images: [], truncated: false});
        expect(await setup().media.find("a")).toEqual({ok: true, images: [], truncated: false});
        const failing = setup({find: () => Promise.resolve({ok: false, code: "io-failed", detail: "读不了"})});
        expect(await failing.media.find("a")).toEqual({ok: false, detail: "读不了"});
    });
});

describe("thumbnail", () => {
    it("绑定了作品：字节地址；没有绑定：null", () => {
        expect(setup().media.thumbnail("project://插图/a.png")).toBe("/raw/插图/a.png");
        expect(setup({bound: false}).media.thumbnail("project://插图/a.png")).toBeNull();
    });
});

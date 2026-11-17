/**
 * 粘贴图片的宿主一侧（docs/specs/workbench/markdown-editing.md 输出 55、56、58）：存哪里、叫什么、失败给用户看什么。媒体能力用真实的
 * `createMarkdownMedia`，只有文件服务的 `upload` 记下收到的入参。
 */

import {describe, expect, it} from "bun:test";

import type {ImageFailure} from "@notnotype/nb-markdown/editor";

import type {UploadResult} from "nbook/plugins/files/shared/upload";

import {createMarkdownMedia} from "./media";
import {createViewImages, imageFailureNotice, maybeStored} from "./view-images";

const CURRENT = "project://卷一/第一章.md";
const png = (name = "image.png", type = "image/png") => new File([new Uint8Array([1, 2, 3])], name, {type});

function setup(options: {readonly bound?: boolean; readonly current?: string | null; readonly reply?: UploadResult} = {}) {
    const uploads: Array<{address: string; options: unknown}> = [];
    const notices: Array<{key: string; params?: unknown}> = [];
    const media = createMarkdownMedia({
        files: {
            list: () => Promise.resolve({ok: true, value: {folder: "plain", contentRoot: null, entries: []}}),
            upload: (address, _body, uploadOptions) => {
                uploads.push({address, options: uploadOptions});
                return Promise.resolve(options.reply ?? {ok: true, address, renamed: false});
            },
            rawUrl: () => null,
        },
        find: null,
        bound: options.bound ?? true,
        settings: {location: () => "folder", folder: () => "插图"},
        now: () => new Date(2026, 10, 17, 14, 5, 33),
    });
    let current = options.current === undefined ? CURRENT : options.current;
    const images = createViewImages(media, () => current, (key, params) => notices.push({key, ...(params === undefined ? {} : {params})}));
    return {images, uploads, notices, setCurrent: (next: string | null) => {
        current = next;
    }};
}

describe("upload：粘贴的图按时间命名、存进存放目录、重名加序号", () => {
    it("成功：地址是实际写下的（可能被加了序号），说明留空", async () => {
        const {images, uploads} = setup({reply: {ok: true, address: "project://插图/粘贴的图片 20261117-140533 2.png", renamed: true}});
        const controller = new AbortController();
        expect(await images.upload(png(), controller.signal)).toEqual({ok: true, address: "project://插图/粘贴的图片 20261117-140533 2.png", alt: ""});
        expect(uploads).toEqual([{address: "project://插图/粘贴的图片 20261117-140533.png", options: {exists: "rename", signal: controller.signal}}]);
    });

    it("按类型定扩展名；不是允许的类型不上传（在传之前判）", async () => {
        const {images, uploads} = setup();
        await images.upload(png("x", "image/jpeg"), new AbortController().signal);
        expect(uploads[0]?.address).toBe("project://插图/粘贴的图片 20261117-140533.jpg");
        for (const type of ["image/svg+xml", "image/bmp", ""]) {
            expect(await images.upload(png("x", type), new AbortController().signal)).toMatchObject({ok: false, code: "unsupported-type"});
        }
        expect(uploads).toHaveLength(1);
    });

    it("按此刻的当前文件算：没有绑定作品、当前文件不在作品里为 unavailable，不上传", async () => {
        const unbound = setup({bound: false});
        expect(await unbound.images.upload(png(), new AbortController().signal)).toMatchObject({ok: false, code: "unavailable"});
        const outside = setup({current: "user://笔记.md"});
        expect(await outside.images.upload(png(), new AbortController().signal)).toMatchObject({ok: false, code: "unavailable"});
        expect(unbound.uploads.length + outside.uploads.length).toBe(0);
    });

    it("服务端的失败原样带码与说明", async () => {
        const {images} = setup({reply: {ok: false, code: "too-large", detail: "图片至多 33554432 字节"}});
        expect(await images.upload(png(), new AbortController().signal)).toEqual({ok: false, code: "too-large", detail: "图片至多 33554432 字节"});
    });
});

describe("失败给用户看什么（输出 55）", () => {
    const failure = (code: string, stored = false, detail = "说明"): ImageFailure => ({file: "a.png", code, detail, stored});

    it("按码选通知；带上是哪一张", () => {
        expect(imageFailureNotice(failure("too-large"))).toEqual({key: "imageTooLarge", params: {name: "a.png"}});
        for (const code of ["unsupported-type", "extension-mismatch"]) expect(imageFailureNotice(failure(code)).key).toBe("imageUnsupported");
        expect(imageFailureNotice(failure("invalid-address")).key).toBe("imageNameInvalid");
        for (const code of ["permission-denied", "not-a-directory", "protected-path", "outside-root", "conflict"]) expect(imageFailureNotice(failure(code)).key).toBe("imageFolderDenied");
        expect(imageFailureNotice(failure("not-allowed-here"))).toEqual({key: "imageNotAllowedHere"});
        expect(imageFailureNotice(failure("unavailable")).key).toBe("imageUnavailable");
        expect(imageFailureNotice(failure("not-inserted", true, "project://插图/a.png"))).toEqual({key: "imageNotInserted", params: {name: "a.png", address: "project://插图/a.png"}});
    });

    it("可能已经存进作品的（结果未知、断开、取消）提示去存放目录看；别的没见过的码带上原因", () => {
        for (const code of ["unknown-outcome", "network", "cancelled"]) expect(imageFailureNotice(failure(code, true)).key).toBe("imageMaybeStored");
        expect(imageFailureNotice(failure("io-failed", false, "磁盘满了"))).toEqual({key: "imageFailed", params: {name: "a.png", detail: "磁盘满了"}});
    });

    it("failed 把通知交给编辑器区", () => {
        const {images, notices} = setup();
        images.failed(failure("too-large"));
        images.failed(failure("not-allowed-here"));
        expect(notices).toEqual([{key: "imageTooLarge", params: {name: "a.png"}}, {key: "imageNotAllowedHere"}]);
    });
});

describe("maybeStored", () => {
    it("结果未知、断开、取消说明图可能已经在作品里；别的失败是确定没写", () => {
        for (const code of ["unknown-outcome", "network", "cancelled"]) expect(maybeStored(code)).toBe(true);
        for (const code of ["too-large", "unsupported-type", "conflict", "unavailable", "io-failed"]) expect(maybeStored(code)).toBe(false);
    });
});

/**
 * 设定里的图片（images.ts；docs/specs/canon/author-ui.md 输出 53）：候选是图片文件夹里按名字倒序的至多 12 张、文件夹还没有时是空的；
 * 上传前在本地拦类型与大小，存进图片文件夹（不合规的设置退回“插图”）、重名时用实际的名字；没成的分四种。文件服务是只实现了这三个
 * 方法的替身，形状由 `FilesService` 的类型约束。
 */

import {describe, expect, test} from "bun:test";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import type {FilesService} from "nbook/plugins/files/shared/contracts";
import type {UploadResult} from "nbook/plugins/files/shared/upload";

import {createCanonImages, createImagePicking, IMAGE_CANDIDATES} from "./images";

type Files = Pick<FilesService, "list" | "rawUrl" | "upload">;

function files(names: readonly string[] | "not-found", upload: (address: string) => UploadResult = (address) => ({ok: true, address, renamed: false})): Files & {readonly uploads: string[]} {
    const uploads: string[] = [];
    return {
        uploads,
        rawUrl: (address) => `/raw/${address}`,
        list: async () => (names === "not-found"
            ? {ok: false, code: "not-found", detail: "no such directory"}
            : {ok: true, value: {folder: {kind: "plain"}, contentRoot: null, entries: names.map((name) => ({name, kind: name.endsWith("/") ? "directory" : "file"}))}}) as never,
        upload: async (address) => {
            uploads.push(address);
            return upload(address);
        },
    };
}
const images = (given: Files, folder = "插图") => createCanonImages(given as FilesService, () => folder);
const png = (name: string, size = 10) => new File([new Uint8Array(size)], name, {type: "image/png"});

describe("设定里的图片", () => {
    test("候选：图片文件夹里的图（按名字倒序，至多 12 张），不是图片的不列；文件夹还没有时是空的", async () => {
        const many = Array.from({length: 14}, (_, index) => `图${String(index).padStart(2, "0")}.png`);
        const listed = await images(files([...many, "说明.txt", "子目录/"])).recent();
        if (!listed.ok) throw new Error("没有列出来");
        expect(listed.images).toHaveLength(IMAGE_CANDIDATES);
        expect(listed.images[0]).toEqual({path: "插图/图13.png", name: "图13.png", url: "/raw/project://插图/图13.png"});
        expect(await images(files("not-found")).recent()).toEqual({ok: true, images: []});
    });

    test("上传：存进图片文件夹，不合规的设置退回“插图”；重名时用实际存下的名字", async () => {
        const given = files([], (address) => ({ok: true, address: address.replace("立绘.png", "立绘 2.png"), renamed: true}));
        expect(await images(given, "../外面").upload(png("立绘.png"))).toEqual({ok: true, path: "插图/立绘 2.png"});
        expect(given.uploads).toEqual(["project://插图/立绘.png"]);
        await images(given, "设定/人物").upload(png("立绘.png"));
        expect(given.uploads.at(-1)).toBe("project://设定/人物/立绘.png");
    });

    test("上传没成的分四种：类型或大小不合（本地先拦，不发请求）；结果不明；取消了；别的", async () => {
        const given = files([], () => ({ok: false, code: "unknown-outcome", detail: "gateway"}));
        expect(await images(given).upload(png("立绘.bmp"))).toMatchObject({ok: false, kind: "rejected"});
        expect(await images(given).upload(png("立绘.png", 33 * 1024 * 1024))).toMatchObject({ok: false, kind: "rejected"});
        expect(given.uploads).toEqual([]);
        expect(await images(given).upload(png("立绘.png"))).toMatchObject({ok: false, kind: "unknown"});
        expect(await images(files([], () => ({ok: false, code: "unsupported-type", detail: ""}))).upload(png("立绘.png"))).toMatchObject({ok: false, kind: "rejected"});
        expect(await images(files([], () => ({ok: false, code: "permission-denied", detail: "no"}))).upload(png("立绘.png"))).toMatchObject({ok: false, kind: "other"});
        expect(await images(files([], () => ({ok: false, code: "cancelled", detail: ""}))).upload(png("立绘.png"))).toMatchObject({ok: false, kind: "cancelled"});
    });

    test("条目页的那一份：每次 browse 重列、清掉上一次的原因；本页上传的排在最前（重列以后也是）；被拒写原因；取消了写一句提示（不算原因）并重列", async () => {
        let outcome: (address: string) => UploadResult = (address) => ({ok: true, address, renamed: false});
        const folder = ["甲.png"];
        const picking = createImagePicking(images(files(folder, (address) => outcome(address))), (text) => JSON.stringify(text));
        const paths = () => picking.candidates?.map((item) => item.path);
        expect(picking.candidates).toBeNull();
        picking.browse();
        await waitUntil("列出候选", () => picking.candidates !== null);
        expect(paths()).toEqual(["插图/甲.png"]);
        expect(await picking.upload(png("乙.png"))).toBe("插图/乙.png");
        folder.push("乙.png");
        expect(paths()).toEqual(["插图/乙.png", "插图/甲.png"]);
        expect(picking.uploading).toBe(false);
        expect(await picking.upload(png("丙.bmp"))).toBeNull();
        expect(picking.reason).toContain("images.rejected");

        // 别处加了一张图（按名字倒序排在最后）：下一处选图片的地方挂上时重列、原因清掉，本页传的“乙”仍在最前。
        folder.push("丁.png");
        picking.browse();
        expect(picking.reason).toBe("");
        await waitUntil("重列", () => picking.candidates?.length === 3);
        expect(paths()).toEqual(["插图/乙.png", "插图/甲.png", "插图/丁.png"]);

        // 取消上传：图可能已经写进去了，写一句提示（不是原因），并重列。
        outcome = () => {
            folder.push("戊.png");
            return {ok: false, code: "cancelled", detail: ""};
        };
        expect(await picking.upload(png("戊.png"))).toBeNull();
        expect(picking.reason).toBe("");
        expect(picking.notice).toContain("images.cancelled");
        await waitUntil("取消以后重列", () => paths()?.includes("插图/戊.png") === true);
    });
});

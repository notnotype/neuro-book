/**
 * 封面路由（docs/specs/runtime/projects.md 输出第 21 条）：上传写到作品目录根下并记进身份文件，读取带 ETag，删除清字段；
 * 超限、格式不对、未登记各按状态码拒绝。真实登记表与真实目录，路由经 Hono 应用的 `fetch` 调用（`nbook.http` 的分发器
 * 也是这样交给它的）。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {chmod, mkdir, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {PROJECT_IDENTITY_FILE, readProjectIdentity, updateProjectMetadata} from "nbook/server/projects/identity";
import {createProjectRegistry} from "nbook/server/projects/registry";
import type {ProjectMetadataRead, ProjectsService} from "nbook/shared/projects";

import {createCoverRoutes} from "./cover-routes";
import {PROJECT_COVER_MAX_BYTES} from "../shared/cover";

let tmp = "";
let counter = 0;

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-projects", "cover-routes");
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);

/** 一个登记了 `Book` 的场地，封面路由接在真实登记表与身份文件上（`readMetadata`、`updateMetadata` 与项目管理器同一实现）。 */
async function world() {
    counter += 1;
    const root = join(tmp, `case-${String(counter)}`);
    const book = join(root, "Book");
    await mkdir(book, {recursive: true});
    const registry = createProjectRegistry({stateRoot: join(root, "state"), cwd: root});
    const registered = await registry.register(book);
    if (!registered.ok) throw new Error(registered.detail);
    const records: Array<{event: string}> = [];
    const pathOf = async (id: string): Promise<string | null> => {
        const listed = await registry.list();
        return listed.ok ? listed.value.find((record) => record.id === id)?.path ?? null : null;
    };
    const projects: Pick<ProjectsService, "list" | "readMetadata" | "updateMetadata"> = {
        list: async () => {
            const listed = await registry.list();
            return listed.ok ? {ok: true, value: listed.value.map((record) => ({...record, state: "stopped" as const, generation: null, pid: null}))} : listed;
        },
        readMetadata: async (id): Promise<ProjectMetadataRead> => {
            const path = await pathOf(id);
            if (path === null) return {ok: false, reason: "unknown-project", detail: id};
            const identity = await readProjectIdentity(path);
            return identity.status === "found" ? {ok: true, metadata: identity.metadata, problems: identity.problems} : {ok: false, reason: "identity-invalid", detail: identity.status};
        },
        updateMetadata: async (id, patch) => {
            const path = await pathOf(id);
            if (path === null) return {ok: false, reason: "unknown-project", detail: id};
            return updateProjectMetadata(path, id, patch, {report: () => undefined});
        },
    };
    const app = createCoverRoutes({projects, record: (input) => records.push({event: input.event})});
    const call = (method: string, path: string, init: RequestInit = {}) => app.fetch(new Request(`http://127.0.0.1${path}`, {method, ...init}), {registerEventStream: () => undefined});
    const upload = (id: string, bytes: Uint8Array, name = "cover.bin") => {
        const form = new FormData();
        form.set("file", new File([bytes], name));
        return call("PUT", `/cover/${id}`, {body: form});
    };
    return {book, id: registered.project.id, call, upload, records};
}

describe("Spec projects 输出 21：封面路由", () => {
    it("上传 PNG：写到 Book/cover.png、身份文件记 cover；读取带 ETag，If-None-Match 命中为 304；换成 WebP 后旧文件删掉；删除清字段", async () => {
        const {book, id, call, upload} = await world();
        const put = await upload(id, PNG);
        expect(put.status).toBe(200);
        expect(await put.json()).toEqual({cover: {version: expect.any(String)}});
        expect(await readdir(book)).toContain("cover.png");
        expect(JSON.parse(await readFile(join(book, PROJECT_IDENTITY_FILE), "utf8"))).toMatchObject({cover: "cover.png"});

        const got = await call("GET", `/cover/${id}`);
        expect(got.status).toBe(200);
        expect(got.headers.get("content-type")).toBe("image/png");
        expect(new Uint8Array(await got.arrayBuffer())).toEqual(PNG);
        const etag = got.headers.get("etag");
        expect(etag).toMatch(/^"\d+"$/);
        expect((await call("GET", `/cover/${id}`, {headers: {"If-None-Match": etag!}})).status).toBe(304);

        expect((await upload(id, WEBP)).status).toBe(200);
        const names = await readdir(book);
        expect(names).toContain("cover.webp");
        expect(names).not.toContain("cover.png");
        expect(JSON.parse(await readFile(join(book, PROJECT_IDENTITY_FILE), "utf8"))).toMatchObject({cover: "cover.webp"});

        const deleted = await call("DELETE", `/cover/${id}`);
        expect(await deleted.json()).toEqual({cover: null});
        expect(await readdir(book)).not.toContain("cover.webp");
        expect(JSON.parse(await readFile(join(book, PROJECT_IDENTITY_FILE), "utf8"))).not.toHaveProperty("cover");
        expect((await call("GET", `/cover/${id}`)).status).toBe(404);
    });

    it("格式按字节判：不是图片为 415；超过 5 MB 为 413；没有 file 字段为 400；未登记的 id 为 404；都不写文件", async () => {
        const {book, id, call, upload} = await world();
        expect((await upload(id, new TextEncoder().encode("<svg/>"), "cover.png")).status).toBe(415);
        // GIF 是图片，但封面不收：共用的判定认得它，封面自己的允许集合不含它。
        expect((await upload(id, new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0]), "cover.png")).status).toBe(415);
        expect((await upload(id, new Uint8Array(PROJECT_COVER_MAX_BYTES + 1))).status).toBe(413);
        expect((await call("PUT", `/cover/${id}`, {body: new FormData()})).status).toBe(400);
        expect((await upload("00000000-0000-4000-8000-000000000000", PNG)).status).toBe(404);
        expect((await call("GET", "/cover/00000000-0000-4000-8000-000000000000")).status).toBe(404);
        expect((await readdir(book)).filter((name) => name.startsWith("cover"))).toEqual([]);
    });

    it("身份文件写不进去：回 409，刚写的文件撤掉，被它顶掉的同名文件还原，.nbook 里不留临时文件", async () => {
        const {book, id, upload} = await world();
        // 作品目录里本来就有一张身份文件没记的 cover.png：上传 PNG 会先顶掉它。
        const existing = new Uint8Array([...PNG, 1, 2, 3]);
        await writeFile(join(book, "cover.png"), existing);
        const identity = join(book, PROJECT_IDENTITY_FILE);
        await chmod(identity, 0o444);
        try {
            expect((await upload(id, PNG)).status).toBe(409);
        } finally {
            await chmod(identity, 0o644);
        }
        expect(new Uint8Array(await readFile(join(book, "cover.png")))).toEqual(existing);
        expect((await readdir(join(book, ".nbook"))).filter((name) => name.startsWith("cover."))).toEqual([]);
    });

    it("请求体超过上限时边收边拒：回 413，不把整个请求体读完", async () => {
        const {id, call} = await world();
        const chunk = new Uint8Array(256 * 1024);
        const total = PROJECT_COVER_MAX_BYTES * 4;
        let pulled = 0;
        // 没有 Content-Length 的流式请求体：上限只能在读的过程中判。
        const body = new ReadableStream<Uint8Array>({
            pull(controller) {
                if (pulled >= total) {
                    controller.close();
                    return;
                }
                pulled += chunk.length;
                controller.enqueue(chunk);
            },
        });
        const response = await call("PUT", `/cover/${id}`, {body, headers: {"Content-Type": "multipart/form-data; boundary=x"}, duplex: "half"} as RequestInit);
        expect(response.status).toBe(413);
        expect(await response.json()).toMatchObject({code: "too-large"});
        expect(pulled).toBeLessThan(total);
    });
});

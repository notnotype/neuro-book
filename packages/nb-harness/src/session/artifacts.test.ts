import {afterAll, describe, expect, test} from "bun:test";
import {mkdir, readdir, readFile, rm} from "node:fs/promises";
import {join} from "node:path";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {createJsonlArtifactStore} from "./jsonl/jsonl";
import {createMemoryArtifactStore, safeToolName} from "./session";
import type {ArtifactStore} from "./session";

const roots: string[] = [];
afterAll(async () => {
    for (const root of roots) await rm(root, {recursive: true, force: true});
});

async function jsonlRoot(): Promise<string> {
    const base = await createTestTmpRoot("nb-harness-session", "artifacts");
    roots.push(base);
    const root = join(base, "sessions");
    await mkdir(root);
    return root;
}

async function exercise(store: ArtifactStore): Promise<void> {
    expect(await store.list("s1")).toEqual({ok: true, value: []});
    expect(await store.read("s1", "0")).toEqual({ok: true, value: null});
    const first = await store.save("s1", "plugin.x/dump", "全文一\n第二行");
    expect(first).toEqual({ok: true, value: {id: "0", bytes: 19}});
    const second = await store.save("s1", "bash", "b");
    expect(second.ok && second.value.id).toBe("1");
    const other = await store.save("s2", "bash", "别的会话");
    expect(other.ok && other.value.id).toBe("0");
    expect(await store.read("s1", "0")).toEqual({ok: true, value: "全文一\n第二行"});
    expect(await store.read("s1", "7")).toEqual({ok: true, value: null});
    expect(await store.read("s1", "x")).toEqual({ok: true, value: null});
    expect(await store.list("s1")).toEqual({ok: true, value: [{id: "0", toolName: "plugin_x_dump", bytes: 19}, {id: "1", toolName: "bash", bytes: 1}]});
    // 两种实现同一套输入合同：会话 id 不合规则都是 invalid-session-id
    for (const result of [await store.save("../x", "read", "c"), await store.read("../x", "0"), await store.list("../x")]) expect(result.ok ? null : result.code).toBe("invalid-session-id");
}

describe("溢出存储（输出 24）", () => {
    test("内存实现：序号会话内从 0 递增、按会话分开、不存在为 null、工具名清洗", async () => {
        await exercise(createMemoryArtifactStore());
        expect(safeToolName("a/b c!")).toBe("a_b_c");
        expect(safeToolName("///")).toBe("tool");
        expect(safeToolName("x".repeat(80))).toHaveLength(64);
    });

    test("JSONL 实现：文件在 <root>/<会话 id>.artifacts/<序号>/<工具名>.log；重开后序号接着编；两个实例同时保存拿到不同序号；不留临时文件；根不可写为 store-failed", async () => {
        const root = await jsonlRoot();
        await exercise(createJsonlArtifactStore({root}));
        expect((await readdir(join(root, "s1.artifacts"))).sort()).toEqual(["0", "1"]);
        expect(await readdir(join(root, "s1.artifacts", "0"))).toEqual(["plugin_x_dump.log"]);
        expect(await readFile(join(root, "s1.artifacts", "0", "plugin_x_dump.log"), "utf8")).toBe("全文一\n第二行");
        // 另一个存储实例（模拟进程重启）：扫目录续号，旧文件不被覆盖
        const reopened = createJsonlArtifactStore({root});
        const third = await reopened.save("s1", "read", "c");
        expect(third.ok && third.value.id).toBe("2");
        expect(await reopened.read("s1", "0")).toEqual({ok: true, value: "全文一\n第二行"});
        const listed = await reopened.list("s1");
        expect(listed.ok && listed.value.map((item) => item.id)).toEqual(["0", "1", "2"]);
        // 两个实例（两个进程）同时保存：序号靠独占创建目录认领，不会撞号；缓存的下一个号被别的实例用掉时跳过去
        const left = createJsonlArtifactStore({root});
        const right = createJsonlArtifactStore({root});
        const raced = await Promise.all([left.save("s3", "first", "1"), right.save("s3", "second", "2")]);
        expect(raced.map((result) => (result.ok ? result.value.id : result.code)).sort()).toEqual(["0", "1"]);
        const later = [await left.save("s3", "third", "3"), await right.save("s3", "fourth", "4")];
        expect(new Set([...raced, ...later].map((result) => (result.ok ? result.value.id : result.code))).size).toBe(4);
        const all = await left.list("s3");
        expect(all.ok && all.value.map((item) => item.id)).toEqual(["0", "1", "2", "3"]);
        expect(await right.read("s3", "2")).toEqual({ok: true, value: "3"});
        // 根不可写（根是一个普通文件）：store-failed，没有半截文件
        const blocked = createJsonlArtifactStore({root: join(root, "s1.artifacts", "0", "plugin_x_dump.log")});
        const failed = await blocked.save("s9", "read", "x");
        expect(failed.ok ? null : failed.code).toBe("store-failed");
    });
});

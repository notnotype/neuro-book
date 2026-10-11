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
}

describe("溢出存储（输出 24）", () => {
    test("内存实现：序号会话内从 0 递增、按会话分开、不存在为 null、工具名清洗", async () => {
        await exercise(createMemoryArtifactStore());
        expect(safeToolName("a/b c!")).toBe("a_b_c");
        expect(safeToolName("///")).toBe("tool");
        expect(safeToolName("x".repeat(80))).toHaveLength(64);
    });

    test("JSONL 实现：文件在 <root>/<会话 id>.artifacts/<序号>.<工具名>.log；重开后序号接着编；不留临时文件；会话 id 不合规则为 invalid-session-id", async () => {
        const root = await jsonlRoot();
        await exercise(createJsonlArtifactStore({root}));
        expect((await readdir(join(root, "s1.artifacts"))).sort()).toEqual(["0.plugin_x_dump.log", "1.bash.log"]);
        expect(await readFile(join(root, "s1.artifacts", "0.plugin_x_dump.log"), "utf8")).toBe("全文一\n第二行");
        // 另一个存储实例（模拟进程重启）：扫目录续号，旧文件不被覆盖
        const reopened = createJsonlArtifactStore({root});
        const third = await reopened.save("s1", "read", "c");
        expect(third.ok && third.value.id).toBe("2");
        expect(await reopened.read("s1", "0")).toEqual({ok: true, value: "全文一\n第二行"});
        const listed = await reopened.list("s1");
        expect(listed.ok && listed.value.map((item) => item.id)).toEqual(["0", "1", "2"]);
        expect((await reopened.save("../x", "read", "c")).ok ? null : "invalid-session-id").toBe("invalid-session-id");
        // 根不可写（根是一个普通文件）：store-failed，没有半截文件
        const blocked = createJsonlArtifactStore({root: join(root, "s1.artifacts", "0.plugin_x_dump.log")});
        const failed = await blocked.save("s9", "read", "x");
        expect(failed.ok ? null : failed.code).toBe("store-failed");
    });
});

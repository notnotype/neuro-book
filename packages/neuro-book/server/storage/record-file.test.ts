import {randomUUID} from "node:crypto";
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {afterEach, expect, it} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {quarantineStorageRecord, readStorageRecordFile, sweepStorageTempFiles} from "nbook/server/storage/record-file";
import {storageContentFingerprint} from "nbook/server/storage/record-codec";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true}))); });
async function root() {
    const result = await mkdtemp(testHostPath("storage-file-"));
    roots.push(result);
    return result;
}

it("超限文件只返回有界分类与原始字节摘要，不携带文件内容", async () => {
    const directory = await root();
    const target = absoluteFsPath(path.join(directory, "record.json"));
    const content = Buffer.alloc(128 * 1024, 0xa5);
    await writeFile(target, content);
    expect(await readStorageRecordFile(target, 1024)).toEqual({
        kind: "oversized", bytes: content.byteLength, fingerprint: storageContentFingerprint(content),
    });
});

it("诊断原件保留无效 UTF-8 字节，清理本模块崩溃临时件后重试", async () => {
    const directory = await root();
    const target = absoluteFsPath(path.join(directory, "record.json"));
    const quarantineDirectory = absoluteFsPath(path.join(directory, "quarantine"));
    await mkdir(quarantineDirectory);
    const content = Buffer.from([0x7b, 0xff, 0xfe, 0x7d]);
    await writeFile(target, content);
    await writeFile(path.join(quarantineDirectory, `record.json.corrupt.${randomUUID()}.tmp`), Buffer.alloc(2048));
    const saved = await quarantineStorageRecord({
        target, quarantineDirectory, fingerprint: storageContentFingerprint(content), maxCopyBytes: 1024,
    });
    expect(await readFile(saved.path)).toEqual(content);
    expect(await readFile(target)).toEqual(content);
    expect(await readdir(quarantineDirectory)).toEqual([path.basename(saved.path)]);
});

it("维护只清理可识别的普通临时文件，保留任意同后缀文件和目录", async () => {
    const directory = absoluteFsPath(await root());
    const owned = `record.json.${randomUUID()}.tmp`;
    const foreign = "user-note.tmp";
    const folder = `folder.${randomUUID()}.tmp`;
    await writeFile(path.join(directory, owned), "unfinished");
    await writeFile(path.join(directory, foreign), "keep");
    await mkdir(path.join(directory, folder));
    expect(await sweepStorageTempFiles(directory)).toBe(1);
    expect((await readdir(directory)).sort()).toEqual([foreign, folder].sort());
});

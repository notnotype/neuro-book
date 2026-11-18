/**
 * 拖入或选出的文件夹的读取（dropped-folder.ts）：替身按 `FileSystemDirectoryEntry` 的真实形状写（`readEntries` 一次一批、回调形式、
 * 读到空数组才算读完），文件用真实的 `File`。
 */

import {describe, expect, it} from "vitest";

import {collectFolder, collectInputFiles, dragHasFiles, MAX_DEPTH, readDrop} from "./dropped-folder";
import type {CollectOptions} from "./dropped-folder";

type Tree = {readonly [name: string]: string | Tree};

/** 一个目录条目：子项按 `batch` 个一批给出。读目录或读文件失败用 `fail` 指定要失败的名字。 */
function directory(name: string, tree: Tree, options: {batch?: number; fail?: ReadonlySet<string>} = {}): FileSystemDirectoryEntry {
    const batch = options.batch ?? 2;
    const children = Object.entries(tree).map(([childName, value]): FileSystemEntry => (typeof value === "string" ? fileEntry(childName, value, options.fail) : directory(childName, value, options)));
    return {
        isFile: false,
        isDirectory: true,
        name,
        createReader: () => {
            let offset = 0;
            return {
                readEntries: (success: (entries: FileSystemEntry[]) => void, failure?: (error: DOMException) => void) => {
                    if (options.fail?.has(name)) return failure?.(new DOMException("读不了"));
                    const next = children.slice(offset, offset + batch);
                    offset += batch;
                    success(next);
                },
            };
        },
    } as unknown as FileSystemDirectoryEntry;
}

function fileEntry(name: string, content: string, fail?: ReadonlySet<string>): FileSystemFileEntry {
    return {
        isFile: true,
        isDirectory: false,
        name,
        file: (success: (file: File) => void, failure?: (error: DOMException) => void) => (fail?.has(name) ? failure?.(new DOMException("读不了")) : success(new File([content], name))),
    } as unknown as FileSystemFileEntry;
}

const SKIP = (name: string): boolean => name === "node_modules" || name === ".git";
const LIMITS = {maxFiles: 100, maxTotalBytes: 1000, maxFileBytes: 500};
const options = (overrides: Partial<CollectOptions> = {}): CollectOptions => ({limits: LIMITS, skip: SKIP, ...overrides});

describe("拖入的目录", () => {
    it("读出嵌套的文件：路径相对文件夹根、按路径排序；一次只给两个也读完（readEntries 要读到空数组）；任何深度的 node_modules 与 .git 不进", async () => {
        const entry = directory("plugin", {
            "package.json": "{}",
            dist: {"index.js": "1", chunks: {"a.js": "2", "b.js": "3"}},
            node_modules: {dep: {"index.js": "x"}},
            ".git": {HEAD: "ref"},
            src: {node_modules: {"deep.js": "y"}, "main.ts": "4"},
            "README.md": "5",
        });
        const result = await collectFolder(entry, options());
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.folder.name).toBe("plugin");
        expect(result.folder.files.map((file) => file.path)).toEqual(["README.md", "dist/chunks/a.js", "dist/chunks/b.js", "dist/index.js", "package.json", "src/main.ts"]);
        expect(await result.folder.files[0]!.file.text()).toBe("5");
        expect(result.folder.bytes).toBe(["5", "2", "3", "1", "{}", "4"].join("").length);
    });

    it("限额：文件数、单个文件、总量（按 cost 计，上传时含分帧头）；超限立即停，原因带路径", async () => {
        const tree = {"a.txt": "x".repeat(10), "b.txt": "x".repeat(10), "c.txt": "x".repeat(10)};
        expect(await collectFolder(directory("d", tree), options({limits: {...LIMITS, maxFiles: 2}}))).toEqual({ok: false, problem: {kind: "too-many-files"}});
        expect(await collectFolder(directory("d", {"big.bin": "x".repeat(501)}), options())).toEqual({ok: false, problem: {kind: "file-too-large", path: "big.bin"}});
        expect(await collectFolder(directory("d", tree), options({limits: {...LIMITS, maxTotalBytes: 25}}))).toEqual({ok: false, problem: {kind: "too-large"}});
        // 每个文件另算 100 字节的帧头：三个 10 字节的文件总量 330，超过 300。
        expect(await collectFolder(directory("d", tree), options({limits: {...LIMITS, maxTotalBytes: 300}, cost: (_, size) => size + 100}))).toEqual({ok: false, problem: {kind: "too-large"}});
    });

    it("路径检查：不合规的路径整个拒绝并指出是哪条；读目录或读文件失败也指出路径", async () => {
        const pathProblem = (path: string): string | null => (path.includes("bad") ? "不能用" : null);
        expect(await collectFolder(directory("d", {ok: {"a.txt": "1"}, bad: {"b.txt": "2"}}), options({pathProblem}))).toEqual({ok: false, problem: {kind: "path-invalid", path: "bad/b.txt", detail: "不能用"}});
        expect(await collectFolder(directory("d", {"a.txt": "1", "locked.txt": "2"}, {fail: new Set(["locked.txt"])}), options())).toEqual({ok: false, problem: {kind: "read-failed", path: "locked.txt"}});
        expect(await collectFolder(directory("d", {sub: {"a.txt": "1"}}, {fail: new Set(["sub"])}), options())).toEqual({ok: false, problem: {kind: "read-failed", path: "sub"}});
    });

    it("目录太深（符号链接的环）：遍历深度有上限", async () => {
        let tree: Tree = {"a.txt": "1"};
        for (let level = 0; level < MAX_DEPTH + 2; level += 1) tree = {d: tree};
        expect(await collectFolder(directory("root", tree), options())).toEqual({ok: false, problem: {kind: "too-deep"}});
    });
});

describe("选出的文件夹（input webkitdirectory）", () => {
    const picked = (relative: string, content = "x"): File => {
        const file = new File([content], relative.split("/").pop()!);
        Object.defineProperty(file, "webkitRelativePath", {value: relative});
        return file;
    };

    it("去掉文件夹名那一段；node_modules 与 .git 不收；与拖入同样的限额与路径检查", () => {
        const result = collectInputFiles([picked("plugin/package.json"), picked("plugin/dist/index.js"), picked("plugin/node_modules/dep/a.js"), picked("plugin/.git/HEAD"), picked("plugin/src/node_modules/b.js")], options());
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.folder.name).toBe("plugin");
        expect(result.folder.files.map((file) => file.path)).toEqual(["dist/index.js", "package.json"]);
        expect(collectInputFiles([picked("plugin/a.txt", "x".repeat(501))], options())).toEqual({ok: false, problem: {kind: "file-too-large", path: "a.txt"}});
        expect(collectInputFiles([picked("plugin/bad/a.txt")], options({pathProblem: (path) => (path.startsWith("bad") ? "不能用" : null)}))).toEqual({ok: false, problem: {kind: "path-invalid", path: "bad/a.txt", detail: "不能用"}});
    });

    it("没有 webkitRelativePath（不是选的文件夹）：读取失败", () => {
        expect(collectInputFiles([new File(["x"], "a.txt")], options())).toEqual({ok: false, problem: {kind: "read-failed", path: "a.txt"}});
    });
});

describe("drop 事件的条目", () => {
    const transfer = (items: Array<{kind: string; entry?: unknown; file?: File | null}>, types: string[] = ["Files"]): DataTransfer =>
        ({
            types,
            items: items.map((item) => ({kind: item.kind, webkitGetAsEntry: () => item.entry ?? null, getAsFile: () => item.file ?? null})),
        }) as unknown as DataTransfer;

    it("分类：文件夹、文件、拿不到条目但有文件的；网页里的文字不在结果里", () => {
        const folder = directory("plugin", {});
        const items = readDrop(transfer([{kind: "file", entry: folder}, {kind: "file", entry: fileEntry("a.zip", "")}, {kind: "file", entry: null, file: new File([""], "b.txt")}, {kind: "string"}, {kind: "file", entry: null, file: null}]));
        expect(items).toEqual([{kind: "folder", name: "plugin", entry: folder}, {kind: "file", name: "a.zip"}, {kind: "file", name: "b.txt"}]);
    });

    it("拖动里有没有文件：含 Files 才算；页面内部元素的拖动、没有 dataTransfer 都不算", () => {
        expect(dragHasFiles(transfer([], ["Files"]))).toBe(true);
        expect(dragHasFiles(transfer([], ["text/plain"]))).toBe(false);
        expect(dragHasFiles(null)).toBe(false);
    });
});

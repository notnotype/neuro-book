/**
 * “列出不读内容”的访问记录（docs/specs/workspace/resources.md 验收 7）：在 `files-sample.ts` 的样本上，用 `strace` 记录
 * 一次列出（项目根、宽目录、深层普通目录、内容根、内容树里的分组与节点）对样本里文件的打开与读取。普通目录不许打开任何
 * 文件；内容树只许打开并读取所属内容根的 `content.xml`。有违反时以 1 退出。只支持 Linux，需要 `strace`。
 *
 *   bun scripts/files-list-trace.ts [--count 3000] [--seed 42017]
 *
 * 列出经 `nbook.files` 的文件服务（与提供者入口调用的是同一个对象），不经内核与项目子进程：那两层不碰样本里的文件，
 * 却会打开 SQLite、配置等无关文件，让记录难以判读。
 */

import {mkdir, readFile, realpath, rm} from "node:fs/promises";
import {join, resolve} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {createFilesService} from "../src/plugins/files/backend/files-service";
import {openRoot} from "../src/plugins/files/backend/rooted";
import {planSample, writeSample} from "./files-sample";

const LISTED = ["", "notes/wide", "notes/archive/2026/q1", "manuscripts/volume-01", "lorebook.content", "lorebook.content/characters", "lorebook.content/characters/char-0001"];

async function child(root: string): Promise<void> {
    const opened = await openRoot(root, {controlDirectory: true, lockDirectory: join(root, ".nbook", "locks", "files"), report: () => undefined});
    if ("ok" in opened) throw new Error(opened.detail);
    const service = createFilesService({root: opened, diagnose: () => undefined});
    for (const path of LISTED) {
        const listed = await service.list(path);
        if (!listed.ok) throw new Error(`${path}：${listed.code}`);
        console.log(`${path === "" ? "<根>" : path}：${String(listed.value.entries.length)} 项`);
    }
}

interface Access {
    readonly call: string;
    readonly path: string;
}

/** strace 记录里对样本文件（`files`，绝对路径）的打开与读取；打开目录不算。 */
function accesses(log: string, files: ReadonlySet<string>): Access[] {
    const found: Access[] = [];
    for (const line of log.split("\n")) {
        const open = /\b(openat2?|open)\([^"]*"([^"]+)"/u.exec(line);
        if (open !== null) {
            if (files.has(open[2] as string)) found.push({call: open[1] as string, path: open[2] as string});
            continue;
        }
        // -yy 把文件描述符写成 `12</绝对路径>`。
        const read = /\b(read|pread64|readv|preadv2?|mmap)\((?:[^<]*?)<([^>]+)>/u.exec(line);
        if (read !== null && files.has(read[2] as string)) found.push({call: read[1] as string, path: read[2] as string});
    }
    return found;
}

async function main(): Promise<void> {
    const at = (name: string, fallback: number): number => {
        const index = process.argv.indexOf(`--${name}`);
        return index < 0 ? fallback : Number(process.argv[index + 1]);
    };
    const tmp = await createTestTmpRoot("neuro-book-files", "list-trace");
    try {
        const root = join(tmp, "sample");
        const description = await writeSample(root, {count: at("count", 3000), seed: at("seed", 42017)});
        await mkdir(join(root, ".nbook"), {recursive: true});
        const log = join(tmp, "strace.log");
        const traced = Bun.spawn(["strace", "-f", "-yy", "-e", "trace=open,openat,openat2,read,pread64,readv,preadv,preadv2,mmap", "-o", log, process.execPath, resolve(import.meta.path), "--child", root], {stdout: "pipe", stderr: "pipe"});
        const [code, stdout, stderr] = await Promise.all([traced.exited, new Response(traced.stdout).text(), new Response(traced.stderr).text()]);
        if (code !== 0) throw new Error(`列出失败（${String(code)}）：${stderr}`);
        const real = await realpath(root);
        const files = new Set([...planSample({count: description.count, seed: description.seed}).files.map((file) => join(real, file.path)), join(real, description.contentRoot, "content.xml")]);
        const found = accesses(await readFile(log, "utf8"), files);
        const manifest = found.filter((access) => access.path.endsWith("/lorebook.content/content.xml"));
        const violations = found.filter((access) => !access.path.endsWith("/lorebook.content/content.xml"));
        console.log(JSON.stringify({sample: {seed: description.seed, count: description.count, totalBytes: description.totalBytes}, listed: stdout.trim().split("\n"), manifestAccesses: manifest.length, violations: violations.slice(0, 20), violationCount: violations.length}, null, 2));
        if (violations.length > 0 || manifest.length === 0) process.exitCode = 1;
    } finally {
        await rm(tmp, {recursive: true, force: true});
    }
}

if (import.meta.main) {
    const childAt = process.argv.indexOf("--child");
    if (childAt >= 0) await child(process.argv[childAt + 1] as string);
    else await main();
}

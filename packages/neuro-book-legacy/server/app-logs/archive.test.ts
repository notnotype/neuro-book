import fs from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import path from "node:path";
import {Readable} from "node:stream";
import {afterEach, describe, expect, it} from "vitest";
import {unzipSync} from "fflate";
import {createAppLogsZipStream} from "nbook/server/app-logs/archive";

const cleanupRoots: string[] = [];

afterEach(async () => {
    for (const root of cleanupRoots.splice(0)) {
        await fs.rm(root, {recursive: true, force: true});
    }
});

/**
 * 创建临时日志根目录。
 */
async function tempLogRoot(): Promise<string> {
    const root = await fs.mkdtemp(testHostPath("nbook-app-log-archive-"));
    cleanupRoots.push(root);
    return root;
}

describe("app logs archive", () => {
    it("packages only log files and manifest", async () => {
        const root = await tempLogRoot();
        await fs.writeFile(path.join(root, "server-current.jsonl"), "{\"level\":\"info\"}\n", "utf8");
        await fs.writeFile(path.join(root, "launcher-2026-06-28.log"), "launcher\n", "utf8");
        await fs.writeFile(path.join(root, "launcher-2026-06-28-120000-1234-abcd1234.log"), "rotated\n", "utf8");
        await fs.writeFile(path.join(root, "config.json"), "{\"apiKey\":\"must-not-ship\"}\n", "utf8");

        const archive = await createAppLogsZipStream(root);
        const buffer = await streamToBuffer(archive.stream);
        const entries = unzipSync(new Uint8Array(buffer));
        const names = Object.keys(entries).sort();

        expect(archive.filename).toMatch(/^neuro-book-logs-\d{8}-\d{6}\.zip$/u);
        expect(names).toEqual([
            "logs/launcher-2026-06-28-120000-1234-abcd1234.log",
            "logs/launcher-2026-06-28.log",
            "logs/server-current.jsonl",
            "manifest.json",
        ]);

        const manifest = JSON.parse(new TextDecoder().decode(entries["manifest.json"]));
        expect(manifest).not.toHaveProperty("logDirectory");
        expect(manifest).not.toHaveProperty("cwd");
        expect(JSON.stringify(manifest)).not.toContain(root);
        expect(manifest.files).toEqual(expect.arrayContaining([
            expect.objectContaining({name: "server-current.jsonl"}),
            expect.objectContaining({name: "launcher-2026-06-28.log"}),
        ]));
    });
});

async function streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

/**
 * 起一个只读的静态服务，服务一个示例的构建产物（`examples/<名字>/dist`），端口由系统给。用例在 `beforeAll` 起、
 * `afterAll` 停。模块脚本要带 `text/javascript`，不然 Chrome 拒绝执行；不在的文件回 404。
 */

import {readFile} from "node:fs/promises";
import {createServer} from "node:http";
import type {AddressInfo} from "node:net";
import {extname, join, normalize} from "node:path";

const TYPES: Readonly<Record<string, string>> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
};

export async function serveExample(name: string): Promise<{readonly url: string; close(): Promise<void>}> {
    const root = join(import.meta.dirname, "..", "examples", name, "dist");
    const server = createServer((request, response) => {
        const path = new URL(request.url ?? "/", "http://localhost").pathname;
        const file = normalize(join(root, path === "/" ? "index.html" : path));
        if (!file.startsWith(root)) {
            response.writeHead(403).end();
            return;
        }
        readFile(file).then(
            (body) => response.writeHead(200, {"content-type": TYPES[extname(file)] ?? "application/octet-stream"}).end(body),
            () => response.writeHead(404).end("not found"),
        );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const {port} = server.address() as AddressInfo;
    return {
        url: `http://127.0.0.1:${port}/`,
        close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
    };
}

/**
 * 本机静态更新源：与 GitHub Release 的下载地址同样的平铺布局（t10 的 `t10-serve.ts` 同一种写法）。更新冒烟用它换源，
 * `build-variant.ts` 构建 B′ 时用它把 A′ 交给 Hutch 做补丁。单独一个文件：构建脚本不该为它装上 Playwright。
 */

import {appendFileSync} from "node:fs";
import {join} from "node:path";

/**
 * 每个请求记一行进 `log`：
 * `<时间> <方法> <路径与查询串> <状态> <字节>`。`serve(dir)` 换成另一个目录（换源）。
 */
export function feedServer(port: number, log: string): {serve(dir: string): void; stop(): void} {
    let root: string | null = null;
    const server = Bun.serve({
        hostname: "127.0.0.1",
        port,
        async fetch(request) {
            const url = new URL(request.url);
            const name = decodeURIComponent(url.pathname.slice(1));
            const file = root !== null && name !== "" && !/[\\/]|\.\./u.test(name) ? Bun.file(join(root, name)) : null;
            const exists = file !== null && (await file.exists());
            appendFileSync(log, `${new Date().toISOString()} ${request.method} ${url.pathname}${url.search} ${exists ? 200 : 404} ${exists ? file.size : 0}\n`);
            return exists ? new Response(file) : new Response("not found", {status: 404});
        },
    });
    return {
        serve(dir) {
            root = dir;
            appendFileSync(log, `${new Date().toISOString()} serve ${dir}\n`);
        },
        stop: () => void server.stop(true),
    };
}

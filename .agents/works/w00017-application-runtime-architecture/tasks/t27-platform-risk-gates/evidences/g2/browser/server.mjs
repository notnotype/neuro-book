// 仅供本实验的静态文件服务：随机端口、只绑定 127.0.0.1，根目录为 g2/。
const root = new URL("../", import.meta.url).pathname;
const types = {".mjs": "text/javascript", ".js": "text/javascript", ".html": "text/html; charset=utf-8"};
const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
        const path = decodeURIComponent(new URL(request.url).pathname);
        if (path.includes("..")) return new Response("forbidden", {status: 403});
        const file = Bun.file(root + path.slice(1));
        if (!await file.exists()) return new Response("not found", {status: 404});
        const ext = path.slice(path.lastIndexOf("."));
        return new Response(file, {headers: {"content-type": types[ext] ?? "application/octet-stream", "cache-control": "no-store", "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp"}});
    },
});
console.log(server.port);

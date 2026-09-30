// G0 预检：crossws node 适配器 + node:http upgrade 在 Bun 下是否可用（不经 Nuxt）。
// 在 packages/neuro-book 目录下运行：bun standalone-ws.mjs（需要能解析 crossws）
import {Server} from "node:http";
import wsAdapter from "crossws/adapters/node";

const server = new Server((req, res) => { res.end("ok"); });
const ws = wsAdapter({hooks: {
    upgrade(request) {
        if (!request.headers.get("cookie")?.includes("ok=1")) return new Response("Unauthorized", {status: 401});
        request.context.user = "u1";
    },
    open(peer) { peer.send("hello " + peer.context.user); },
    message(peer, m) { peer.send("echo:" + m.text()); },
}});
server.on("upgrade", (req, socket, head) => ws.handleUpgrade(req, socket, head));
server.listen(3320, "127.0.0.1", async () => {
    const results = [];
    const open = (headers) => new Promise((resolve) => {
        const c = new WebSocket("ws://127.0.0.1:3320/x", {headers});
        const got = [];
        c.onmessage = (e) => { got.push(String(e.data)); if (got.length === 1) c.send("ping"); else { c.close(); resolve({ok: true, got}); } };
        c.onerror = (e) => resolve({ok: false, error: String(e.message ?? e.type)});
        c.onclose = (e) => { if (got.length < 2) resolve({ok: false, closeCode: e.code, got}); };
    });
    results.push(await open({cookie: "ok=1"}));
    results.push(await open({}));
    console.log(JSON.stringify({bun: Bun.version, results}));
    server.close(); process.exit(0);
});

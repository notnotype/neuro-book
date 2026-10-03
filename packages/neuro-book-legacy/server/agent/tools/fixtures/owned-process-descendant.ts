import {writeFileSync} from "node:fs";
import {createServer} from "node:net";

const statePath = process.argv[2];
if (!statePath) throw new Error("Owned Process fixture需要状态文件路径。");

const server = createServer();
server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Owned Process fixture没有获得TCP端口。");
    writeFileSync(statePath, JSON.stringify({pid: process.pid, port: address.port}), "utf8");
});

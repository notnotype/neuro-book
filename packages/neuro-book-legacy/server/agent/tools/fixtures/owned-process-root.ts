import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";

const statePath = process.argv[2];
if (!statePath) throw new Error("Owned Process fixture需要状态文件路径。");

const descendant = spawn(process.execPath, [
    fileURLToPath(new URL("./owned-process-descendant.ts", import.meta.url)),
    statePath,
], {
    env: process.env,
    stdio: ["ignore", "inherit", "inherit"],
    windowsHide: true,
});
if (!descendant.pid) throw new Error("Owned Process fixture无法启动孙进程。");

setInterval(() => undefined, 60_000);

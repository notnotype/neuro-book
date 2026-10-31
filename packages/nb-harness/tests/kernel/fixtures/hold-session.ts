/**
 * 测试用的子进程：打开一个会话并一直持有，打开成功后在标准输出打一行 `held`，失败时打出码并退出。
 * 用法：bun hold-session.ts <根目录> <会话 id>
 */

import {createJsonlStore} from "@notnotype/nb-harness/kernel";

const [root, id] = process.argv.slice(2) as [string, string];
const opened = await createJsonlStore({root}).open(id);
if (!opened.ok) {
    console.log(opened.code);
    process.exit(2);
}
console.log("held");
// 一直持有，直到被父进程结束。句柄挂在全局上留住引用：没关的文件句柄被垃圾回收时 Bun 报错退出；
// 只靠闭包里的 `void handle` 留不住，转译时会被当成无用代码删掉。
(globalThis as {heldSession?: unknown}).heldSession = opened.value;
setInterval(() => undefined, 1 << 30);

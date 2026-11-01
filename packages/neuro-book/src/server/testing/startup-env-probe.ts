/**
 * `startup-env.test.ts` 的子进程：和服务端入口一样先导入启动环境快照，再导入 OMP（它在导入时把家目录的 `.env` 并进
 * `process.env`），把两边看到的变量打印出来。只由测试启动。
 */

import {startupEnv} from "nbook/server/startup-env";

await import("@oh-my-pi/pi-utils");

const names = ["NB_STARTUP_HOME_ONLY", "NB_STARTUP_CWD", "NB_STARTUP_SHELL"];
console.log(JSON.stringify({snapshot: Object.fromEntries(names.map((name) => [name, startupEnv[name] ?? null])), live: Object.fromEntries(names.map((name) => [name, process.env[name] ?? null]))}));

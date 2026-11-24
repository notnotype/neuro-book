#!/usr/bin/env -S bun --no-env-file
// `--no-env-file`：Bun 默认读当前目录的 `.env`，官方站的配置只来自环境变量（`site.operations` 的输入一节）。

import {runCli} from "./cli";
import {SITE_MODULES} from "./modules";

// 显式退出：命令做完收口之后不等残留的句柄（例如没读完的标准输入），退出码由 `runCli` 算出。
process.exit(await runCli(process.argv.slice(2), SITE_MODULES));

#!/usr/bin/env -S bun --no-env-file
// `--no-env-file`：Bun 默认读当前目录的 `.env`，官方站的配置只来自环境变量（`site.operations` 的输入一节）。

import {Command} from "commander";

new Command("nb-site").description("NeuroBook official site server: serve, migrate and back up the site's data directory").outputHelp();

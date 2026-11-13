import {readFileSync} from "node:fs";

import type {ElectrobunConfig} from "electrobun";

// 桌面壳的 Electrobun 配置（docs/specs/runtime/desktop-shell.md）。主进程是 `scripts/build.ts` 在仓库里预先打好的
// `bundle/main.js`（核心在 `packages/neuro-book/src/desktop/`）；载荷 `payload/app` 由同一脚本从发布清单组装。
// 应用标识与发布频道发出去以后不改（Spec 的“输入与前置条件”）。版本是产品版本，由同一脚本写进 `bundle/version.json`。
const {version} = JSON.parse(readFileSync(new URL("./bundle/version.json", import.meta.url), "utf8")) as {version: string};

export default {
    app: {
        name: "NeuroBook",
        identifier: "io.github.notnotype.neurobook",
        version,
    },
    build: {
        mainProcess: "bun",
        bun: {entrypoint: "bundle/main.js"},
        copy: {
            "src/views/shell/index.html": "views/shell/index.html",
            "payload/app": "neurobook",
        },
    },
    runtime: {
        // 最后一个窗口关掉时由壳自己停服务端再退出（输出 18）。
        exitOnLastWindowClosed: false,
    },
} satisfies ElectrobunConfig;

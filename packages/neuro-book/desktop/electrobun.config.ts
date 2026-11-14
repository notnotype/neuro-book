import {readFileSync} from "node:fs";

import type {ElectrobunConfig} from "electrobun";

// 桌面壳的 Electrobun 配置（docs/specs/runtime/desktop-shell.md）。主进程是 `scripts/build.ts` 在仓库里预先打好的
// `bundle/main.js`（核心在 `packages/neuro-book/src/desktop/`）；载荷 `payload/app` 由同一脚本从发布清单组装。
// 应用标识与发布频道发出去以后不改（Spec 的“输入与前置条件”）。版本是产品版本，由同一脚本写进 `bundle/version.json`。
const {version} = JSON.parse(readFileSync(new URL("./bundle/version.json", import.meta.url), "utf8")) as {version: string};

// 更新源（docs/specs/runtime/desktop-update.md）：构建进包里，装好之后改不了。缺省是 GitHub 最新 Release 的下载地址。
// 两个环境变量只给自动更新的验收用：`NBOOK_UPDATE_BASE_URL` 换成本地更新源；`NBOOK_DESKTOP_IDENTIFIER` 换一个应用标识，
// 测试包装进另一个目录（`%LOCALAPPDATA%\<identifier>\`）、用另一份 WebView 数据，不碰正式安装。缺省状态根不随标识变。
const baseUrl = process.env.NBOOK_UPDATE_BASE_URL?.trim() || "https://github.com/notnotype/neuro-book/releases/latest/download";
const identifier = process.env.NBOOK_DESKTOP_IDENTIFIER?.trim() || "io.github.notnotype.neurobook";

export default {
    app: {
        name: "NeuroBook",
        identifier,
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
    release: {
        baseUrl,
        // 本地版本有现成的增量补丁时下载补丁（desktop-update 输出 4）。
        generatePatch: true,
    },
    runtime: {
        // 最后一个窗口关掉时由壳自己停服务端再退出（输出 18）。
        exitOnLastWindowClosed: false,
    },
} satisfies ElectrobunConfig;

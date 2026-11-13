// Hutch 与 Electrobun 的版本固定（ADR 0051 决定 1），升级单独提交。Hutch 0.29.0 设了 HTTPS_PROXY 时下载会失败，构建前清掉。
export default {
    packageManager: "bun",
    electrobun: {version: "2.0.6"},
    scripts: {
        install: ["hutch", "pm", "install"],
        build: ["hutch", "electrobun", "build", "--env=stable"],
    },
};

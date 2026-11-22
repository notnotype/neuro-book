/**
 * Bun 测试的预加载（`bunfig.toml` 的 `[test].preload`）：模型服务缺省不取在线目录（docs/specs/models/service.md“输入与前置条件”的
 * `NBOOK_MODELS_CATALOG_URL`）。进程内起的服务端（启动环境是这时的 `process.env` 快照）与测试派生的服务端子进程（继承 `process.env`）
 * 都因此不出本机；要测在线目录的用例自己给本机端点的地址。已经设了的不改。
 */

process.env.NBOOK_MODELS_CATALOG_URL ??= "";

/**
 * 第二切片组合 smoke 的共享常量：父进程 CLI 与子进程清单都引用它。
 * 本文件没有任何导入，父进程在 server/browser 模式下不会因此加载插件或 `node:sqlite`。
 */

export type ServicePluginId = "nbook.diagnostics" | "nbook.platform-files" | "nbook.sqlite";
export const SERVICE_PLUGIN_IDS: ReadonlyArray<ServicePluginId> = ["nbook.diagnostics", "nbook.platform-files", "nbook.sqlite"];

export const NOTES_FILE = "notes/entry.txt";
export const NOTES_BODY = "第二切片组合验收：文件与 SQLite 各自提交\n";
export const NOTES_ROW = "x'); DROP TABLE notes; -- 按值绑定";
/** 写阶段记录进诊断的敏感样本；父进程确认它们不出现在日志文件里。 */
export const SECRET_SAMPLES = {token: "smoke-token-4f1c9e", password: "smoke-password-77aa"} as const;

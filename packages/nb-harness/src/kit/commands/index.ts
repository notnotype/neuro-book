/**
 * `@notnotype/nb-harness/kit/commands`：命令方言（docs/specs/agent/permissions.md 的“命令与方言”）。`shell` 工具按它求等级，审批钩子
 * 按它把一段命令拆成规则要看的单条命令；放在两者之下，免得工具与审批互相依赖。
 */

export {createBashDialect} from "./bash-dialect.js";
export type {BashDialectOptions, CommandDialect, CommandRedirect, OpaqueCommand, ParsedCommand, SimpleCommand} from "./bash-dialect.js";
export {commandEffect, createDialects} from "./dialects.js";
export type {Dialects} from "./dialects.js";

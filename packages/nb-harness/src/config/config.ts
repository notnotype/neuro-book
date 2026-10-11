/**
 * 配置：合成好的配置变成内核用的快照——校验、缺省值、深冻结、替换与变化通知。行为合同见 docs/specs/harness/config.md。
 */

export type {ApprovalMode, ConfigProblem, ConfigResult, ConfigStore, HarnessConfig, JsonValue, ModelRef, ProviderConfig, ProviderModelConfig, RoleItem} from "./types";
export {validateHarnessConfig} from "./validate";
export {createConfigStore} from "./store";
export {MODEL_REF_PATTERN} from "./schema";
export type {HarnessConfigInput} from "./schema";

/**
 * 模型：目录与解析、角色选择链、能力检查、OMP 凭据与 OAuth。行为合同见 docs/specs/harness/models.md（planned）。
 * 模型通信本身直接用 OMP 的 `streamSimple`，本模块只给出模型对象与凭据。
 */

export type {Capabilities, CapabilityProblem, Credentials, ModelCatalog, ModelFailure, ModelResult, ModelSummary, SelectRequest, Selected} from "./types";
export {createModelCatalog, parseModelRef} from "./catalog";
export {createCredentials, openCredentials} from "./credentials";

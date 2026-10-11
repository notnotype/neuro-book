/**
 * 压缩：方法注册与按顺序选择、内置 soft（包 OMP 本地摘要）、压缩条目与种子的一批写入、阈值判断、Profile 字段 harness/compaction。
 * 行为合同见 docs/specs/harness/compaction.md。
 */

export type {
    Attempt, CompactInput, Compacted, CompactionFailure, CompactionMethod, CompactionOutput, CompactionRegistry, CompactionResult, CompactionSettings,
    CompleteImpl, JsonValue, MethodInput, MethodResult, Model, TriggerDecision,
} from "./types";
export {COMPACTION_FIELD, resolveCompactionSettings} from "./settings";
export {createCompactionRegistry} from "./registry";
export {createSoftCompaction, softCompaction} from "./soft";
export {compactSession} from "./run";
export {shouldCompact} from "./trigger";

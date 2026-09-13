/**
 * factoryKey → resolver 的间接层。
 *
 * 本期只有第一方映射（内置插件路径）；**不实现**任何第三方路径、动态 import、模块路径解析或安装账本。
 * 将来接 L3 时改的是 resolver 的实现，descriptor 与调用方不变。
 */
export type FactoryResolution = {kind: "ok"; ref: string} | {kind: "error"; reason: string};

const FIRST_PARTY: Record<string, string> = {
    "spike.view.files": "files",
    "spike.view.outline": "outline",
    "spike.view.characters": "characters",
    "spike.view.trace": "trace",
    "spike.view.jobs": "jobs",
    "spike.view.problems": "problems",
};

export function resolveFactory(factoryKey: string): FactoryResolution {
    if (factoryKey === "spike.broken") {
        return {kind: "error", reason: "factory 解析失败：spike.broken（演示用）"};
    }
    const ref = FIRST_PARTY[factoryKey];
    return ref ? {kind: "ok", ref} : {kind: "error", reason: "未知 factoryKey：" + factoryKey};
}

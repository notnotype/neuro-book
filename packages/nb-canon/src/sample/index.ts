/**
 * 子路径 `@notnotype/nb-canon/sample`：t16 原型里的星瑕样本（故事种子、三章、十一次写入）与把它换成写入请求的转换。给内核的
 * 样本测试、应用的样本项目脚本与 e2e 共用同一份数据；不进主入口。读 JSON 用 `node:fs`，只在 Bun 与 Node 里用。
 */

import {readFile} from "node:fs/promises";

import type {PrototypeSample} from "./convert";

export {componentDeclarations, IdMap, prototypeTypes, toRequest, typeId, type PrototypeSample, type PrototypeState, type SampleType, type SampleTypes} from "./convert";

/** 原型导出的样本（`xingxia-prototype.json`，原样保留，不手改）。 */
export async function loadXingxiaSample(): Promise<PrototypeSample> {
    return JSON.parse(await readFile(new URL("./xingxia-prototype.json", import.meta.url), "utf8")) as PrototypeSample;
}

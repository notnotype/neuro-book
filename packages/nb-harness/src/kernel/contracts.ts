/**
 * `@notnotype/nb-harness/kernel/contracts`：全部公开类型、码表与定义用的构造函数，不拖内核实现。
 * 插件把契约放在不拖实现的 shared 模块里时从这里导入。
 */

export * from "./api/index.js";
export {coreHistory, conv, defineContract, defineExtension, ext, implement, optional, shape, slice} from "./extension/define.js";
export {defineProfile} from "./extension/profile.js";

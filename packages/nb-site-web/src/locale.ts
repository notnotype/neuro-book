import {readonly, ref} from "vue";

/**
 * 站点界面的语言。第一版只有中文（t10 README 的“语言”一段），所以固定 `zh-CN`；加英文时改成按用户的选择或
 * `navigator.language` 取，组件与目录的取字方式不变（t10 计划 3.3）。`<html lang>` 跟着它（`site.ts`）。
 */
export const locale = readonly(ref("zh-CN"));

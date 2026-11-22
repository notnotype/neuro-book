/**
 * 输入法正在组字时按的回车是选字，不是提交（中文输入法下打名称、搜索词时常见）。和 nb-ui 的弹层同一个判法：`isComposing`，
 * 加上部分浏览器在组字期间给的 `keyCode` 229。
 */
export const composing = (event: KeyboardEvent): boolean => event.isComposing || event.keyCode === 229;

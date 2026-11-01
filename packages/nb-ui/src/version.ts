/**
 * nb-ui 的宿主版本号。
 *
 * 主题包用 `hostVersion` 声明自己兼容哪些宿主版本，装载时按这个常量校验，
 * 所以它必须与 package.json 的 version 逐字一致——theme-loader.test.ts 守着这条。
 *
 * 为什么不直接读 package.json：库要能被打进浏览器产物，运行期读文件不可行；
 * 而 `import pkg from "../package.json"` 会让每个消费方的打包器都得开 JSON 导入。
 */
export const NB_UI_VERSION = "0.3.0";

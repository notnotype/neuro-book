/**
 * NeuroBook 的客户端身份在本地存储里的键（runtime.browser-host 术语）；读写由 nb-host 的 `readClientIdentity` 做，窗口启动时
 * 传这个键。e2e 从这里取键去读、清浏览器里存的身份。
 */

export const CLIENT_IDENTITY_KEY = "nbook.client-identity";

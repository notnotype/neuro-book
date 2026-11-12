/**
 * NeuroBook 的客户端身份：读写由 nb-host 的 `readClientIdentity` 做（runtime.browser-host 术语），这里只定本应用在本地
 * 存储里的键。e2e 从这里取键去读、清浏览器里存的身份。
 */

import {readClientIdentity as readHostClientIdentity} from "@notnotype/nb-host/web";
import type {ClientIdentity, IdentityStorage} from "@notnotype/nb-host/web";

export const CLIENT_IDENTITY_KEY = "nbook.client-identity";

export function readClientIdentity(storage: () => IdentityStorage): ClientIdentity {
    return readHostClientIdentity(CLIENT_IDENTITY_KEY, storage);
}

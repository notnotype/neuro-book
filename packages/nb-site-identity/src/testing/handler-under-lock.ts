/**
 * 在一个独立的进程里经库的 `auth.handler` 调一个要写库的端点，同时另一条连接持着写锁；在标准输出写一行结果 JSON。
 * `auth.test.ts` 起这个进程，核对“错误从 handler 抛出、标准错误为空”：要看的是整个进程的标准错误，同一个测试进程里看不到。
 * 不含断言。
 *
 * 选授权端点（`/oauth2/authorize`）：经 handler 到得了的只有对外要的几条（`auth.ts` 的 `LIBRARY_PUBLIC_ENDPOINTS`），它是其中
 * 之一；它要会话与客户端（读，写锁下照常），再写授权码（写，撞写锁得 SQLITE_BUSY），库 1.7.27 不包装这个错误。
 * 不选 `revoke-session`：它接住删行的错误、改抛 `APIError`，经 handler 是 500 响应，看不出 `onAPIError.throw` 的作用。
 */

import {isDbUnavailable} from "../db/connection";
import {createTestIdentity} from "./module";
import {authorize, CONSENTED, registerClient} from "./oauth";

const identity = await createTestIdentity("identity-handler-under-lock");
let outcome: Readonly<Record<string, unknown>>;
try {
    const client = await registerClient(identity);
    const userId = await identity.addUser("locked", CONSENTED);
    const {cookie} = await identity.issue(userId);
    const other = identity.root.openOther();
    other.exec("PRAGMA busy_timeout = 0");
    other.exec("BEGIN IMMEDIATE");
    try {
        // `authorize` 经 `auth.handler` 发请求；handler 抛出的错误原样从它抛出。
        await authorize(identity, cookie, client);
        outcome = {thrown: false};
    } catch (error) {
        outcome = {thrown: true, unavailable: isDbUnavailable(error)};
    } finally {
        other.exec("ROLLBACK");
    }
} finally {
    await identity.root.cleanup();
}
process.stdout.write(`${JSON.stringify(outcome)}\n`);

/**
 * 在一个独立的进程里经库的 `auth.handler` 调一个要写库的端点，同时另一条连接持着写锁；在标准输出写一行结果 JSON。
 * `auth.test.ts` 起这个进程，核对“错误从 handler 抛出、标准错误为空”：要看的是整个进程的标准错误，同一个测试进程里看不到。
 * 不含断言。
 *
 * 选 `update-user`：它要会话（读，写锁下照常），再改账号行（写，撞写锁得 SQLITE_BUSY），库 1.7.27 不包装这个错误。
 * 不选 `revoke-session`：它接住删行的错误、改抛 `APIError`，经 handler 是 500 响应，看不出 `onAPIError.throw` 的作用。
 */

import {LIB_BASE_PATH} from "../auth";
import {isDbUnavailable} from "../db/connection";
import {createTestIdentity} from "./module";
import {TEST_SITE_URL} from "./library";

const identity = await createTestIdentity("identity-handler-under-lock");
let outcome: Readonly<Record<string, unknown>>;
try {
    const userId = await identity.addUser("locked");
    const {cookie} = await identity.issue(userId);
    const other = identity.root.openOther();
    other.exec("PRAGMA busy_timeout = 0");
    other.exec("BEGIN IMMEDIATE");
    try {
        const response = await identity.assembly.auth.handler(
            new Request(`${TEST_SITE_URL}${LIB_BASE_PATH}/update-user`, {
                method: "POST",
                headers: {cookie, origin: TEST_SITE_URL, "content-type": "application/json"},
                body: JSON.stringify({name: "renamed"}),
            }),
        );
        outcome = {thrown: false, status: response.status};
    } catch (error) {
        outcome = {thrown: true, unavailable: isDbUnavailable(error)};
    } finally {
        other.exec("ROLLBACK");
    }
} finally {
    await identity.root.cleanup();
}
process.stdout.write(`${JSON.stringify(outcome)}\n`);

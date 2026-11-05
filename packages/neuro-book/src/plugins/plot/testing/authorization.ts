/**
 * 测试用的作者来源：决策转成已定要作者来源（canon.revisions 输出 21）。签名换成 HMAC 加固定的测试密钥，与 nb-canon 的测试夹具同一个
 * 合同（`binds` 用内核导出的同一个函数算）。只由测试用。
 */

import {createHash, createHmac} from "node:crypto";

import {authorizationBinds, signedContent} from "@notnotype/nb-canon";
import type {Authorization, AuthorSource, Transition, WriteRequest} from "@notnotype/nb-canon";

const KEY = "nb-plot-test-key";
export const TEST_PROJECT = "plot-test-project";
export const testDigest = (text: string) => createHash("sha256").update(text).digest("hex");
const hmac = (source: Omit<AuthorSource, "signature">) => createHmac("sha256", KEY).update(signedContent(source)).digest("hex");
export const verifyTestSource = (source: AuthorSource) => source.signature === hmac(source);

/** 宿主按将要发出的请求签发一项授权。 */
export function signAuthorization(request: WriteRequest, decision: string, transition: Transition, quote = "作者定的"): Authorization {
    const binds = authorizationBinds({project: TEST_PROJECT, request, decision, transition}, testDigest);
    const unsigned = {author: "作者", via: "message" as const, id: "m1", quote, time: "2026-11-05T00:00:00Z", binds};
    return {decision, transition, source: {...unsigned, signature: hmac(unsigned)}};
}

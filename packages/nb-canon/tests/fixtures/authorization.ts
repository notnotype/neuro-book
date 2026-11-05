/**
 * 测试用的作者来源签发与校验：宿主的签名换成 HMAC 加固定的测试密钥，按 canon.revisions 输出 21 的合同签
 * （`binds` 用内核导出的同一个函数算，签名覆盖除 `signature` 以外的全部字段）。
 */

import {createHash, createHmac} from "node:crypto";

import {authorizationBinds, signedContent, type Authorization, type AuthorSource, type RevertRequest, type Transition, type WriteRequest} from "../../src/index";

const KEY = "nb-canon-test-key";
export const PROJECT = "project-1";
export const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const hmac = (source: Omit<AuthorSource, "signature">) => createHmac("sha256", KEY).update(signedContent(source)).digest("hex");
export const verify = (source: AuthorSource) => source.signature === hmac(source);

/** 宿主按将要发出的请求签发一项授权；还原请求的 `fields` 照预览给的抄。 */
export function sign(request: WriteRequest | RevertRequest, decision: string, transition: Transition, fields?: string): Authorization {
    const binds = authorizationBinds({project: PROJECT, request, decision, transition, ...(fields === undefined ? {} : {fields})}, digest);
    const unsigned = {author: "作者", via: "message" as const, id: "m1", quote: "定在第 20 章，前面只给暗示", time: "2026-11-05T00:00:00Z", binds};
    return {decision, transition, source: {...unsigned, signature: hmac(unsigned)}};
}

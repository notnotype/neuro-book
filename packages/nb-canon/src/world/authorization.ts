/**
 * 作者授权（docs/specs/canon/revisions.md 输出 21）：需要作者来源的决策转换与修改，写入请求里各带一项授权。
 *
 * 宿主签发、本能力校验，两边用这里导出的同一个 `authorizationBinds` 算 `binds`，所以口径不会分叉。校验分两步：先按
 * 规范的 JSON 逐字比来源里的 `binds` 与按请求原样算出的，再把来源交给宿主注入的签名校验。前一步由内核做，宿主的
 * 签名校验即使对什么都答“通过”，挪到别的请求、别的决策、别的结论上的来源也过不了。
 *
 * `request` 与 `fields` 都按请求原样（临时 id 换成正式 id 之前）算：同一请求里新建、互相引用的对象，签发时还没有正式 id。
 */

import type {Actor, AuthorSource, Binds, Decision, WriteRequest} from "../core/schema";
import {canonicalJson} from "../core/stable-json";
import {AUTHORIZED_KEYS, type Transition} from "./decisions";

/** 还原请求（project.md 的 `revert`）里参与摘要的部分。 */
export interface RevertRequest {
    readonly revert: string;
    readonly withDependents: boolean;
    readonly requestId: string;
    readonly by: Actor;
    readonly title?: string;
}

/** 需要的一项授权（`author-source-required` 的详情、还原预览列出的清单）：宿主照它签发。 */
export interface NeededAuthorization {
    readonly decision: string;
    readonly transition: Transition;
    readonly fields: string;
}

/** 写入请求去掉 `authorizations` 与 `baseVersion`，或还原请求的那几项，取规范的 JSON 再取摘要。 */
export function requestDigest(request: WriteRequest | RevertRequest, digest: (text: string) => string): string {
    if ("puts" in request) {
        const {authorizations: _authorizations, baseVersion: _baseVersion, ...meaning} = request;
        return digest(canonicalJson(meaning));
    }
    const {revert, withDependents, requestId, by, title} = request;
    return digest(canonicalJson({revert, withDependents, requestId, by, ...(title === undefined ? {} : {title})}));
}

/** 一条决策里授权管的那些键（出现了的，不论这次改没改）组成的对象，取规范的 JSON 再取摘要；决策不存在时是空对象。 */
export function fieldsDigest(decision: Decision | null | undefined, digest: (text: string) => string): string {
    const picked: Record<string, unknown> = {};
    if (decision !== null && decision !== undefined) {
        for (const key of AUTHORIZED_KEYS) if (decision[key] !== undefined) picked[key] = decision[key];
    }
    return digest(canonicalJson(picked));
}

/**
 * 一项授权的 `binds`。写入请求的 `fields` 按请求里这条决策（`decision` 是请求里写的 id，新建的是临时 id）原样算；
 * 还原请求的 `fields` 由本能力按补偿后的值算好，经预览或 `author-source-required` 给出，调用方照抄进来。
 */
export function authorizationBinds(
    input: {readonly project: string; readonly request: WriteRequest | RevertRequest; readonly decision: string; readonly transition: Transition; readonly fields?: string},
    digest: (text: string) => string,
): Binds {
    let fields = input.fields;
    if (fields === undefined) {
        if (!("puts" in input.request)) throw new Error("a revert authorization needs the fields digest the preview gave");
        const put = input.request.puts.find((candidate) => candidate.ref.kind === "decision" && candidate.ref.id === input.decision);
        fields = fieldsDigest((put?.after ?? null) as Decision | null, digest);
    }
    return {project: input.project, requestId: input.request.requestId, request: requestDigest(input.request, digest), decision: input.decision, transition: input.transition, fields};
}

/** 签名覆盖的内容：来源去掉 `signature` 以后的规范 JSON（宿主签发与校验都按它）。 */
export function signedContent(source: Omit<AuthorSource, "signature"> | AuthorSource): string {
    const {signature: _signature, ...rest} = source as AuthorSource;
    return canonicalJson(rest);
}

export type AuthorizationProblem =
    | {readonly code: "author-source-invalid"; readonly decision: string; readonly transition: string; readonly reason: "binds-mismatch" | "signature" | "no-verifier" | "authorization-unused" | "authorization-duplicate"}
    | {readonly code: "author-source-required"; readonly needed: NeededAuthorization};

/**
 * 按需要的清单核对请求带的授权：每项需要的找同一决策、同一转换的那项授权，逐字比 `binds`，再交给宿主验签名；用不上的、
 * 重复的都不通过。返回接受了的授权（按需要的决策）与问题。
 */
export function checkAuthorizations(
    needed: readonly NeededAuthorization[],
    given: readonly {readonly decision: string; readonly transition: string; readonly source: AuthorSource}[],
    expected: (item: NeededAuthorization) => Binds,
    verify: ((source: AuthorSource) => boolean) | undefined,
): {readonly accepted: ReadonlyMap<string, AuthorSource>; readonly problems: readonly AuthorizationProblem[]} {
    const problems: AuthorizationProblem[] = [];
    const accepted = new Map<string, AuthorSource>();
    const seen = new Set<string>();
    for (const item of given) {
        const key = `${item.decision}\u0000${item.transition}`;
        if (seen.has(key)) problems.push({code: "author-source-invalid", decision: item.decision, transition: item.transition, reason: "authorization-duplicate"});
        seen.add(key);
        if (!needed.some((candidate) => candidate.decision === item.decision && candidate.transition === item.transition)) {
            problems.push({code: "author-source-invalid", decision: item.decision, transition: item.transition, reason: "authorization-unused"});
        }
    }
    for (const item of needed) {
        const authorization = given.find((candidate) => candidate.decision === item.decision && candidate.transition === item.transition);
        if (authorization === undefined) {
            problems.push({code: "author-source-required", needed: item});
            continue;
        }
        if (canonicalJson(authorization.source.binds) !== canonicalJson(expected(item))) {
            problems.push({code: "author-source-invalid", decision: item.decision, transition: item.transition, reason: "binds-mismatch"});
            continue;
        }
        if (verify === undefined) {
            problems.push({code: "author-source-invalid", decision: item.decision, transition: item.transition, reason: "no-verifier"});
            continue;
        }
        if (!verify(authorization.source)) {
            problems.push({code: "author-source-invalid", decision: item.decision, transition: item.transition, reason: "signature"});
            continue;
        }
        accepted.set(item.decision, authorization.source);
    }
    return {accepted, problems};
}

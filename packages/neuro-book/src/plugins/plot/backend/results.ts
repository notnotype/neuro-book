/**
 * 剧情插件项目入口的几个远程合同共用的结果写法：失败的形状、单次预算、列表的一页、缺省的读取位置、按读取位置取那条线的视图。
 */

import {createHash} from "node:crypto";

import {pageOf} from "@notnotype/nb-canon/node";
import type {CanonReadView, Mode, ReadPosition} from "@notnotype/nb-canon/schema";

import {CANON_BUDGET_BYTES, encodedBytes} from "nbook/plugins/canon/shared/contracts";

export type Failure = {readonly ok: false; readonly code: "plot"; readonly detail: {readonly code: string}};
export const fail = (code: string): Failure => ({ok: false, code: "plot", detail: {code}});

export type Ok<T> = {readonly ok: true; readonly value: T};
export const digest = (text: string) => createHash("sha256").update(text).digest("hex");

/** 单个结果：编码后超过单次预算回 `too-large`（canon.project 输出 18）。 */
export function fitted<T>(value: T): Ok<T> | Failure {
    return encodedBytes(value) > CANON_BUDGET_BYTES ? fail("too-large") : {ok: true, value};
}

/**
 * 列表的一页（canon.project 输出 18，与 canon 的列表同一套游标）：按调用方给的条数（缺省 50）取，编码后超过预算就把条数减半
 * 重取，单条都装不下才回 `too-large`。`extra` 是每页都带的那几项（例如没记参与者的条数）。
 */
export function pagedList<T>(view: CanonReadView, items: readonly T[], input: {readonly cursor?: string; readonly limit?: number}, params: {readonly method: string} & Readonly<Record<string, unknown>>, extra: Readonly<Record<string, unknown>> = {}): Ok<unknown> | Failure {
    let size = input.limit ?? 50;
    for (;;) {
        const page = pageOf(view.stamp, items, input.cursor, size, params, digest);
        if (page === "cursor-stale") return fail("cursor-stale");
        const value = {version: view.version, inputDigest: view.stamp.inputDigest, ...extra, items: page.items, ...(page.next === undefined ? {} : {cursor: page.next})};
        if (encodedBytes(value) <= CANON_BUDGET_BYTES) return {ok: true, value};
        if (size === 1) return fail("too-large");
        size = Math.max(1, Math.floor(size / 2));
    }
}

/** 缺省的读取位置：最新一章的末尾，没有章时是初值（canon.model 输出 21）。 */
export function latest(view: CanonReadView): ReadPosition {
    const last = view.chapters.at(-1);
    return last === undefined ? {kind: "initial"} : {kind: "chapter", chapter: last, edge: "end"};
}

/** 读取位置那条线的视图（worldlines 输出 12）：位置写了线用写的，不写按活页夹那一章讲的线。线读不到（不存在、实际模式下的计划线、不可建）是 `line-not-found`。 */
export function lineViewOf(view: CanonReadView, position: ReadPosition, mode: Mode): CanonReadView | Failure {
    const line = view.positionLine(position, mode);
    if (line === view.line) return view;
    const found = view.onLine(line, mode);
    return "code" in found ? fail(found.code) : found;
}

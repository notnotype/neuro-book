/**
 * 两种世界场地共跑的契约场景：项目子进程的场地（`harness.ts`，`bun test`）与进程内的场地（`node-world.ts`，Vitest）
 * 在同一个场景下观察到的应当一样（订阅、独占、断开后的失败码）。这里只走场景、收集观察，断言写在两边的测试文件里，
 * 对同一份期望；进程内的场地哪天和真实子进程走得不一样，两边会一边绿一边红。
 */

import type {Entry, WriteRequest} from "@notnotype/nb-canon";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import type {CanonClient, CanonEvent} from "../shared/contracts";

export interface VenueWindow {
    readonly canon: CanonClient;
    disconnect(): void;
    close(): Promise<void>;
}

export interface Venue {
    window(id: string): Promise<VenueWindow>;
}

export interface VenueObservations {
    /** 别的窗口发布以后，订阅的窗口收到的 `changed` 带的版本与发布结果的版本一致。 */
    readonly changedMatchesPublish: boolean;
    /** 独占期间别的窗口写入得到的失败码。 */
    readonly writeWhileHeld: string | null;
    /** 持有窗口的链路断开后，独占随之结束、别的窗口能写入。 */
    readonly writeAfterHolderGone: boolean;
    /** 断开链路的窗口再调用得到的失败码。 */
    readonly callAfterDisconnect: string | null;
}

let sequence = 0;
function person(name: string, baseVersion: number): WriteRequest {
    const id = `tmp:venue-${String(++sequence)}`;
    const entry: Entry = {id, type: "nbook.canon.person", parent: null, folder: "", order: 0, init: {name, aliases: [], summary: "", text: [], data: {character: {type: "nbook.canon.person", version: 1, enabled: true, fields: {性格: null, 身份: null, 现在的状态: null}}}}};
    return {requestId: `venue-${String(sequence)}`, by: {kind: "author"}, what: "edit", title: name, baseVersion, puts: [{ref: {kind: "entry", id}, after: entry}]};
}

async function versionOf(canon: CanonClient): Promise<number> {
    const status = await canon.call("status", {});
    if (!status.ok) throw new Error(`读状态失败：${JSON.stringify(status.failure)}`);
    return status.value.version;
}

const codeOf = (result: {readonly ok: boolean; readonly failure?: {readonly code: string}}): string | null => (result.ok ? null : (result.failure?.code ?? null));

/** 场地里的世界要已经打开（`status` 能读）。场景结束时关掉两个窗口。 */
export async function venueScenario(venue: Venue): Promise<VenueObservations> {
    const author = await venue.window("venue-author");
    const task = await venue.window("venue-task");
    const seen: CanonEvent[] = [];
    const subscribed = await author.canon.subscribe((event) => seen.push(event));
    if (!subscribed.ok) throw new Error(`订阅失败：${JSON.stringify(subscribed.failure)}`);

    const first = await task.canon.publish(person("星瑾", await versionOf(task.canon)));
    if (!first.ok) throw new Error(`发布失败：${JSON.stringify(first.failure)}`);
    const changed = await waitUntil("订阅的窗口收到这次发布", () => seen.find((event): event is Extract<CanonEvent, {kind: "changed"}> => event.kind === "changed"), {timeoutMs: 10_000});
    const changedMatchesPublish = changed.version === first.value.version;

    const held = await task.canon.hold("第 5 章记账");
    if (!held.ok) throw new Error(`拿独占失败：${JSON.stringify(held.failure)}`);
    const writeWhileHeld = codeOf(await author.canon.publish(person("白灵", await versionOf(author.canon))));

    task.disconnect();
    await waitUntil("独占随持有窗口的链路结束", () => seen.some((event) => event.kind === "exclusive" && event.holder === null), {timeoutMs: 10_000});
    const writeAfterHolderGone = (await author.canon.publish(person("彗", await versionOf(author.canon)))).ok;
    const callAfterDisconnect = codeOf(await task.canon.call("status", {}));

    subscribed.value.release();
    await task.close();
    await author.close();
    return {changedMatchesPublish, writeWhileHeld, writeAfterHolderGone, callAfterDisconnect};
}

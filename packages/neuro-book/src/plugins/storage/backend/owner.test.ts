/**
 * 分区拥有者关闭（docs/specs/storage/persistence.md 的“时序与寿命”）。经真实内核停止时，调用方入口先于
 * `nbook.storage` 停止，它们的订阅已随服务对象释放结束；拥有者关闭时还留着本地订阅的情形只能在拥有者这一层直接
 * 构造，库仍是真实临时目录上的 SQLite。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {existsSync} from "node:fs";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import type {ConsumerIdentity} from "@notnotype/nb-runtime/services";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {Type} from "typebox";

import {defineRecord} from "nbook/shared/storage";

import type {RecordRequest} from "../shared/facade";
import {createPartitionOwner} from "./owner";
import {createPartition} from "./partition";

const notes = defineRecord({key: "notes", scope: "user", locality: "shared", version: 1, schema: Type.Object({text: Type.String()}, {additionalProperties: false})});
const consumer: ConsumerIdentity = {instanceId: "hub", location: "server", client: null, plugin: "app.notes", entry: "server", generation: 1, via: null};
const request: RecordRequest = {descriptor: notes.descriptor, resource: ""};

let tmp = "";

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-storage", "owner");
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

describe("Spec storage.persistence 时序与寿命：分区拥有者关闭", () => {
    it("一条本地订阅的 onEnd 抛错：其余订阅照样以 provider-stopped 结束，库照样关闭；关闭抛出这个错误", async () => {
        const path = join(tmp, "storage", "user.sqlite");
        const owner = createPartitionOwner(createPartition({path}), "user", () => undefined);
        const route = owner.route(consumer);
        expect(await route.open(request)).toEqual({ok: true});
        const ended: string[] = [];
        await route.subscribe(request, () => undefined, () => {
            throw new Error("结束回调抛错");
        });
        await route.subscribe(request, () => undefined, (reason) => ended.push(reason));
        expect(await route.write(request, {kind: "save", value: {text: "x"}, expect: null})).toMatchObject({ok: true});
        expect(existsSync(`${path}-wal`)).toBe(true);

        expect(() => owner.close()).toThrow("结束回调抛错");
        expect(ended).toEqual(["provider-stopped"]);
        expect(existsSync(`${path}-wal`)).toBe(false);
        expect(await route.read(request)).toMatchObject({status: "error", code: "unavailable"});
    });
});

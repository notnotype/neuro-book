/** 连接判定表（docs/specs/runtime/desktop-shell.md 输出 4）。 */

import {describe, expect, it} from "bun:test";

import type {InstanceInfo} from "../server/instance";
import {decideConnection} from "./connect";

const instance = (patch: Partial<InstanceInfo>): InstanceInfo => ({schema: 1, pid: 42, version: "1.0.0", kind: "product", status: "ready", url: "http://127.0.0.1:4217/", rpcUrl: "ws://127.0.0.1:4218/rpc", plugins: null, ...patch});

describe("连接判定", () => {
    it("没有实例拉起；同版本就绪的产品实例连它；启动中、停止中等它", () => {
        expect(decideConnection({state: "none"}, "1.0.0")).toEqual({kind: "spawn"});
        expect(decideConnection({state: "running", instance: instance({})}, "1.0.0")).toMatchObject({kind: "connect", url: "http://127.0.0.1:4217/"});
        expect(decideConnection({state: "running", instance: instance({status: "starting", url: null})}, "1.0.0")).toMatchObject({kind: "wait", status: "starting"});
        expect(decideConnection({state: "running", instance: instance({status: "stopping"})}, "1.0.0")).toMatchObject({kind: "wait", status: "stopping"});
    });

    it("版本不同、开发实例、没有应答：都不碰它，说明原因", () => {
        expect(decideConnection({state: "running", instance: instance({version: "0.9.0"})}, "1.0.0")).toMatchObject({kind: "refuse", reason: "version-mismatch", running: "0.9.0", installed: "1.0.0"});
        expect(decideConnection({state: "running", instance: instance({kind: "development", url: null})}, "1.0.0")).toMatchObject({kind: "refuse", reason: "not-product"});
        expect(decideConnection({state: "unresponsive", detail: "没有应答"}, "1.0.0")).toEqual({kind: "refuse", reason: "unresponsive", detail: "没有应答"});
    });
});

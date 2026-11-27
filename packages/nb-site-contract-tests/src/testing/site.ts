/**
 * 合同测试用的沙箱入口：底座本身（起进程、请求、收口）在 `./process`，它不依赖测试运行器；这里只把它的收口挂到 `bun:test`
 * 的钩子上。合同测试从这里导入，其余名字原样转出。
 */

import {afterAll, afterEach, beforeAll, beforeEach} from "bun:test";

import {createSiteSandbox, type SiteSandbox} from "./process";

export * from "./process";

/**
 * 在当前测试文件里登记收口用的钩子，返回沙箱。在文件顶层调用一次：钩子登记在调用处所在的作用域。
 * `purpose` 写进临时根的 owner 标记，传测试文件名。`beforeAll` 里起的进程属于整个文件，在 `afterAll` 里停掉；用例里起的在
 * 这个用例的 `afterEach` 里停掉。
 */
export function useSiteSandbox(purpose: string): SiteSandbox {
    const sandbox = createSiteSandbox(purpose);
    beforeAll(sandbox.open);
    beforeEach(sandbox.beginTest);
    afterEach(sandbox.endTest);
    afterAll(sandbox.close);
    return sandbox;
}

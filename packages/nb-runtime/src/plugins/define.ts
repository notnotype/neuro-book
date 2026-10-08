/**
 * `defineEntry`：在编译期核对入口的激活产出与静态声明一致（runtime.plugins 输入与前置条件、验收 28）。运行期原样
 * 返回入口，输出阶段的核对照常进行。
 *
 * 核对的是类型能区分的部分：`services` 按 `provides` 的顺序一一对应且服务类型相符，`remote` 按 `remoteProvides`
 * 的顺序一一对应且合同形状相符，`receivers` 的键恰好是 `receives`，`contributions` 下每个贡献点的键恰好是本入口
 * 声明的贡献 id，没有声明的一类不能出现。服务键与合同的 id 在类型上都是 `string`，两个同类型的键分不出来，
 * 仍由激活时的产出核对报出。
 *
 * 按运行位置分支的入口要在整个产出上分支（`browser ? {...base, remote: [提供项]} : base`）：在各字段里分别写
 * `browser ? [提供项] : []` 时，声明与产出是两个互不对应的联合，类型对不上。辅助函数返回提供项时写出带参数的
 * 类型（`RemoteProvision<typeof 合同>`），返回宽类型会擦掉要核对的参数。
 */

import type {RemoteContract, RemoteProvision} from "../remote/remote";
import type {ServiceKey} from "../services/services";

import type {ActivationContext, ContributionDeclaration, ContributionReceiver, PluginEntryDefinition, ProvidedService} from "./contracts";

type ProvidedServices<Keys extends ReadonlyArray<ServiceKey<unknown>>> = {
    readonly [Index in keyof Keys]: Keys[Index] extends ServiceKey<infer T> ? ProvidedService<T> : never;
};

type RemoteProvisions<Contracts extends ReadonlyArray<RemoteContract>> = {
    readonly [Index in keyof Contracts]: Contracts[Index] extends RemoteContract ? RemoteProvision<Contracts[Index]> : never;
};

type Receivers<Points extends ReadonlyArray<string>> = {readonly [Point in Points[number]]: ContributionReceiver};

/** 声明来自宽类型（贡献点是 `string`）时分不出各点下的 id，只要求是字符串键。 */
type IdsAt<Declared extends ReadonlyArray<ContributionDeclaration>, Point> = string extends Declared[number]["capability"]
    ? string
    : Extract<Declared[number], {readonly capability: Point}>["id"];

type Implementations<Declared extends ReadonlyArray<ContributionDeclaration>> = {
    readonly [Point in Declared[number]["capability"]]: {readonly [Id in IdsAt<Declared, Point>]: unknown};
};

/** 声明要求的产出。声明是空元组时那一类不能出现；`NoInfer` 防止从产出反推声明，使核对落空。 */
type ExpectedOutput<
    Provides extends ReadonlyArray<ServiceKey<unknown>>,
    Remote extends ReadonlyArray<RemoteContract>,
    Receives extends ReadonlyArray<string>,
    Contributions extends ReadonlyArray<ContributionDeclaration>,
> = (Provides extends readonly [] ? {readonly services?: undefined} : {readonly services: NoInfer<ProvidedServices<Provides>>})
    & (Remote extends readonly [] ? {readonly remote?: undefined} : {readonly remote: NoInfer<RemoteProvisions<Remote>>})
    & (Receives extends readonly [] ? {readonly receivers?: undefined} : {readonly receivers: NoInfer<Receivers<Receives>>})
    & (Contributions extends readonly [] ? {readonly contributions?: undefined} : {readonly contributions: NoInfer<Implementations<Contributions>>});

/**
 * 实际产出里多写的接收者与贡献实现。约束只要求声明的键都在，多出来的键要另外从实际产出里找：赋值给对象类型时
 * TypeScript 不报多余属性。
 */
type ExtraKeys<Output, Receives extends ReadonlyArray<string>, Contributions extends ReadonlyArray<ContributionDeclaration>> =
    | (Output extends {readonly receivers: infer Actual} ? `多写的接收者：${Exclude<keyof Actual, Receives[number] | symbol | number>}` : never)
    | (Output extends {readonly contributions: infer Actual}
        ? {
            [Point in keyof Actual & string]: Point extends Contributions[number]["capability"]
                ? `多写的贡献实现：${Point}/${Exclude<keyof Actual[Point], IdsAt<Contributions, Point> | symbol | number>}`
                : `多写的贡献点：${Point}`;
        }[keyof Actual & string]
        : never);

/** 有多写的键时要求入口上有一个以问题命名的属性，报错因此写成“缺少属性 多写的接收者：x”。 */
type NoExtraKeys<Output, Receives extends ReadonlyArray<string>, Contributions extends ReadonlyArray<ContributionDeclaration>> =
    [ExtraKeys<Output, Receives, Contributions>] extends [never] ? unknown : {readonly [Problem in ExtraKeys<Output, Receives, Contributions>]: never};

type TypedEntryDefinition<
    Provides extends ReadonlyArray<ServiceKey<unknown>>,
    Remote extends ReadonlyArray<RemoteContract>,
    Receives extends ReadonlyArray<string>,
    Contributions extends ReadonlyArray<ContributionDeclaration>,
    Output,
> = Omit<PluginEntryDefinition, "provides" | "remoteProvides" | "receives" | "contributions" | "activate"> & {
    readonly provides?: Provides;
    readonly remoteProvides?: Remote;
    readonly receives?: Receives;
    readonly contributions?: Contributions;
    activate(context: ActivationContext): Output | Promise<Output>;
};

/**
 * 定义一个入口，编译期核对激活产出与声明一致。产出单独推导（`const`，字面量数组按元组推导，不用写 `as const`），
 * 以声明要求的产出为约束；多写的键另行核对。
 */
export function defineEntry<
    const Provides extends ReadonlyArray<ServiceKey<unknown>> = readonly [],
    const Remote extends ReadonlyArray<RemoteContract> = readonly [],
    const Receives extends ReadonlyArray<string> = readonly [],
    const Contributions extends ReadonlyArray<ContributionDeclaration> = readonly [],
    const Output extends ExpectedOutput<Provides, Remote, Receives, Contributions> = ExpectedOutput<Provides, Remote, Receives, Contributions>,
>(
    entry: TypedEntryDefinition<Provides, Remote, Receives, Contributions, Output> & NoExtraKeys<Output, NoInfer<Receives>, NoInfer<Contributions>>,
): PluginEntryDefinition {
    return entry;
}

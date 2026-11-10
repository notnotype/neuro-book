/**
 * 宿主套件的工具交给宿主的形状。宿主补 id、`provider` 与给模型的名字，再按自己的贡献机制交给内核。
 */

import type {ToolEffect, ToolImplementation, ToolSessionContext} from "../../kernel/contracts.js";
import type {KitServices} from "../files/index.js";
import type {ToolSubject} from "../shapes.js";

/** 声明里序列化得了的部分。字段的先后与宿主原来的声明一致：声明进 Profile 哈希与会话快照。 */
export interface KitToolDeclaration {
    readonly description: string;
    readonly parameters: Readonly<Record<string, unknown>>;
    readonly customFormat?: {readonly syntax: "lark"; readonly definition: string};
    readonly version: string;
    readonly concurrency: "shared" | "exclusive";
    readonly effect: ToolEffect;
}

/** 工具的实现：`create` 按会话建一次，`effect` 给按参数求等级的工具，`subjects` 给审批规则看的东西。 */
export interface KitToolImplementation {
    create(context: ToolSessionContext, services: KitServices): ToolImplementation;
    effect?(args: Readonly<Record<string, unknown>>): ToolEffect;
    subjects?(args: Readonly<Record<string, unknown>>): readonly ToolSubject[];
}

/** 工具说明里属于宿主的事实（地址的例子、工作目录、全文存哪里），宿主给，kit 不给缺省值。 */
export interface BuiltinToolTexts {
    /** `read`、`write` 的 `path` 参数说明（例如“资源地址，例如 project://正文/第一章.md、session://plan.md”）。 */
    readonly pathParameter: string;
    /** `edit` 两种写法的说明末尾的一段（地址怎么写、能改什么）。 */
    readonly editNote: string;
}

/**
 * 场景登记的入口单独放一个模块：分组登记（`nb-ui/`、`nb-layout/`、`nb-agent-ui/`）与草稿区（`../drafts/`）的各个
 * `fixtures.ts` 都要用它，而总登记表（`./index.ts`）又要汇入它们；入口放在总登记表里会成一圈运行时导入，测试环境里
 * 先求值的分组拿不到它。这里只引类型，不引总登记表的值。
 */
import type {LabSubjectProps} from "../lab-subject";
import type {LabFixture, LabFixtureDefinition} from "./index";

/** 唯一的类型化 fixture 登记入口；运行时只返回登记对象，不加载组件或推导签名。 */
export function defineLabFixture<C = never>(
    definition: [C] extends [never] ? never : [LabSubjectProps<C>] extends [never] ? never : LabFixtureDefinition<C>,
): LabFixture {
    // 类型检查发生在入口参数；消费方需要的宽化 registry 类型在此处擦除一次。
    return definition as unknown as LabFixture;
}

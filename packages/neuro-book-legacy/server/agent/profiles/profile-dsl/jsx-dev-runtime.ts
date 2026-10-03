export {Fragment, jsx, jsxs} from "nbook/server/agent/profiles/profile-dsl/jsx-runtime";
import {jsx} from "nbook/server/agent/profiles/profile-dsl/jsx-runtime";
import type {ProfileDslNode} from "nbook/server/agent/profiles/profile-dsl";

type Props = Record<string, unknown>;

/**
 * TSX dev runtime 入口。开发模式下编译器会导入 jsxDEV。
 */
export function jsxDEV(type: Parameters<typeof jsx>[0], props: Props, _key?: string): ProfileDslNode {
    return jsx(type, props);
}

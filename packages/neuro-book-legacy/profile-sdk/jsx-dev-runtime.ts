import {Fragment, jsx, jsxs} from "nbook/profile-sdk/jsx-runtime";
import type {ProfileDslNode} from "nbook/profile-sdk/contracts";

type Props = {[key: string]: unknown};

export {Fragment, jsx, jsxs};

/** TSX development runtime 入口。 */
export function jsxDEV(type: Parameters<typeof jsx>[0], props: Props, _key?: string): ProfileDslNode {
    return jsx(type, props);
}

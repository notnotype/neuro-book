/** 打进夹具页的引擎：测试在页面里经 `window.nbPageAgent` 建引擎。 */

import {createPageAgent} from "../src/index";

Object.assign(globalThis, {nbPageAgent: {createPageAgent}});

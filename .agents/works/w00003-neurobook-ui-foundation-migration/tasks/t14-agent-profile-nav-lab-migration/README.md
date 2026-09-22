---
schema: nbook.task/v2
taskId: t14-agent-profile-nav-lab-migration
---

# 鍗忎綔璇曡縼绉� Agent Profile 瀵艰埅

## 鐩�鏍�

鐢卞紑鍙戣�呬笌 Agent 涓�璧锋妸鐪熷疄璁剧疆鐣岄潰鐨� `AgentProfileNavList` 鍘熷湴閲嶅啓鎴愭柊涓婚�樹綋绯讳笅鍙�鍦� Component Lab 纭�瀹氭�ч獙璇佺殑棰嗗煙缁勪欢锛屽苟瀹屾暣璁板綍浠庢棫涓诲簲鐢ㄧ粍浠跺埌 Lab-ready replacement 鐨勬�ラ�ゃ�佸け璐ャ�佸彇鑸嶅拰鍙�澶嶇敤缁忛獙銆傝繖涓�鏍锋湰鐢ㄤ簬鍐冲畾鍚庣画鑷�涓昏縼绉诲�備綍鎷嗘壒锛屼笉浠ｈ〃璁剧疆鐣岄潰鏁翠綋杩佺Щ锛屼篃涓嶆妸浜у搧涓婚〉鎭㈠�嶄綔涓烘湰 Task 鐨勫畬鎴愭潯浠躲��

鏈� Task 鍒嗘垚涓や釜瀹屾垚灞傛�★細

- **鏈� Task 蹇呴』瀹屾垚鐨� Lab-ready**锛氬悓鍚嶆枃妗ｃ�佺‘瀹氭�� fixture銆侀�嗗煙鐘舵�併�佸彈鎺т簨浠躲�侀敭鐩�/鐒︾偣/ARIA銆佹�岄潰鍜� `390 脳 844` 鍧囨湁璇佹嵁銆�
- **鍚庣画 Task 鎵嶅畬鎴愮殑 Product-ready**锛欳 浜у搧涓婚�� clean cutover 鍚庨獙璇佺湡瀹炶�剧疆椤点�佹仮澶嶅叏灞�闂ㄧ�侊紝骞舵竻鐞嗗墿浣欐棫涓婚�樻垨鏃у熀纭�缁勪欢鍏ュ彛銆�

## 褰撳墠鍩虹嚎

### 缁勪欢涓庢秷璐硅��

- 瀹炵幇锛歚packages/neuro-book/app/components/novel-ide/settings/AgentProfileNavList.vue`锛屽綋鍓嶇害 127 琛屻��
- 鍞�涓�杩愯�屾椂娑堣垂鑰咃細鍚岀洰褰� `NovelIdeAgentProfileModelSettingsPanel.vue`銆�
- 褰撳墠鍏�寮�杈撳叆锛歚items`銆乣activeKey`銆乣search`銆乣defaultsDirty`锛涘綋鍓嶅叕寮�杈撳嚭锛歚update:activeKey`銆乣update:search`锛涙病鏈� slot 鎴� expose銆�
- `activeKey === ""` 琛ㄧず榛樿�よ�剧疆椤点�傜埗缁勪欢璐熻矗鍦� Profile 娑堝け鏃舵妸鏈�鐭� key 绾犳�ｅ洖绌轰覆锛涘�艰埅缁勪欢涓嶆嫢鏈夎�ョ姸鎬併��
- 鐖剁粍浠舵寜 `profileKey` 鎺掑簭鍚庢瀯閫� `items`銆俙overrideCount` 鏄�妯″瀷銆佽繍琛岀瓥鐣ュ拰 Profile 璁剧疆瑕嗙洊鏁颁箣鍜岋紱`dirty` 鏄�褰撳墠鑽夌�夸笌淇濆瓨蹇�鐓х殑姣旇緝缁撴灉锛沗isDefault` 鐢卞綋鍓嶇敓鏁堥粯璁� Profile 鎺ㄥ�笺��
- `status` 鐨勫皝闂�闆嗗悎鏉ヨ嚜 `ConfigAgentProfileLoadStatusDtoSchema`锛歚loaded`銆乣compiling`銆乣compile_failed`銆乣not_compiled`銆乣compile_stale`銆乣compiled_load_failed`銆乣source_error`銆�

### 宸茬煡杩佺Щ缂哄彛

- 鎼滅储渚濊禆涓诲簲鐢ㄦ棫 `components/common/form/FormInput.vue`锛岃�屼笉鏄� nb-ui 琛ㄥ崟鍏ュ彛銆�
- 鍒楄〃鏄�鏅�閫氭寜閽�闆嗗悎锛屼絾娌℃湁鍙�鍛藉悕鐨勫�艰埅 landmark锛屽綋鍓嶉」涔熸病鏈� `aria-current`銆�
- 缂栬瘧鐘舵�佷富瑕佷緷璧� 6px 鑹茬偣鍜� `title`锛沝irty 涔熶富瑕佷緷璧栬壊鐐癸紝榛樿�� Profile 涓昏�佷緷璧栨槦褰㈠浘鏍囥�傜姸鎬佸�硅Е灞忋�侀敭鐩樺拰鑹茶�夊樊寮傜敤鎴蜂笉澶熸槑纭�銆�
- 褰撳墠椤逛富瑕佷緷璧栭�滆壊銆侀槾褰卞拰宸︿晶鎸囩ず鏉★紱娌℃湁鐙�绔嬩簬棰滆壊鐨勬寔缁�鍙�瑙侀�夋嫨鏍囪�般��
- `rounded-2xl`銆乣duration-300`銆乣transition-all` 鍜屾棫浜у搧鍙橀噺涓嶇�﹀悎 nb-ui 璇�涔� token 涓庡姩鏁堝悎鍚屻��
- 鐜版湁鑱氱劍娴嬭瘯鍙�璇诲彇婧愮爜瀛楃�︿覆锛屾柇瑷�瀛樺湪 `overflow-y-auto` 涓斾笉瀛樺湪 `90vh`锛涘畠涓嶈兘璇佹槑鐪熷疄婊氬姩銆佸浐瀹氭悳绱㈠叆鍙ｃ�佺劍鐐规垨绐勫睆鏃犳孩鍑恒��
- LSP 鍦ㄥ綋鍓嶇幆澧冧笉鍙�鐢�锛屽紩鐢ㄦ煡璇㈣繑鍥� `No language server found for this action`锛涙湰杞�鍩虹嚎閫氳繃绮剧‘鏂囨湰鎼滅储纭�璁ゅ敮涓�娑堣垂鑰呫�傚疄鐜伴樁娈佃嫢 LSP 鎭㈠�嶏紝浠嶉』鍏堥噸鏂版墽琛� references銆�

## 宸插畾杈圭晫

### 鎵�鏈夋潈涓� replacement 褰㈠紡

- `AgentProfileNavList` 淇濈暀鍦� NeuroBook `novel-ide/settings` 棰嗗煙灞傘�侾rofile load status銆侀粯璁� Profile銆佽�嗙洊璁℃暟鍜� dirty 閮芥槸 NeuroBook 棰嗗煙璇�涔夛紝涓嶄笅娌夊埌 nb-ui銆�
- 鍘熷湴閲嶅啓鐜版湁 `AgentProfileNavList.vue`锛屼笉鍒涘缓 `Next`銆乣V2`銆乤lias 鎴栧苟琛屾棫鍏ュ彛銆傚綋鍓嶇埗缁勪欢鍥犺矾寰勪笉鍙樹細鐩存帴娑堣垂 replacement锛涙湰 Task 涓嶅彟澶栨敼涓婚〉缂栨帓锛屼篃涓嶆妸涓婚〉鍙�鐢ㄦ�у啓鎴� Lab-ready 閫氳繃銆�
- 鏂板�炲悓鐩�褰� `AgentProfileNavList.types.ts` 鎸佹湁 `AgentProfileNavItem` 涓� load-status 绫诲瀷锛涚埗缁勪欢鍙�鎶婄幇鏈� SFC type import 鏀逛负璇ユ枃浠剁殑 type-only import锛岃繍琛屾椂鎺ョ嚎涓庢暟鎹�鏋勯�犱笉鍙樸�俧ixture 涓庢祴璇曞�嶇敤鍚屼竴棰嗗煙绫诲瀷锛屼笉浠� SFC 瀵煎嚭绗�浜屼唤鍚堝悓銆�
- 鍚屽悕鏂囨。鍥哄畾鏀惧湪 `AgentProfileNavList.vue` 鍚岀洰褰曪紝鏂囦欢鍚嶄负 `AgentProfileNavList.md`銆傝繖鏄� `component-index.ts` 鑳借嚜鍔ㄧ撼鍏� Lab 瀵艰埅鐨勫敮涓�姝ｇ‘浣嶇疆锛屼笉缁存姢绗�浜屼唤缁勪欢娓呭崟銆�

### 鍏�鍏辩粍浠跺彇鑸�

- 鎼滅储妗嗗�嶇敤 `@notnotype/nb-ui/components` 鐨� `FormInput`锛屼娇鐢� `type="search"`銆乣size="sm"` 鍜屽浘鏍囪兘鍔涳紱**涓嶅惎鐢� `clearable`**銆傛悳绱㈡�嗘彁渚涗笌鍘熺敓 input 鍏宠仈鐨勫彲瑙� label锛屼笉鎶� placeholder 褰撲綔鍞�涓�鍙�璁块棶鍚嶇О锛屽洜姝ゆ竻绌洪�氳繃缂栬緫璇� input 瀹屾垚锛屼笉澧炲姞棰濆�� Tab 鍋滈潬鐐癸紝涔熶笉寮曞叆鈥滄竻绌哄悗鐒︾偣褰掕繕 input鈥濈殑鏂板疄鐜板悎鍚屻��
- 鐘舵�佸厓鏁版嵁浼樺厛澶嶇敤 nb-ui `Badge`銆俙Listbox` 鍙�鏈夊浐瀹氶�夐」缁撴瀯鍜屽崟 badge锛屾棤娉曟棤鎹熻〃杈� load status銆侀粯璁ゃ�乨irty銆佽�嗙洊璁℃暟鍥涚被骞惰�岄�嗗煙鐘舵�侊紱涓嶄负鍗曚釜棰嗗煙缁勪欢鎵╁睍鍏�鍏卞�氭彃妲� API銆�
- 绌烘�佷繚鎸侀�嗗煙缁勪欢鍐呯殑绱у噾鏂囨湰鍧椼�俷b-ui `EmptyState` 闈㈠悜鍐呭�瑰尯鍩燂紝鏀惧叆 240px 瀵艰埅浼氬紩鍏ヤ笉蹇呰�佺殑鏍囬�樸�佸浘鏍囧拰鐣欑櫧銆�
- 鍒楄〃缁х画浣跨敤鍘熺敓绾靛悜婊氬姩瀹瑰櫒鍜屽叏灞�缁嗘粴鍔ㄦ潯鏍峰紡锛屼笉寮曞叆 `ScrollArea`銆傚浐瀹氭悳绱�涓庨粯璁ゅ叆鍙ｃ�佸垪琛ㄧ嫭绔嬫粴鍔ㄧ敱鐪熷疄 Lab smoke 楠岃瘉锛屼笉鍐嶈�╂簮鐮� class 瀛楃�︿覆鍏呭綋琛屼负璇佹嵁銆�

### 闅愯棌閫氶亾涓庝富棰�

- 缁勪欢缁х画浣跨敤搴旂敤 i18n provider锛屾枃妗ｅ�傚疄澹版槑 `鏍囩��: [state:inject]`锛屽苟璇存槑鍙�娉ㄥ叆缈昏瘧鑳藉姏銆傚畠涓嶈�� store銆佽矾鐢便�佹祻瑙堝櫒瀛樺偍銆丄PI 鎴栦骇鍝佹暟鎹�锛屽洜姝ゆ棤闇�鐘舵�佸揩鐓т笖鍙�浠ュ湪 Lab 纭�瀹氭�ф寕杞姐��
- 涓嶅�炲姞 `isLab`銆佽矾鐢卞垽鏂�銆佹棫涓婚�� fallback 鎴栧�夸富鏉′欢鍒嗘敮銆傜粍浠跺彧娑堣垂 nb-ui 宸茬櫥璁扮殑鏂囧瓧銆佽〃闈�銆佸垎闅斻�佸己璋冦�佺姸鎬併�佸渾瑙掋�侀棿璺濄�佺劍鐐瑰拰鍔ㄦ晥璇�涔� token銆�
- 涓嶅湪鏈� Task 淇�鏀� `docs/specs/theme/system.md`銆�8 濂楁棫浜у搧涓婚�樸�丟lobal Config銆侀�栧抚涓婚�樻垨娴�灞傚�夸富锛涜繖浜涗粛灞炰簬鍚庣画 C銆�

### 鎼滅储涓庨�夋嫨琛ュ厖绾︽潫

- 缁勪欢涓嶅惎鐢� nb-ui `FormInput` 鐨� `clearable`锛涘洜姝� Tab 搴忓垪涓嶅寘鍚�棰濆�栨竻绌烘寜閽�銆傜敤鎴烽�氳繃鍘熺敓鎼滅储 input 鍒犻櫎鏂囧瓧娓呯┖绛涢�夛紝鐒︾偣濮嬬粓鐣欏湪璇� input銆�

```ts
type AgentProfileNavItem = {
    profileKey: string;
    name: string;
    status: ConfigAgentProfileSettingsDto["agentProfiles"][number]["loadStatus"];
    overrideCount: number;
    dirty: boolean;
    isDefault: boolean;
};

interface AgentProfileNavListProps {
    items: AgentProfileNavItem[];
    /** 绌轰覆琛ㄧず榛樿�よ�剧疆椤碉紱鍙楁帶锛岀粍浠朵笉鑷�琛屼慨鏀广�� */
    activeKey: string;
    /** 鍘熷�嬫悳绱㈣緭鍏ワ紱鍙楁帶锛岀粍浠跺彧鐢� trim 鍚庣殑灏忓啓鍊艰繃婊ゃ�� */
    search: string;
    /** 榛樿�よ�剧疆椤垫槸鍚︽湁鏈�淇濆瓨鏀瑰姩銆� */
    defaultsDirty: boolean;
}

interface AgentProfileNavListEmits {
    /** 鐐瑰嚮榛樿�ら〉鎴� Profile 鏃跺彂鍑虹洰鏍� key锛涢噸澶嶇偣鍑诲綋鍓嶉」浠嶅彂鍑恒�� */
    (event: "update:activeKey", value: string): void;
    /** 姣忔�℃悳绱㈣緭鍏ュ彉鍖栨椂鍙戝嚭鍘熷�嬪瓧绗︿覆锛屼笉鏇胯皟鐢ㄦ柟 trim銆� */
    (event: "update:search", value: string): void;
}
```

- 鎼滅储涓哄ぇ灏忓啓涓嶆晱鎰熺殑 `includes`锛屽悓鏃跺尮閰� `name` 涓� `profileKey`锛涗笉澧炲姞妯＄硦鎼滅储銆佹嫾闊炽�佹帓搴忔垨楂樹寒銆�
- 鎼滅储鍙�杩囨护 Profile 鍒楄〃锛屼笉闅愯棌榛樿�よ�剧疆鍏ュ彛锛屼笉淇�鏀� `activeKey`銆傚綋鍓� Profile 琚�杩囨护鎺夋椂锛岃�︽儏鐘舵�佷繚鎸佷笉鍙橈紱娓呯┖鎼滅储鍚庡綋鍓嶆爣璁版仮澶嶃�傜敱浜庢悳绱㈡�嗕笉鍚�鐢� `clearable`锛屾竻绌哄姩浣滄槸鐢ㄦ埛鍦ㄥ師鐢熸悳绱� input 涓�鍒犻櫎鏂囧瓧锛岀劍鐐瑰�嬬粓淇濈暀鍦ㄨ�� input銆�
- 闈� `loaded` Profile 浠嶅彲閫夋嫨銆俵oad status 鏄�璇存槑淇℃伅锛屼笉鍦ㄥ�艰埅灞傛搮鑷�鏀瑰彉璇︽儏椤垫槸鍚﹀彲鐢ㄣ��
- `items` 涓虹┖鏃舵樉绀衡�滄病鏈夊彲閰嶇疆鐨� Profile鈥濓紱`items` 闈炵┖浣嗚繃婊ょ粨鏋滀负绌烘椂鏄剧ず鈥滄病鏈夊尮閰嶇殑 Profile鈥濄��
- 鏈�鐭� `activeKey` 涓嶈Е鍙戣嚜鍔� emit锛屼篃涓嶄吉閫犲綋鍓嶉」锛涜皟鐢ㄦ柟缁х画璐熻矗绾犳�ｃ��
- 娌℃湁 slots銆乪xpose 鎴栬嚜瀹氫箟绂佺敤/鍙�璇�/loading props銆俈ue 榛樿�� attrs 钀藉埌鍗曚竴鏍硅妭鐐癸紝渚� `class`銆乣style`銆乣data-*` 鍜屽彲璁块棶灞炴�ф墿灞曘��

### 淇℃伅灞傜骇涓庣姸鎬佽〃杈�

- 鏍硅妭鐐规槸鏈夊彲瑙佹爣棰樺叧鑱旂殑璁剧疆椤靛�艰埅 landmark銆傜粨鏋勯『搴忓浐瀹氫负鎼滅储銆侀粯璁よ�剧疆鍏ュ彛銆丳rofile 鍖烘爣棰樸�佺嫭绔嬫粴鍔ㄥ垪琛ㄣ��
- 姣忚�屼富淇℃伅鏄�鍚嶇О锛宍profileKey` 鏄�娆′俊鎭�锛涢暱鍚嶇О鍜岄暱 key 鎴�鏂�浣嗕笉鎾戠牬杞ㄩ亾锛屽畬鏁村�间粛淇濈暀鍦� DOM 鍙�璁块棶鍚嶇О涓�锛屽苟鎻愪緵鎸囬拡鍙�鍙戠幇鐨勫畬鏁存枃鏈�銆�
- 褰撳墠椤逛娇鐢ㄦ暣琛屽己璋冨簳銆佸己璋冩枃瀛椼�佹寔缁�鍙�瑙侀�夋嫨鍥炬爣鍜� `aria-current="page"`锛涗笉浣跨敤甯搁┗宸﹁竟妗嗐�傞粯璁ら〉涓� Profile 琛岄噰鐢ㄥ悓涓�閫夋嫨璇�娉曘��
- load status 浣跨敤鎸佺画鍙�瑙佺殑鐭�鏂囨�堜笌鍥炬爣锛屼笉鍙�鐢ㄨ壊鐐癸細`loaded` 涓� success锛宍compiling` 涓� accent锛宍not_compiled` / `compile_stale` 涓� warning锛宍compile_failed` / `compiled_load_failed` / `source_error` 涓� danger銆傛墍鏈変竷绉嶇姸鎬侀兘浣跨敤鐜版湁 i18n 鏂囨�堛��
- `isDefault` 鏄剧ず鈥滃綋鍓嶉粯璁も�濊��涔夛紝`dirty` 鏄剧ず鈥滄湁鏈�淇濆瓨鐨勪慨鏀光�濊��涔夛紝`overrideCount > 0` 鏄剧ず鏈�鍦板寲璁℃暟锛涗笁鑰呭潎涓嶈兘鍙�闈犻�滆壊鎴� `title`銆傚�氫釜寰界珷鍏佽�告崲琛岋紝涓嶈兘鎸ゅ帇鍚嶇О杞ㄩ亾鎴栨敼鍙樻寜閽�澶栧�姐��
- `defaultsDirty` 鍦ㄩ粯璁よ�剧疆琛屼娇鐢ㄥ悓涓� warning 璇�娉曘�俙overrideCount === 0` 涓嶆樉绀鸿�℃暟寰界珷銆�
- `compiling` 鍙�浠ユ湁鍙� token 鎺у埗鐨勫姩鏁堬紝浣嗗繀椤诲悓鏃舵湁闈欐�佸浘鏍囦笌鏂囧瓧锛沗prefers-reduced-motion` 涓嬪仠姝㈤潪蹇呰�佸姩鐢汇��

### 閿�鐩樸�佺劍鐐逛笌 ARIA

| 鍦烘櫙 | 鍚堝悓 |
| --- | --- |
| Tab | 椤哄簭杩涘叆鎼滅储 input銆侀粯璁よ�剧疆鎸夐挳銆佹瘡涓�鍙�瑙� Profile 鎸夐挳锛涚┖鎬佷笉鏄� Tab 鍋滈潬鐐广�傛悳绱�涓嶅惎鐢� nb-ui `FormInput` 鐨� `clearable`锛屽洜姝や笉瀛樺湪棰濆�栨竻绌烘寜閽�鍋滈潬鐐广�� |
| Enter / Space | 鍘熺敓鎸夐挳瑙﹀彂涓�娆� `update:activeKey`锛屽垎鍒�鎼哄甫绌轰覆鎴� `profileKey`銆� |
| 鏂瑰悜閿� / Home / End | 涓嶈嚜瀹氫箟銆傝�ョ粍浠舵槸椤甸潰瀵艰埅锛屼笉鍐掑厖 `listbox`锛涙悳绱㈡�嗘壙鎷呭揩閫熷畾浣嶃�� |
| 鎼滅储杩囨护 | 鐒︾偣淇濈暀鍦ㄦ悳绱� input锛涜繃婊や笉涓诲姩鎶婄劍鐐规垨閫変腑鐘舵�佺Щ鍒伴�栭」銆傛竻绌虹敱 input 缂栬緫瀹屾垚銆� |
| 褰撳墠椤� | 鎭板ソ涓�涓�鍙�瑙佹寜閽�鍙�甯� `aria-current="page"`锛涘綋鍓嶉」琚�杩囨护鎴� key 鏈�鐭ユ椂鍙�瑙佸垪琛ㄦ病鏈変吉閫� current銆� |
| 鐘舵�� | 鐘舵�佹枃妗堜綅浜庢寜閽�鍙�璁块棶鍐呭�逛腑锛涜�呴グ鍥炬爣 `aria-hidden`锛屼笉璁╅�滆壊鎴� `title` 鎴愪负鍞�涓�淇℃伅婧愩�� |
| 鎸傝浇/鍗歌浇 | 涓嶈嚜鍔ㄦ姠鐒︾偣锛涚粍浠舵病鏈夋诞灞傦紝涔熸病鏈夌劍鐐瑰綊杩樿矗浠汇�� |

## 纭�瀹氭�� fixture

鏂板�� `packages/neuro-book/app/component-lab/fixtures/AgentProfileNavListFixture.vue`锛屽湪 `fixtures/index.ts` 鍙�鐧昏�颁互涓嬪満鏅�鍜� loader銆俧ixture 鍙�鎸佹湁褰撳墠鍦烘櫙鐨勫唴瀛樻�侊紝鐩戝惉鍦烘櫙鎴� Lab 鏁版嵁杩樺師鍚庨噸缃�锛涙瘡娆� `update:*` 鍏堟洿鏂板彈鎺� ref锛屽啀閫氳繃 `useLabEventSink()` 涓婃姤鍘熶簨浠跺悕涓� payload銆�

| 鍦烘櫙 id | 鏍囩�� | 鍒濆�嬭緭鍏ヤ笌瑙傚療閲嶇偣 |
| --- | --- | --- |
| `statuses` | 鐘舵�佸叏闆� | 涓冧釜鍥哄畾 Profile 鍚勮�嗙洊涓�绉� load status锛涘叾涓�涓�椤归�変腑銆佷竴椤� dirty銆佷竴椤瑰綋鍓嶉粯璁ゃ�佷竴椤规湁瑕嗙洊璁℃暟锛岄獙璇佸苟琛屽厓鏁版嵁灞傜骇銆� |
| `defaults` | 榛樿�よ�剧疆 | `activeKey=""`銆乣defaultsDirty=true`锛岄獙璇侀粯璁ら〉 current 涓庢湭淇濆瓨璇�涔夈�� |
| `long-list` | 闀垮垪琛ㄤ笌闀挎枃鏈� | 鍥哄畾鐢熸垚涓嶅皯浜� 30 椤癸紝鍚�瓒呴暱涓�鑻辨枃鍚嶇О銆侀暱 key 鍜屽�氬窘绔犺�岋紱fixture 缁欑粍浠舵槑纭�楂樺害锛岄獙璇佸垪琛ㄨ嚜韬�婊氬姩銆� |
| `empty` | 绌哄垪琛� | `items=[]`銆佺┖鎼滅储锛岄獙璇侀�嗗煙绌烘�佷笖榛樿�よ�剧疆浠嶅彲鎿嶄綔銆� |
| `no-match` | 鎼滅储鏃犲尮閰� | 闈炵┖ items 鍔犲浐瀹氭棤鍖归厤鎼滅储璇嶏紝楠岃瘉鏃犲尮閰嶆枃妗堛�佹悳绱㈢紪杈戝拰娓呯┖鍚庢仮澶嶃�� |

fixture 鐨� JSON 鏁版嵁鍙�浣跨敤鍙�搴忓垪鍖栧瓧娈碉紝涓嶈�诲彇鐪熷疄 Profile銆侀厤缃�銆乻tore銆丄PI銆佹祻瑙堝櫒瀛樺偍銆丳rovider/Model銆丳roject 鎴� Session銆傚垪琛ㄧ敓鎴愯�勫垯鍥哄畾锛屼笉浣跨敤褰撳墠鏃堕棿銆侀殢鏈烘暟鎴栨湰鏈烘暟鎹�銆�

## 瀹炴柦椤哄簭涓庢��鏌ョ偣

### 闃舵�� 0锛氬綊鍥犲熀绾�

1. 鍦ㄥ紑濮嬫簮鐮佹敼鍔ㄥ墠璁板綍 revision銆佸伐浣滄爲鍜屽彈褰卞搷鍛戒护鐨勫綋鍓嶇粨鏋溿��
2. 瀵瑰綋鍓嶅凡鏈夌殑鍏ㄥ眬澶辫触寤虹珛 ledger锛氬懡浠ゃ�乧wd銆乪xit code銆侀敊璇�鍘熸枃銆佹姤閿欒矾寰勩�侀�栨�″紩鍏ユ壒娆″拰鎭㈠�嶆潯浠躲�傛棤娉曚粠鍘嗗彶纭�瀹氶�栨�℃壒娆℃椂鏄庣‘鍐欌�滄湭楠岃瘉鈥濓紝涓嶇寽娴嬨��
3. 鑻ュ疄鐜版椂 LSP 鍙�鐢�锛屽�� `AgentProfileNavList` 涓� `AgentProfileNavItem` 閲嶆柊鎵ц�� references锛涗粛涓嶅彲鐢ㄥ垯鍦� walkthrough 淇濈暀绮剧‘澶辫触锛屽苟鐢ㄦ枃鏈�鎼滅储澶嶆牳璋冪敤鏂广��

### 闃舵�� 1锛氭枃妗ｅ拰 fixture 鍏堣��

1. 鏂板�� `AgentProfileNavList.md`锛屽啓鍏ヤ笂杩� props/emits/slots/attrs銆佺姸鎬併�佸竷灞�銆侀敭鐩樸�丄RIA銆佷笉鏀�鎸侀」鍜� `state:inject` 鐞嗙敱銆�
2. 鏂板�� `AgentProfileNavList.types.ts`銆乫ixture 涓庝簲涓�鍦烘櫙鐧昏�帮紝浣嗘殏涓嶆敼鍙樿�嗚�夊疄鐜般��
3. 杩愯�岀粍浠剁储寮曡仛鐒︽祴璇曪紝纭�璁ゆ枃妗ｈ嚜鍔ㄨ繘鍏� `settings` 鍒嗙粍銆乫ixture 鍙�鍙戠幇銆佸満鏅�閲嶇疆涓庝簨浠舵棩蹇楃‘瀹氥��

**寮�鍙戣�呮��鏌ョ偣 A**锛氬湪 Lab 鏌ョ湅鏂囨。鍜屽満鏅�鏁版嵁锛岀‘璁や笁椤逛骇鍝佸彇鑸嶏細鍚嶇О/key/鍏冩暟鎹�鐨勪俊鎭�灞傜骇锛涗竷绉� load status 閲囩敤鎸佺画鍙�瑙佺煭鏂囨�堬紱`390 脳 844` 缁х画浣跨敤鍥哄畾鎼滅储鍔犵旱鍚戝垪琛�锛岃�屼笉鏄�妯�鍚戞潯鎴栨娊灞夈�侫gent 鎻愪緵妗岄潰涓庢墜鏈哄疄闄呯敾闈�銆佹浛浠ｆ柟妗堝拰褰卞搷锛涘緱鍒扮粨鏋滃墠涓嶈繘鍏ユ渶缁堣�嗚�夋敹鍙ｃ��

### 闃舵�� 2锛氬師鍦� replacement

1. 鍏堣ˉ鍙�澶辫触鐨勮仛鐒﹁�屼负娴嬭瘯锛屽啀鍘熷湴閲嶅啓缁勪欢锛涜縼绉诲埌 nb-ui `FormInput` / `Badge` 涓庤��涔� token銆俙FormInput` 涓嶅惎鐢� `clearable`锛屾祴璇曚笉涓烘湭閲囩敤鐨勬竻绌烘寜閽�寤虹珛鍚堝悓銆�
2. 鏇存柊鐖剁粍浠跺敮涓�鐨� type-only import锛涗笉鏀瑰彉 `navItems` 鏋勯�犮�乣v-model` 鎺ョ嚎銆佽�剧疆淇濆瓨鎴栬�︽儏闈㈡澘銆�
3. 鍒犻櫎 SFC 鍐呮棫绫诲瀷瀵煎嚭銆佹棫 `FormInput` 渚濊禆銆佽壊鐐�-only 鐘舵�併�佸乏渚� current 鎸囩ず鏉°�佹棫涓婚�樺彉閲忋�佸瓧闈㈠姩鏁堟椂闀垮拰 `transition-all`銆�
4. 鏇存柊鏃у搷搴斿紡婧愮爜瀛楃�︿覆娴嬭瘯锛氱Щ闄� Profile 瀵艰埅鐨� class 鍖归厤锛岀敤缁勪欢琛屼负娴嬭瘯涓庣湡瀹� Lab scroll/overflow smoke 鎺ョ�¤�ュ悎鍚屻��

### 闃舵�� 3锛氳嚜鍔� Lab 楠屾敹

1. 妗岄潰涓嶄綆浜� 1440px锛氶獙璇佹悳绱�涓庨粯璁ゅ叆鍙ｄ繚鎸佸彲瑙併�侀暱鍒楄〃鍙�鍦ㄥ唴閮ㄦ粴鍔ㄣ�佺姸鎬�/榛樿��/dirty/璁℃暟鍙�鍖哄垎銆佺劍鐐圭幆鍜屼簨浠� payload 姝ｇ‘銆�
2. `390 脳 844`锛氶獙璇佹牳蹇冩搷浣滀粛瀹屾暣锛岄暱鍚嶇О/key/寰界珷涓嶉伄鎸°�佷笉浜х敓椤甸潰绾фí鍚戞孩鍑猴紝鎼滅储鍚庝粛鍙�閫夋嫨涓庢仮澶嶅垪琛ㄣ��
3. 閿�鐩樼湡瀹� smoke锛歍ab 椤哄簭銆丒nter/Space 閫夋嫨銆乧urrent 璇�涔夈�佹悳绱㈣繃婊ゅ悗鐨勭劍鐐逛繚鎸併��
4. 鑷冲皯鍦� nbook 涓庡彟涓�濂楀樊寮傛槑鏄剧殑 nb-ui 涓婚�樹笅楠岃瘉 token 娑堣垂锛涗笉浠ュ崟涓婚�樷�滅湅璧锋潵姝ｅ父鈥濇浛浠ｄ富棰樺悎鍚屻��

**寮�鍙戣�呮��鏌ョ偣 B**锛氭彁渚涚湡瀹� Lab 棣栫増渚涗汉宸ヨ�傛劅鍒ゆ柇銆備汉宸ラ獙鏀堕渶瑕佸崟鐙�鎺堟潈锛岃嚜鍔� smoke 涓嶆浛浠ｈ�ュ垽鏂�锛涙湭鑾峰緱缁撴灉鏃� Task 淇濇寔鏈�闂�鍚堬紝涓嶆妸鈥滄湭鍙嶉�堚�濊�颁负閫氳繃銆�

### 闃舵�� 4锛氳�板綍涓庝氦鎺�

1. 鎶婃渶缁堝喅绛栥�佽��鍚﹀喅鏂规�堛�佺被鍨�/涓婚��/i18n/fixture 闅愬惈渚濊禆銆佸け璐ヤ笌淇�澶嶅啓鍏� Task walkthrough銆�
2. 瀵规瘮闃舵�� 0 涓庢渶缁堝叏灞�缁撴灉銆傛瘡涓�鏂板�炲け璐ユ敞鏄庣敱 t14 寮曞叆鍙婃仮澶嶆潯浠讹紱鏃㈡湁澶辫触淇濇寔鍘熷綊鍥狅紝涓嶇�肩粺鍐欌�滈�勬湡澶辫触鈥濄��
3. 鎻愮偧鍚庣画鎵规�″彲澶嶇敤姝ラ�や笌鏈�缁勪欢鐗逛緥锛屼氦缁� Leader锛涗笉鍦ㄦ湰 Task 棰勫缓鍓╀綑缁勪欢浠诲姟鎴� C銆�

## 棰勮�℃敼鍔ㄦ枃浠�

- `packages/neuro-book/app/components/novel-ide/settings/AgentProfileNavList.md`
- `packages/neuro-book/app/components/novel-ide/settings/AgentProfileNavList.vue`
- `packages/neuro-book/app/components/novel-ide/settings/AgentProfileNavList.types.ts`
- `packages/neuro-book/app/components/novel-ide/settings/AgentProfileNavList.test.ts`
- `packages/neuro-book/app/components/novel-ide/settings/NovelIdeAgentProfileModelSettingsPanel.vue`锛屼粎 type-only import
- `packages/neuro-book/app/component-lab/fixtures/AgentProfileNavListFixture.vue`
- `packages/neuro-book/app/component-lab/fixtures/index.ts`
- `packages/neuro-book/scripts/smoke/component-lab.ts`
- `packages/neuro-book/app/utils/novel-ide-settings-responsive.contract.test.ts`锛屼粎绉婚櫎鐢辩湡瀹炶�屼负璇佹嵁鎺ョ�＄殑 Profile 婧愮爜瀛楃�︿覆鏂�瑷�
- 鏈� Task 鐨� `walkthroughs/` 涓庡繀瑕� `evidences/`

榛樿�や笉淇�鏀� nb-ui 鍏�鍏辩粍浠跺疄鐜版垨 exports銆傝嫢鐜版湁 `FormInput` / `Badge` 鐨勫凡澹版槑鍚堝悓涓嶈冻锛屽仠姝㈡墿澶у叕鍏� API锛岃�板綍鍏蜂綋缂哄彛骞剁敱 Leader 鍐冲畾鐙�绔� Task銆�

## 楠岃瘉鐭╅樀

瀹炵幇闃舵�垫寜浠ヤ笅椤哄簭涓茶�屾墽琛岋紝閬垮厤 nb-ui `nuxt prepare playground` 涓� Playwright webServer 骞跺彂鍐� `playground/.nuxt`锛�

1. `bun --cwd packages/neuro-book run test -- app/components/novel-ide/settings/AgentProfileNavList.test.ts app/component-lab app/utils/novel-ide-settings-responsive.contract.test.ts`
2. `bun --cwd packages/nb-ui run test`
3. `bun --cwd packages/nb-ui run typecheck`
4. `bun --cwd packages/neuro-book run typecheck`
5. 鍚�鍔ㄥ綋鍓� revision 鐨� Source Dev 鏈嶅姟锛屽啀杩愯�� `bun --cwd packages/neuro-book run smoke:component-lab -- --url <瀹為檯鍦板潃> --browser-executable <瀹為檯 Chromium>`锛涙湇鍔″拰鎴�鍥惧彧浣跨敤绯荤粺涓存椂鏍广��
6. 杩愯�� Product 鎺掗櫎闂ㄧ�侊細鎸� t05/t06 宸查獙璇佺殑鏂规硶鎵ц�� `NODE_ENV=production bun x nuxt build --dotenv .env.product --preset node-server`锛屾��鏌� `.nuxt/product-raw` 鐨� Lab/fixture/寮�鍙戠粷瀵硅矾寰�/璇嗗埆鏍囪�板叏鏂囦笌璺�鐢辫〃鍧囨棤鍛戒腑锛屽苟鐢ㄥ悓涓�浜х墿纭�璁ゆ�ｅ紡璺�鐢卞彲鍛戒腑銆傝�ラ棬绂佸繀椤荤豢鑹诧紱涓嶅緱鐢ㄤ富搴旂敤鏈�鎺ョ嚎澶辫触鏇夸唬銆�
7. `bun run docs:check`
8. `bun run governance:check`
9. `git diff --check`

涓婅堪绗� 1 鑷� 6 椤逛腑锛宍packages/nb-ui` 鑷�韬� test/typecheck銆丯euroBook Component Lab focused test/smoke 涓� Product 鎺掗櫎闂ㄧ�佸繀椤诲叏缁裤�傜敤浜� Product 鎺掗櫎鐨勭敓浜ф瀯寤哄拰浜х墿鎵�鎻忓睘浜庤�ョ‖闂ㄧ�侊紝涓嶈兘鎶婂畠鐨勫け璐ュ綊鍥犱簬涓婚〉鏈�鎺ュ叆銆傚彧鏈夌嫭绔嬩笖鑳藉�熷畾浣嶄负 NeuroBook 涓诲簲鐢ㄦ湭鎺ュ叆娑堣垂鑰呯殑闆嗘垚妫�鏌ワ紝鎵嶅彲浠ヨ�板綍涓鸿縼绉绘湡闂寸殑鍏佽�哥孩鑹诧紱姣忛」蹇呴』璁板綍鍛戒护銆乧wd銆佽矾寰勩�侀敊璇�鍘熸枃銆佸紩鍏ユ壒娆″拰鎭㈠�嶆潯浠躲�傝嫢 nb-ui銆丩ab 鎴� Product 鎺掗櫎澶辫触锛屽綋鍓嶆壒娆′笉寰楀�ｇО Lab-ready銆�

鑱氱劍娴嬭瘯鑷冲皯瑕嗙洊锛氬ぇ灏忓啓涓嶆晱鎰熺殑 name/key 鎼滅储銆佸師濮� search emit銆侀粯璁�/Profile 閫夋嫨 payload銆侀噸澶嶉�夋嫨銆佷竷绉嶇姸鎬佹枃妗堛�乧urrent/dirty/default/override 璇�涔夈�佺┖鍒楄〃銆佹棤鍖归厤鍜屽綋鍓嶉」琚�杩囨护銆傜湡瀹� smoke 鑷冲皯瑕嗙洊锛歍ab/Enter/Space銆佺劍鐐瑰彲瑙併�佹棤棰濆�� clearable Tab 鍋滈潬鐐广�佸唴閮ㄦ粴鍔ㄣ�佹�岄潰涓� `390 脳 844` 婧㈠嚭銆佸満鏅�閲嶇疆銆佷簨浠舵棩蹇楀拰鍙屼富棰樸��

Product 鎺掗櫎闂ㄧ�佸繀椤荤豢锛涗富椤电湡瀹炴祦绋嬨�佺嫭绔嬬殑涓诲簲鐢� typecheck 鎴栫敱鏈�鎺ュ叆娑堣垂鑰呯洿鎺ュ�艰嚧涓斾笉灞炰簬 Product 鎺掗櫎闂ㄧ�佺殑涓诲簲鐢ㄩ泦鎴愬け璐ワ紝鎵嶅彲杩涘叆绾㈣壊 ledger銆傛瘡椤硅�板綍鍛戒护銆乧wd銆佽矾寰勩�侀敊璇�鍘熸枃銆佸紩鍏ユ壒娆″拰鎭㈠�嶆潯浠讹紱绾㈣壊 revision 涓嶅緱 push銆佹彁 PR銆佸悎骞躲�佸彂甯冦�侀儴缃叉垨澹版槑鏁翠釜 Work 瀹屾垚銆�

## Lab-ready 楠屾敹

- 鍚屽悕鏂囨。涓庡疄鐜颁竴鑷达紝`state:inject` 濡傚疄鍙嶆槧 i18n provider锛沺rops/emits/slots/attrs 鍙�鏈烘�版牳瀵广��
- fixture 瑕嗙洊浜斾釜纭�瀹氭�у満鏅�锛岄噸澶嶆墦寮�銆佺紪杈戜笌杩樺師缁撴灉涓�鑷达紱涓嶄緷璧� API銆乻tore銆佹祻瑙堝櫒瀛樺偍鎴栫湡瀹� Profile銆�
- 缁勪欢鍙�娑堣垂 nb-ui 璇�涔� token锛屼笉璇诲彇鏃� `theme.system` authority锛屼笉鍚� Lab/涓婚〉鏉′欢鍒嗘敮銆�
- 鎼滅储涓庨�夋嫨淇濇寔鍙楁帶锛涢�変腑銆乨irty銆侀粯璁ゅ拰涓冪�嶇紪璇戠姸鎬佷笉鍙�渚濊禆棰滆壊鎴� `title`銆�
- 妗岄潰涓� `390 脳 844` Lab 涓�鏃犲叧閿�閬�鎸℃垨椤甸潰绾фí鍚戞孩鍑猴紝闀垮悕绉般�侀暱 key 鍜屽�氬窘绔犱笉鎾戠牬甯冨眬锛屽垪琛ㄧ嫭绔嬫粴鍔ㄣ��
- 鑱氱劍娴嬭瘯銆丆omponent Lab smoke銆乶b-ui test/typecheck銆丯euroBook typecheck 鍜屾枃妗ｆ不鐞嗘��鏌ュ潎鏈夊疄闄呯粨鏋滐紱鍏ㄥ眬绾㈣壊鍩虹嚎閫愭潯璁板綍锛屼笉鍐掑厖閫氳繃銆�
- 涓や釜寮�鍙戣�呮��鏌ョ偣鐨勭粨璁哄啓鍏� walkthrough锛涙湭鎺堟潈鐨勪汉宸ラ獙鏀朵笉鍐欐垚宸插畬鎴愩��

## 鍋滄�㈡潯浠�

鍑虹幇浠ヤ笅浠讳竴鎯呭喌鏃跺仠姝㈡墿澶у疄鐜帮紝瀹屾垚鑼冨洿鍐呰瘉鎹�鍚庝氦缁� Leader 鎴栧紑鍙戣�呭喅瀹氾細

- 蹇呴』鏀瑰彉 `AgentProfileNavItem` 鏁版嵁璇�涔夈�佸叡浜� DTO銆丳rofile 鐘舵�佹満銆佷繚瀛�/缂栬瘧琛屼负鎴栬�︽儏椤靛彲鐢ㄦ�с��
- 蹇呴』缁� nb-ui 鍏�鍏辩粍浠舵柊澧� API/token锛屾垨鍑虹幇涓や釜浠ヤ笂鍚屾牱鍚堢悊鐨勫叕寮�缁勪欢杈圭晫銆�
- 蹇呴』淇�鏀� C 浜у搧涓婚�樺悎鍚屻��8 濂楁棫涓婚�樸�丟lobal Config銆侀�栧抚鎴栨诞灞傚�夸富銆�
- 蹇呴』鏂板�炵湡瀹� API/store/鎸佷箙鍖栦緷璧栵紝鎴� fixture 闇�瑕佽�诲彇鐪熷疄 Project銆丼ession銆丳rovider/Model 鎴栫敤鎴锋枃浠躲��
- 杩佺Щ闇�瑕佺户缁�鎵╁睍 `LabShell.vue`锛涜繖浼氬懡涓� t09 鐨勬仮澶嶆潯浠讹紝鍏堢敱 Leader 鎭㈠�� t09銆�

## 瀹屾垚鍚庣殑 Leader 鍔ㄤ綔

璇诲彇鏈� Task walkthrough锛屽垽鏂�鍝�浜涙�ラ�よ兘鎴愪负鎵归噺杩佺Щ鍚堝悓銆佸摢浜涘彧閫傜敤浜� Agent Profile 瀵艰埅锛屽啀鎸夊疄闄呬緷璧栧垱寤虹��涓�鎵� Agent 鑷�涓昏縼绉� Task銆備笉寰椾粎鍑�鏈� Task 鎴愬姛灏遍�勫缓鍓╀綑鍏ㄩ儴缁勪欢浠诲姟锛涚洰鏍囩粍浠堕泦鍚堣揪鍒� Lab-ready 鍚庢墠鍒涘缓 C銆�

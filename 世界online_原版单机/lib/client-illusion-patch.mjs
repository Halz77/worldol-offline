export const illusionRevision='illusion-any-weapon-v1';

// MOD(illusion)：装备幻化原本只允许「同类型」外观 —— 大刀只能幻化成刀、法杖只能幻化成杖。
// 原因是类型相等判断散落三处：
//   1) 服务端 lib/illusion-service.mjs 的 candidatesFor()：只下发 item.type===source.type 的候选；
//   2) 服务端 lib/illusion-service.mjs 的幻化校验：appearance.type!==definition.type 直接拒绝；
//   3) 客户端主包：
//        · BagChange 视图 onShow() 里 `n.type==e.type` 过滤候选列表；
//        · Item.isIllusion() 里 `o.type==this.type` 统计「是否有可幻化的同类外观」。
// 1) 2) 已在上游 lib/illusion-service.mjs 改成「同槽位组」判定，这里补客户端两处。
//
// 判定依据（v305 槽位表 itemSlots）：
//   所有武器 —— 单手/双手剑(13/14)、单手/双手刀(15/16)、单手/双手重武(17/18)、
//   双手法杖(19)、双手长枪(20)、单手/双手弩(21/22)、双手弓(23)、单手盾(24)、
//   法术球(34)、单手/双手火枪(35/36)、单手/双手锤(37/38)、双手扇(39) —— 共用武器槽 [8,10]；
//   其余装甲各自独占槽位（头 0、衣 1、裤 2 …… 坐骑 11、时装 12），本来就没有同槽位的第二种类型。
// 所以「同槽位组」等价于「同类型 或 同属武器大类」，武器之间全部互通，装甲行为完全不变。
//
// 客户端列表响应是多字节数量头：count 由 1 字节(UInt8/读作 Int8) 改成 2 字节，
// 因为放开后武器类候选有 500+ 条，超过单字节有符号上限 127。
export function patchIllusion(source){
  const weapon=v=>'('+v+'>=13&&'+v+'<=24||'+v+'>=34&&'+v+'<=39)';
  const same=(a,b)=>'('+a+'=='+b+'||'+weapon(a)+'&&'+weapon(b)+')';

  const replaces=[
    // BagChange 视图：候选列表过滤（原：同类型才收录）
    ['n.type==e.type&&(n.id!=e.id?this.itemList.push(n):i=n)',
     same('n.type','e.type')+'&&(n.id!=e.id?this.itemList.push(n):i=n)'],
    // Item.isIllusion：是否显示「幻化」按钮（原：图鉴里有同类才显示）
    ['o.type==this.type&&t++,t>1',
     same('o.type','this.type')+'&&t++,t>1'],
    // 幻化列表响应数量头：byte → short（放开后候选数超过 127）
    ['a=i.getByte(),o.illusionInfo={}',
     'a=i.getShort(),o.illusionInfo={}'],
  ];

  let out=source;
  for(const [from,to] of replaces){
    const hits=out.split(from).length-1;
    if(hits===1){out=out.replace(from,to);continue;}
    if(hits===0&&out.includes(to))continue;      // 已打过：幂等
    if(hits>1)throw Error('v305 illusion patch anchor not unique: '+from);
    throw Error('v305 illusion patch mismatch: '+from);
  }
  return out;
}

/**
 * 战斗提示弹窗（「xxx无效，（魔攻）无敌状态！」那种）**滚得太慢、一直占着屏幕**。
 *
 * ## 是谁在显示它
 * 服务端在战斗里发来的提示（「xxx无效…」「xxx抵抗了…」）走：
 *
 *   MiscProxy 数据类（主包模块 62）addPromptMsg(text)
 *     → promptMsssage.addElement(text) + Briefing.show()
 *   Briefing（主包模块 370，Layer.tip 上、y=200 的单例）
 *     → showNext()：从队列头取一条 setData 显示，
 *       然后 delayCall(showNext, this.TIME)  ← **TIME=2e3**
 *
 * 也就是说：一次只显示一条，**每条固定占 2 秒**，队列排到第几条就要等
 * 2×(n-1) 秒。战斗里一轮可能产生好几条（多段攻击、宠物、反伤各报一次），
 * 队列增长速度远大于 2 秒/条 → 战斗都结束了，弹窗还在慢慢往下滚（玩家实测）。
 *
 * ## 修法（第 73 版，三处字符串替换）
 *   ① 单条时间 2000ms → 800ms（`PROMPT_TIME_MS`）；
 *   ② 队列越长切得越快：`delay = max(250, min(TIME, 2000/队列长度))`
 *      —— 队列 1~2 条仍按 800ms，排到 3/4/5/6 条时依次 666/500/400/333ms，
 *      6 条满队从头清空约 2 秒；
 *   ③ addPromptMsg 给队列**加上限**（`PROMPT_QUEUE_LIMIT` 条，超出丢最旧的）
 *      —— 原版队列无上限，战斗里攒下的旧提示会一直占位。
 *
 * 三处都只动显示节奏与队列长度，**不动提示内容、不动谁发提示**，所以
 * 战斗数值与协议一个字节都没变。
 *
 * ## 没做的一条（记着，真遇到再补）
 * 「战斗一结束立刻清空队列」需要一个干净的锚点：`BattleProxy.exitBattle` 那块
 * 已经被 client-escort-board-patch.mjs 占着，且 0062 的作用域里拿不到 Misc 数据类
 * 的实例引用 —— 与其硬塞，不如靠上面 ②③ 把尾巴压到 2 秒内。
 */

export const promptBriefingRevision='prompt-briefing-speed-v1';

/** 单条提示的基础停留时间（原版 2000ms）。 */
export const PROMPT_TIME_MS=800;
/** 排队上限：超出的丢最旧的一条（原版无上限）。 */
export const PROMPT_QUEUE_LIMIT=6;
/** 队满时的最快切换间隔 —— 留个下限，免得点一下攻击刷出一串字看都看不清。 */
export const PROMPT_MIN_MS=250;
/** 赶队列用的参考总时长：delay ≈ REF_MS / 队列长度（受 PROMPT_TIME_MS 与 PROMPT_MIN_MS 夹取）。 */
export const PROMPT_REF_MS=2000;

// ① Briefing 构造函数里的 `t.TIME=2e3`（全包唯一）。
const FROM_TIME=',t.TIME=2e3,t.timeKey=0';
const TO_TIME=`,t.TIME=${PROMPT_TIME_MS},t.timeKey=0`;
// ② showNext 里排下一次显示的那一句（全包唯一）。
const FROM_DELAY='this.timeKey=r.delayCall(o["default"].alloc(this,this.showNext),this.TIME)';
// 这里的 this.TIME 是 Briefing 自己的字段；a["default"].getInstance() 就是 0062 的数据类，
// 队列长度取 promptMsssage.size()（isPromptEmtry() 也是这么数的）。
const TO_DELAY=`this.timeKey=r.delayCall(o["default"].alloc(this,this.showNext),Math.max(${PROMPT_MIN_MS},Math.min(this.TIME,Math.floor(${PROMPT_REF_MS}/Math.max(1,a["default"].getInstance().promptMsssage.size())))))`;
// ③ addPromptMsg 里入队那一句（全包唯一）。
const FROM_QUEUE='e.getInstance().promptMsssage.addElement(t),_.Briefing.show()';
// 入队后立刻裁剪：只留最新 PROMPT_QUEUE_LIMIT 条。
// 用 function 表达式（逗号表达式位置）+ 形参 q，避免和二外的 t/i 撞名；
// 原句在 `(…,e.getInstance()…,_.Briefing.show())` 里，替换后仍是同一个逗号链。
const TO_QUEUE=`function(q){q.addElement(t);for(;q.size()>${PROMPT_QUEUE_LIMIT};)q.removeElementAt(0)}(e.getInstance().promptMsssage),_.Briefing.show()`;

function swap(source,from,to,label){
 const hits=source.split(from).length-1;
 if(hits===1)return source.replace(from,to);
 // 已打过：幂等（standalone 构建会再跑一遍整条链，靠这条跳过）。
 if(hits===0&&source.includes(to))return source;
 throw Error(`v305 prompt briefing patch mismatch (${hits}): ${label}`);
}

export function patchPromptBriefing(source){
 return swap(
  swap(swap(source,FROM_TIME,TO_TIME,'briefing TIME'),
   FROM_DELAY,TO_DELAY,'briefing showNext delay'),
  FROM_QUEUE,TO_QUEUE,'addPromptMsg queue cap');
}

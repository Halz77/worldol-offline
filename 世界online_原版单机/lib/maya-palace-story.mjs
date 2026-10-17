/**
 * 玛雅副本 —— 地下宫殿剧情（10 环，单机补写）。
 *
 * ## 背景
 * 原版任务表里 8700—8709 整段缺失：太阳神中段的剧情没有官方数据，
 * 而 3219「巨石神兵」与1824「告白」两头都指着这段，中间是空的 ——
 * 打完巨石神兵拿不到下一环，做不了告白。本模块把两头接上。
 *
 * ## 内容
 * 新建地图 962「地下宫殿」+ 10 个任务 + 23 个 NPC。
 * 战斗沿用原版已有的 2659/2663/2666 三个编队，怪物沿用已录的 3210/3215。
 *
 * ## 剧情线
 * 8700 与蒂卡尔商量潜入 → 8701 扫清门廊（打 5 名大殿守卫）
 * → 8702 祭文石碑 → 8703 父女重逢 → 8704 制止大祭司（打 5 个护教圣灵）
 * → 8705 未醒的疑心 → 8706 宫殿神使 → 8707 神使的援军
 * → 8708 抉择 → 8709 通往祭殿（终环，交回 1824 告白）
 *
 * ## 哪些是补写
 * 场景布局、NPC 站位、对话与人数都是单机补写 —— 沿用反抗联盟 / 神水 / 水晶头骨
 * 的人物线索与已录怪物，不是正式服原始任务。怪物属性不打折扣，抄的是录制值。
 * 任务编号取 8700—8709，避开个人城市已用的 8801—8808。
 *
 * ## 地形资源
 * 地图 962 用的是原客户端已有的地块文件 client/assets/26/265345ede5466edb.json，
 * 不需要额外贴图；服务端只要带上 data/maps/962.json 的地形块数据。
 */
import {Writer} from './codec.mjs';

/** 剧情节点编号：8700 起 10 环。 */
export const MAYA_QUEST_IDS=Array.from({length:10},(_,i)=>8700+i);

export const scenes = [
    {
      id: 8700,
      name: "深入地下宫殿",
      from: 14,
      to: 14,
      goal: "与蒂卡尔商量潜入地下宫殿的计划。",
      desc: "门后的守卫还没有察觉。雅克斯把联盟保管的最后一颗水晶头骨托付给我，我们绝不能让它落入神使手里。先扫清门廊，再找通向祭祀宫殿的路。",
      finish: "不要惊动整座宫殿，先制住门廊的守卫。水晶头骨由我保管，我们一起往前走。"
    },
    {
      id: 8701,
      name: "扫清门廊",
      from: 14,
      to: 14,
      kill: [3210, 5],
      radar: [6, 15],
      goal: "击败门廊的5名大殿守卫，再向蒂卡尔报告。",
      desc: "门廊里还有一队大殿守卫。他们堵住了通往宫殿深处的路，若是惊动后面的神使，我们就会腹背受敌。先击退这队守卫，我留在入口接应。",
      waiting: "门廊的守卫还在，先击退他们，再回来商量下一步。",
      finish: "路清出来了。前面那块石碑记着旧日祭典的行路次序，我们过去看看。",
      exp: 1e3,
      coins: 500
    },
    {
      id: 8702,
      name: "祭文石碑",
      from: 14,
      to: 15,
      goal: "沿门廊前进，查看祭文石碑上的刻文。",
      desc: "父亲从前带我参加神礼时，总会在这块石碑前停下。他说祭文既是告诫，也是宫殿的路标。去看看上面还留下了什么。",
      finish: "石碑刻着：“行祭者先谒祭司，再循长廊入祭殿。勿扰先祖之眠，勿以私欲启封。”残旧刻痕指向宫殿深处，那里似乎有人正在主持仪式。"
    },
    {
      id: 8703,
      name: "父女重逢",
      from: 15,
      to: 16,
      goal: "按照祭文指引，找到宫殿中厅的大祭司。",
      desc: "循着刻文的指向，长廊深处传来了祈祷声。蒂卡尔停住脚步：“那是我的父亲！也许我还能劝他停止听从神使。让我再试一次。”",
      finish: "蒂卡尔，你竟带着外乡人闯进这里！神使赐下的神水让我们听见神谕，你为何一再违抗？"
    },
    {
      id: 8704,
      name: "制止大祭司",
      from: 16,
      to: 16,
      kill: [3215, 5],
      battle: 2663,
      radar: [19, 17],
      goal: "击退5个护教圣灵，打断大祭司的阻拦。",
      desc: "“既然你们执意闯入，就让护教圣灵将你们逐出宫殿！蒂卡尔，退到一旁，别再和这个外乡人一起违抗神使。”\n蒂卡尔低声请求：父亲已听不进劝告，先打断他对圣灵的操纵，千万不要下杀手。",
      waiting: "护教圣灵仍在阻挡去路，先打断大祭司对它们的操纵。",
      finish: "连护教圣灵也败了……咳，我已经拦不住你们。蒂卡尔，你竟真要反抗到最后？",
      exp: 2500,
      coins: 1e3
    },
    {
      id: 8705,
      name: "未醒的疑心",
      from: 16,
      to: 17,
      goal: "大祭司被扶往后殿，与蒂卡尔商量下一步。",
      desc: "大祭司疲惫地放下手：“我需要休息……来人，扶我去后殿。神使会为今日的事作出裁断。”守卫扶着他离开，蒂卡尔望着父亲的背影，久久没有说话。",
      finish: "他刚才有一瞬间认出了我，却仍不肯相信神水有问题。我们不能再让神使继续控制大家。前面的路还得走下去。"
    },
    {
      id: 8706,
      name: "宫殿神使",
      from: 17,
      to: 18,
      goal: "走向东侧长廊，面对挡路的神使。",
      desc: "蒂卡尔认出了前方的身影：“她就是先前逃走的神使。她挡住了通往祭祀宫殿的路，我们得从这里突破。无论她如何威胁，都不能把水晶头骨交出去。”",
      finish: "毁了我的神水，又打伤大祭司，区区凡人真是不知死活。我的同伴都在祭殿，今日谁也救不了你！"
    },
    {
      id: 8707,
      name: "斩断操纵",
      from: 18,
      to: 18,
      kill: [3219, 1],
      battle: 2666,
      radar: [30, 11],
      goal: "击败宫殿神使及其随从。",
      desc: "“护卫，拿下他们！我要让所有反抗者记住背叛的下场！”神使唤来了随从，堵住了长廊。蒂卡尔握紧手中的头骨，与你并肩迎向敌人。",
      waiting: "神使还没有被击败。稳住阵脚，再次迎战她和随从。",
      finish: "怎么可能……你竟能打败我！",
      exp: 5e3,
      coins: 2500
    },
    {
      id: 8708,
      name: "神使的诅咒",
      from: 18,
      to: 19,
      goal: "听完神使的诅咒，与长廊前方的蒂卡尔汇合。",
      desc: "“别以为这样就赢了！我的同伴不会放过你们，我们的神终会降临！”败退的神使仍在咒骂。你们越过散开的随从，终于走出了她的包围。",
      finish: "她仍在用恐惧控制我们。父亲被带去了后殿，我们还得找到他；要阻止更多人受害，也必须面对祭殿里的其余神使。"
    },
    {
      id: 8709,
      name: "通往祭殿",
      from: 19,
      to: 20,
      goal: "沿长廊抵达祭殿入口，与蒂卡尔交谈后进入祭祀宫殿。",
      desc: "祭文所指的长廊就在前面。我从小看父亲沿这条路主持神礼，如今却要带着武器走进去。无论如何，我们一起把它夺回来。",
      finish: "祭祀宫殿到了。里面还有神使和爪牙，接下来更要小心。我们进去吧。"
    }
  ]

function npc({ id, name, x, y, icon = "15068", phase, target, group, talk = "" }) {
  const npcType = target ? 3 : group ? 1 : 0, status = phase ? 10 : 3;
  const row = {
    mapId: 962,
    id,
    name,
    x,
    y,
    sign: 0,
    missionGroupID: 0,
    npcType,
    icon1: icon,
    businessIcon: 0,
    welcome: "",
    talkDetail: talk,
    status,
    direction: 1,
    rangeX: 0,
    rangeY: 0,
    localMayaStory: true,
    sources: []
  };
  const w = new Writer().byte(0).byte(id).byte(0).byte(npcType).long(icon).short(0).utf(name).utf("").utf(talk).byte(status).byte(1).byte(x).byte(y).byte(0).byte(0);
  if (phase) {
    row.missionData = phase;
    w.short(phase[0]).byte(phase[1]).short(phase[2]).byte(phase[3]);
  }
  if (target) {
    row.topic = "前往" + name;
    row.jumpMapID = [target[0]];
    row.jumpMapGx = [target[1]];
    row.jumpMapGy = [target[2]];
    w.utf(row.topic).short(target[0]).byte(target[1]).byte(target[2]);
  }
  if (group) {
    row.battleID = [group];
    row.comeOutTime = 20;
    w.short(group).byte(20);
  }
  row.wireBase64 = w.done().toString("base64");
  return row;
}
export function createMayaPalaceStory(official2) {
  const npcs = [
    npc({ id: 0, name: "卡斯蒂略金字塔", x: 1, y: 12, icon: "1338", target: [961, 36, 2] }),
    npc({ id: 14, name: "蒂卡尔", x: 2, y: 12, phase: [3219, 7, 8702, 1], talk: "先扫清门廊，再循着祭文寻找通往祭祀宫殿的路。" }),
    npc({ id: 15, name: "祭文石碑", x: 10, y: 14, icon: "15290", talk: "风化的石面上，仍能辨认出祭典行路的刻文。" }),
    npc({ id: 16, name: "大祭司", x: 17, y: 18, icon: "15308", phase: [8703, 7, 8705, 1] }),
    npc({ id: 17, name: "蒂卡尔", x: 23, y: 14, phase: [8705, 7, 8706, 1] }),
    npc({ id: 18, name: "神使", x: 29, y: 11, icon: "15121", phase: [8706, 7, 8708, 1] }),
    npc({ id: 19, name: "蒂卡尔", x: 33, y: 10, phase: [8708, 7, 8709, 7] }),
    npc({ id: 20, name: "蒂卡尔", x: 35, y: 11, phase: [8709, 7, 0, 0], talk: "祭祀宫殿就在前方。" }),
    npc({ id: 30, name: "门廊守卫", x: 6, y: 15, icon: "15317", group: 2659, phase: [8701, 2, 8701, 5] }),
    npc({ id: 33, name: "门廊守卫", x: 8, y: 15, icon: "15317", group: 2659, phase: [8701, 2, 8701, 5] }),
    npc({ id: 34, name: "门廊守卫", x: 5, y: 17, icon: "15317", group: 2659, phase: [8701, 2, 8701, 5] }),
    npc({ id: 35, name: "门廊守卫", x: 7, y: 16, icon: "15317", group: 2659, phase: [8701, 2, 8701, 5] }),
    npc({ id: 31, name: "护教圣灵", x: 19, y: 17, icon: "15112", group: 2663, phase: [8704, 2, 8704, 5] }),
    npc({ id: 36, name: "护教圣灵", x: 20, y: 16, icon: "15112", group: 2663, phase: [8704, 2, 8704, 5] }),
    npc({ id: 37, name: "护教圣灵", x: 18, y: 17, icon: "15112", group: 2663, phase: [8704, 2, 8704, 5] }),
    npc({ id: 38, name: "护教圣灵", x: 20, y: 18, icon: "15112", group: 2663, phase: [8704, 2, 8704, 5] }),
    npc({ id: 32, name: "神使与随从", x: 30, y: 11, icon: "15121", group: 2666, phase: [8707, 2, 8707, 5] }),
    npc({ id: 39, name: "神使随从", x: 28, y: 10, icon: "15121", group: 2666, phase: [8707, 2, 8707, 5] }),
    npc({ id: 40, name: "神使随从", x: 32, y: 12, icon: "15121", group: 2666, phase: [8707, 2, 8707, 5] }),
    npc({ id: 1, name: "祭祀宫殿", x: 36, y: 11, icon: "1338", target: [838, 34, 18] })
  ];
  const byNpc = new Map(npcs.map((n) => [n.id, n]));
  const missions = scenes.map((scene, i2) => {
    if (official2.missions.some((q) => q.id === scene.id)) throw Error("Local Maya story ID collision: " + scene.id);
    const prev = i2 ? scenes[i2 - 1] : official2.missions.find((q) => q.id === 3219), target = byNpc.get(scene.to), radar = scene.radar || [target.x, target.y];
    if (scene.battle && !official2.groups.some((g) => g.groupId === scene.battle)) throw Error("Missing Maya story battle " + scene.battle);
    const acceptCondition = [{
      type: 9,
      typeName: "CONDITION_MISSION_DONE",
      not: 0,
      missionId: prev.id,
      name: prev.name,
      rawHex: new Writer().short(prev.id).utf(prev.name).done().toString("hex")
    }];
    const submitCondition = [];
    if (scene.kill) {
      const [monsterId, required] = scene.kill, monster = official2.monsters.find((m) => m.id === monsterId);
      if (!monster) throw Error("Missing Maya story monster " + monsterId);
      submitCondition.push({
        type: 2,
        typeName: "CONDITION_KILL_MONSTER",
        not: 0,
        monsterId,
        name: monster.name,
        required,
        current: 0,
        rawHex: new Writer().short(monsterId).utf(monster.name).byte(required).byte(0).done().toString("hex")
      });
    }
    const last = i2 === scenes.length - 1;
    return {
      id: scene.id,
      name: scene.name,
      level: 0,
      simpleDesc: scene.goal,
      desc: (i2 === 0 ? "【单机剧情】\n" : "") + scene.desc,
      setting: 5122,
      mapId: 962,
      npcId: scene.to,
      radarMapID: 962,
      radarGx: radar[0],
      radarGy: radar[1],
      dialogNotStartNotReady: "请先完成前面的宫殿调查。",
      dialogStartNotFinish: scene.waiting || scene.goal,
      dialogStartFinish: scene.finish,
      exp: scene.exp ?? 100,
      money2: 0,
      money3: scene.coins ?? 0,
      acceptJumpMapID: 0,
      submitJumpMapID: last ? 838 : 0,
      ...last ? { submitJumpMapGx: 34, submitJumpMapGy: 18 } : {},
      acceptBattleID: scene.battle || 0,
      submitBattleID: 0,
      submitNextMissionID: last ? 1824 : scenes[i2 + 1].id,
      rewardItems: [],
      selectItems: [],
      acceptCondition,
      submitCondition,
      type: 7,
      series: "玛雅副本·地下宫殿",
      acceptMapId: 962,
      acceptNpcId: scene.from,
      canAccept: 1,
      _isHelp: !!scene.kill,
      localMayaStory: true,
      sourceKind: "locally-authored-continuation",
      sources: [{ origin: "local-maya-palace-story", mapId: 962, npcId: scene.from }]
    };
  });
  return { missions, map: {
    id: 962,
    name: "地下宫殿",
    recordedName: "地下宫殿",
    nameSource: "recorded-neighbor-portal",
    spawn: [1, 12],
    spawnSource: "recorded-961-portal",
    localMayaStory: true,
    geometrySource: "client/assets/26/265345ede5466edb.json",
    npcs
  } };
}
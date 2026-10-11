// MOD(country-skill-shop)：国家专属技能（防御战术（劈砍）/（穿刺）、驯兽战斗、灵兽守护）。
//
// 为什么单独成文件，而不是写进 data/career-skills.json：
//   tests/career-skills.test.mjs 与 tests/career-effect-sign.test.mjs 是上游验收用例
//   （与 2026-09-23 原始包逐字节一致），它们的断言是「careers.skills 恰好 470 个，
//   每个技能都必须是 1–22 级」。而国家专属技能在原版里只有 20 级，且原版渠道
//   （data/skill-progression.json）里没有这几级的定义。硬塞进上游文件会同时破坏这两条验收。
//   所以本地新增技能放在这里，由 lib/restoration.mjs 合并进运行时的 skills 表。
//
// 这些技能不带 career 标记，且不在 careers.skills 里，因此不参与上游用例的
// 「career 技能必须是 1–22 级」检查；运行时不读 career 字段（lib/ 与 web/ 全库无引用）。
import fs from 'node:fs';

const data = JSON.parse(fs.readFileSync(new URL('../data/local-career-skills.json', import.meta.url), 'utf8'));

export const localCareerSkills = data.skills;
export const localCareerSkillIds = new Set(localCareerSkills.map(skill => skill.id));
// 国家专属技能的原版等级上限（客户端按技能自身的 maxLevel 显示 1–20）。
export const LOCAL_CAREER_SKILL_LEVEL_CAP = data.levelCap ?? 20;

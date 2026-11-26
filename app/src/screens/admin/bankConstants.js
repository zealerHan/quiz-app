// screens/admin/bankConstants.js
//
// 题库分类常量（从 AdminScreen.jsx 抽出，2026-11-27）
//
// 5 分类体系 v2，用户 2026-09 定版。
// 口径：emergency=车上设备故障（司机自办）/ abnormal=车外环境设施因素（多专业联动）
//
// 为什么单独一个文件：BANK_TYPES 被 BankTypeSelect、AddQuestionPanel、
// 题库 tab 渲染、导出等多处使用，放共享文件避免循环引用。

export const BANK_TYPES = [
  { key: 'emergency',  icon: '🚨', label: '应急',           color: 'var(--p-red-71)' },
  { key: 'essential',  icon: '📕', label: '应知必会',       color: 'var(--p-blue-68)' },
  { key: 'event',      icon: '📋', label: '安全事件',       color: 'var(--p-amber-61)' },
  { key: 'abnormal',   icon: '⚠️', label: '非正常情况行车', color: 'var(--p-amber-56)' },
  { key: 'compliance', icon: '⚖️', label: '违法乱纪',       color: 'var(--p-indigo-76)' },
];

export const BANK_TYPE_MAP = Object.fromEntries(BANK_TYPES.map(t => [t.key, t]));

/** banks 数组按 bank_type 分组；'manual' 类型不进分组 */
export const groupBanksByType = (banks) => {
  const groups = {};
  BANK_TYPES.forEach(t => { groups[t.key] = []; });
  banks.forEach(b => {
    const k = b.bank_type || 'essential';
    if (k !== 'manual' && groups[k]) groups[k].push(b);
  });
  return groups;
};

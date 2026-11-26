// ─── 假期权益计算（老韩 2026-11-26）────────────────────────────────
//
// 解决问题：婚假 / 陪产假 / 育儿假 的额度不是「每年手填一个死数字」，
// 而是跟着某个日期事件走、并且有有效期。这里把规则写成纯函数，
// 输入「事件日期 + 今天」，输出「此刻有效额度 + 本期起止 + 剩余天数」。
//
// 规则来源（务必不要凭记忆改）：
//
//   ① 育儿假 —— 武汉市政府答复
//      https://www.wuhan.gov.cn/hdjl/lxgs/202203/t20220323_1944231.shtml
//      依据《〈湖北省人口与计划生育条例〉有关问题的解答》鄂卫办通〔2021〕74号
//      原文：「3岁以下婴幼儿父母每人每年享受累计10天育儿假，从子女出生之日起，
//            按照自然年度计算。……不按照子女数量叠加享受。」
//      官方算例（孩子 2020-02-22 生）：
//        2021.11.26-2021.12.31  10天
//        2022.1.1-2022.12.31    10天
//        2023.1.1-2023.2.22     10天  ← 满3岁前一天截止
//      → 首年 = 出生日到当年 12-31；中间整年各 10 天；末年 = 1-1 到满3岁前一天。
//
//   ② 婚假 15 天 —— 老韩 2026-11-26 定论。领证日起 365 天内有效，过期归零。
//
//   ③ 陪产假 15 天 —— 条例为「配偶享受15天护理假」；「出生日起 3 个月内有效、
//      可分次」是单位管理口径，不是条例规定。代码里按单位口径执行。
//
// 育儿假为什么不按生日滚动：老韩原提的「5月1日出生 → 每年5月1日滚动」这种切法
// 总天数同样是 40 天（4 个周期），但边界与官方答复不一致。2026-11-26 明确选定
// 按官方自然年度切。别自作聪明改回生日滚动。

const DAY = 86400000;

// 日期工具：统一用 YYYY-MM-DD 字符串，避免时区漂移
function parseDate(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}
function fmt(d) {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}
function addDays(s, n) {
  const d = parseDate(s);
  if (!d) return null;
  return fmt(new Date(d.getTime() + n * DAY));
}
function addMonths(s, n) {
  const d = parseDate(s);
  if (!d) return null;
  const y = d.getUTCFullYear(), mo = d.getUTCMonth() + n, day = d.getUTCDate();
  // 月份溢出自动进位；目标月天数不足时取该月最后一天（1-31 +1月 → 2-28/29）
  const lastDay = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  return fmt(new Date(Date.UTC(y, mo, Math.min(day, lastDay))));
}
/** 含头含尾的天数差：(b - a) + 1 */
function daysBetween(a, b) {
  const da = parseDate(a), dbb = parseDate(b);
  if (!da || !dbb) return 0;
  return Math.round((dbb - da) / DAY) + 1;
}
/** a <= b */
function lte(a, b) { return a <= b; }

// ─── 育儿假：按自然年度切 ────────────────────────────────────────
// 返回该权益在「今天」这个日期下落在哪个周期，以及全周期列表
function parentalCycles(birthDate, perYear = 10) {
  const birth = parseDate(birthDate);
  if (!birth) return [];
  const by = birth.getUTCFullYear();
  const threeYearsOld = addDays(addMonths(birthDate, 36), -1); // 满3岁前一天
  const lastDay = threeYearsOld;                                // 育儿假到这天为止
  const cycles = [];
  for (let y = by; ; y++) {
    const start = (y === by) ? fmt(birth) : `${y}-01-01`;
    let end = `${y}-12-31`;
    if (lte(lastDay, end)) end = lastDay;   // 末年截到满3岁前一天
    if (lte(end, start) && y !== by) break; // 越过截止，收工
    cycles.push({
      year: y,
      start,
      end,
      days: perYear,
      is_first: y === by,
      is_last: end === lastDay,
    });
    if (end === lastDay) break;             // 已经到末年
    if (y - by > 6) break;                  // 防御：异常日期不要死循环
  }
  return cycles;
}

// ─── 通用：给定权益 + 今天，算当前有效周期 ───────────────────────
// 返回 { total, cycleStart, cycleEnd, cycles, active, expired, expireLabel }
function computeRight(right, today) {
  const kind = right.kind;
  const ev = right.event_date;
  const total = Number(right.total_days) || 0;
  const todayStr = today;

  if (!ev) {
    return { total, cycleStart: null, cycleEnd: null, cycles: [], active: true,
             expired: false, expireLabel: '', reason: '未填事件日期，暂按无期限处理' };
  }

  if (kind === 'marriage') {
    // 领证日起 365 天（含领证当天，到第365天）
    const end = addDays(ev, 364);
    const expired = todayStr > end;
    return {
      total,
      cycleStart: ev, cycleEnd: end, cycles: [{ start: ev, end, days: total }],
      active: !expired, expired,
      expireLabel: expired ? `已于 ${end} 过期` : `${end} 前有效`,
      reason: '领证日起 365 天内有效，过期归零',
    };
  }

  if (kind === 'paternity') {
    // 出生日起 3 个月（单位口径）
    const end = addDays(addMonths(ev, 3), -1);
    const expired = todayStr > end;
    return {
      total,
      cycleStart: ev, cycleEnd: end, cycles: [{ start: ev, end, days: total }],
      active: !expired, expired,
      expireLabel: expired ? `已于 ${end} 过期` : `${end} 前有效`,
      reason: '出生日起 3 个月内有效（单位口径），可分次',
    };
  }

  if (kind === 'parental') {
    const cycles = parentalCycles(ev, total);
    if (!cycles.length) {
      return { total, cycleStart: null, cycleEnd: null, cycles: [], active: false,
               expired: true, expireLabel: '周期计算异常', reason: '出生日期异常' };
    }
    const cur = cycles.find(c => todayStr >= c.start && todayStr <= c.end);
    if (cur) {
      return {
        total: cur.days, cycleStart: cur.start, cycleEnd: cur.end, cycles,
        active: true, expired: false,
        expireLabel: `${cur.end} 前有效（本周期 ${cur.start}~${cur.end}）`,
        reason: '按自然年度计算，每个自然年 10 天，到满 3 岁当年截止',
      };
    }
    // 今天不在任何周期内 → 全部过期（已满3岁）或还没出生
    const first = cycles[0], last = cycles[cycles.length - 1];
    const expired = todayStr > last.end;
    return {
      total, cycleStart: null, cycleEnd: last.end, cycles,
      active: false, expired,
      expireLabel: expired ? `已于 ${last.end} 结束（孩子满 3 岁）` : `${first.start} 起生效`,
      reason: expired ? '孩子已满 3 岁，育儿假已结束' : '孩子还没出生',
    };
  }

  // 未知类型：原样返回，不参与计算
  return { total, cycleStart: null, cycleEnd: null, cycles: [], active: true,
           expired: false, expireLabel: '', reason: '无周期规则' };
}

// ─── 汇总一个人某类假期在「今天」的可用额度 ──────────────────────
// rights: leave_rights 里该员工该 kind 的全部行
// used  : 已休天数（不含作废/驳回）
// 说明：育儿假「不按子女数量叠加」，多条权益时取「当前有效且额度最大」那条，
//       不把天数相加。婚假/陪产假同理（再婚另算一条权益即可，这里不叠加）。
function summarizeRights(rights, used, today) {
  if (!rights || !rights.length) return null;
  const computed = rights.map(r => ({ right: r, ...computeRight(r, today) }));
  // 优先当前有效的；都无效则取最后一条（用于显示"已过期"）
  const actives = computed.filter(c => c.active);
  const pick = actives.length
    ? actives.reduce((a, b) => (b.total > a.total ? b : a))
    : computed[computed.length - 1];
  const total = pick.total || 0;
  const left = Math.max(0, Math.round((total - used) * 10) / 10);
  return {
    kind: pick.right.kind,
    total,
    used: Math.round(used * 10) / 10,
    left,
    cycleStart: pick.cycleStart,
    cycleEnd: pick.cycleEnd,
    active: pick.active,
    expired: pick.expired,
    expireLabel: pick.expireLabel,
    reason: pick.reason,
    cycles: pick.cycles,
    rights: computed.map(c => ({
      id: c.right.id,
      event_date: c.right.event_date,
      total_days: c.right.total_days,
      cycle_kind: c.right.cycle_kind,
      note: c.right.note,
      active: c.active,
      expired: c.expired,
      expireLabel: c.expireLabel,
    })),
  };
}

module.exports = {
  parseDate, addDays, addMonths, daysBetween,
  parentalCycles, computeRight, summarizeRights,
};

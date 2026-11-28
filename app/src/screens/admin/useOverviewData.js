// ─── 概览 tab 的数据状态与加载（2026-11-28 从 AdminScreen 抽出）────────────
//
// 与 useOverviewUI.js 的分工：
//   useOverviewUI  → 纯 UI（折叠 / 弹窗 / 导出面板导航），不碰 fetch
//   useOverviewData（本文件）→ 数据状态 + 数据加载
//
// ## 抽出来的原因
//
// AdminScreen 原来有一个 178-192 行的巨型 useEffect，用
// `if(tab==='xxx'){...}` 串了 6 个分支，其中 overview 那一行压了 8 个请求。
// 谁的数据该谁取，放进各 tab 的 hook 后这个 effect 就只剩 dispatch。
//
// ## remRecords 的双写问题（2026-11-28 一并修掉）
//
// 原来有两处给 setRemRecords 赋值：
//   ① 178 行主 effect，请求 /api/admin/remediation/records   → 不带 month
//   ② 189 行独立 effect，请求 ...?month=${remMonth}          → 带 month
//
// 后端 498 行：const month = req.query.month || <当月>
// 所以 ① 拿的也是当月，和 ② 的初始请求完全重复 —— 每次打开概览都白跑一次。
//
// 现在 ① 删掉，只留 ②，并且把它并进本 hook 的 remRecords effect。
//
// ## 刻意没抽的
//
// dingtalkLoading —— 「推送钉钉」按钮的 loading，属于按钮交互状态，
//    留在 AdminScreen 的 pushDingtalk() 旁边比放 hook 里更好读。
// monthPlanCompletion —— 查过了：只出现在声明行和赋值处，取回来从没被读过，
//    是「只发请求不用结果」的死代码，连请求一起删掉。

import { useState, useEffect } from 'react';
import { apiJson } from '../../shared.jsx';

// 与后端一致的「当月」取值（用 sv-SE 拿到 YYYY-MM）
const currentMonth = () =>
  new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 7);

export function useOverviewData({ authed, tab, hdrs }) {
  const [overview, setOverview] = useState(null);
  const [lbSessions, setLbSessions] = useState([]);          // 本套班积分榜
  const [lbSessionsAlltime, setLbSessionsAlltime] = useState([]); // 累计积分榜
  const [weakQuestions, setWeakQuestions] = useState([]);    // 弱项题目
  const [monthMemberCompletion, setMonthMemberCompletion] = useState(null);
  const [exportMonths, setExportMonths] = useState([]);      // 导出可选月份
  const [remRecords, setRemRecords] = useState([]);          // 复查台账
  const [remMonth, setRemMonth] = useState(currentMonth);    // 复查台账的月份

  // ── 主数据：进概览时拉一次 ──
  // 注意：month-plan-completion 的请求已删（结果从未被读取）
  useEffect(() => {
    if (!authed || tab !== 'overview') return;
    apiJson('/api/admin/overview', { headers: hdrs() }).then(setOverview).catch(() => {});
    apiJson('/api/admin/leaderboard/cycle', { headers: hdrs() })
      .then(d => setLbSessions(d.rows || [])).catch(() => {});
    apiJson('/api/admin/leaderboard/alltime', { headers: hdrs() })
      .then(d => setLbSessionsAlltime(Array.isArray(d) ? d : (d.rows || []))).catch(() => {});
    apiJson('/api/admin/weak-questions', { headers: hdrs() })
      .then(setWeakQuestions).catch(() => {});
    apiJson('/api/export/months', { headers: hdrs() })
      .then(setExportMonths).catch(() => {});
    apiJson('/api/admin/month-member-completion', { headers: hdrs() })
      .then(setMonthMemberCompletion).catch(() => {});
  }, [tab, authed]);

  // ── 复查台账：跟随 remMonth 变化（唯一的数据源，不再有第二个 effect）──
  useEffect(() => {
    if (!authed || tab !== 'overview') return;
    apiJson(`/api/admin/remediation/records?month=${remMonth}`, { headers: hdrs() })
      .then(setRemRecords).catch(() => {});
  }, [remMonth, authed, tab]);

  return {
    overview, setOverview,
    lbSessions, setLbSessions,
    lbSessionsAlltime, setLbSessionsAlltime,
    weakQuestions, setWeakQuestions,
    monthMemberCompletion, setMonthMemberCompletion,
    exportMonths, setExportMonths,
    remRecords, setRemRecords,
    remMonth, setRemMonth,
  };
}

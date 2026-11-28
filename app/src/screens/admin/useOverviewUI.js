// ─── 概览 tab 的纯 UI 状态（2026-11-28 从 AdminScreen 抽出）──────────────
//
// 为什么抽：AdminScreen 里 81 个 useState 全堆在函数顶部，看代码时
// 分不清哪个属于哪个 tab。这里这 15 个的共同特征是：
//   **只被渲染用，不参与任何 fetch / useEffect / 数据变换**
// —— 折叠开关、弹窗开关、导出面板的三层导航状态。
//
// 所以抽出来是纯搬家，没有逻辑改动，也不需要动 useEffect。
//
// ⚠ 刻意没抽的两个（它们碰数据流，不属于「纯 UI」）：
//   remMonth        在 useEffect 里决定 /api/admin/remediation/records?month= 的参数
//   overview 等数据 由 fetch 写入
//
// 用法：
//   const ui = useOverviewUI();
//   ui.lbCollapsed        ui.setLbCollapsed
//   ui.resetModal         ui.setResetModal
//   ...
// 或者直接解构：
//   const { lbCollapsed, setLbCollapsed, resetModal, setResetModal } = useOverviewUI();

import { useState } from 'react';

export function useOverviewUI() {
  // ── 折叠开关（4 个）──
  const [lbCollapsed, setLbCollapsed] = useState(true);                 // 积分榜两列
  const [staffListCollapsed, setStaffListCollapsed] = useState(true);   // 人员名单
  const [allCorrectExpanded, setAllCorrectExpanded] = useState(false);  // 全对题目
  const [lowErrorExpanded, setLowErrorExpanded] = useState(false);      // 低错误率
  const [highErrorCollapsed, setHighErrorCollapsed] = useState(true);   // 高错误率

  // ── 弹窗开关（6 个）──
  const [resetModal, setResetModal] = useState(null);            // null | {staff_id, name}
  const [makeupModal, setMakeupModal] = useState(null);          // null | {staff_id, name}
  const [remediationModal, setRemediationModal] = useState(null); // null | {staff_id, name, score, ...}
  const [adminDrillModal, setAdminDrillModal] = useState(null);   // {staffId, staffName, mode, ...}
  const [memberEvalModal, setMemberEvalModal] = useState(null);   // {id, name, plans:[]}
  const [planDetailModal, setPlanDetailModal] = useState(null);   // plan object

  // ── 导出面板三层导航（4 个）──
  //   showExportMenu   null | 'open'
  //     ├─ exportWsModal===null && wsMultiMonthSel===null → 主面板
  //     ├─ wsMultiMonthSel!==null                        → 跨月合并
  //     └─ exportWsModal!==null                          → 按场次导出
  const [showExportMenu, setShowExportMenu] = useState(null);
  const [exportWsModal, setExportWsModal] = useState(null);
  const [quizExportSel, setQuizExportSel] = useState(new Set());  // 抽问记录多月勾选
  const [wsMultiMonthSel, setWsMultiMonthSel] = useState(null);   // null | {months:[], selected:Set}

  return {
    // 折叠
    lbCollapsed, setLbCollapsed,
    staffListCollapsed, setStaffListCollapsed,
    allCorrectExpanded, setAllCorrectExpanded,
    lowErrorExpanded, setLowErrorExpanded,
    highErrorCollapsed, setHighErrorCollapsed,
    // 弹窗
    resetModal, setResetModal,
    makeupModal, setMakeupModal,
    remediationModal, setRemediationModal,
    adminDrillModal, setAdminDrillModal,
    memberEvalModal, setMemberEvalModal,
    planDetailModal, setPlanDetailModal,
    // 导出
    showExportMenu, setShowExportMenu,
    exportWsModal, setExportWsModal,
    quizExportSel, setQuizExportSel,
    wsMultiMonthSel, setWsMultiMonthSel,
  };
}

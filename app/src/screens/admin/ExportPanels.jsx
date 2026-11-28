// screens/admin/ExportPanels.jsx
//
// 「导出记录」弹窗的三个面板，2026-11-27 从 AdminScreen.jsx 抽出。
//
// 结构（三层状态机，父组件持有状态，面板只管显示）：
//
//   showExportMenu === 'open'
//     ├─ exportWsModal===null && wsMultiMonthSel===null → ExportMainPanel
//     ├─ wsMultiMonthSel !== null                       → WorkshopMultiMonthPanel
//     └─ exportWsModal !== null                         → WorkshopPlansPanel
//
// 三个面板互不知道对方存在，切换由父组件改状态完成。
// 这样每个面板都能单独渲染、单独测。

import { useState, useMemo } from 'react';
import { apiJson } from '../../shared.jsx';

/**
 * 主选择面板
 *
 * 两块：
 *   1. 抽问记录 —— 多月份复选框 + 合并导出（/api/export/multi）+ 每月单独导出（/api/export）
 *   2. 月度任务 —— 两个入口：按场次导出、跨月合并
 *
 * props:
 *   pwd             管理员密码（拼进导出 URL 的 query）
 *   exportMonths    可选月份列表 ['2026-01', ...]
 *   quizExportSel   已勾选的月份 Set
 *   setQuizExportSel setter
 *   onOpenPlans     () => void        打开「按场次导出」面板
 *   onOpenWsMulti   () => void        打开「跨月合并」面板
 */
export function ExportMainPanel({
  pwd, exportMonths, quizExportSel, setQuizExportSel, onOpenPlans, onOpenWsMulti,
}) {
  const months = exportMonths || [];
  const sel = quizExportSel || new Set();
  const allSel = months.length > 0 && sel.size === months.length;

  const toggleAll = () => {
    setQuizExportSel(allSel ? new Set() : new Set(months));
  };

  const toggleOne = (m) => {
    const next = new Set(sel);
    next.has(m) ? next.delete(m) : next.add(m);
    setQuizExportSel(next);
  };

  const doMultiExport = () => {
    if (!sel.size) return;
    const ms = [...sel].sort().join(',');
    window.open(`/api/export/multi?password=${encodeURIComponent(pwd)}&months=${ms}`, '_blank');
  };

  return (
    <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
      {/* 抽问记录：复选框多月合并 */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, letterSpacing: 1 }}>📋 抽问记录</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              onClick={toggleAll}
              style={{
                padding: '3px 8px', borderRadius: 4, border: '1px solid var(--border)',
                background: 'transparent', color: 'var(--muted)', cursor: 'pointer',
                fontSize: 11, fontFamily: 'inherit',
              }}
            >{allSel ? '取消全选' : '全选'}</button>
            <button
              onClick={doMultiExport}
              disabled={!sel.size}
              style={{
                padding: '3px 10px', borderRadius: 4, border: 'none',
                background: sel.size ? 'var(--blue)' : 'var(--border)',
                color: sel.size ? 'white' : 'var(--muted)',
                cursor: sel.size ? 'pointer' : 'default',
                fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
              }}
            >↓ 合并导出{sel.size ? ` (${sel.size}月)` : ''}</button>
          </div>
        </div>

        <div style={{ background: 'var(--input-bg)', border: '1px solid var(--p-blue-60-a25)', borderRadius: 8, overflow: 'hidden' }}>
          {months.length === 0 && (
            <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--muted)' }}>暂无数据</div>
          )}
          {months.map((m) => {
            const isSel = sel.has(m);
            return (
              <div
                key={m}
                onClick={() => toggleOne(m)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                  borderTop: '1px solid var(--p-navy-22-a50)', cursor: 'pointer',
                  background: isSel ? 'var(--p-blue-60-a08)' : 'transparent',
                }}
              >
                <div style={{
                  width: 15, height: 15, borderRadius: 3,
                  border: `2px solid ${isSel ? 'var(--blue)' : 'var(--p-blue-27)'}`,
                  background: isSel ? 'var(--blue)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  {isSel && <span style={{ color: 'var(--text)', fontSize: 11, fontWeight: 700, lineHeight: 1 }}>✓</span>}
                </div>
                <span style={{ fontSize: 13, color: 'var(--text)', flex: 1 }}>{m}</span>
                <a
                  href={`/api/export?password=${encodeURIComponent(pwd)}&month=${m}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    fontSize: 11, color: 'var(--muted)', textDecoration: 'none',
                    padding: '2px 6px', borderRadius: 3, border: '1px solid var(--border)',
                  }}
                >单月↓</a>
              </div>
            );
          })}
        </div>
      </div>

      {/* 月度任务 */}
      <div>
        <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, letterSpacing: 1, marginBottom: 6 }}>🏭 月度任务</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onOpenPlans}
            style={{
              flex: 1, padding: '11px', borderRadius: 8,
              border: '1px solid var(--p-green-45-a30)', background: 'var(--p-green-45-a06)',
              color: 'var(--p-green-58)', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
            }}
          >按场次导出 →</button>
          <button
            onClick={onOpenWsMulti}
            style={{
              flex: 1, padding: '11px', borderRadius: 8,
              border: '1px solid var(--p-amber-56-a30)', background: 'var(--p-amber-56-a06)',
              color: 'var(--p-amber-56)', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
            }}
          >跨月合并 →</button>
        </div>
      </div>
    </div>
  );
}

/**
 * 培训记录跨月合并面板
 *
 * 勾选若干月份，导出一份 Excel，每个月一个 Sheet（含培训日程和出勤人数）。
 * 接口：GET /api/export/workshop?months=2026-01,2026-02
 *
 * props:
 *   pwd     管理员密码
 *   state   {months:[], selected:Set}
 *   setState setter
 *   onBack  () => void
 */
export function WorkshopMultiMonthPanel({ pwd, state, setState, onBack }) {
  const months = state?.months || [];
  const sel = state?.selected || new Set();
  const allSel = months.length > 0 && months.every((m) => sel.has(m));

  const toggleM = (m) => {
    const next = new Set(sel);
    next.has(m) ? next.delete(m) : next.add(m);
    setState((prev) => ({ ...prev, selected: next }));
  };

  const doExport = () => {
    if (!sel.size) return;
    const ms = [...sel].sort().join(',');
    window.open(`/api/export/workshop?password=${encodeURIComponent(pwd)}&months=${ms}`, '_blank');
  };

  return (
    <>
      <div style={{
        padding: '8px 14px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
      }}>
        <button
          onClick={onBack}
          style={{ background: 'none', border: 'none', color: 'var(--p-blue-68)', fontSize: 13, cursor: 'pointer', padding: 0, marginRight: 4 }}
        >← 返回</button>
        <span style={{ fontSize: 13, color: 'var(--text)', flex: 1, fontWeight: 600 }}>培训记录跨月合并</span>
        <button
          onClick={() => setState((prev) => ({ ...prev, selected: allSel ? new Set() : new Set(months) }))}
          style={{
            padding: '5px 8px', borderRadius: 5, border: '1px solid var(--border)',
            background: 'transparent', color: 'var(--muted)', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit',
          }}
        >{allSel ? '取消全选' : '全选'}</button>
        <button
          onClick={doExport}
          disabled={!sel.size}
          style={{
            padding: '5px 12px', borderRadius: 5, border: 'none',
            background: sel.size ? 'var(--p-amber-56)' : 'var(--border)',
            color: sel.size ? 'var(--p-amber-05)' : 'var(--muted)',
            cursor: sel.size ? 'pointer' : 'default',
            fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
          }}
        >↓ 导出{sel.size ? ` (${sel.size}月)` : ''}</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--muted)' }}>
          每个月生成一个 Sheet，含培训日程和出勤人数
        </div>
        {months.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '28px 0', fontSize: 13 }}>暂无数据</div>
        )}
        {months.map((m) => (
          <div
            key={m}
            onClick={() => toggleM(m)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px',
              borderBottom: '1px solid var(--p-navy-22-a35)', cursor: 'pointer',
              background: sel.has(m) ? 'var(--p-amber-56-a06)' : 'transparent',
            }}
          >
            <div style={{
              width: 16, height: 16, borderRadius: 3,
              border: `2px solid ${sel.has(m) ? 'var(--p-amber-56)' : 'var(--p-blue-27)'}`,
              background: sel.has(m) ? 'var(--p-amber-56)' : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              {sel.has(m) && <span style={{ color: 'var(--p-amber-05)', fontSize: 11, fontWeight: 700, lineHeight: 1 }}>✓</span>}
            </div>
            <span style={{ fontSize: 13, color: 'var(--text)' }}>{m}</span>
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * 月度任务按场次勾选面板
 *
 * 选月份 → 列出该月每场培训 → 勾选若干场 → 导出 Excel。
 * 接口：GET /api/export/workshop?ids=1,2,3
 *
 * 本月有多场培训时最常用这个（比如「11月的车门系统故障实操」单独导一份）。
 *
 * props:
 *   pwd     管理员密码
 *   state   {plans, months, activeMonth, selected:Set, showMonthPicker, loading}
 *   setState setter
 *   onBack  () => void
 */
export function WorkshopPlansPanel({ pwd, state, setState, onBack }) {
  const {
    plans = [], months = [], activeMonth = '', selected: sel = new Set(),
    showMonthPicker = false, loading = false,
  } = state || {};

  const monthPlans = useMemo(
    () => plans.filter((p) => p.year_month === activeMonth),
    [plans, activeMonth]
  );
  const allSel = monthPlans.length > 0 && monthPlans.every((p) => sel.has(p.id));

  const switchMonth = (m) => {
    const mp = plans.filter((p) => p.year_month === m);
    setState((prev) => ({ ...prev, activeMonth: m, selected: new Set(mp.map((p) => p.id)), showMonthPicker: false }));
  };

  const toggleAll = () => {
    const next = new Set(sel);
    if (allSel) monthPlans.forEach((p) => next.delete(p.id));
    else monthPlans.forEach((p) => next.add(p.id));
    setState((prev) => ({ ...prev, selected: next }));
  };

  const toggleOne = (id) => {
    const next = new Set(sel);
    next.has(id) ? next.delete(id) : next.add(id);
    setState((prev) => ({ ...prev, selected: next }));
  };

  const doExport = () => {
    if (!sel.size) return;
    const ids = [...sel].join(',');
    window.open(`/api/export/workshop?password=${encodeURIComponent(pwd)}&ids=${ids}`, '_blank');
  };

  const typeColor = (t) =>
    t === '中旬会' ? 'var(--amber)' : t === '理论' ? 'var(--p-cyan-60)' : 'var(--p-green-52)';

  return (
    <>
      <div style={{
        padding: '8px 14px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
      }}>
        <button
          onClick={onBack}
          style={{ background: 'none', border: 'none', color: 'var(--p-blue-68)', fontSize: 13, cursor: 'pointer', padding: 0, marginRight: 4 }}
        >← 返回</button>

        <div style={{ position: 'relative', flex: 1 }}>
          <button
            onClick={() => setState((prev) => ({ ...prev, showMonthPicker: !prev.showMonthPicker }))}
            style={{
              padding: '5px 10px', borderRadius: 5,
              border: `1px solid ${showMonthPicker ? 'var(--blue)' : 'var(--border)'}`,
              background: 'transparent', color: 'var(--text)', cursor: 'pointer',
              fontSize: 12, fontFamily: 'inherit',
            }}
          >{activeMonth || '…'} ▾</button>

          {showMonthPicker && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 4px)', left: 0,
              background: 'var(--p-navy-10)', border: '1px solid var(--p-blue-60-a40)',
              borderRadius: 7, overflow: 'hidden', zIndex: 20,
              boxShadow: '0 4px 20px var(--p-black-00-a60)', minWidth: 110,
            }}>
              {months.map((m) => (
                <div
                  key={m}
                  onClick={() => switchMonth(m)}
                  style={{
                    padding: '8px 12px', fontSize: 12,
                    color: m === activeMonth ? 'var(--p-blue-68)' : 'var(--text)',
                    background: m === activeMonth ? 'var(--p-blue-60-a10)' : 'transparent',
                    cursor: 'pointer', borderTop: '1px solid var(--p-navy-22-a40)',
                  }}
                >{m}</div>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={toggleAll}
          style={{
            padding: '5px 8px', borderRadius: 5, border: '1px solid var(--border)',
            background: 'transparent', color: 'var(--muted)', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit',
          }}
        >{allSel ? '取消全选' : '全选'}</button>

        <button
          onClick={doExport}
          disabled={!sel.size}
          style={{
            padding: '5px 12px', borderRadius: 5, border: 'none',
            background: sel.size ? 'var(--green)' : 'var(--border)',
            color: sel.size ? 'var(--p-green-09)' : 'var(--muted)',
            cursor: sel.size ? 'pointer' : 'default',
            fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
          }}
        >↓ 导出{sel.size ? ` (${sel.size})` : ''}</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '28px 0', fontSize: 13 }}>加载中…</div>}
        {!loading && monthPlans.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '28px 0', fontSize: 13 }}>该月暂无培训计划</div>
        )}
        {monthPlans.map((p) => (
          <div
            key={p.id}
            onClick={() => toggleOne(p.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
              borderBottom: '1px solid var(--p-navy-22-a35)', cursor: 'pointer',
              background: sel.has(p.id) ? 'var(--p-green-45-a05)' : 'transparent',
            }}
          >
            <div style={{
              width: 16, height: 16, borderRadius: 3,
              border: `2px solid ${sel.has(p.id) ? 'var(--green)' : 'var(--p-blue-27)'}`,
              background: sel.has(p.id) ? 'var(--green)' : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              {sel.has(p.id) && <span style={{ color: 'var(--p-green-09)', fontSize: 11, fontWeight: 700, lineHeight: 1 }}>✓</span>}
            </div>
            <span style={{ fontSize: 12, color: 'var(--muted)', width: 36, flexShrink: 0 }}>{p.shift_date?.slice(5)}</span>
            <span style={{
              fontSize: 11, padding: '1px 5px', borderRadius: 3,
              border: `1px solid ${typeColor(p.plan_type)}55`, color: typeColor(p.plan_type), flexShrink: 0,
            }}>{p.plan_type}</span>
            <span style={{ fontSize: 12, color: 'var(--muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {p.group_name || ''}{p.instructor_name ? ` · ${p.instructor_name}` : ''}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

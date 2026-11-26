// ─── 我的假期（额度摘要 + 申报日历 + 休假记录 一屏整合）──────────────
// 老韩 2026-11-25 定：
//   · 额度压成顶部一行摘要，不再单独占一张卡
//   · 申报日历直接放在本页（不再是二级菜单），4 周，与首页共用 ShiftGrid
//   · 「我的休假」折叠：只露标题 + 最近一条（待审优先）
import { useState, useEffect } from "react";
import { apiJson, AppModal } from "../shared.jsx";
import { ShiftGrid, buildWeeks } from "../ShiftGrid.jsx";
import { splitByMonth, buildAttendanceText } from "../leaveCommon.js";

const LEAVE_TYPES = ['年休', '婚假', '陪产假', '育儿假', '病假', '事假'];

const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

const TYPE_COLOR = {
  年休: 'var(--p-purple-58)',
  婚假: 'var(--p-amber-53)',
  陪产假: 'var(--p-blue-74)',
  育儿假: 'var(--p-green-45)',
  病假: 'var(--p-red-60)',
  事假: 'var(--muted)',
};

const STATUS_TEXT = {
  draft: '草稿',
  submitted: '待审批',
  locked: '已批准',
  reported: '已报车场组',
  released: '已放行',
  oa_done: '已走OA',
  verified: '已销假',
  rejected: '已驳回',
  cancelled: '已取消',
  cancel_pending: '撤销待批',
};

export default function LeaveScreen({ user, onBack, onApply, refreshKey }) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mine, setMine] = useState([]);
  const [cancelFor, setCancelFor] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  // ── 申报状态 ──
  const [type, setType] = useState('年休');
  const [start, setStart] = useState(null);
  const [end, setEnd] = useState(null);
  const [shifts, setShifts] = useState({});
  const [groupLeaves, setGroupLeaves] = useState([]);
  const [win, setWin] = useState(null);
  const [preview, setPreview] = useState(null);
  const [msg, setMsg] = useState('');
  const [confirmCross, setConfirmCross] = useState(false);   // 跨月提交前的二次确认弹窗
  const [copied, setCopied] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(false);

  const sid = user?.staffId || user?.id;
  const today = fmt(new Date());
  const weeks = buildWeeks(4);   // 本周 + 未来 3 周

  const loadMine = () => {
    if (!sid) return;
    apiJson('/api/leave/mine', { headers: { 'x-staff-id': String(sid) } })
      .then(d => { if (Array.isArray(d?.records)) setMine(d.records); })
      .catch(() => {});
  };

  useEffect(() => {
    if (!sid) { setErr('未获取到工号，请重新登录'); setLoading(false); return; }
    setLoading(true);
    apiJson(`/api/leave/my?year=${year}`, { headers: { 'x-staff-id': String(sid) } })
      .then(d => { if (d?.error) setErr(d.error); else { setData(d); setErr(null); } })
      .catch(e => setErr(String(e)))
      .finally(() => setLoading(false));
    loadMine();
  }, [user, year, refreshKey]);

  // 4 周班次 + 全组休假（/api/shift/range 需要 x-staff-id 鉴权）
  useEffect(() => {
    if (!sid) return;
    const from = weeks[0][0], to = weeks[3][6];
    apiJson(`/api/shift/range?from=${from}&to=${to}`, { headers: { 'x-staff-id': String(sid) } })
      .then(d => {
        const m = {};
        (d?.days || []).forEach(x => { m[x.date] = x.shift; });
        setShifts(m);
        setGroupLeaves(d?.leaves || []);
      })
      .catch(() => {});
    // 申报窗口（周一起 ~ 周三 17:00 截止）
    apiJson('/api/leave/apply-window').then(setWin).catch(() => {});
  }, [sid, refreshKey]);

  // 扣减预览
  useEffect(() => {
    if (!start || !end) { setPreview(null); return; }
    const q = `start=${start}&end=${end}&type=${encodeURIComponent(type)}`;
    apiJson(`/api/leave/preview?${q}`, { headers: { 'x-staff-id': String(sid) } })
      .then(d => { if (d?.error) { setMsg(d.error); setPreview(null); } else { setPreview(d); setMsg(''); } })
      .catch(e => setMsg(String(e)));
  }, [start, end, type, sid]);

  const doCancel = async () => {
    if (!cancelReason.trim()) { setToast('请填写撤销原因'); return; }
    setBusy(true);
    try {
      const r = await apiJson(`/api/leave/${cancelFor}/cancel-request`, {
        method: 'POST',
        headers: { 'x-staff-id': String(sid) },
        body: JSON.stringify({ reason: cancelReason.trim() }),
      });
      if (r?.error) setToast(r.error);
      else {
        setToast(r.need_approval ? '撤销申请已提交，等管理员批准' : '已撤销');
        setCancelFor(null); setCancelReason('');
        loadMine();
      }
    } catch (e) { setToast(String(e)); }
    setBusy(false);
    setTimeout(() => setToast(null), 2600);
  };

  const quota = data?.quota;
  const records = data?.records || [];
  const disabled = (date) => date < today;

  const onPick = (date) => {
    if (disabled(date)) { setMsg('过去的时间不能申报'); return; }
    setMsg('');
    if (!start || (start && end)) { setStart(date); setEnd(null); return; }
    if (date < start) { setStart(date); setEnd(null); return; }
    setEnd(date);
  };

  // 合并「我的申请」+「休假台账」
  const allRecords = (() => {
    const mineById = new Map(mine.map(r => [r.id, r]));
    const fromLedger = records
      .filter(r => !mineById.has(r.id))
      .map(r => ({
        id: r.id, leave_type: r.leave_type, start_date: r.start_date, end_date: r.end_date,
        days: r.days, status: r.status, is_app_flow: false, steps: [], terminal: null, can_cancel: false,
      }));
    return [...mine, ...fromLedger].sort((a, b) =>
      (b.start_date || '').localeCompare(a.start_date || '')
    );
  })();
  const pendingCount = allRecords.filter(
    r => r.status === 'submitted' || r.status === 'cancel_pending'
  ).length;
  const recent = allRecords.find(r => r.status === 'submitted' || r.status === 'cancel_pending') || allRecords[0];

  // 跨月判断（只提醒，不拦）—— 逻辑在 src/leaveCommon.js，两页共用
  const crossMonths = splitByMonth(start, end);
  const needTwoForms = crossMonths.length > 1;

  // ── 全组休假条（每周一层）：横跨几格=休几天，跨周自动截断 ──
  // 老韩 2026-11-25：「申报假期也应该看到其他人的申报，信息透明，
  // 也能让申报人明白自己是否是超出部分」
  //
  // 实线/虚线【不在前端判断】——后端 computeLeavePending() 是唯一来源，
  // 首页和申报页共用。前端只读 lv.pending 渲染。
  // （这里曾自己算过一遍「周窗+名额」，与首页各写一份导致结果不一致）
  const LEAVE_ABBR = { 年休: '年', 育儿假: '育', 婚假: '婚', 陪产假: '产', 病假: '病', 事假: '事' };
  const LEAVE_COLOR = {
    年休:   { bg: 'rgba(91,155,250,0.20)',  border: 'rgba(91,155,250,0.60)',  text: '#8ab8fc' },
    陪产假: { bg: 'rgba(232,120,180,0.20)', border: 'rgba(232,120,180,0.60)', text: '#f094c4' },
    婚假:   { bg: 'rgba(238,114,104,0.20)', border: 'rgba(238,114,104,0.60)', text: '#f08d84' },
    育儿假: { bg: 'rgba(255,167,38,0.20)',  border: 'rgba(255,167,38,0.60)',  text: '#ffb657' },
    病假:   { bg: 'rgba(160,160,160,0.20)', border: 'rgba(160,160,160,0.55)', text: '#b8b8b8' },
    事假:   { bg: 'rgba(160,160,160,0.20)', border: 'rgba(160,160,160,0.55)', text: '#b8b8b8' },
  };
  // 单格宽度约 46px，放不下三字全名（「韩思成（育）」要 60px+）
  // 单格 → 取姓（韩思成→韩）；两格以上 → 全名
  const shortenName = (name, span) =>
    span > 1 ? name : ((name || '').length >= 3 ? (name || '').charAt(0) : (name || ''));

  const buildBars = (rowDates) => {
    const first = rowDates[0], last = rowDates[6];
    const bars = [];
    (groupLeaves || []).forEach(lv => {
      const s = lv.start_date > first ? lv.start_date : first;
      const e = lv.end_date < last ? lv.end_date : last;
      if (s > e) return;
      const si = rowDates.indexOf(s), ei = rowDates.indexOf(e);
      if (si < 0 || ei < 0) return;
      bars.push({
        name: lv.real_name || '',
        type: lv.leave_type || '年休',
        abbr: LEAVE_ABBR[lv.leave_type] || (lv.leave_type || '年').charAt(0),
        startIdx: si, span: ei - si + 1,
        clippedStart: lv.start_date < first,
        clippedEnd: lv.end_date > last,
        pending: !!lv.pending,          // ← 后端算好的，前端不重算
        isSelf: String(lv.staff_id) === String(sid),
      });
    });
    bars.sort((a, b) => a.startIdx - b.startIdx || b.span - a.span);
    // 轨道分配：时间不重叠就共用一行
    const tracks = [];
    bars.forEach(b => {
      const bs = b.startIdx, be = b.startIdx + b.span - 1;
      let placed = false;
      for (let t = 0; t < tracks.length; t++) {
        if (!tracks[t].some(r => !(be < r.s || bs > r.e))) {
          tracks[t].push({ s: bs, e: be }); b.track = t; placed = true; break;
        }
      }
      if (!placed) { tracks.push([{ s: bs, e: be }]); b.track = tracks.length - 1; }
    });
    return { bars, trackCount: tracks.length };
  };

  const COL_GAP = 4;

  // 考勤员格式文本 —— 逻辑在 src/leaveCommon.js（两页共用，跨月自动拆段）
  const attendanceText = buildAttendanceText({
    start, end, staffName: user?.name, staffId: sid, leaveType: type, preview,
  });

  const copyAttendance = async () => {
    if (!attendanceText) return;
    try { await navigator.clipboard.writeText(attendanceText); setCopied(true); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = attendanceText; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); setCopied(true); } catch {}
      document.body.removeChild(ta);
    }
    setTimeout(() => setCopied(false), 1800);
  };

  // 真正提交
  const doSubmit = async () => {
    if (!start || !end) { setMsg('先选起止日期'); return; }
    setBusy(true); setMsg('');
    try {
      const r = await apiJson('/api/leave/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-staff-id': String(sid) },
        body: JSON.stringify({ start, end, type }),
      });
      if (r?.error) setMsg(r.error);
      else {
        setMsg('已提交，等班组长审批');
        setStart(null); setEnd(null); setPreview(null);
        loadMine();
      }
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(false); }
  };

  // 提交入口（老韩 2026-11-26）：跨月的假要分两张假单交。
  // 页面里的黄字提示容易被直接划过去，所以在点提交这一刻强制弹窗二次确认，
  // 把「要交几张、每张覆盖哪几天」摆出来。只提醒不阻断：点「仍然提交」照常入库，
  // 系统里仍是一条完整记录（考勤文本已按自然月拆成两段）。
  const submit = () => {
    if (!start || !end) { setMsg('先选起止日期'); return; }
    if (needTwoForms) { setConfirmCross(true); return; }
    doSubmit();
  };

  const num = (n) => (n ?? 0) % 1 === 0 ? (n ?? 0) : (n ?? 0).toFixed(1);

  return (
    <div className="screen" style={{ background: 'var(--bg)', paddingBottom: 28 }}>
      {/* 顶栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 16px 10px' }}>
        <button onClick={onBack} style={{
          background: 'var(--card-deep)', border: '1px solid var(--border)', borderRadius: 10,
          width: 32, height: 32, cursor: 'pointer', color: 'var(--text)', fontSize: 15,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>←</button>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>我的假期</div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2 }}>
          <button onClick={() => setYear(y => y - 1)} style={{
            background: 'none', border: 'none', color: 'var(--muted)', fontSize: 14,
            cursor: 'pointer', padding: '0 5px', fontFamily: 'var(--font)',
          }}>‹</button>
          <span style={{ fontSize: 11.5, color: 'var(--text)', fontWeight: 700, minWidth: 50, textAlign: 'center' }}>
            {year}年度
          </span>
          <button onClick={() => setYear(y => y + 1)} style={{
            background: 'none', border: 'none', color: 'var(--muted)', fontSize: 14,
            cursor: 'pointer', padding: '0 5px', fontFamily: 'var(--font)',
          }}>›</button>
        </div>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: 12 }}>加载中…</div>
      )}

      {err && (
        <div style={{ margin: '0 12px', padding: '12px 14px', borderRadius: 12, background: 'var(--p-red-60-a08)', border: '1px solid var(--p-red-60-a30)', color: 'var(--p-red-60)', fontSize: 12 }}>
          {err}
        </div>
      )}

      {!loading && !err && (
        <>
          {/* ── 假期余额：一行摘要，只显示有额度的假别 ──
              已休口径统一为「批准了就算扣」（老韩 2026-11-26）：
              已批但还没休到的天也计在已休里，所以这里额外标一句
              「含已批未休N天」，否则组员会以为余额被提前扣了。 */}
          {(() => {
            const D = quota?.detail || {};
            const rows = quota ? [
              { label: '年休',   total: quota.annual_total,    used: quota.annual_used,
                up: D['年休']?.upcoming || 0,   color: 'var(--p-purple-58)' },
              { label: '婚假',   total: quota.marriage_total,  used: quota.marriage_used,
                up: D['婚假']?.upcoming || 0,   color: 'var(--p-amber-53)' },
              { label: '陪产假', total: quota.paternity_total, used: quota.paternity_used,
                up: D['陪产假']?.upcoming || 0, color: 'var(--p-blue-74)' },
              { label: '育儿假', total: quota.parental_total,  used: quota.parental_used,
                up: D['育儿假']?.upcoming || 0, color: 'var(--p-green-45)' },
            ].filter(r => r.total > 0 || r.used > 0) : [];
            if (rows.length === 0) return null;
            return (
              <div style={{
                margin: '0 12px 10px', padding: '10px 13px', borderRadius: 12,
                background: 'var(--card)', border: '1px solid var(--border)',
              }}>
                <div style={{
                  fontSize: 11, color: 'var(--muted)', letterSpacing: '2.5px', fontWeight: 600,
                  marginBottom: 7,
                }}>假期余额</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 16px', alignItems: 'baseline' }}>
                  {rows.map(r => {
                    const left = (r.total ?? 0) - (r.used ?? 0);
                    return (
                    <span key={r.label} style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                      <span style={{ color: r.color, fontWeight: 700 }}>{r.label}</span>
                      {' '}剩 <span style={{ color: 'var(--text)', fontWeight: 800, fontSize: 13.5 }}>{num(left > 0 ? left : 0)}</span> 天
                      <span style={{ fontSize: 10 }}>（已休 {num(r.used)}·应得 {num(r.total)}）</span>
                      {r.up > 0 && (
                        <span style={{ fontSize: 10, color: '#e8a726', marginLeft: 4 }}>
                          含已批未休{num(r.up)}天
                        </span>
                      )}
                    </span>
                  );})}
                </div>
              </div>
            );
          })()}

          {/* ── 主卡：申报假期（标题 + 假别 + 4周日历 + 预览/休假信息 + 提交）── */}
          <div style={{
            margin: '0 12px 12px', background: 'var(--card)',
            border: '1px solid var(--border)', borderRadius: 16, padding: '12px 10px 11px',
          }}>
            {/* 板块标题（与「假期余额」「我的休假」同级） */}
            <div style={{
              fontSize: 11, color: 'var(--muted)', letterSpacing: '2.5px', fontWeight: 600,
              marginBottom: 10, padding: '0 2px',
            }}>申报假期</div>

            {/* 申报窗口状态条（老韩 2026-11-25 定：周一起、周三 17:00 截止） */}
            {win ? (
              <div style={{
                margin: '0 2px 9px', padding: '7px 10px', borderRadius: 9,
                background: win.expired ? 'rgba(232,167,38,0.10)' : 'rgba(92,194,124,0.10)',
                border: `1px solid ${win.expired ? 'rgba(232,167,38,0.42)' : 'rgba(92,194,124,0.42)'}`,
                fontSize: 10.5, lineHeight: 1.6,
                color: win.expired ? '#e8a726' : '#5cc27c',
              }}>
                {win.expired ? (
                  <>⏰ 本轮申报已截止（{win.deadline.slice(5, 16)}）· 现在可提前申报更远的周</>
                ) : (
                  <>✅ 申报下周（{win.target_week_start.slice(5)}~{win.target_week_end.slice(5)}）
                    · 截止 {win.deadline.slice(5, 16)}</>
                )}
              </div>
            ) : null}

            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10, padding: '0 2px' }}>
              {LEAVE_TYPES.map(t => (
                <button key={t} onClick={() => setType(t)} style={{
                  padding: '4px 11px', borderRadius: 8, fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font)',
                  background: type === t ? 'rgba(91,155,250,0.18)' : 'var(--card-deep)',
                  border: `1px solid ${type === t ? 'rgba(91,155,250,0.55)' : 'var(--border)'}`,
                  color: type === t ? '#7ec8f0' : 'var(--muted)',
                  fontWeight: type === t ? 700 : 400,
                }}>{t}</button>
              ))}
            </div>

            {weeks.map((row, ri) => {
              const { bars, trackCount } = buildBars(row);
              return (
                <div key={ri} style={{ marginBottom: 3 }}>
                  <ShiftGrid
                    days={row.map(date => ({ date, shift: shifts[date] }))}
                    showWeekday={ri === 0}
                    onPick={onPick}
                    start={start}
                    end={end}
                    disabledFn={disabled}
                    highlightSel
                  />
                  {/* 全组休假条：看到别人休了哪天，判断自己是否超名额 */}
                  {bars.length > 0 ? (
                    <div style={{ marginTop: 3, position: 'relative', height: trackCount * 19 - 2 }}>
                      {bars.map((b, bi) => {
                        const lc = LEAVE_COLOR[b.type] || LEAVE_COLOR['年休'];
                        const gap = COL_GAP;
                        const left = `calc(${b.startIdx} * ((100% - ${6*gap}px) / 7 + ${gap}px))`;
                        const width = `calc(${b.span} * ((100% - ${6*gap}px) / 7) + ${(b.span-1)*gap}px)`;
                        return (
                          <div key={bi} style={{
                            position: 'absolute', left, width, top: b.track * 19, height: 17,
                            background: b.pending ? 'transparent' : lc.bg,
                            border: b.pending ? `1.5px dashed ${lc.border}` : `1px solid ${lc.border}`,
                            opacity: b.pending ? 0.72 : 1,
                            borderRadius: b.clippedStart ? '2px 5px 5px 2px' : (b.clippedEnd ? '5px 2px 2px 5px' : 5),
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 9, fontWeight: 700, color: lc.text,
                            whiteSpace: 'nowrap', overflow: 'hidden',
                            // 本人那条加粗边框，一眼找到自己
                            boxShadow: b.isSelf ? `inset 0 0 0 1px ${lc.text}` : 'none',
                          }} title={`${b.name}·${b.type}${b.pending ? '（待审批）' : ''}`}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', padding: '0 1px' }}>
                              {b.clippedStart ? '‹' : ''}
                              {shortenName(b.name, b.span)}（{b.abbr}{b.pending ? '?' : ''}）
                              {b.clippedEnd ? '›' : ''}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}

                  {/* 每日休假人数：超过 1 人标黄，一眼看出哪几天名额满了 */}
                  {(() => {
                    const perDay = row.map(d => {
                      const n = (groupLeaves || []).filter(lv =>
                        lv.start_date <= d && lv.end_date >= d
                      ).length;
                      return n;
                    });
                    if (perDay.every(n => n === 0)) return null;
                    return (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: COL_GAP, marginTop: 2 }}>
                        {perDay.map((n, i) => (
                          <div key={i} style={{
                            textAlign: 'center', fontSize: 8.5, lineHeight: 1.3,
                            color: n === 0 ? 'transparent' : (n > 1 ? '#e8a726' : 'var(--muted)'),
                            fontWeight: n > 1 ? 800 : 500,
                          }}>{n === 0 ? '·' : `${n}人`}</div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              );
            })}

            {start && end ? (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                {preview ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 7, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>这段要扣</span>
                      <span style={{ fontSize: 20, fontWeight: 800, color: preview.enough ? 'var(--text)' : '#e8a726' }}>
                        {preview.days}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>天</span>
                      <span style={{ fontSize: 10.5, color: preview.enough ? 'var(--muted)' : '#e8a726', marginLeft: 'auto' }}>
                        余额 {preview.annual_left} 天{preview.enough ? '' : '（不够）'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', marginBottom: 8 }}>
                      {(preview.detail || []).map((d, i) => (
                        <span key={i} style={{ fontSize: 10, color: 'var(--muted)' }}>
                          {Number(d.date.slice(8))}号{d.shift}{' · '}{d.deduct ? d.deduct : '不扣'}
                        </span>
                      ))}
                    </div>
                  </>
                ) : null}

                {needTwoForms ? (
                  <div style={{
                    marginBottom: 8, padding: '8px 10px', borderRadius: 9,
                    background: 'rgba(232,167,38,0.10)', border: '1px solid rgba(232,167,38,0.45)',
                  }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: '#e8a726', marginBottom: 3 }}>
                      ⚠ 跨月休假，需提交 {crossMonths.length} 张假单
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.7 }}>
                      公司规定：假单按自然月分开提交，每张对应一个月的休假日期。
                    </div>
                    <div style={{ marginTop: 3 }}>
                      {crossMonths.map((m, i) => (
                        <div key={i} style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.8 }}>
                          {i + 1}. {m.label}　{m.start.slice(5)} ~ {m.end.slice(5)}　共 {m.days} 天
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {attendanceText ? (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '1px' }}>休假信息</span>
                      <button onClick={copyAttendance} style={{
                        marginLeft: 'auto', fontSize: 10.5, fontWeight: 700,
                        padding: '3px 10px', borderRadius: 7, cursor: 'pointer', fontFamily: 'var(--font)',
                        background: copied ? 'rgba(92,194,124,0.18)' : 'rgba(91,155,250,0.16)',
                        border: `1px solid ${copied ? 'rgba(92,194,124,0.55)' : 'rgba(91,155,250,0.5)'}`,
                        color: copied ? '#5cc27c' : '#7ec8f0',
                      }}>{copied ? '已复制' : '复制'}</button>
                    </div>
                    <div style={{
                      fontSize: 10.5, lineHeight: 1.75, color: 'var(--text)',
                      background: 'var(--card-deep)', border: '1px solid var(--border)',
                      borderRadius: 9, padding: '8px 10px', wordBreak: 'break-all',
                      // 跨月会拆成两行，必须 pre-wrap 才真的换行
                      // （默认 normal 会把 \n 当空格，两行连成一行）
                      whiteSpace: 'pre-wrap',
                    }}>{attendanceText}</div>
                  </div>
                ) : null}

                {msg ? <div style={{ fontSize: 10.5, color: '#e8a726', marginBottom: 7 }}>{msg}</div> : null}

                <button onClick={submit} disabled={busy} style={{
                  width: '100%', padding: '10px 0', borderRadius: 10, border: 'none',
                  fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: 'var(--font)',
                  background: busy ? 'var(--card-deep)' : 'linear-gradient(145deg,#5b9bfa,#3d7ae0)',
                  cursor: busy ? 'default' : 'pointer',
                }}>{busy ? '提交中…' : '提交申请'}</button>
              </div>
            ) : (
              <div style={{ marginTop: 8, fontSize: 10.5, color: msg ? '#e8a726' : 'var(--muted)', textAlign: 'center' }}>
                {msg || '点日历选开始和结束日期'}
              </div>
            )}
          </div>

          {/* ── 我的休假：折叠，只露标题 + 最近一条 ── */}
          <div style={{ margin: '0 12px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
            <div
              onClick={() => setRecordsOpen(o => !o)}
              style={{ padding: '12px 14px 10px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
            >
              <span style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '2.5px', fontWeight: 600 }}>
                我的休假（{allRecords.length}）
              </span>
              {pendingCount > 0 && (
                <span style={{
                  fontSize: 9.5, padding: '1px 7px', borderRadius: 5,
                  background: 'rgba(232,167,38,0.16)', border: '1px solid rgba(232,167,38,0.5)',
                  color: '#e8a726',
                }}>{pendingCount} 条待审</span>
              )}
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>{recordsOpen ? '⌃' : '⌄'}</span>
            </div>

            {/* 折叠态：最近一条（待审优先） */}
            {!recordsOpen && recent && (
              <div style={{ padding: '0 14px 12px', display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6, flexShrink: 0,
                  color: TYPE_COLOR[recent.leave_type] || 'var(--muted)',
                  background: 'var(--card-deep)', border: '1px solid var(--border)',
                }}>{recent.leave_type}</span>
                <span style={{ fontSize: 11.5, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {recent.start_date} → {recent.end_date}
                </span>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--text)', flexShrink: 0 }}>{recent.days}天</span>
                <span style={{
                  fontSize: 9.5, flexShrink: 0,
                  color: (recent.status === 'submitted' || recent.status === 'cancel_pending') ? '#e8a726' : 'var(--muted)',
                }}>{STATUS_TEXT[recent.status] || recent.status}</span>
              </div>
            )}

            {/* 展开态：全部记录 */}
            {recordsOpen && (
              <div style={{ borderTop: '1px solid var(--border)', padding: '4px 14px 10px' }}>
                {allRecords.length === 0 ? (
                  <div style={{ padding: '18px 0', textAlign: 'center', fontSize: 12, color: 'var(--muted)' }}>本年度暂无休假记录</div>
                ) : allRecords.map((r, i) => {
                  const t = r.terminal;
                  const showFlow = r.is_app_flow !== false;
                  const isPending = r.status === 'submitted' || r.status === 'cancel_pending';
                  const termColor = t?.type === 'rejected' ? 'var(--p-red-60)'
                    : t?.type === 'cancel_pending' ? 'var(--p-amber-53)' : 'var(--muted)';
                  return (
                    <div key={r.id} style={{ padding: '11px 0', borderBottom: i < allRecords.length - 1 ? '1px solid var(--border)' : 'none' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: showFlow ? 8 : 0 }}>
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6, flexShrink: 0,
                          color: TYPE_COLOR[r.leave_type] || 'var(--muted)',
                          background: 'var(--card-deep)', border: '1px solid var(--border)',
                        }}>{r.leave_type}</span>
                        <span style={{ fontSize: 11.5, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.start_date} → {r.end_date}
                        </span>
                        <span style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--text)', flexShrink: 0 }}>{r.days}天</span>
                        {!showFlow && (
                          <span style={{ fontSize: 9.5, color: 'var(--muted)', flexShrink: 0, minWidth: 42, textAlign: 'right' }}>
                            {STATUS_TEXT[r.status] || r.status}
                          </span>
                        )}
                        {isPending && (
                          <span style={{
                            fontSize: 9.5, fontWeight: 700, flexShrink: 0, padding: '1px 6px', borderRadius: 5,
                            background: 'rgba(232,167,38,0.16)', border: '1px solid rgba(232,167,38,0.5)', color: '#e8a726',
                          }}>{r.status === 'cancel_pending' ? '撤销待批' : '待审'}</span>
                        )}
                      </div>

                      {showFlow && (
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0, marginBottom: 6 }}>
                          {(r.steps || []).map((s, si) => {
                            const last = si === (r.steps.length - 1);
                            return (
                              <div key={s.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                                {!last && (
                                  <div style={{
                                    position: 'absolute', top: 5, left: '50%', width: '100%', height: 1.5,
                                    background: r.steps[si + 1]?.done ? 'var(--p-green-45)' : 'var(--border)',
                                  }} />
                                )}
                                <div style={{
                                  width: 11, height: 11, borderRadius: '50%', zIndex: 1,
                                  background: s.done ? 'var(--p-green-45)' : 'var(--card-deep)',
                                  border: s.current ? '2px solid var(--p-green-45)' : '1.5px solid var(--border)',
                                  boxShadow: s.current ? '0 0 0 3px rgba(76,175,110,.18)' : 'none',
                                }} />
                                <span style={{
                                  marginTop: 4, fontSize: 9, lineHeight: 1.25, textAlign: 'center',
                                  color: s.done ? 'var(--text)' : 'var(--muted)',
                                  fontWeight: s.current ? 800 : 500,
                                }}>{s.label}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {t && (
                        <div style={{
                          marginTop: 4, padding: '6px 9px', borderRadius: 8,
                          background: 'var(--card-deep)', border: `1px solid ${termColor}`,
                          fontSize: 10.5, color: termColor, lineHeight: 1.6,
                        }}>{t.label}{t.reason ? `：${t.reason}` : ''}</div>
                      )}

                      {r.can_cancel && (
                        <button onClick={() => { setCancelFor(r.id); setCancelReason(''); }} style={{
                          marginTop: 8, background: 'none', border: '1px solid var(--border)',
                          borderRadius: 8, padding: '4px 11px', fontSize: 10.5, color: 'var(--muted)',
                          cursor: 'pointer', fontFamily: 'var(--font)',
                        }}>{r.status === 'submitted' ? '撤回申请' : '申请撤销'}</button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* 撤销弹窗 */}
      {cancelFor && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 100,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }} onClick={() => !busy && setCancelFor(null)}>
          <div onClick={e => e.stopPropagation()} style={{
            width: '100%', maxWidth: 320, background: 'var(--card)', borderRadius: 16,
            border: '1px solid var(--border)', padding: '18px 16px 14px',
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>申请撤销休假</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.7, marginBottom: 12 }}>
              已批准的休假撤销需管理员同意。请说明原因：
            </div>
            <textarea
              value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
              placeholder="例如：计划有变，当天正常上班"
              rows={3}
              style={{
                width: '100%', boxSizing: 'border-box', resize: 'none',
                background: 'var(--card-deep)', border: '1px solid var(--border)', borderRadius: 10,
                padding: '9px 11px', fontSize: 12, color: 'var(--text)',
                fontFamily: 'var(--font)', outline: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={() => setCancelFor(null)} disabled={busy} style={{
                flex: 1, padding: '9px 0', borderRadius: 10, cursor: 'pointer',
                background: 'var(--card-deep)', border: '1px solid var(--border)',
                color: 'var(--text)', fontSize: 12.5, fontFamily: 'var(--font)',
              }}>取消</button>
              <button onClick={doCancel} disabled={busy} style={{
                flex: 1, padding: '9px 0', borderRadius: 10, cursor: busy ? 'default' : 'pointer',
                background: 'linear-gradient(145deg,#e8723c,#d45a25)',
                border: '1px solid rgba(255,150,100,.45)',
                color: '#fff', fontSize: 12.5, fontWeight: 700, fontFamily: 'var(--font)',
                opacity: busy ? .6 : 1,
              }}>{busy ? '提交中…' : '提交撤销'}</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{
          position: 'fixed', left: '50%', bottom: 60, transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,.82)', color: '#fff', fontSize: 12, fontWeight: 600,
          padding: '9px 16px', borderRadius: 10, zIndex: 200, maxWidth: '82vw', textAlign: 'center',
        }}>{toast}</div>
      )}

      {/* 跨月提交确认弹窗（老韩 2026-11-26）：
          公司要求跨月的假分两张假单交，页面里那行黄字容易被直接划过去，
          所以在点「提交申请」这一刻强制停一下，把要交几张、每张覆盖哪几天摆出来。
          只提醒不阻断 —— 点「仍然提交」照常入库，系统里仍是一条完整记录，
          考勤文本那边已经按自然月拆好两段了。 */}
      {confirmCross && needTwoForms && (
        <AppModal
          icon="📋"
          title="跨月休假，注意分两张假单"
          body={
            `公司规定：跨月的休假要按自然月分开填两张请假单。\n\n` +
            crossMonths.map((m, i) =>
              `${i + 1}. ${m.label}　${m.start.slice(5)} ~ ${m.end.slice(5)}　共 ${m.days} 天`
            ).join('\n') +
            `\n\n系统里仍按一条完整记录保存，考勤那边会自动拆成两段。`
          }
          buttons={[
            { label: '返回修改', onClick: () => setConfirmCross(false) },
            { label: '仍然提交', onClick: () => { setConfirmCross(false); doSubmit(); }, primary: true },
          ]}
        />
      )}
    </div>
  );
}

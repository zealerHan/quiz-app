// ─── 休假申请页（组员填报）──────────────────────────────────────
// 老韩 2026-11-23 定：
//   · 组员自己填 → 管理员审
//   · 界面填日历（点起止日期），系统按班次自动算扣几天
//   · 扣减口径：白=1、夜=1、夜早连上=1.5、白夜=2、正休=0
import { useState, useEffect } from "react";
import { apiJson, AppModal } from "../shared.jsx";
import { ShiftGrid, buildWeeks, WEEKDAY } from "../ShiftGrid.jsx";
import { splitByMonth, buildAttendanceText } from "../leaveCommon.js";

const LEAVE_TYPES = ['年休', '婚假', '陪产假', '育儿假', '病假', '事假'];

const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const mondayOf = (d) => { const x = new Date(d); const n = x.getDay() || 7; x.setDate(x.getDate() - n + 1); return x; };

export default function LeaveApplyScreen({ user, onBack, onDone }) {
  const [anchor, setAnchor] = useState(() => new Date());   // 点击定位跨 4 周
  const [shifts, setShifts] = useState({});                 // date -> shift
  const [start, setStart] = useState(null);
  const [end, setEnd] = useState(null);
  const [type, setType] = useState('年休');
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const [confirmCross, setConfirmCross] = useState(false);   // 跨月提交前的二次确认弹窗

  const sid = user?.staffId || user?.id;

  // 取班次：向前 2 周 + 向后 2 周
  const loadShifts = () => {
    const from = new Date(anchor); from.setDate(from.getDate() - 14);
    const to = new Date(anchor); to.setDate(to.getDate() + 28);
    apiJson(`/api/shift/range?from=${fmt(from)}&to=${fmt(to)}`, { headers: { 'x-staff-id': String(sid) } })
      .then(d => {
        const m = {};
        // 新接口 /api/shift/range 返回 { days:[{date,shift}] }
        (d?.days || []).forEach(x => { m[x.date] = x.shift; });
        // 兼容旧接口形状 { weeks:[{days:[...]}] }
        (d?.weeks || []).forEach(w => (w.days || []).forEach(x => { m[x.date] = x.shift; }));
        setShifts(m);
      })
      .catch(() => {});
  };
  useEffect(() => { if (sid) loadShifts(); }, [anchor, sid]);

  // 选了起止就预览
  useEffect(() => {
    if (!start || !end) { setPreview(null); return; }
    apiJson(`/api/leave/preview?start=${start}&end=${end}&type=${encodeURIComponent(type)}`,
      { headers: { 'x-staff-id': String(sid) } })
      .then(d => { if (d?.error) { setPreview(null); setErr(d.error); } else { setPreview(d); setErr(''); } })
      .catch(e => setErr(String(e)));
  }, [start, end, type, sid]);

  // 日历固定显示「本周 + 未来 3 周」共 4 周，不能翻页（过去的时间不该能申报）
  // 4 周是为了应对陪产假/婚假这类一次休很多天的情况
  const today = fmt(new Date());
  const weeks = buildWeeks(4);   // 与首页日历共用同一个生成器

  const disabled = (date) => date < today;   // 过去的日子不能申报

  const onPick = (date) => {
    if (disabled(date)) { setErr('过去的时间不能申报'); return; }
    setErr('');
    if (!start || (start && end)) { setStart(date); setEnd(null); return; }
    if (date < start) { setStart(date); setEnd(null); return; }
    setEnd(date);
  };

  const inRange = (date) => start && (end ? (date >= start && date <= end) : date === start);
  const isStart = (d) => d === start;
  const isEnd = (d) => d === end;

  // 跨月判断（只提醒不拦）—— 逻辑在 src/leaveCommon.js，两页共用
  const crossMonths = splitByMonth(start, end);
  const needTwoForms = crossMonths.length > 1;

  // 考勤员格式文本 —— 逻辑在 src/leaveCommon.js（两页共用，跨月自动拆段）
  const attendanceText = buildAttendanceText({
    start, end, staffName: user?.name || user?.realName || user?.real_name,
    staffId: sid, leaveType: type, preview,
  });

  const [copied, setCopied] = useState(false);
  const copyAttendance = async () => {
    if (!attendanceText) return;
    try {
      await navigator.clipboard.writeText(attendanceText);
      setCopied(true);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = attendanceText; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); setCopied(true); } catch (_) {}
      document.body.removeChild(ta);
    }
    setTimeout(() => setCopied(false), 1800);
  };

  // 真正提交（跨月确认弹窗点了「仍然提交」后走这里）
  const doSubmit = async () => {
    if (!start || !end) { setErr('先在日历上点开始和结束日期'); return; }
    setBusy(true); setErr('');
    try {
      const r = await apiJson('/api/leave/apply', {
        method: 'POST',
        headers: { 'x-staff-id': String(sid) },
        body: JSON.stringify({ start, end, type, note }),
      });
      if (r?.error) setErr(r.error);
      else {
        setToast(`已提交，等管理员审核（扣 ${r.days} 天）`);
        setStart(null); setEnd(null); setNote('');
        setTimeout(() => { setToast(''); onDone && onDone(); }, 1600);
      }
    } catch (e) { setErr(String(e)); }
    setBusy(false);
  };

  // 提交入口（老韩 2026-11-26）：
  // 跨月的假公司要求分两张假单交，但页面里的静态提示容易被忽略
  //（组员点完日期直接划到底部按提交）。所以在提交这一刻强制弹窗二次确认，
  // 把「要交几张、每张对应哪几天」摆到眼前。
  // 注意：只提醒不阻断 —— 点了「仍然提交」照常走，系统里仍是一条完整记录
  //（考勤文本那边已经按自然月拆好了，这里拦死反而会让组员没法提交）。
  const submit = () => {
    if (!start || !end) { setErr('先在日历上点开始和结束日期'); return; }
    if (needTwoForms) { setConfirmCross(true); return; }
    doSubmit();
  };

  // （weeks / today 已在上面按「本周+下周」固定生成）

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', paddingBottom: 110 }}>
      {/* 顶栏 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '16px 16px 12px',
        position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 10,
        borderBottom: '1px solid var(--border)',
      }}>
        <button onClick={onBack} style={{
          background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 9,
          padding: '5px 11px', fontSize: 12, color: 'var(--text)', cursor: 'pointer', fontFamily: 'var(--font)',
        }}>‹ 返回</button>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>申报休假</span>
      </div>

      {/* 假别选择：与日历同在一块卡里，不单独占一节 */}
      <div style={{ padding: '12px 12px 0' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {LEAVE_TYPES.map(t => (
            <button key={t} onClick={() => setType(t)} style={{
              padding: '5px 12px', borderRadius: 9, fontSize: 11.5, cursor: 'pointer', fontFamily: 'var(--font)',
              background: type === t ? 'rgba(91,155,250,0.18)' : 'var(--card)',
              border: `1px solid ${type === t ? 'rgba(91,155,250,0.55)' : 'var(--border)'}`,
              color: type === t ? '#7ec8f0' : 'var(--text)',
              fontWeight: type === t ? 700 : 400,
            }}>{t}</button>
          ))}
        </div>
      </div>

      {/* 日历 */}
      <div style={{
        margin: '12px 12px 0', background: 'var(--card)',
        border: '1px solid var(--border)', borderRadius: 16, padding: '12px 10px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, padding: '0 2px' }}>
          <span style={{ fontSize: 11.5, color: 'var(--muted)', flex: 1, textAlign: 'center' }}>
            {weeks[0][0].slice(5)} ~ {weeks[weeks.length-1][6].slice(5)}（本周 + 未来 3 周）
          </span>
        </div>

        {weeks.map((row, ri) => (
          <div key={ri} style={{ marginBottom: 4 }}>
            <ShiftGrid
              days={row.map(date => ({ date, shift: shifts[date] }))}
              showWeekday={ri === 0}
              onPick={onPick}
              start={start}
              end={end}
              disabledFn={disabled}
              highlightSel
            />
          </div>
        ))}
      </div>

      {/* 预览：扣几天 */}
      <div style={{ margin: '12px 12px 0' }}>
        {preview ? (
          <div style={{
            background: 'var(--card)', border: '1px solid var(--border)',
            borderRadius: 14, padding: '12px 14px',
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>这段要扣</span>
              <span style={{ fontSize: 21, fontWeight: 800, color: preview.enough ? '#5cc27c' : 'var(--p-red-60)', margin: '0 5px' }}>
                {preview.days}
              </span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>天</span>
              {type === '年休' ? (
                <span style={{ marginLeft: 'auto', fontSize: 10.5, color: preview.enough ? 'var(--muted)' : 'var(--p-red-60)' }}>
                  余额 {preview.annual_left} 天{preview.enough ? '' : '（不够）'}
                </span>
              ) : null}
            </div>
            {/* 逐日拆解，让人看懂怎么算的 */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {(preview.detail || []).map((d, i) => (
                <span key={i} style={{
                  fontSize: 9.5, padding: '2px 6px', borderRadius: 5,
                  background: 'var(--card-deep)', border: '1px solid var(--border)',
                  color: d.deduct > 0 ? 'var(--text)' : 'var(--muted)',
                }}>
                  {Number(d.date.slice(8))}号{d.shift ? d.shift[0] : ''} · {d.deduct > 0 ? d.deduct : '不扣'}
                </span>
              ))}
            </div>
            {preview.warning ? (
              <div style={{ fontSize: 10.5, color: 'var(--p-amber-61, #e4bd48)', marginTop: 7 }}>⚠ {preview.warning}</div>
            ) : null}

            {/* 跨月提醒：公司规定跨月假单要提交两张，各对应当月 */}
            {needTwoForms ? (
              <div style={{
                marginTop: 9, padding: '9px 11px', borderRadius: 9,
                background: 'rgba(232,167,38,0.10)',
                border: '1px solid rgba(232,167,38,0.45)',
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#e8a726', marginBottom: 5 }}>
                  ⚠ 跨月休假，需提交 {crossMonths.length} 张假单
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--text)', lineHeight: 1.75 }}>
                  公司规定：假单按自然月分开提交，每张对应一个月的休假日期。
                </div>
                <div style={{ marginTop: 6 }}>
                  {crossMonths.map((m, i) => (
                    <div key={i} style={{
                      fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.9,
                    }}>
                      {i + 1}. {m.label}　{m.start.slice(5)} ~ {m.end.slice(5)}　共 {m.days} 天
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* 休假信息文本（供复制给考勤员） */}
            {attendanceText ? (
              <div style={{ marginTop: 11, paddingTop: 11, borderTop: '1px solid var(--border)' }}>
                <div style={{
                  display: 'flex', alignItems: 'center', marginBottom: 6,
                }}>
                  <span style={{ fontSize: 10.5, color: 'var(--muted)', letterSpacing: '1px' }}>休假信息</span>
                  <button onClick={copyAttendance} style={{
                    marginLeft: 'auto', fontSize: 11, fontWeight: 700,
                    padding: '4px 11px', borderRadius: 7, cursor: 'pointer',
                    fontFamily: 'var(--font)',
                    background: copied ? 'rgba(92,194,124,0.18)' : 'rgba(91,155,250,0.16)',
                    border: `1px solid ${copied ? 'rgba(92,194,124,0.55)' : 'rgba(91,155,250,0.5)'}`,
                    color: copied ? '#5cc27c' : '#7ec8f0',
                  }}>{copied ? '已复制' : '复制'}</button>
                </div>
                <div style={{
                  fontSize: 11, lineHeight: 1.8, color: 'var(--text)',
                  background: 'var(--card-deep)', border: '1px solid var(--border)',
                  borderRadius: 9, padding: '9px 11px',
                  wordBreak: 'break-all',
                  // 跨月会拆成两行，必须 pre-wrap 才真的换行
                  whiteSpace: 'pre-wrap',
                }}>{attendanceText}</div>
              </div>
            ) : null}
          </div>
        ) : (
          <div style={{
            background: 'var(--card)', border: '1px dashed var(--border)', borderRadius: 14,
            padding: '18px 14px', textAlign: 'center', fontSize: 11.5, color: 'var(--muted)',
          }}>
            {start ? `已选 ${start.slice(5)} 起，再点结束日期` : '在日历上点开始和结束日期'}
          </div>
        )}
      </div>

      {/* 备注 */}
      {start && end ? (
        <div style={{ margin: '12px 12px 0' }}>
          <input value={note} onChange={e => setNote(e.target.value)}
            placeholder="备注（可不填，比如：家里有事）"
            maxLength={60}
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'var(--card)', border: '1px solid var(--border)',
              borderRadius: 11, padding: '10px 12px', fontSize: 12.5,
              color: 'var(--text)', fontFamily: 'var(--font)', outline: 'none',
            }} />
        </div>
      ) : null}

      {err ? (
        <div style={{ margin: '10px 12px 0', fontSize: 11.5, color: 'var(--p-red-60)' }}>⚠ {err}</div>
      ) : null}

      {/* 底部提交 */}
      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, padding: '10px 12px 16px',
        background: 'linear-gradient(to top, var(--bg) 70%, transparent)',
      }}>
        <button onClick={submit} disabled={busy || !start || !end} style={{
          width: '100%', padding: '13px 0', borderRadius: 13, fontSize: 14, fontWeight: 700,
          fontFamily: 'var(--font)',
          background: (busy || !start || !end) ? 'rgba(91,155,250,0.25)' : 'linear-gradient(145deg,#5b9bfa,#3d7ae0)',
          border: '1px solid rgba(120,180,255,0.45)',
          color: (busy || !start || !end) ? 'var(--muted)' : '#fff',
          cursor: (busy || !start || !end) ? 'default' : 'pointer',
        }}>{busy ? '提交中…' : '提交申请'}</button>
      </div>

      {toast ? (
        <div style={{
          position: 'fixed', left: '50%', bottom: 100, transform: 'translateX(-50%)',
          background: 'rgba(92,194,124,0.95)', color: '#fff', fontSize: 12,
          padding: '8px 18px', borderRadius: 20, zIndex: 30, whiteSpace: 'nowrap',
        }}>{toast}</div>
      ) : null}

      {/* 跨月提交确认弹窗（老韩 2026-11-26）：
          公司要求跨月的假分两张假单交，但页面里那行黄字容易被直接划过去，
          所以在点「提交申请」的这一刻强制停一下，把要交几张、每张覆盖哪几天摆出来。
          只提醒不阻断 —— 点「仍然提交」照常入库，系统这边仍是一条完整记录，
          考勤文本已经按自然月拆好两段了。 */}
      {confirmCross && needTwoForms ? (
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
      ) : null}
    </div>
  );
}

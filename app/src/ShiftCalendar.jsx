// ─── 两周班表 + 休假日历 ─────────────────────────────────────────
// 老韩 2026-11-23 定：
//   · 首页日历只做「显示」，不做操作入口
//   · 只显示本周 + 下周
//   · 四组班次统一（早→休→白→夜 四天一循环）
//   · 借鉴 Excel 年休日历：休假用「合并单元格 + 填色」表达区间，
//     横跨几列就是几天，一眼看出起止和重叠
import { useState, useEffect } from "react";
import { apiJson } from "./shared.jsx";
import { SHIFT_STYLE, COL_GAP, ShiftGrid } from "./ShiftGrid.jsx";

// 假别配色（休假条用，不同假别不同颜色）
// 假别简称：年休→年、育儿假→育、婚假→婚、陪产假→产，其余取首字
const LEAVE_ABBR = {
  '年休': '年',
  '育儿假': '育',
  '婚假': '婚',
  '陪产假': '产',
  '病假': '病',
  '事假': '事',
};
const abbrOf = (t) => LEAVE_ABBR[t] || (t ? t.charAt(0) : '年');

// 单格休假条放不下全名（实测：名字+括号需 59px，单格只有 44px）
// 三字名 → 取姓（谢安达→谢）；双字名 → 保留全名（胡鑫→胡鑫）
const shortenName = (name, span) => {
  if (span > 1) return name;
  return (name || '').length >= 3 ? (name || '').charAt(0) : (name || '');
};

// 列间距与格子尺寸由 ShiftGrid.jsx 统一提供（首页/申报页共用），此处不再重复定义

const LEAVE_COLOR = {
  年休:   { bg: 'rgba(91,155,250,0.22)',  border: 'rgba(91,155,250,0.55)',  text: '#8ab8fc' },
  陪产假: { bg: 'rgba(232,120,180,0.22)', border: 'rgba(232,120,180,0.55)', text: '#f094c4' },
  婚假:   { bg: 'rgba(238,114,104,0.22)', border: 'rgba(238,114,104,0.55)', text: '#f08d84' },
  育儿假: { bg: 'rgba(255,167,38,0.22)',  border: 'rgba(255,167,38,0.55)',  text: '#ffb657' },
  病假:   { bg: 'rgba(160,160,160,0.22)', border: 'rgba(160,160,160,0.55)', text: '#b8b8b8' },
  事假:   { bg: 'rgba(160,160,160,0.22)', border: 'rgba(160,160,160,0.55)', text: '#b8b8b8' },
};

const WEEKDAY = ['一', '二', '三', '四', '五', '六', '日'];
const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

export default function ShiftCalendar({ refreshKey }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    const sid = (() => { try { return JSON.parse(localStorage.getItem('quiz_login') || '{}').staffId; } catch { return null; } })();
    apiJson('/api/shift/two-weeks', { headers: sid ? { 'x-staff-id': String(sid) } : {} })
      .then(d => { if (d?.error) setErr(d.error); else setData(d); })
      .catch(e => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [refreshKey]);

  const today = fmt(new Date());

  if (loading) {
    return (
      <div style={{ margin: '6px 12px 14px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '28px 0', textAlign: 'center', fontSize: 12, color: 'var(--muted)' }}>
        加载班表…
      </div>
    );
  }

  const weeks = data?.weeks || [];
  if (err || weeks.length === 0) {
    return (
      <div style={{ margin: '6px 12px 14px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '20px 14px', fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>
        {err || '暂无班表数据'}
      </div>
    );
  }

  // ── 把跨天休假压成「条」：横跨几格=休几天，跨周自动截断 ──
  const buildBars = (w) => {
    const dates = w.days.map(d => d.date);
    const first = dates[0], last = dates[6];
    const raw = w.leaves || []; // [{real_name, leave_type, start_date, end_date}]
    const bars = [];
    raw.forEach(lv => {
      const s = lv.start_date > first ? lv.start_date : first;
      const e = lv.end_date < last ? lv.end_date : last;
      if (s > e) return;                       // 完全不在本周
      const si = dates.indexOf(s);
      const ei = dates.indexOf(e);
      if (si < 0 || ei < 0) return;
      bars.push({
        name: lv.real_name,
        leave_type: lv.leave_type || '年休',
        abbr: abbrOf(lv.leave_type || '年休'),
        startIdx: si,
        span: ei - si + 1,
        realEnd: lv.trueEnd || lv.end_date,   // 真实结束日（可能跨出本周）
        clippedStart: lv.start_date < first,
        clippedEnd: lv.end_date > last,
        pending: !!lv.pending,                // 待审 → 虚线+半透明，表示「未定」
      });
    });
    bars.sort((a, b) => a.startIdx - b.startIdx || b.span - a.span);

    // ── 轨道分配：只要时间不重叠，就排在同一行 ──
    // 依次把每条休假条放进「第一条不与它重叠」的行
    const tracks = [];            // 每行已占用的区间 [{s, e}]
    bars.forEach(b => {
      const bs = b.startIdx, be = b.startIdx + b.span - 1;
      let placed = false;
      for (let t = 0; t < tracks.length; t++) {
        const conflict = tracks[t].some(r => !(be < r.s || bs > r.e));  // 有交叉
        if (!conflict) {
          tracks[t].push({ s: bs, e: be });
          b.track = t;
          placed = true;
          break;
        }
      }
      if (!placed) {
        tracks.push([{ s: bs, e: be }]);
        b.track = tracks.length - 1;
      }
    });
    return { bars, trackCount: tracks.length };
  };

  return (
    <div style={{ margin: '12px 12px 14px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
      {weeks.map((w, wi) => {
        const { bars, trackCount } = buildBars(w);
        return (
          <div key={w.week_start} style={{
            padding: '9px 5px 7px',
            borderBottom: wi < weeks.length - 1 ? '1px solid var(--border)' : 'none',
          }}>
            {/* 星期头 + 7 列日期格（共用组件，外观与申报页完全一致） */}
            <ShiftGrid days={w.days} showWeekday={wi === 0} />

            {/* ── 休假条：按轨道排布，时间不重叠就共用一行 ── */}
            {bars.length > 0 ? (
              <div style={{
                marginTop: 5,
                position: 'relative',
                height: trackCount * 24 - 3,   // 每条 21px + 3px 间距
              }}>
                {bars.map((b, bi) => {
                  const lc = LEAVE_COLOR[b.leave_type] || LEAVE_COLOR['年休'];
                  const gap = COL_GAP;
                  const left  = `calc(${b.startIdx} * ((100% - ${6*gap}px) / 7 + ${gap}px))`;
                  const width = `calc(${b.span} * ((100% - ${6*gap}px) / 7) + ${(b.span-1)*gap}px)`;
                  // 销假提醒：这条休假的「真实结束日」落在本周范围内，才提示销假
                  // （跨到下周的不在本周提示，下周自己的周次里会提示）
                  const wkDates = w.days.map(d => d.date);
                  const showReturnMark = b.realEnd && wkDates.includes(b.realEnd);
                  return (
                    <div key={bi} style={{
                      position: 'absolute',
                      left, width,
                      top: b.track * 24,
                      height: 21,
                      // 待审：半透明 + 虚线边框 + 标题加「?」，表示「未定」
                      background: b.pending ? 'transparent' : lc.bg,
                      border: b.pending ? `1.5px dashed ${lc.border}` : `1px solid ${lc.border}`,
                      opacity: b.pending ? 0.72 : 1,
                      borderRadius: b.clippedStart ? '2px 6px 6px 2px' : (b.clippedEnd ? '6px 2px 2px 6px' : 6),
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9.5, fontWeight: 700, color: lc.text,
                      whiteSpace: 'nowrap',
                      overflow: 'visible',
                    }}>
                      <span style={{
                        overflow: 'hidden', textOverflow: 'ellipsis',
                        paddingLeft: 1,
                        paddingRight: showReturnMark ? 13 : 1,
                      }}>
                        {b.clippedStart ? '‹' : ''}{shortenName(b.name, b.span)}（{b.abbr}{b.pending ? '?' : ''}）{b.clippedEnd ? '›' : ''}
                      </span>
                      {/* 销假标记：只给已批准的休假（待审的不该催销假） */}
                      {showReturnMark && !b.pending ? (
                        <span style={{
                          position: 'absolute',
                          right: 2, top: 1,
                          fontSize: 8.5, lineHeight: 1,
                          filter: 'drop-shadow(0 0 2px rgba(255,60,60,0.95))',
                        }} title="休假最后一天，打电话销假">☎️</span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

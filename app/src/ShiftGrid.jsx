// ─── 班表日历（共用组件）──────────────────────────────────────────
// 首页和「申报休假」页共用同一套日历，保证外观完全一致：
//   · 格子 47×38（390 视口），列间距 4，圆角 8
//   · 日期纯白 13.5px 在上、班次 9.5px 保留自身颜色在下
//   · 今天 = 1.5px 白框 + 白光晕 + 淡白底
// 两处差异只通过 props 表达，不各写一套：
//   · 首页：只显示（不传 onPick）
//   · 申报页：传 onPick + selected 起止，多做「可点选」交互
// 数据由调用方提供（首页从 /api/shift/two-weeks，申报页从 /api/shift/range）

// 班次配色（沿用系统既有语义：早=琥珀 白=蓝 夜=紫 休=绿）
export const SHIFT_STYLE = {
  早班: { bg: 'rgba(212,175,55,0.20)', border: 'rgba(212,175,55,0.60)', text: '#e4bd48', label: '早' },
  白班: { bg: 'rgba(66,133,244,0.20)', border: 'rgba(66,133,244,0.60)', text: '#6ba5fb', label: '白' },
  夜班: { bg: 'rgba(139,110,247,0.20)', border: 'rgba(139,110,247,0.60)', text: '#a992f7', label: '夜' },
  休息: { bg: 'rgba(76,175,110,0.20)', border: 'rgba(76,175,110,0.60)', text: '#5cc27c', label: '休' },
};

// 列间距：日期格 grid 与休假条定位必须用同一个值，否则错位
export const COL_GAP = 4;
export const CELL_H = 38;

export const WEEKDAY = ['一', '二', '三', '四', '五', '六', '日'];

const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

// 生成本周起的 N 周，每周 7 个日期字符串
export function buildWeeks(nWeeks = 2) {
  const now = new Date();
  const day = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day - 1));
  const out = [];
  for (let w = 0; w < nWeeks; w++) {
    const row = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + w * 7 + i);
      row.push(fmt(d));
    }
    out.push(row);
  }
  return out;
}

/**
 * ShiftGrid —— 一周 7 个日期格
 *
 * @param days         [{date, shift}] 7 项
 * @param showWeekday  是否显示「一二三四五六日」表头
 * @param onPick       点击某天回调 (date) => void；不传 = 只显示
 * @param start        选中起点（可选）
 * @param end          选中终点（可选）
 * @param disabledFn   该日是否禁用 (date) => bool
 * @param highlightSel 是否用橙红高亮选中范围（申报页用）
 */
export function ShiftGrid({
  days, showWeekday = false, onPick, start, end,
  disabledFn, highlightSel = false,
}) {
  const today = fmt(new Date());

  const inRange = (date) => {
    if (!start) return false;
    if (!end) return date === start;
    return date >= start && date <= end;
  };

  return (
    <>
      {showWeekday ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: COL_GAP, marginBottom: 3 }}>
          {WEEKDAY.map((wd, i) => (
            <div key={i} style={{
              textAlign: 'center', fontSize: 9.5, color: 'var(--muted)', fontWeight: 500,
            }}>{wd}</div>
          ))}
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: COL_GAP }}>
        {days.map((d) => {
          const st = SHIFT_STYLE[d.shift] || SHIFT_STYLE['休息'];
          const isToday = d.date === today;
          const sel = highlightSel && inRange(d.date);
          const isEdge = highlightSel && end && (d.date === start || d.date === end);
          const past = disabledFn ? disabledFn(d.date) : false;
          const clickable = !!onPick && !past;

          // 背景优先级：过去(灰) > 选中(橙红) > 今天(淡白) > 班次色
          let background = st.bg;
          let border = `1px solid ${st.border}`;
          let boxShadow = 'none';
          let opacity = 1;
          let dateColor = '#ffffff';
          let shiftColor = st.text;
          let strike = 'none';

          if (past) {
            background = 'rgba(128,128,128,0.10)';
            border = '1px solid rgba(128,128,128,0.22)';
            opacity = 0.42;
            dateColor = 'var(--muted)';
            shiftColor = 'var(--muted)';
            strike = 'line-through';
          } else if (sel) {
            background = 'rgba(238,114,104,0.32)';
            border = '2px solid #ff7a52';
            boxShadow = '0 0 8px rgba(255,122,82,0.55)';
          } else if (isToday) {
            background = 'rgba(255,255,255,0.10)';
            border = '1.5px solid #ffffff';
            boxShadow = '0 0 8px rgba(255,255,255,0.45)';
          }

          return (
            <div
              key={d.date}
              onClick={clickable ? () => onPick(d.date) : undefined}
              style={{
                height: CELL_H, borderRadius: 8, position: 'relative',
                boxSizing: 'border-box',
                cursor: onPick ? (past ? 'not-allowed' : 'pointer') : 'default',
                background, border, boxShadow, opacity,
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 1,
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <div style={{
                fontSize: 13.5, fontWeight: 800, color: dateColor, lineHeight: 1,
                textDecoration: strike,
              }}>{Number(d.date.slice(8))}</div>
              <div style={{
                fontSize: 9.5, fontWeight: 800, color: shiftColor, lineHeight: 1,
              }}>{st.label}</div>
              {/* 选中范围的起止端点：实心小点 */}
              {isEdge ? (
                <span style={{
                  position: 'absolute', top: 2, right: 3,
                  width: 5, height: 5, borderRadius: '50%', background: '#ff7a52',
                }} />
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}

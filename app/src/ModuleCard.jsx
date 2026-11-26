// ─── 主页正方形模块卡（统一设计语言）────────────────────────────────
// 设计约定（老韩 2026-11-23 定稿）：
//   · 每张卡 = 一个模块，整卡可点击进入
//   · 近似正方形：高 172px，宽占半屏
//   · 上=图标+模块名，中=关键状态（大字），下=补充信息（小字）
//   · 三色区分：答题紫 / 月度金 / 休假绿
// 卡片内不放题目全文 —— 长文本一律进模块看，主页永不被文字拉长。

export const CARD_THEMES = {
  quiz: {
    label: '日常答题',
    icon: '📝',
    accent: 'var(--p-purple-58)',
    accent2: 'var(--p-purple-65)',
    glow: 'rgba(139,110,247,0.16)',
    border: 'rgba(139,110,247,0.32)',
  },
  workshop: {
    label: '月度任务',
    icon: '📋',
    accent: 'var(--p-amber-24)',
    accent2: 'var(--p-amber-53)',
    glow: 'rgba(212,175,55,0.16)',
    border: 'rgba(212,175,55,0.32)',
  },
  leave: {
    label: '我的假期',
    icon: '🗓',
    accent: 'var(--p-green-45)',
    accent2: 'var(--p-green-73)',
    glow: 'rgba(76,175,110,0.16)',
    border: 'rgba(76,175,110,0.32)',
  },
  wall: {
    label: '留言墙',
    icon: '💬',
    accent: 'var(--p-cyan-55, #4dc8d4)',
    accent2: '#5fd3de',
    glow: 'rgba(77,200,212,0.15)',
    border: 'rgba(77,200,212,0.32)',
  },
  placeholder: {
    label: '',
    icon: '',
    accent: 'var(--border)',
    accent2: 'var(--border)',
    glow: 'transparent',
    border: 'var(--border)',
  },
};

/**
 * SquareModuleCard
 * @param theme      CARD_THEMES 里的 key
 * @param main       中间大字（关键状态）
 * @param sub        下方小字（补充信息），可为 null
 * @param badge      右上角角标（如"未报"红点），可为 null
 * @param warn       main 是否用警告色
 * @param disabled   是否不可点（灰态）
 * @param mainLabel  可选：加在 main 上方的小标签（如「总额」），给了就独占一行
 * @param onClick    点击回调
 */
export function SquareModuleCard({ theme = 'placeholder', main, mainLabel, sub, badge, warn, disabled, onClick, customBody }) {
  const t = CARD_THEMES[theme] || CARD_THEMES.placeholder;
  const clickable = !!onClick && !disabled;
  return (
    <div
      onClick={clickable ? onClick : undefined}
      style={{
        flex: 1,
        minWidth: 0,
        height: 146,
        borderRadius: 18,
        position: 'relative',
        overflow: 'hidden',
        cursor: clickable ? 'pointer' : 'default',
        background: `linear-gradient(150deg, ${t.glow} 0%, var(--card) 62%)`,
        border: `1px solid ${t.border}`,
        padding: '11px 12px 10px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        boxShadow: clickable ? `0 4px 16px ${t.glow}` : 'none',
        opacity: disabled ? 0.55 : 1,
        transition: 'transform .12s ease',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {/* 顶部：图标 + 模块名 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ fontSize: 17, lineHeight: 1 }}>{t.icon}</span>
        <span style={{
          fontSize: 15, fontWeight: 800, letterSpacing: '0.8px',
          color: t.accent2, whiteSpace: 'nowrap',
        }}>{t.label}</span>
        {badge ? (
          <span style={{
            marginLeft: 'auto', fontSize: 10, fontWeight: 800, letterSpacing: '0.4px',
            padding: '2px 7px', borderRadius: 8,
            background: 'var(--p-red-60-a18)', border: '1px solid var(--p-red-60-a40)',
            color: 'var(--p-red-60)', whiteSpace: 'nowrap',
          }}>{badge}</span>
        ) : null}
      </div>

      {/* 中部：关键状态（垂直居中，最多 2 行，超出省略） */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        maxHeight: 56,
        overflow: 'hidden',
      }}>
        {/* 可选的小标签行（如「总额」），另起一行放在数值上方 */}
        {mainLabel ? (
          <div style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '1.5px',
            lineHeight: 1.2,
            marginBottom: 2,
            color: 'var(--muted)',
          }}>{mainLabel}</div>
        ) : null}
        <div style={{
          width: '100%',
          fontSize: 16,
          fontWeight: 800,
          lineHeight: 1.3,
          letterSpacing: '0.3px',
          color: warn ? 'var(--p-red-60)' : 'var(--text)',
          wordBreak: 'break-word',
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: mainLabel ? 1 : 2,
          WebkitBoxOrient: 'vertical',
        }}>{customBody || main}</div>
      </div>

      {/* 底部：补充信息（小字，最多 2 行） */}
      {customBody ? null : sub ? (
        <div style={{
          fontSize: 11.5,
          lineHeight: 1.5,
          color: 'var(--muted)',
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}>{sub}</div>
      ) : (
        <div style={{ fontSize: 11.5, color: 'transparent' }}>·</div>
      )}
    </div>
  );
}

export default SquareModuleCard;

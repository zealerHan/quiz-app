// screens/admin/LeaveOverview.jsx
//
// 全组休假总览
//
// 这块界面 2026-11-26 做过（老韩截图可证），但代码没进 git，
// 2026-11-27 规范化部署时被覆盖丢失。现按聊天记录里的原始需求重建。
//
// ══ 老韩的需求演进（逐条对应，别漏）══
//   11-26 15:53  「可视化全组休假预览，一个数据是班组 30 个在编序号的
//                 人休假天数总额，一个是每个人休假情况」
//   11-26 16:05  「总览做一个默认折叠吧，平时一般也不看，处理审批为主」
//   11-26 16:42  「休超了也正常显示。确实是有一些特殊情况和特例，我需要数据真实记录」
//   11-26 17:10  「加一个切换年份的按钮」「总人数还是这 41」
//                「总览列表名字前面加个序号」
//   11-27        「措辞只用「车峰」，不要用「编外」」
//   11-27 二次   「年休假和育儿假等其他假期综合算在一起」→ 要分假别看
//                「每个人的条目底部应该有假期的明细」
//                「非编人员不用那么详细，用灰色小字体显示」
//   11-27 三次   「总览顶部不需要这么详细的分类再汇总，只需要：假期总额、已休、剩余」
//                「下面的个人类目可以详细一点。打个比方：现在的显示艾凌风在已休完里，
//                  但是他还有育儿假。和直觉不符。列表也是按每个人的假期总额来」
//                「同时正休一下顶头的序号，1，2，3，4 固定不动」
//
// ══ 口径（关键）══
//   顶部：只三列 —— 假期总额 / 已休 / 剩余（四项合计，不分类）
//   个人行：大字 = 四项合计；底部小字 = 各假别明细
//   排序：按【四项总额剩余】降序 —— 不能按年休排，
//         否则年休用完但还有育儿假的人会被挤进"已休完"区，与直觉不符
//   序号：roster_seq（1~41 班组固定序号，不跟排序走）
//   在编 = is_cp=0（30 人）详细显示
//   车峰 = is_cp=1（11 人）灰色小字单行，不展开
//   已休 = status IN ('verified','locked','reported','released')
//   超支 = `5.5/5（超0.5）`   额度0 = `已休N 已用完`，不标异常

import { useState, useEffect } from "react";
import { apiJson } from "../../shared.jsx";

const fmt = (n) => {
  if (n === null || n === undefined) return "-";
  const v = Math.round(n * 10) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};

// 进度条配色：蓝=剩得多 / 橙=剩不到一半 / 红=用完或超出
const barColor = (used, total) => {
  if (total <= 0) return "#e8723c";
  const ratio = used / total;
  if (ratio >= 1) return "#e8723c";
  if (ratio > 0.5) return "#e8a726";
  return "#6ba5fb";
};

const STATUS_LABEL = {
  verified: "已核实", locked: "已锁定", reported: "已报车场组",
  released: "已销假", submitted: "待审", cancel_pending: "撤销待批",
  rejected: "已驳回", cancelled: "已撤销", draft: "草稿",
};

const TYPES = [
  { key: "annual",    name: "年休",   totalKey: "annual_total",    usedKey: "annual_used" },
  { key: "marriage",  name: "婚假",   totalKey: "marriage_total",  usedKey: "marriage_used" },
  { key: "paternity", name: "陪产假", totalKey: "paternity_total", usedKey: "paternity_used" },
  { key: "parental",  name: "育儿假", totalKey: "parental_total",  usedKey: "parental_used" },
];

/** 四项合计 */
const totalOf = (r) => TYPES.reduce(
  (a, t) => ({ total: a.total + (r[t.totalKey] || 0), used: a.used + (r[t.usedKey] || 0) }),
  { total: 0, used: 0 }
);

/** 单人明细弹窗 */
function StaffDetailModal({ staffRow, year, hdrs, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    apiJson(`/api/leave/staff/${staffRow.staff_id}?year=${year}`, { headers: hdrs() })
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setData({ records: [], lines: [] }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [staffRow.staff_id, year]);

  const records = data?.records || [];
  const lines = data?.lines || [];

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)",
      display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 100,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "100%", maxWidth: 440, background: "var(--card)",
        border: "1px solid var(--border)", borderRadius: "16px 16px 0 0",
        padding: "16px 16px 28px", maxHeight: "80vh", overflowY: "auto",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
              {staffRow.name}
              {data?.is_cp ? (
                <span style={{
                  marginLeft: 6, fontSize: 9.5, padding: "1px 5px", borderRadius: 3,
                  background: "rgba(232,167,38,0.14)", border: "1px solid rgba(232,167,38,0.4)",
                  color: "#e8a726", fontWeight: 400,
                }}>车峰</span>
              ) : null}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
              {staffRow.seq != null ? `序号 ${staffRow.seq} · ` : ""}Y{staffRow.staff_id} · {year} 年
            </div>
          </div>
          <button onClick={onClose} style={{
            background: "none", border: "1px solid var(--border)", color: "var(--muted)",
            borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12,
          }}>关闭</button>
        </div>

        {loading && <div style={{ textAlign: "center", padding: "24px 0" }}>
          <div className="spinner" style={{ margin: "0 auto" }} />
        </div>}

        {!loading && lines.length > 0 && (
          <div style={{
            background: "var(--p-navy-16-a60)", border: "1px solid var(--border)",
            borderRadius: 9, padding: "9px 11px", marginBottom: 12,
          }}>
            {lines.map((l) => {
              const over = l.total > 0 && l.used > l.total;
              return (
                <div key={l.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0" }}>
                  <span style={{ color: "var(--muted)" }}>{l.name}</span>
                  <span style={{ color: over ? "#e8723c" : "var(--text)" }}>
                    {l.total === 0 && l.used > 0
                      ? `已休${fmt(l.used)} 已用完`
                      : `${fmt(l.used)}/${fmt(l.total)}${over ? `（超${fmt(l.used - l.total)}）` : ""}`}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {!loading && records.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, padding: "28px 0" }}>
            无相关记录
          </div>
        )}

        {!loading && records.map((r) => (
          <div key={r.id} style={{
            background: "var(--p-navy-16-a60)", border: "1px solid var(--border)",
            borderRadius: 10, padding: "10px 12px", marginBottom: 8,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{
                fontSize: 10.5, padding: "1px 7px", borderRadius: 5,
                background: "rgba(91,155,250,0.16)", border: "1px solid rgba(91,155,250,0.4)",
                color: "#7ec8f0",
              }}>{r.leave_type}</span>
              {r.status && r.status !== "verified" && (
                <span style={{ fontSize: 10, color: "var(--muted)" }}>{STATUS_LABEL[r.status] || r.status}</span>
              )}
              <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--muted)" }}>
                {r.start_date === r.end_date ? r.start_date : `${r.start_date} ~ ${r.end_date}`}
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text)" }}>
              扣 <b>{fmt(r.days)}</b> 天
              {r.created_by && <span style={{ marginLeft: 8, fontSize: 10.5, color: "var(--muted)" }}>{r.created_by}</span>}
            </div>
            {r.relief_note && (
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, lineHeight: 1.6 }}>备注：{r.relief_note}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 在编人员一行
 * 序号放最前，固定小方块，跟人走不跟排序走
 * 大字 = 四项合计；底部小字 = 各假别明细
 */
function PersonRow({ r, onOpen }) {
  const { total, used } = totalOf(r);
  const left = total - used;
  const over = used > total;
  const usedUp = total > 0 && left === 0;
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 100;
  const color = barColor(used, total);

  const details = TYPES
    .map((t) => ({ name: t.name, total: r[t.totalKey] || 0, used: r[t.usedKey] || 0 }))
    .filter((d) => d.total > 0 || d.used > 0);

  return (
    <div onClick={onOpen} style={{
      display: "flex", gap: 8, alignItems: "flex-start",
      padding: "9px 2px", borderBottom: "1px solid var(--p-navy-22-a30)", cursor: "pointer",
    }}>
      {/* 序号：固定小方块，最左 */}
      <div style={{
        minWidth: 22, height: 22, borderRadius: 5,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "var(--p-navy-22-a60)", border: "1px solid var(--border)",
        fontSize: 10.5, color: "var(--muted)", fontWeight: 600,
        flexShrink: 0, marginTop: 1,
      }}>{r.seq ?? "-"}</div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
          <span style={{ fontSize: 12.5, color: "var(--text)", fontWeight: 600 }}>{r.name}</span>
          <span style={{ marginLeft: "auto", fontSize: 11.5, color: left < 0 ? "#e8723c" : "var(--text)" }}>
            {fmt(used)} / {fmt(total)}
            <span style={{ color, fontWeight: 700, marginLeft: 6 }}>
              {over ? `超${fmt(-left)}` : usedUp ? "已用完" : `剩 ${fmt(left)}`}
            </span>
          </span>
        </div>

        <div style={{ height: 4, background: "var(--p-navy-22-a60)", borderRadius: 2, overflow: "hidden", marginBottom: 5 }}>
          <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2 }} />
        </div>

        {details.length > 0 && (
          <div style={{ fontSize: 10, color: "var(--muted)", lineHeight: 1.7 }}>
            {details.map((d, i) => {
              const dn = d.total > 0 && d.used > d.total;
              return (
                <span key={d.name} style={{ color: dn ? "#e8723c" : "var(--muted)" }}>
                  {i > 0 && <span style={{ margin: "0 6px", opacity: 0.4 }}>·</span>}
                  {d.name} {d.total === 0 ? "已用完" : `${fmt(d.used)}/${fmt(d.total)}`}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** 车峰一行：灰色小字，不展开明细 */
function CpRow({ r }) {
  const { total, used } = totalOf(r);
  const left = total - used;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "4px 2px", fontSize: 10.5, color: "var(--muted)", lineHeight: 1.6,
    }}>
      <span style={{
        minWidth: 22, height: 18, borderRadius: 4,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "var(--p-navy-22-a60)", border: "1px solid var(--border)",
        fontSize: 10, opacity: 0.75, flexShrink: 0,
      }}>{r.seq ?? "-"}</span>
      <span>{r.name}</span>
      <span style={{ marginLeft: "auto", color: left < 0 ? "#e8723c" : "var(--muted)" }}>
        {fmt(used)}/{fmt(total)}{left < 0 ? `（超${fmt(-left)}）` : ""}
      </span>
    </div>
  );
}

/**
 * 全组休假总览（默认折叠）
 *
 * props:
 *   hdrs   () => 管理员请求头
 */
export default function LeaveOverview({ hdrs }) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(2026);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState(null);
  const [sortBy, setSortBy] = useState("left");  // left=剩余从多到少 / used=已休从少到多

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    apiJson(`/api/leave/all?year=${year}`, { headers: hdrs() })
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setData({ rows: [] }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, year]);

  const allRows = data?.rows || [];
  const regRows = allRows.filter((r) => !r.is_cp);
  const cpRows = allRows.filter((r) => r.is_cp);

  // 顶部三列：只算在编（车峰不计）
  const regTotal = regRows.reduce((a, r) => {
    const t = totalOf(r);
    return { total: a.total + t.total, used: a.used + t.used };
  }, { total: 0, used: 0 });
  const regLeft = regTotal.total - regTotal.used;

  // 排序两种（老韩 2026-11-27）：都按四项合计口径
  //   left = 剩余从多到少（最想休的人在最上，方便安排）
  //   used = 已休从少到多（休得最少的人在前，一眼看出谁没休）
  // 序号不受排序影响，永远是班组固定号。
  const sortedReg = sortBy === "left"
    ? [...regRows].sort((a, b) => {
        const ta = totalOf(a), tb = totalOf(b);
        return (tb.total - tb.used) - (ta.total - ta.used);
      })
    : [...regRows].sort((a, b) => {
        const ta = totalOf(a), tb = totalOf(b);
        return ta.used - tb.used;
      });
  // 车峰按序号固定
  const sortedCp = [...cpRows].sort((a, b) => (a.seq ?? 999) - (b.seq ?? 999));

  return (
    <div style={{
      background: "var(--card)", border: "1px solid var(--border)",
      borderRadius: 11, marginBottom: 12, overflow: "hidden",
    }}>
      <div onClick={() => setOpen(!open)} style={{
        display: "flex", alignItems: "center", gap: 8, padding: "11px 13px", cursor: "pointer",
      }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)" }}>全组休假总览</span>
        {!open && data && (
          <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
            在编 {regRows.length} 人 · 剩 {fmt(regLeft)} / {fmt(regTotal.total)} 天
          </span>
        )}
        <span style={{
          marginLeft: "auto", fontSize: 11, color: "var(--muted)",
          transform: open ? "rotate(180deg)" : "none", transition: "transform .2s",
        }}>▼</span>
      </div>

      {open && (
        <div style={{ padding: "0 13px 13px" }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            {[2026, 2027].map((y) => (
              <button key={y} onClick={() => setYear(y)} style={{
                flex: 1, padding: "6px 0", borderRadius: 8, fontSize: 12, cursor: "pointer",
                fontWeight: year === y ? 700 : 400,
                background: year === y ? "rgba(91,155,250,0.18)" : "transparent",
                border: `1px solid ${year === y ? "rgba(91,155,250,0.55)" : "var(--border)"}`,
                color: year === y ? "var(--blue)" : "var(--muted)",
              }}>{y} 年</button>
            ))}
          </div>

          {loading && <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div className="spinner" style={{ margin: "0 auto" }} />
          </div>}

          {!loading && data && (
            <>
              {/* ── 顶部三列：假期总额 / 已休 / 剩余 ── */}
              <div style={{
                background: "var(--p-navy-16-a60)", border: "1px solid var(--border)",
                borderRadius: 9, padding: "10px 11px", marginBottom: 10,
              }}>
                <div style={{ fontSize: 10.5, color: "var(--muted)", marginBottom: 7 }}>
                  在编 {regRows.length} 人合计
                  {cpRows.length > 0 && <span style={{ marginLeft: 6, opacity: 0.7 }}>（车峰 {cpRows.length} 人不计）</span>}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {[["假期总额", regTotal.total, "var(--text)"],
                    ["已休", regTotal.used, "var(--text)"],
                    ["剩余", regLeft, regLeft < 0 ? "#e8723c" : "var(--blue)"]].map(([k, v, c]) => (
                    <div key={k} style={{ flex: 1, textAlign: "center" }}>
                      <div style={{ fontSize: 17, fontWeight: 700, color: c }}>{fmt(v)}</div>
                      <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>{k}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── 排序切换（默认按序号固定）── */}
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                {[["left", "剩余从多到少"], ["used", "已休从少到多"]].map(([k, label]) => (
                  <button key={k} onClick={() => setSortBy(k)} style={{
                    flex: 1, padding: "4px 0", borderRadius: 6, fontSize: 10.5, cursor: "pointer",
                    background: sortBy === k ? "rgba(91,155,250,0.14)" : "transparent",
                    border: `1px solid ${sortBy === k ? "rgba(91,155,250,0.45)" : "var(--border)"}`,
                    color: sortBy === k ? "var(--blue)" : "var(--muted)",
                  }}>{label}</button>
                ))}
              </div>

              {/* ── 在编人员 ── */}
              {sortedReg.map((r) => (
                <PersonRow key={r.staff_id} r={r} onOpen={() => setDetail(r)} />
              ))}

              {/* ── 车峰（灰色小字，不展开）── */}
              {sortedCp.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{
                    fontSize: 10, color: "var(--muted)", opacity: 0.8,
                    padding: "6px 0 3px", borderTop: "1px dashed var(--border)", marginBottom: 2,
                  }}>
                    以下 {sortedCp.length} 人为车峰（临时调整跑车方式，保留组籍），不计入上方合计
                  </div>
                  {sortedCp.map((r) => <CpRow key={r.staff_id} r={r} />)}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {detail && (
        <StaffDetailModal staffRow={detail} year={year} hdrs={hdrs} onClose={() => setDetail(null)} />
      )}
    </div>
  );
}

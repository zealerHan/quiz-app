#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把《四组XXXX年休假记录.xlsx》迁移进 peixun 的 leave_* 表（P0 数据迁移）
用法: python3 leave_import.py <台账.xlsx> [--dry-run]
只写全新建的 leave_quota / leave_records 表，不碰任何现有表。
"""
import sys, sqlite3, re, datetime
import openpyxl

DB = "/Users/hanying/peixun/app/data/quiz.db"
YEAR = 2026

def norm_name(s):
    if s is None: return ""
    s = str(s).replace("\u3000", "").replace("\xa0", "").strip()
    s = re.sub(r"[（(](病假|事假|年休|育儿假|陪产假|婚假)[）)]", "", s)
    s = re.sub(r"\s+", "", s)
    return s

def norm_id(s):
    if s is None: return ""
    return str(s).replace("\n", "").replace(" ", "").replace("\u3000", "").strip()

def parse_date(v):
    """解析各种脏格式；返回 (date_str|None, is_dirty)"""
    if v is None: return None, False
    if isinstance(v, datetime.datetime):
        d = v.date()
    elif isinstance(v, datetime.date):
        d = v
    else:
        s = str(v).strip()
        m = re.match(r"^(\d{4})[年\-/\.](\d{1,2})[月\-/\.](\d{1,2})", s)
        if not m: return None, True
        try:
            d = datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None, True
    # 明显错年份（如 2036）标脏
    if d.year < 2020 or d.year > YEAR:
        return d.isoformat(), True
    return d.isoformat(), False

def main():
    path = sys.argv[1]
    dry = "--dry-run" in sys.argv
    wb = openpyxl.load_workbook(path, data_only=True)

    # ── 1. 人员基础信息（全台，用于工号↔姓名↔班组） ──
    ws = wb["人员基础信息表"]
    base = {}          # 工号 -> dict
    name2id = {}       # 姓名 -> 工号
    for r in ws.iter_rows(min_row=3, max_row=ws.max_row, max_col=8, values_only=True):
        gh, name, team, total = r[0], r[1], r[2], r[3]
        if not gh or not name: continue
        gh = norm_id(gh); name = norm_name(name)
        if not gh or not name: continue
        base[gh] = {"name": name, "team": (str(team).strip() if team else ""), "total": total}
        name2id.setdefault(name, gh)

    # ── 2. 请假流水 ──
    ws2 = wb["请假与销假记录表"]
    rows = []
    dirty = []
    for r in ws2.iter_rows(min_row=3, max_row=ws2.max_row, max_col=12, values_only=True):
        gh, name, team, ltype, sd, ed, days = r[1], r[2], r[3], r[4], r[5], r[6], r[7]
        if gh is None and name is None: continue
        nm = norm_name(name)
        if not nm: continue
        sd_s, sd_bad = parse_date(sd)
        ed_s, ed_bad = parse_date(ed)
        d = days if isinstance(days, (int, float)) else 0
        rec = {
            "staff_id": norm_id(gh) or name2id.get(nm, ""),
            "name": nm, "team": (str(team).strip() if team else ""),
            "leave_type": (str(ltype).strip() if ltype else ""),
            "start_date": sd_s, "end_date": ed_s, "days": float(d),
            "approver": r[9],
        }
        if sd_bad or ed_bad:
            dirty.append((nm, str(sd), str(ed), rec["leave_type"], d))
        rows.append(rec)

    print(f"基础信息 {len(base)} 人 / 流水 {len(rows)} 条 / 脏日期 {len(dirty)} 条")
    for x in dirty: print("  脏:", x)

    # ── 3. 计算：按姓名汇总各类假 ──
    from collections import defaultdict
    agg = defaultdict(lambda: defaultdict(float))
    for x in rows:
        agg[x["name"]][x["leave_type"]] += x["days"]

    # ── 4. 写入 ──
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # 4a. 额度表：只写 peixun 里存在的 staff（id 无 Y 前缀）
    staff = {r["id"]: r for r in cur.execute("SELECT id, name, real_name FROM staff")}
    print(f"\npeixun 现有 staff: {len(staff)} 人")

    quota_n = rec_n = 0
    missing = []
    for gh, info in base.items():
        name = info["name"]
        if info["team"] != "乘务四组": continue
        sid = gh.replace("Y", "").replace("y", "").lstrip("0") or gh
        # 匹配 peixun staff：按数字工号
        cand = [k for k in staff if k.lstrip("0") == sid.lstrip("0")]
        if not cand:
            missing.append((gh, name))
            continue
        pid = cand[0]
        annual = info["total"] or 0
        if not dry:
            cur.execute("""INSERT OR REPLACE INTO leave_quota
                (staff_id, year, annual_total, work_years_note, updated_at)
                VALUES (?,?,?,?,datetime('now','localtime'))""",
                (pid, YEAR, float(annual), f"Excel总额{annual}（工龄待核）"))
        quota_n += 1

    for x in rows:
        if not x["staff_id"]: continue
        sid = x["staff_id"].replace("Y", "").replace("y", "").lstrip("0")
        cand = [k for k in staff if k.lstrip("0") == sid.lstrip("0")]
        pid = cand[0] if cand else x["staff_id"]
        if not dry:
            cur.execute("""INSERT INTO leave_records
                (staff_id, leave_type, start_date, end_date, days, status,
                 quota_year, source, created_at, updated_at)
                VALUES (?,?,?,?,?,'verified',?,'import',
                        datetime('now','localtime'),datetime('now','localtime'))""",
                (pid, x["leave_type"], x["start_date"] or "", x["end_date"] or "",
                 x["days"], YEAR))
        rec_n += 1

    if not dry: conn.commit()

    print(f"\n{'[DRY-RUN] ' if dry else ''}额度写入 {quota_n} 人 / 流水写入 {rec_n} 条")
    if missing:
        print(f"\n⚠ Excel标四组但 peixun 无此人（{len(missing)}人，需你确认）：")
        for gh, nm in missing: print(f"   {gh} {nm}")

    # ── 5. 回读验证 ──
    if not dry:
        print("\n=== 回读验证：四组年休余额 ===")
        q = cur.execute("""
          SELECT s.id, s.real_name, q.annual_total,
                 COALESCE((SELECT SUM(days) FROM leave_records l
                           WHERE l.staff_id=s.id AND l.leave_type='年休'),0) AS used
          FROM leave_quota q JOIN staff s ON s.id=q.staff_id
          WHERE q.year=? ORDER BY (q.annual_total - COALESCE((SELECT SUM(days)
            FROM leave_records l WHERE l.staff_id=s.id AND l.leave_type='年休'),0)) DESC
        """, (YEAR,)).fetchall()
        print(f"{'工号':<8}{'姓名':<8}{'应得':>5}{'已休':>7}{'剩余':>7}")
        tot_l = 0
        for r in q:
            left = r["annual_total"] - r["used"]
            tot_l += left
            flag = " ⚠超" if left < 0 else (" 用完" if left == 0 else "")
            print(f"{r['id']:<8}{r['real_name']:<8}{r['annual_total']:>5.0f}{r['used']:>7.1f}{left:>7.1f}{flag}")
        print(f"\n合计 {len(q)} 人，剩余年休总和 {tot_l:.1f} 天")
    conn.close()

if __name__ == "__main__":
    main()

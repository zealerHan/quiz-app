// test/ui/smoke-admin.spec.js
//
// 管理后台冒烟测试（2026-11-27）
//
// 这组测试是 AdminScreen 重构的保险。
// 拆 3,572 行文件最怕「拆完某个 tab 白屏了但没人发现」，
// 后端 110 个单测碰不到界面，只能靠这里。
//
// 设计：每个 tab 一个 test，只验证三件事
//   ① 能点开（不卡在加载中）
//   ② 页面有该 tab 该有的关键内容
//   ③ 没有 JS 报错
//
// 不测具体交互（按钮点了会发生什么），因为那种测试一改样式就红，
// 维护成本高于收益，最后没人跑。
//
// ⚠️ 密码从环境变量 ADMIN_PASSWORD 读，绝不写死在代码里 —— 仓库是公开的。
//    ADMIN_PASSWORD='***' npx playwright test test/ui/smoke-admin.spec.js

const { test, expect } = require("@playwright/test");

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// 没有密码就整组跳过，而不是报错（方便别人 clone 下来跑）
test.skip(!ADMIN_PASSWORD, "未设置 ADMIN_PASSWORD，跳过管理后台测试");

// 收集 JS 报错
function collectErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") {
      const t = m.text();
      if (!/Failed to load resource|net::ERR/.test(t)) errors.push("console: " + t);
    }
  });
  return errors;
}

/** 进管理后台并登录，返回时的页面已停在概览页 */
async function adminLogin(page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // 点「管理员入口」
  await page.getByText("管理员入口", { exact: false }).first().click();
  await page.waitForTimeout(1500);

  // 输密码（找一个 password 类型的输入框，找不到就用可见的第一个 input）
  const pwd = page.locator('input[type="password"]').first();
  const target = (await pwd.count()) ? pwd : page.locator("input").first();
  await target.fill(ADMIN_PASSWORD);

  // 登录按钮文字可能是「进入后台」「登录」「确定」之类，逐个试
  const btn = page.getByRole("button", { name: /进入|登录|确定|确认/ }).first();
  await btn.click();

  // 等到出现 tab 栏（概览是默认 tab）
  await expect(page.locator("body")).toContainText("概览", { timeout: 25000 });
}

/** 点某个 tab 并等一小会儿让它加载数据 */
async function openTab(page, name) {
  await page.getByRole("button", { name, exact: true }).first().click();
  await page.waitForTimeout(2500);
}

test.describe("管理后台冒烟 — 9 个 tab 都能打开", () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
  });

  test("概览 tab", async ({ page }) => {
    const errors = collectErrors(page);
    // adminLogin 已停在概览，等数据
    await page.waitForTimeout(2500);
    const body = page.locator("body");
    await expect(body).toContainText("概览");
    expect(errors, "概览不该有 JS 报错").toEqual([]);
  });

  test("人员 tab", async ({ page }) => {
    const errors = collectErrors(page);
    await openTab(page, "人员");
    const body = page.locator("body");
    // 应该能看到人员相关内容（姓名或"人员"字样）
    await expect(body).toContainText(/人员|姓名|工号/);
    expect(errors, "人员 tab 不该有 JS 报错").toEqual([]);
  });

  test("休假 tab", async ({ page }) => {
    const errors = collectErrors(page);
    await openTab(page, "休假");
    const body = page.locator("body");
    await expect(body).toContainText(/休假|年休|待批/);
    expect(errors, "休假 tab 不该有 JS 报错").toEqual([]);
  });

  // 这条是回归保护：全组休假总览曾经因为代码没进 git 而丢失过一次
  // （2026-11-27 老韩发现）。加断言防止再丢。
  test("休假 tab 有全组休假总览", async ({ page }) => {
    const errors = collectErrors(page);
    await openTab(page, "休假");
    const body = page.locator("body");
    await expect(body).toContainText("全组休假总览");
    // 展开后应该有年份切换和合计
    // 断言用界面上真实存在的措辞：顶部三列是「假期总额 / 已休 / 剩余」
    // （2026-11-27：原断言写的是「总天数」，与改版后的界面不符，导致误报失败）
    await body.getByText("全组休假总览").first().click();
    await page.waitForTimeout(2500);
    await expect(body).toContainText("2026 年");
    await expect(body).toContainText("假期总额");
    await expect(body).toContainText("已休");
    await expect(body).toContainText("剩余");
    expect(errors, "总览不该有 JS 报错").toEqual([]);
  });

  test("题库 tab", async ({ page }) => {
    const errors = collectErrors(page);
    await openTab(page, "题库");
    const body = page.locator("body");
    await expect(body).toContainText(/题库|题目|导入/);
    expect(errors, "题库 tab 不该有 JS 报错").toEqual([]);
  });

  test("留言 tab", async ({ page }) => {
    const errors = collectErrors(page);
    await openTab(page, "留言");
    const body = page.locator("body");
    await expect(body).toContainText(/留言/);
    expect(errors, "留言 tab 不该有 JS 报错").toEqual([]);
  });

  test("设置 tab", async ({ page }) => {
    const errors = collectErrors(page);
    await openTab(page, "设置");
    const body = page.locator("body");
    await expect(body).toContainText(/设置/);
    expect(errors, "设置 tab 不该有 JS 报错").toEqual([]);
  });

  test("日志 tab", async ({ page }) => {
    const errors = collectErrors(page);
    await openTab(page, "日志");
    const body = page.locator("body");
    await expect(body).toContainText(/日志|操作/);
    expect(errors, "日志 tab 不该有 JS 报错").toEqual([]);
  });

  test("设备 tab", async ({ page }) => {
    const errors = collectErrors(page);
    await openTab(page, "设备");
    const body = page.locator("body");
    await expect(body).toContainText(/设备/);
    expect(errors, "设备 tab 不该有 JS 报错").toEqual([]);
  });

  test("扫码 tab", async ({ page }) => {
    const errors = collectErrors(page);
    await openTab(page, "扫码");
    const body = page.locator("body");
    await expect(body).toContainText(/扫码|二维码/);
    expect(errors, "扫码 tab 不该有 JS 报错").toEqual([]);
  });
});

test.describe("管理后台 — 关键数据能显示", () => {
  test("概览页能看到统计数字", async ({ page }) => {
    await adminLogin(page);
    await page.waitForTimeout(3000);
    const text = await page.locator("body").innerText();
    // 概览应该有数字（人数、题数、答题数之类）
    const hasNumber = /\d+/.test(text);
    expect(hasNumber, "概览页应该有统计数字").toBe(true);
  });

  test("人员 tab 能列出真实人员", async ({ page }) => {
    await adminLogin(page);
    await openTab(page, "人员");
    const text = await page.locator("body").innerText();
    // 至少能看到一个已知的真实姓名
    const known = ["韩颖", "艾凌风", "胡鑫", "韩思成", "蔡一凡"];
    const found = known.some((n) => text.includes(n));
    expect(found, "人员列表应该显示真实姓名").toBe(true);
  });

  // 回归保护：ResetAnswerModal / MakeupGrantModal / RemediationGrantModal
  // 2026-11-27 从 AdminScreen.jsx 抽到 admin/OverviewModals.jsx（Stage 3）。
  //
  // 三个弹窗都从「本套班完成情况」的人员卡片分流进入，判据是卡片上的次要标签：
  //   已完成「xx分 ›」    → ResetAnswerModal（重置：姓名）
  //   逾期「逾期 ›」      → MakeupGrantModal（补答授权：姓名）
  //   需复查「xx分 需复查 ›」→ RemediationGrantModal（授权复查：姓名）
  //
  // ⚠ 定位踩过的坑：
  //   人员卡片的 DOM 是
  //     <div onClick style="cursor:pointer">      ← 可点的就是这层
  //       <div>盛成</div>
  //       <div>68.3分 ›</div>                     ← children=0 的叶子
  //     </div>
  //   姓名和分数是两个兄弟 div，textContent 拼起来没有空格，innerText 中间是换行。
  //   所以正则 `^\s*.+\s*\d+分\s*›\s*$` 匹配不上（. 不跨行）。
  //   可靠判据是：cursor:pointer 且直接子节点里含「数字分 ›」的 div。
  test("概览：点已完成人员弹出重置弹窗", async ({ page }) => {
    const errors = collectErrors(page);
    await adminLogin(page);
    await page.waitForTimeout(3500);

    const body = page.locator("body");

    // 用 evaluate 直接挑出可点击的人员卡片，返回它在 DOM 里的索引
    const cardHandle = await page.evaluateHandle(() => {
      const all = Array.from(document.querySelectorAll("div"));
      return all.find((e) => {
        if (getComputedStyle(e).cursor !== "pointer") return false;
        if (e.children.length !== 2) return false;
        const t = (e.textContent || "").trim();
        return /\d+(\.\d+)?分 ›$/.test(t);
      }) || null;
    });

    const exists = await cardHandle.evaluate((e) => !!e);
    if (!exists) {
      test.skip(true, "本套班没有「xx分 ›」形式的已完成人员卡片");
      return;
    }
    await cardHandle.asElement().click();

    await page.waitForTimeout(1200);
    const after = await body.innerText();
    const hasResetModal = /重置[：:]/.test(after) && after.includes("本套班答题记录");
    expect(hasResetModal, "点已完成人员应弹出重置答题弹窗").toBe(true);
    expect(errors, "重置弹窗不该有 JS 报错").toEqual([]);
  });
  // 回归保护：导出记录三个面板 2026-11-27 从 AdminScreen.jsx 抽到
  // admin/ExportPanels.jsx（Stage 3 最后一块）。
  //
  // 三个面板是三层状态机，父组件持状态：
  //   showExportMenu==='open'
  //     ├─ exportWsModal==null && wsMultiMonthSel==null → ExportMainPanel
  //     ├─ wsMultiMonthSel!==null                      → WorkshopMultiMonthPanel（跨月合并）
  //     └─ exportWsModal!==null                        → WorkshopPlansPanel（按场次导出）
  //
  // 本用例走完整链路：打开导出 → 主面板有抽问记录 → 点跨月合并 → 进子面板 → 返回。
  // 只验证「渲染出来 + 能来回切」，不真点导出（导出会开新窗口下文件）。
  test("概览：导出记录三层面板能打开和返回", async ({ page }) => {
    const errors = collectErrors(page);
    await adminLogin(page);
    await page.waitForTimeout(3500);

    const body = page.locator("body");

    // 1) 打开导出弹窗
    await body.getByText("📊 导出记录", { exact: false }).first().click();
    await page.waitForTimeout(2000);

    let text = await body.innerText();
    expect(text, "导出弹窗应显示抽问记录区").toContain("抽问记录");
    expect(text, "导出弹窗应显示月度任务区").toContain("月度任务");
    expect(text, "应有跨月合并按钮").toContain("跨月合并");

    // 2) 进跨月合并子面板
    await body.getByText("跨月合并", { exact: false }).first().click();
    await page.waitForTimeout(2000);

    text = await body.innerText();
    expect(text, "跨月合并面板应有标题").toContain("培训记录跨月合并");
    expect(text, "跨月合并面板应有返回按钮").toContain("返回");

    // 3) 返回主面板
    await body.getByText("← 返回", { exact: false }).first().click();
    await page.waitForTimeout(1500);

    text = await body.innerText();
    expect(text, "返回后应回到主面板（月度任务可见）").toContain("月度任务");

    expect(errors, "导出面板不该有 JS 报错").toEqual([]);
  });

  // 回归保护：MemberEvalModal 2026-11-27 从 AdminScreen.jsx 抽到
  // admin/OverviewModals.jsx（Stage 3 重构）。抽完必须还能正常弹出、显示真实数据。
  //
  // ⚠ 踩过三个坑，都记下来免得再犯：
  //   1. body.getByText(姓名).first() 点到积分榜/成员列表的同名元素，
  //      弹出「重置答题」弹窗 → 假失败。
  //   2. 「本月任务未完成人员」里的名字是 span，不可点击，点了没反应。
  //   3. 「固定成员」区块不常出现——接口 /api/admin/month-member-completion
  //      的 fixed 当前返回 0 个，整块用 fixedMembers.length>0 包着，压根不渲染。
  //   能稳定触发弹窗的是「本月培训完成情况」里各小组的成员行（onClick=openMemberModal）。
  test("概览：点本月培训成员能弹出详情", async ({ page }) => {
    const errors = collectErrors(page);
    await adminLogin(page);
    await page.waitForTimeout(4000);

    const body = page.locator("body");
    const text = await body.innerText();

    expect(text, "概览应该有『本月培训完成情况』区块").toContain("本月培训完成情况");

    // 在「本月培训完成情况」到「班组各类题均分」之间取片段（小组名单就在这里）
    const start = text.indexOf("本月培训完成情况");
    const end = text.indexOf("班组各类题均分");
    const seg = text.slice(start, end > start ? end : start + 1500);

    // 从成员列表里挑一个真实姓名
    //
    // ⚠ 踩过四个坑：
    //   1. getByText(姓名).first() 点到积分榜同名元素 → 弹出「重置答题」
    //   2. 「本月任务未完成人员」里是 span，不可点击
    //   3. 「固定成员」整块不渲染（接口 fixed 返回 0 条）
    //   4. 「第三小组·韩思成」里的韩思成是**组长名**，不是成员行，点了没反应
    //      → 必须用真正的成员姓名，且定位到成员行 div（含 done/total 分数那个）
    const realMembers = ["蔡一凡", "宋典伦", "吴卓群", "胡斌", "郭文亮", "彭涵", "陈实",
                         "董治昆", "姚云", "李如政", "李凌嵩", "胡锦洲", "贺子涵"];
    const nameInSeg = realMembers.find((n) => seg.includes(n));
    expect(nameInSeg, "本月培训完成情况里应能看到真实成员姓名").toBeTruthy();

    // 成员行形如「蔡一凡 11/23 3/3」，用 hasText 找同时含姓名和 n/n 的元素
    const rows = page.locator("div").filter({ hasText: new RegExp(`${nameInSeg}.*\\d/\\d`) });
    const cnt = await rows.count();
    expect(cnt, `应能定位到成员行「${nameInSeg}」`).toBeGreaterThan(0);
    await rows.nth(cnt - 1).click({ force: true });

    await page.waitForTimeout(1500);
    const after = await body.innerText();
    const hasModal = after.includes("本月培训项点完成情况") || after.includes("本月暂无培训项点");
    expect(hasModal, `点培训成员「${nameInSeg}」应弹出培训详情弹窗`).toBe(true);
    expect(errors, "弹窗不该有 JS 报错").toEqual([]);
  });
});

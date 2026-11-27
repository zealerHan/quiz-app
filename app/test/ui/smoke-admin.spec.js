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
    await body.getByText("全组休假总览").first().click();
    await page.waitForTimeout(2500);
    await expect(body).toContainText("2026 年");
    await expect(body).toContainText("总天数");
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
});

// test/ui/smoke-staff.spec.js
//
// 组员端冒烟测试（2026-11-27）
//
// 只验证「页面能开、关键内容在、没有 JS 报错」。不测交互细节。
// 组员端不需要密码，用测试账号 19991（韩思成）登录。
//
// ⚠️ 测试会在 login_devices 表留下登录记录，污染「设备留痕」的真实数据。
// 清理方法（按 UA 标记精确删除，不误伤真人记录）：
//   docker exec peixun node -e "
//     const {db}=require('/app/server/db');
//     db.prepare(\"DELETE FROM login_devices WHERE ua LIKE '%CrewUISMokeTest%'\").run();
//   "
// 所以下面给测试浏览器设了专属 UA —— 没有这个标记就分不清测试和真人。

const { test, expect } = require("@playwright/test");

// 收集页面 JS 报错 —— 这是最有价值的一条断言。
// 白屏往往不报错，但「有异常」几乎总是先于白屏出现。
function collectErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") {
      // 忽略资源加载失败（图片/字体），只关心脚本错误
      const t = m.text();
      if (!/Failed to load resource|net::ERR/.test(t)) errors.push("console: " + t);
    }
  });
  return errors;
}

async function staffLogin(page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // 工号 + 手机尾号
  const inputs = page.locator("input");
  await inputs.nth(0).fill("19991");
  await inputs.nth(1).fill("2097");

  await page.getByRole("button", { name: /欢迎登录/ }).click();
  // 登录后应该看到首页问候语
  await expect(page.locator("body")).toContainText(/你好/, { timeout: 20000 });
}

test.describe("组员端冒烟", () => {
  test("登录页正常打开", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/");
    await expect(page.locator("body")).toContainText("乘务系统");
    await expect(page.locator("body")).toContainText("工");
    expect(errors, "登录页不该有 JS 报错").toEqual([]);
  });

  test("能登录并看到首页卡片（留言墙已换待开发占位）", async ({ page }) => {
    const errors = collectErrors(page);
    await staffLogin(page);

    const body = page.locator("body");
    // 四张主卡：日常答题 / 月度任务 / 我的假期 / 待开发占位
    // 2026-11-28：留言墙隐藏（SHOW_WALL=false），第二排右边换成不可点的「待开发」卡
    await expect(body).toContainText("日常答题");
    await expect(body).toContainText("月度任务");
    await expect(body).toContainText("我的假期");
    await expect(body).toContainText("待开发");

    // 留言墙不该再出现在首页
    await expect(body).not.toContainText("留言墙");

    expect(errors, "首页不该有 JS 报错").toEqual([]);
  });

  test("我的假期页：余额和申报日历都在", async ({ page }) => {
    const errors = collectErrors(page);
    await staffLogin(page);

    // 注意：登录后不能再 goto("/")，那会刷掉状态回到登录页。
    // 直接在当前页面点「我的假期」卡片。
    await page.getByText("我的假期", { exact: false }).first().click();

    // 不用固定等待：下一行的 toContainText 自己会等（默认 5s，够用）
    const body = page.locator("body");
    await expect(body).toContainText("假期余额");
    await expect(body).toContainText("申报假期");
    // 假别标签
    await expect(body).toContainText("年休");
    // 星期行（4 周日历的表头）
    await expect(body).toContainText("一");

    expect(errors, "假期页不该有 JS 报错").toEqual([]);
  });

  test("ErrorBoundary 自测开关能显示错误页", async ({ page }) => {
    // ?ebtest=1 会在渲染时抛异常，验证错误边界生效
    await page.goto("/?ebtest=1");
    await page.waitForLoadState("networkidle");
    // 不用固定等待：下面的 toContainText 自己会等

    const body = page.locator("body");
    await expect(body).toContainText("页面出了点问题");
    await expect(body).toContainText("重试");
    await expect(body).toContainText("刷新页面");
  });
});

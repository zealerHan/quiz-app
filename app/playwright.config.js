// playwright.config.js
//
// UI 冒烟测试配置（2026-11-27 加）
//
// 目的：给 AdminScreen 重构上一道保险。
// 拆 3,572 行文件最怕的是「拆完某个 tab 白屏了但没人发现」，
// 后端 110 个单测碰不到界面，只能靠这个。
//
// 设计原则：
//   · 只测「能打开、不报错、关键数据看得见」，不测具体交互细节
//     （细节测试维护成本高，一改样式就红，反而没人跑）
//   · 跑线上环境，不跑本地 dev（本机 node_modules 的 better-sqlite3 已失效）
//   · 密码从环境变量读，绝不写进代码 —— 仓库是公开的
//
// 怎么跑：
//   ADMIN_PASSWORD='***' npx playwright test
//
// 只看某个测试：
//   ADMIN_PASSWORD='***' npx playwright test -g "概览"

const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./test/ui",
  // 一次跑完不要太多并行，线上是生产环境，别给服务器压力
  workers: 1,
  // 每个测试给足时间：线上走 Cloudflare 隧道，比本地慢
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // 失败重试 1 次，排除网络抖动造成假红
  retries: 1,
  // 不要每个测试都截图，只在失败时截
  reporter: [["list"], ["html", { outputFolder: "test/ui/report", open: "never" }]],
  use: {
    baseURL: process.env.BASE_URL || "https://peixun.zealerhan.cn",
    // 失败留证据
    screenshot: "only-on-failure",
    video: "off",
    trace: "retain-on-failure",
    // 用已下载的 chromium，不去重新下
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 900 },
    // ★ 专属 UA 标记：测试会在 login_devices 表留记录，
    //   有了这个标记才能和真人记录区分开、精确清理。
    //   清理 SQL：DELETE FROM login_devices WHERE ua LIKE '%CrewUISMokeTest%'
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
             + "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 CrewUISMokeTest",
    // 忽略 https 证书问题（Cloudflare 正常不该有，但别让它挡测试）
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: "chromium",
      use: {
        // 用本机已装的 Chrome，不另外下载 Playwright 自带浏览器
        // （缓存里的版本号与 playwright 1.64 要的对不上，下载又要走代理）
        channel: "chrome",
        // ⚠️ 注意顺序：devices 展开在前，userAgent 在后。
        // devices["Desktop Chrome"] 自带 userAgent，放后面会把标记覆盖掉
        // （踩过一次：标记没生效，测试记录和真人记录混在一起没法清）。
        ...devices["Desktop Chrome"],
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                 + "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 CrewUISMokeTest",
      },
    },
  ],
});

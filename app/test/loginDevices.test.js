// test/loginDevices.test.js
//
// 设备识别 + 真实 IP 提取测试（2026-11-27 加）
//
// 为什么重要：
//   describeUA 判错 → 后台「一人多设备 / 设备共用」根本看不出来，留痕等于白留
//   clientIp 取错  → 记录下来的是隧道内网地址，所有登录看起来都来自同一个 IP
//
// 不需要数据库，Mac 上也能跑。

const { test, describe } = require("node:test");
const assert = require("node:assert");
const { describeUA, clientIp } = require("../server/loginDevices.js");

// ─── UA 解析 ─────────────────────────────────────────────────
describe("describeUA — 操作系统", () => {
  test("iPhone", () => {
    const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1";
    assert.match(describeUA(ua), /iPhone/);
  });

  test("iPad（不能误判成 iPhone）", () => {
    const ua = "Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1";
    assert.match(describeUA(ua), /iPad/);
    assert.ok(!describeUA(ua).includes("iPhone"));
  });

  test("Android", () => {
    const ua = "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
    assert.match(describeUA(ua), /Android/);
  });

  test("Windows", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    assert.match(describeUA(ua), /Windows/);
  });

  test("Mac", () => {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    assert.match(describeUA(ua), /Mac/);
  });

  test("空 UA → 未知设备，不抛异常", () => {
    assert.equal(describeUA(""), "(未知设备)");
    assert.equal(describeUA(null), "(未知设备)");
    assert.equal(describeUA(undefined), "(未知设备)");
  });
});

describe("describeUA — 浏览器（微信/钉钉必须优先识别）", () => {
  test("微信内置浏览器", () => {
    // 微信 UA 里同时含 iPhone 和 Safari，必须优先判成微信
    const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.40(0x18002832) NetType/WIFI Language/zh_CN";
    assert.match(describeUA(ua), /微信/);
    assert.ok(!describeUA(ua).includes("Safari"), "微信不该被判成 Safari");
  });

  test("钉钉内置浏览器", () => {
    const ua = "Mozilla/5.0 (Linux; U; Android 13; zh-CN; V2227A Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/100.0.4896.58 UWS/3.22.0.7 Mobile Safari/537.36 AliApp(DingTalk/7.0.15) com.alibaba.android.rimet/21600000 Channel/227200 language/zh-CN";
    assert.match(describeUA(ua), /钉钉/);
  });

  test("Android 微信（微信优先级高于 Android 默认）", () => {
    const ua = "Mozilla/5.0 (Linux; Android 13; PGT-AN00 Build/HUAWEIPGT-AN00) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/111.0.0.0 Mobile Safari/537.36 MMWEBID/1234 MicroMessenger/8.0.42.2460(0x28002A35)";
    const d = describeUA(ua);
    assert.match(d, /Android/);
    assert.match(d, /微信/);
  });

  test("Edge（不能误判成 Chrome）", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";
    assert.match(describeUA(ua), /Edge/);
  });

  test("iOS 上的 Chrome（CriOS）", () => {
    const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1";
    assert.match(describeUA(ua), /Chrome/);
  });

  test("Firefox", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0";
    assert.match(describeUA(ua), /Firefox/);
  });

  test("输出格式为「系统 · 浏览器」", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    assert.match(describeUA(ua), /^Windows · Chrome$/);
  });

  test("识别不出浏览器时给「未知浏览器」，不返回 undefined", () => {
    const d = describeUA("SomethingWeird/1.0");
    assert.ok(typeof d === "string");
    assert.ok(d.includes("·"), "格式应保持「系统 · 浏览器」");
    assert.ok(!d.includes("undefined"));
  });
});

// ─── 真实 IP 提取 ────────────────────────────────────────────
describe("clientIp — 链路是 Cloudflare → cloudflared → 容器", () => {
  test("优先 cf-connecting-ip", () => {
    const req = { headers: { "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9" }, socket: { remoteAddress: "172.17.0.1" } };
    assert.equal(clientIp(req), "1.2.3.4");
  });

  test("没有 cf 头时取 x-forwarded-for 首段", () => {
    const req = { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1, 172.17.0.1" }, socket: { remoteAddress: "172.17.0.1" } };
    assert.equal(clientIp(req), "1.2.3.4");
  });

  test("都没有时退回 socket.remoteAddress", () => {
    const req = { headers: {}, socket: { remoteAddress: "192.168.1.50" } };
    assert.equal(clientIp(req), "192.168.1.50");
  });

  test("完全取不到时返回空字符串，不抛异常", () => {
    assert.equal(clientIp({ headers: {} }), "");
    assert.equal(clientIp({ headers: {}, socket: {} }), "");
  });

  test("IP 两侧空白会被清掉", () => {
    const req = { headers: { "cf-connecting-ip": "  1.2.3.4  " } };
    assert.equal(clientIp(req), "1.2.3.4");
  });

  test("x-forwarded-for 多段时会 trim", () => {
    const req = { headers: { "x-forwarded-for": "  1.2.3.4  , 10.0.0.1" } };
    assert.equal(clientIp(req), "1.2.3.4");
  });

  test("绝不返回隧道内网地址（当 cf 头存在时）", () => {
    // 这是线上真实场景，req.ip 会是 172.17.x.x
    const req = { headers: { "cf-connecting-ip": "111.60.1.1" }, socket: { remoteAddress: "172.17.0.2" } };
    assert.equal(clientIp(req), "111.60.1.1");
    assert.ok(!clientIp(req).startsWith("172."));
  });
});

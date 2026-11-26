// src/ErrorBoundary.jsx
//
// 全局错误边界（2026-11-27 加）
//
// 为什么需要：React 组件里任何未捕获的 JS 异常，默认会让整棵组件树卸载，
// 用户看到的就是纯白页面 —— 不知道发生了什么，也不知道该怎么办。
// 乘务系统是给班组手机用的，白屏等于「这系统坏了」，比报错信息伤害大得多。
//
// 这个组件只做三件事：
//   1. 接住异常，不让它把整页干掉
//   2. 显示一句人话 + 一个「重试」按钮
//   3. 把错误记到 localStorage，方便事后排查（手机上没法看控制台）
//
// 注意：ErrorBoundary 只能接住「渲染期间」的同步异常。
// 接不住的：事件处理器里的异常、setTimeout / Promise 里的异常、它自己的异常。
// 那几类要靠 window.onerror / unhandledrejection，已在下面一并挂上。

import React from "react";

const LS_KEY = "crew_error_log";
const MAX_LOG = 20;

/** 记一条错误到 localStorage（手机上唯一能事后查的地方） */
function logError(info) {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    list.unshift(info);
    // 只留最近 20 条，防止把 localStorage 撑满
    localStorage.setItem(LS_KEY, JSON.stringify(list.slice(0, MAX_LOG)));
  } catch (e) {
    // 记录失败绝不能影响主流程
  }
}

/** 读取错误记录（管理后台可用） */
export function readErrorLog() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    logError({
      time: new Date().toISOString(),
      message: error?.message || String(error),
      // 只留前 800 字，堆栈太长没必要
      stack: (error?.stack || "").slice(0, 800),
      component: (errorInfo?.componentStack || "").slice(0, 400),
    });
    // 控制台也打一份，电脑上排查方便
    console.error("[ErrorBoundary]", error, errorInfo);
  }

  handleReload = () => {
    // 先试软重置：清掉错误状态重新渲染
    this.setState({ error: null, errorInfo: null });
    // 软重置没用的，让用户手动刷新
  };

  handleHardReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    const msg = this.state.error?.message || String(this.state.error);

    return (
      <div style={{
        minHeight: "100vh",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: "24px 20px", gap: 16,
        background: "#0d1b2a", color: "#dce8f3",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif",
      }}>
        <div style={{ fontSize: 44, lineHeight: 1 }}>😵</div>

        <div style={{ fontSize: 17, fontWeight: 600 }}>页面出了点问题</div>

        <div style={{
          fontSize: 13, color: "#8fb8dd", textAlign: "center",
          maxWidth: 320, lineHeight: 1.7,
        }}>
          不影响已提交的数据。可以先点「重试」，不行再刷新。
        </div>

        {/* 错误详情默认折叠 —— 给管理员看的，不给普通组员添乱 */}
        <details style={{
          maxWidth: 340, width: "100%",
          fontSize: 11, color: "#6f8ba3",
          background: "rgba(255,255,255,.04)",
          borderRadius: 10, padding: "10px 12px",
        }}>
          <summary style={{ cursor: "pointer", outline: "none" }}>
            错误详情（给管理员看）
          </summary>
          <div style={{
            marginTop: 8, wordBreak: "break-all",
            whiteSpace: "pre-wrap", maxHeight: 160, overflow: "auto",
            fontFamily: "ui-monospace, Menlo, monospace", lineHeight: 1.5,
          }}>
            {msg}
          </div>
        </details>

        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          <button
            onClick={this.handleReload}
            style={{
              padding: "11px 26px", borderRadius: 12, border: "none",
              background: "#6ba5fb", color: "#fff",
              fontSize: 14, fontWeight: 600, cursor: "pointer",
            }}
          >
            重试
          </button>
          <button
            onClick={this.handleHardReload}
            style={{
              padding: "11px 26px", borderRadius: 12,
              border: "1px solid rgba(255,255,255,.18)",
              background: "transparent", color: "#8fb8dd",
              fontSize: 14, cursor: "pointer",
            }}
          >
            刷新页面
          </button>
        </div>

        <div style={{ fontSize: 11, color: "#4d6478", marginTop: 8 }}>
          反复出现请联系管理员
        </div>
      </div>
    );
  }
}

/**
 * 挂全局兜底：事件处理器、Promise、定时器里的异常不会经过 ErrorBoundary，
 * 但至少记下来，别让它悄无声息。
 */
export function installGlobalErrorHandlers() {
  if (typeof window === "undefined") return;

  window.addEventListener("error", (e) => {
    // 资源加载失败（img/script）不记，噪音太大
    if (e.target && e.target !== window && e.target.tagName) return;
    logError({
      time: new Date().toISOString(),
      message: e.message || "unknown error",
      stack: (e.error?.stack || "").slice(0, 800),
      source: `${e.filename || "?"}:${e.lineno || "?"}`,
    });
  });

  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    logError({
      time: new Date().toISOString(),
      message: r?.message || String(r),
      stack: (r?.stack || "").slice(0, 800),
      source: "unhandledrejection",
    });
  });
}

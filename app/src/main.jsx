// src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { ErrorBoundary, installGlobalErrorHandlers } from "./ErrorBoundary.jsx";

// 先挂全局兜底，保证 App 渲染前出的错也能被记下来
installGlobalErrorHandlers();

/**
 * 错误边界自测炸弹（2026-11-27）
 *
 * 访问任意页面加 `?ebtest=1` 就会让一个子组件在渲染时抛异常，
 * 用来验证 ErrorBoundary 真的能接住、真的不白屏。
 *
 * 为什么留在代码里而不是测完删掉：
 *   - 不加参数时它完全不生效（只是读了一次 location），零成本
 *   - 以后改了 React 版本或动了 App 结构，可以随时用这个开关复验
 *   - 手机上也能测：微信/浏览器打开链接后面加 ?ebtest=1 即可
 */
function EbtestBomb({ children }) {
  const on = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("ebtest") === "1";
  if (on) throw new Error("ErrorBoundary 自测：这是人为制造的渲染期异常");
  return children;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <EbtestBomb>
      <App/>
    </EbtestBomb>
  </ErrorBoundary>
);

// src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { ErrorBoundary, installGlobalErrorHandlers } from "./ErrorBoundary.jsx";

// 先挂全局兜底，保证 App 渲染前出的错也能被记下来
installGlobalErrorHandlers();

ReactDOM.createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <App/>
  </ErrorBoundary>
);

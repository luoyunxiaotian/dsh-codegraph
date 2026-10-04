import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';
import { ThemeProvider } from './context/ThemeContext.js';
import './index.css';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class WebviewErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[CodeGraph Webview] Uncaught render error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen w-screen bg-[#151517] text-white p-6 select-text">
          <div className="text-3xl mb-3">🧭</div>
          <h2 className="text-base font-semibold text-red-400 mb-2">代码图谱界面渲染异常</h2>
          <p className="text-xs text-gray-400 mb-4 max-w-md text-center">
            {this.state.error?.message || '未知渲染错误'}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-medium cursor-pointer transition-colors"
          >
            重新载入页面
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WebviewErrorBoundary>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </WebviewErrorBoundary>
  </React.StrictMode>
);

import React, { createContext, useContext, useState, useEffect } from 'react';

export type ThemeMode = 'light' | 'dark';

interface ThemeContextType {
  theme: ThemeMode;
  isDark: boolean;
  setTheme: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'dark',
  isDark: true,
  setTheme: () => {},
  toggleTheme: () => {},
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    // 1. 优先读取 URL 中的显式主题参数 (?theme=light 或 ?theme=dark)
    const searchParams = new URLSearchParams(window.location.search);
    const queryTheme = searchParams.get('theme');
    if (queryTheme === 'light' || queryTheme === 'dark') {
      return queryTheme;
    }

    // 2. 检查宿主已挂载的 DOM 标记 (若同域或直接嵌入)
    if (typeof document !== 'undefined') {
      if (document.body.hasAttribute('data-ds-dark-theme')) return 'dark';
      if (window.parent && window.parent !== window) {
        try {
          if (window.parent.document.body.hasAttribute('data-ds-dark-theme')) {
            return 'dark';
          } else {
            return 'light';
          }
        } catch {}
      }
    }

    // 3. 检查 localStorage 记忆
    const saved = localStorage.getItem('codegraph-theme');
    if (saved === 'light' || saved === 'dark') {
      return saved;
    }

    // 4. 检查系统深色偏好
    if (typeof window !== 'undefined' && window.matchMedia) {
      if (window.matchMedia('(prefers-color-scheme: light)').matches) {
        return 'light';
      }
    }

    return 'dark';
  });

  const setTheme = (mode: ThemeMode) => {
    setThemeState(mode);
    try {
      localStorage.setItem('codegraph-theme', mode);
    } catch {}
  };

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  // 同步设置到 DOM 根节点
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.setAttribute('data-theme', 'dark');
      root.classList.add('dark');
      document.body.setAttribute('data-ds-dark-theme', '');
    } else {
      root.setAttribute('data-theme', 'light');
      root.classList.remove('dark');
      document.body.removeAttribute('data-ds-dark-theme');
    }
  }, [theme]);

  // 跨窗口动态侦听来自 DeepSeek Harness 宿主的主题切换指令
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === 'codegraph:theme-change') {
        const target = e.data.theme === 'light' ? 'light' : 'dark';
        setTheme(target);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, isDark: theme === 'dark', setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);

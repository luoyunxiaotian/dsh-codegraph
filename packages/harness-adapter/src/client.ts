import React from 'react';
import ReactDOM from 'react-dom';

export const inject = ['slots'];

const h = React.createElement;

/**
 * 宿主主题感知 Hook: 实时监听 DeepSeek Harness 宿主暗色/亮色切换
 */
function useHostTheme(): boolean {
  const [isDark, setIsDark] = React.useState<boolean>(() => {
    if (typeof document !== 'undefined') {
      return (
        document.body.hasAttribute('data-ds-dark-theme') ||
        document.documentElement.classList.contains('dark') ||
        document.documentElement.getAttribute('data-theme') === 'dark'
      );
    }
    return false;
  });

  React.useEffect(() => {
    const updateTheme = () => {
      const dark =
        typeof document !== 'undefined' &&
        (document.body.hasAttribute('data-ds-dark-theme') ||
          document.documentElement.classList.contains('dark') ||
          document.documentElement.getAttribute('data-theme') === 'dark');
      setIsDark(dark);
    };

    updateTheme();

    const observer = new MutationObserver(() => {
      updateTheme();
    });

    if (document.body) {
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ['data-ds-dark-theme', 'class', 'data-theme'],
      });
    }
    if (document.documentElement) {
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-ds-dark-theme', 'class', 'data-theme'],
      });
    }

    return () => observer.disconnect();
  }, []);

  return isDark;
}

/**
 * 动态监听 Hero 工作区行容器 (heroWorkspaceRow)，用于通过 Portal 无侵入插入胶囊按钮
 * 绝对不触碰或覆盖 DSH 核心 single slot (如 agentPreset)，彻底避免模式选择下拉框 (PTC/极简) 冲突
 */
function useHeroWorkspaceRow(): HTMLElement | null {
  const [rowEl, setRowEl] = React.useState<HTMLElement | null>(() => {
    if (typeof document !== 'undefined') {
      return document.querySelector('[class*="heroWorkspaceRow"]');
    }
    return null;
  });

  React.useEffect(() => {
    if (typeof document === 'undefined') return;

    const update = () => {
      const el = document.querySelector('[class*="heroWorkspaceRow"]') as HTMLElement | null;
      setRowEl((prev) => (prev !== el ? el : prev));
    };

    update();

    const observer = new MutationObserver(() => {
      update();
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return rowEl;
}

/**
 * 工作区路径解析助手函数: 4层兜底保证获取用户当前选中的项目目录
 */
function resolveWorkspacePath(props: any): string {
  // 1. 如果组件显式传参，优先采用
  if (props?.activeWorkspace) return props.activeWorkspace;

  // 2. 尝试从 props.useSessions 读取当前会话绑定的 cwd
  if (typeof props?.useSessions === 'function' && props?.sessionId) {
    try {
      const sessionCwd = props.useSessions((s: any) => s?.byId?.[props?.sessionId]?.cwd);
      if (sessionCwd) return sessionCwd;
    } catch {}
  }

  // 3. 尝试从 props.useWorkspaces 获取工作区列表
  let wsList: any[] = [];
  if (typeof props?.useWorkspaces === 'function') {
    try {
      wsList = props.useWorkspaces((s: any) => s?.items) || [];
      if (Array.isArray(wsList) && wsList.length > 0) {
        if (props?.sessionId) {
          const matched = wsList.find((w: any) => w.sessionIds?.includes(props.sessionId));
          if (matched?.path) return matched.path;
        }
      }
    } catch {}
  }

  // 4. 从 DOM 辅助提取（当用户在工作区选择器刚切换时）
  if (typeof document !== 'undefined') {
    try {
      const chip =
        document.querySelector('[class*="heroWorkspaceRow"] button') ||
        document.querySelector('button[aria-label*="工作区"]') ||
        document.querySelector('button[aria-label*="workspace"]');
      const text = chip?.textContent?.trim();
      if (text && Array.isArray(wsList) && wsList.length > 0) {
        const found = wsList.find((w: any) => w.title === text || w.path?.endsWith(text));
        if (found?.path) return found.path;
      }
      if (text && (text.includes(':') || text.includes('/') || text.includes('\\'))) {
        return text;
      }
    } catch {}
  }

  // 5. 兜底采用第一个工作区路径
  if (Array.isArray(wsList) && wsList.length > 0 && wsList[0]?.path) {
    return wsList[0].path;
  }

  return '';
}

/**
 * 代码图谱主面板组件 (同时支持作为独立 Tab 视图或新会话 Overlay 浮层呈现)
 */
function CodeGraphViewPanel(props: any) {
  // 1. 动态感知 DeepSeek Harness 当前工作区根目录
  const activeWorkspace = React.useMemo(() => {
    return resolveWorkspacePath(props);
  }, [props?.activeWorkspace, props?.sessionId, props?.useSessions, props?.useWorkspaces]);

  // 2. 宿主主题与 iframe 交互
  const isDark = useHostTheme();
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);

  // 当宿主主题切换时，向 iframe 发送无感切肤消息
  React.useEffect(() => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        {
          type: 'codegraph:theme-change',
          theme: isDark ? 'dark' : 'light',
        },
        '*'
      );
    }
  }, [isDark]);

  const handleIframeLoad = () => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        {
          type: 'codegraph:theme-change',
          theme: isDark ? 'dark' : 'light',
        },
        '*'
      );
    }
  };

  const [key, setKey] = React.useState(0);
  const [status, setStatus] = React.useState<'checking' | 'online' | 'offline'>('checking');
  const [statusText, setStatusText] = React.useState('正在检测引擎状态...');
  const [isScanning, setIsScanning] = React.useState(false);

  const iframeUrl = React.useMemo(() => {
    const base = 'http://127.0.0.1:3333';
    const params = new URLSearchParams();
    if (activeWorkspace) {
      params.set('workspace', activeWorkspace);
    }
    params.set('theme', isDark ? 'dark' : 'light');
    return `${base}/?${params.toString()}`;
  }, [activeWorkspace, key]);

  // 3. 状态检测与向 CodeGraph 后台同步当前工作区
  const checkStatus = React.useCallback(async () => {
    setStatus('checking');
    try {
      if (activeWorkspace) {
        await fetch('http://127.0.0.1:3333/api/workspace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspaceRoot: activeWorkspace }),
        }).catch(() => {});
      }

      const queryUrl = activeWorkspace
        ? `http://127.0.0.1:3333/api/status?workspace=${encodeURIComponent(activeWorkspace)}`
        : 'http://127.0.0.1:3333/api/status';

      const res = await fetch(queryUrl, { mode: 'cors' });
      if (res.ok) {
        const data = await res.json();
        setStatus('online');
        setStatusText(data.initialized && data.meta ? `已装配 (${data.meta.fileCount || 0} 文件)` : '就绪');
      } else {
        setStatus('offline');
        setStatusText('未就绪');
      }
    } catch {
      setStatus('offline');
      setStatusText('服务未启动');
    }
  }, [activeWorkspace]);

  React.useEffect(() => {
    checkStatus();
    const timer = setInterval(checkStatus, 10000);
    return () => clearInterval(timer);
  }, [checkStatus]);

  React.useEffect(() => {
    if (activeWorkspace) {
      setKey((prev) => prev + 1);
    }
  }, [activeWorkspace]);

  // 4. 监听来自嵌入 iframe 的图谱上下文注入请求，自动填入下方聊天框
  React.useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === 'codegraph:insert-chat') {
        const textToInsert = e.data.payload;
        if (!textToInsert) return;

        // 查找 DeepSeek Harness 主聊天输入框 [data-composer-input]
        const composerInput = document.querySelector('[data-composer-input]') as HTMLElement;
        if (composerInput) {
          composerInput.focus();
          const success = document.execCommand('insertText', false, textToInsert + '\n');
          if (!success) {
            composerInput.innerText = (composerInput.innerText ? composerInput.innerText + '\n' : '') + textToInsert;
            composerInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // 5. 键盘 Esc 关闭浮层
  React.useEffect(() => {
    if (!props?.isOverlay || !props?.onClose) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        props.onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [props?.isOverlay, props?.onClose]);

  const handleRefresh = () => {
    setKey((prev) => prev + 1);
    checkStatus();
  };

  const handleTriggerScan = async () => {
    if (!activeWorkspace) {
      alert('请先选择目标工作区');
      return;
    }
    setIsScanning(true);
    setStatusText('全量扫描中...');
    try {
      const res = await fetch('http://127.0.0.1:3333/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceRoot: activeWorkspace }),
      });
      if (res.ok) {
        setKey((prev) => prev + 1);
        await checkStatus();
      }
    } catch (err) {
      console.warn('[dsh-codegraph] 扫描触发异常:', err);
    } finally {
      setIsScanning(false);
    }
  };

  const handleOpenBrowser = () => {
    window.open(iframeUrl, '_blank');
  };

  const workspaceShortName = React.useMemo(() => {
    if (!activeWorkspace) return '未选定工作区';
    const normalized = activeWorkspace.replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    return parts[parts.length - 1] || activeWorkspace;
  }, [activeWorkspace]);

  const themeStyles = React.useMemo(() => {
    if (isDark) {
      return {
        bgBase: '#151517',
        bgPanel: '#151517',
        bgLayer1: '#232324',
        textPrimary: '#f9fafb',
        textSecondary: '#cfd3d6',
        textTertiary: '#979da6',
        borderSubtle: 'rgba(255, 255, 255, 0.08)',
        borderMedium: 'rgba(255, 255, 255, 0.14)',
        codeBg: '#151517',
      };
    } else {
      return {
        bgBase: '#f7f8fa',
        bgPanel: '#ffffff',
        bgLayer1: '#f2f4f7',
        textPrimary: '#111827',
        textSecondary: '#4b5563',
        textTertiary: '#6b7280',
        borderSubtle: 'rgba(0, 0, 0, 0.08)',
        borderMedium: 'rgba(0, 0, 0, 0.14)',
        codeBg: '#ffffff',
      };
    }
  }, [isDark]);

  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        background: themeStyles.bgBase,
        color: themeStyles.textPrimary,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
        overflow: 'hidden',
        ...(props?.isOverlay
          ? {
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 90,
              boxShadow: isDark ? '0 0 24px rgba(0, 0, 0, 0.5)' : '0 0 24px rgba(0, 0, 0, 0.1)',
            }
          : {}),
      },
    },
    // DeepSeek Harness 原生风格精简操作条 (高度 36px)
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          height: '36px',
          background: themeStyles.bgPanel,
          borderBottom: `0.5px solid ${themeStyles.borderSubtle}`,
          fontSize: '12px',
          flexShrink: 0,
          userSelect: 'none',
        },
      },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
        // 如果是 Overlay 模式，呈现「← 返回新对话」按钮
        props?.isOverlay
          ? h(
              'button',
              {
                type: 'button',
                onClick: props?.onClose,
                title: '返回新对话界面 (Esc)',
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  background: isDark ? 'rgba(65, 118, 230, 0.15)' : 'rgba(65, 118, 230, 0.1)',
                  border: '0.5px solid rgba(65, 118, 230, 0.4)',
                  color: '#4176e6',
                  borderRadius: '14px',
                  padding: '2px 10px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  marginRight: '6px',
                  transition: 'all 0.15s ease',
                  outline: 'none',
                },
              },
              h('span', { style: { fontSize: '12px', lineHeight: 1 } }, '←'),
              h('span', null, '返回新对话')
            )
          : null,
        // DeepSeek Blue 徽章
        h(
          'span',
          {
            style: {
              width: '18px',
              height: '18px',
              borderRadius: '4px',
              background: 'rgba(65, 118, 230, 0.15)',
              border: '0.5px solid rgba(65, 118, 230, 0.3)',
              color: '#4176e6',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '10px',
              fontWeight: 700,
            },
          },
          'CG'
        ),
        h(
          'span',
          { style: { fontWeight: 600, color: themeStyles.textPrimary, fontSize: '12px', letterSpacing: '-0.2px' } },
          'CodeGraph'
        ),
        // 工作区小标签
        h(
          'div',
          {
            title: `当前工作区:\n${activeWorkspace || '未检测到工作区'}`,
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '1px 7px',
              borderRadius: '12px',
              background: themeStyles.bgLayer1,
              border: `0.5px solid ${themeStyles.borderSubtle}`,
              fontSize: '11px',
              color: themeStyles.textSecondary,
              fontFamily: 'monospace',
            },
          },
          h('span', null, '📁'),
          h('span', null, workspaceShortName)
        ),
        // 状态圆点
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '11px',
              color: status === 'online' ? '#22c55e' : status === 'offline' ? '#f59e0b' : themeStyles.textTertiary,
              marginLeft: '2px',
            },
          },
          h('span', {
            style: {
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: status === 'online' ? '#22c55e' : status === 'offline' ? '#f59e0b' : themeStyles.textTertiary,
              display: 'inline-block',
            },
          }),
          h('span', null, statusText)
        )
      ),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
        h(
          'button',
          {
            onClick: handleTriggerScan,
            disabled: isScanning,
            title: '全量重新扫描当前项目 AST 并更新图谱',
            style: {
              background: 'transparent',
              color: isScanning ? themeStyles.textTertiary : '#4176e6',
              border: '0.5px solid rgba(65, 118, 230, 0.35)',
              padding: '2px 8px',
              borderRadius: '4px',
              cursor: isScanning ? 'not-allowed' : 'pointer',
              fontSize: '11px',
              lineHeight: '18px',
              transition: 'all 0.15s',
            },
          },
          isScanning ? '⟳ 扫描中...' : '↻ 重新扫描'
        ),
        h(
          'button',
          {
            onClick: handleRefresh,
            title: '重新加载图谱视窗',
            style: {
              background: 'transparent',
              color: themeStyles.textSecondary,
              border: `0.5px solid ${themeStyles.borderMedium}`,
              padding: '2px 8px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '11px',
              lineHeight: '18px',
              transition: 'all 0.15s',
            },
          },
          '刷新'
        ),
        h(
          'button',
          {
            onClick: handleOpenBrowser,
            title: '在独立浏览器窗口中全屏打开',
            style: {
              background: '#4176e6',
              color: '#ffffff',
              border: 'none',
              padding: '2px 10px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: 500,
              lineHeight: '18px',
              transition: 'background 0.15s',
            },
          },
          '↗ 独立视窗'
        )
      )
    ),
    // 离线提示横幅 (DSH 标准提示风格)
    status === 'offline'
      ? h(
          'div',
          {
            style: {
              padding: '6px 14px',
              background: themeStyles.bgLayer1,
              borderBottom: `0.5px solid ${themeStyles.borderSubtle}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '12px',
              color: themeStyles.textSecondary,
              flexShrink: 0,
            },
          },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
            h('span', null, '💡 提示：后台引擎未连接。请运行根目录下 '),
            h(
              'code',
              {
                style: {
                  background: themeStyles.codeBg,
                  padding: '1px 5px',
                  borderRadius: '4px',
                  color: '#4176e6',
                  border: `0.5px solid ${themeStyles.borderSubtle}`,
                  fontFamily: 'monospace',
                },
              },
              '启动CodeGraph.bat'
            ),
            h('span', null, '，或点击右侧重试。')
          ),
          h(
            'button',
            {
              onClick: checkStatus,
              style: {
                background: '#4176e6',
                color: '#ffffff',
                border: 'none',
                padding: '2px 8px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '11px',
              },
            },
            '重试'
          )
        )
      : null,
    // 嵌入式 Webview 画布
    h('iframe', {
      ref: iframeRef,
      key,
      src: iframeUrl,
      onLoad: handleIframeLoad,
      style: {
        flex: 1,
        width: '100%',
        height: '100%',
        border: 'none',
        background: themeStyles.bgBase,
      },
      title: 'CodeGraph Studio',
    })
  );
}

/**
 * 新对话 Hero 工作区行旁边的胶囊按钮组件
 */
function HeroCapsuleButton({
  activeWorkspace,
  isDark,
  onOpen,
}: {
  activeWorkspace: string;
  isDark: boolean;
  onOpen: () => void;
}) {
  const [isHovered, setIsHovered] = React.useState(false);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!activeWorkspace) {
      alert('💡 提示：请先在左侧选择或关联一个项目工作区文件夹，再生成代码图谱。');
      return;
    }

    // 静默向后台发送工作区路径并准备图谱 (0 Token)
    try {
      await fetch('http://127.0.0.1:3333/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceRoot: activeWorkspace }),
      });
    } catch (err) {
      console.warn('[dsh-codegraph] 后台服务连接异常:', err);
    }

    onOpen();
  };

  return h(
    'button',
    {
      type: 'button',
      onClick: handleClick,
      onMouseEnter: () => setIsHovered(true),
      onMouseLeave: () => setIsHovered(false),
      title: activeWorkspace
        ? `生成/查看【${activeWorkspace}】代码图谱 (0 Token)`
        : '生成当前工作区代码图谱 (0 Token)',
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        height: '28px',
        padding: '0 11px',
        marginLeft: '6px',
        borderRadius: '14px',
        fontSize: '12px',
        fontWeight: 500,
        cursor: 'pointer',
        background: isHovered
          ? (isDark ? 'rgba(65, 118, 230, 0.22)' : 'rgba(65, 118, 230, 0.12)')
          : (isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.05)'),
        color: isHovered
          ? '#4176e6'
          : (isDark ? '#e1e4ea' : '#333333'),
        border: isHovered
          ? '0.5px solid rgba(65, 118, 230, 0.5)'
          : (isDark ? '0.5px solid rgba(255, 255, 255, 0.12)' : '0.5px solid rgba(0, 0, 0, 0.1)'),
        transition: 'all 0.15s ease',
        outline: 'none',
        boxShadow: isHovered ? '0 0 10px rgba(65, 118, 230, 0.25)' : 'none',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      },
    },
    h('span', { style: { fontSize: '13px', lineHeight: 1 } }, '🧭'),
    h('span', null, '生成代码图谱')
  );
}

/**
 * 注入输入框底栏工具栏的快捷组件 (挂载在 conversation.input.right)
 * 具备双重功能:
 * 1. 在输入框右下角展示「🧭 图谱」快捷按钮 (全场景可用)
 * 2. 如果检测到新对话 Hero 工作区行 (heroWorkspaceRow)，通过 Portal 无侵入插入「🧭 生成代码图谱」胶囊按钮
 *    （绝对不注册 conversation.hero.agentPreset single slot，因此完全不会与 PTC / 极简模式产生冲突）
 */
function InputCodeGraphUnifiedSlot(props: any) {
  const [isHovered, setIsHovered] = React.useState(false);
  const [isOpen, setIsOpen] = React.useState(false);
  const isDark = useHostTheme();
  const heroRowEl = useHeroWorkspaceRow();

  const activeWorkspace = React.useMemo(() => {
    return resolveWorkspacePath(props);
  }, [props?.sessionId, props?.useSessions, props?.useWorkspaces]);

  const handleInputBtnClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!activeWorkspace) {
      alert('💡 提示：请先选择项目工作区文件夹');
      return;
    }
    setIsOpen(true);
  };

  return h(
    React.Fragment,
    null,
    // A. 输入框底栏快捷按钮 (位于发送按钮旁)
    h(
      'button',
      {
        type: 'button',
        onClick: handleInputBtnClick,
        onMouseEnter: () => setIsHovered(true),
        onMouseLeave: () => setIsHovered(false),
        title: '代码图谱 (0 Token 直接查看/生成)',
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          height: '24px',
          padding: '0 8px',
          borderRadius: '4px',
          fontSize: '11px',
          fontWeight: 500,
          cursor: 'pointer',
          background: isHovered
            ? (isDark ? 'rgba(65, 118, 230, 0.2)' : 'rgba(65, 118, 230, 0.12)')
            : 'transparent',
          color: isHovered ? '#4176e6' : (isDark ? '#9ca3af' : '#6b7280'),
          border: isHovered
            ? '0.5px solid rgba(65, 118, 230, 0.4)'
            : '0.5px solid transparent',
          transition: 'all 0.15s ease',
          outline: 'none',
        },
      },
      h('span', { style: { fontSize: '12px', lineHeight: 1 } }, '🧭'),
      h('span', null, '图谱')
    ),

    // B. 新会话 Hero 界面胶囊按钮 (通过 Portal 优雅注入 heroWorkspaceRow，排在模式选择右侧)
    heroRowEl
      ? ReactDOM.createPortal(
          h(HeroCapsuleButton, {
            activeWorkspace,
            isDark,
            onOpen: () => setIsOpen(true),
          }),
          heroRowEl
        )
      : null,

    // C. 沉浸式图谱工作台浮层 (全屏 Overlay 展开，0 Token)
    isOpen && typeof document !== 'undefined'
      ? ReactDOM.createPortal(
          h(CodeGraphViewPanel, {
            ...props,
            isOverlay: true,
            onClose: () => setIsOpen(false),
            activeWorkspace,
          }),
          document.querySelector('[data-conversation-content]') || document.body
        )
      : null
  );
}

/**
 * DSH 插件注册入口: 仅使用 list 类型安全插槽，坚决不触碰 single 独占插槽
 */
export function apply(ctx: any): void {
  if (ctx.slots && typeof ctx.slots.inject === 'function') {
    // 1. 注入会话顶部视图列表: 注册「代码图谱」标签页 (有会话历史时与「对话」、「轨迹」并列)
    ctx.slots.inject('conversation.view', () =>
      ctx.slots.register(
        {
          name: 'conversation.view',
          id: 'codegraph',
          order: 15,
          label: () => '代码图谱',
        },
        CodeGraphViewPanel
      )
    );

    // 2. 注入输入框底栏工具栏 (conversation.input.right 是 list 类型安全插槽，支持多插件并存)
    //    该组件内部负责渲染底栏图标，并在 Hero 状态下通过 Portal 投射胶囊按钮到 heroWorkspaceRow
    ctx.slots.inject('conversation.input.right', () =>
      ctx.slots.register(
        {
          name: 'conversation.input.right',
          id: 'codegraph-input-action',
          order: 5,
        },
        InputCodeGraphUnifiedSlot
      )
    );
  }
}

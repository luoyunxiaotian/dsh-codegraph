import React from 'react';

export const inject = ['slots'];

const h = React.createElement;

function CodeGraphViewPanel(props: any) {
  // 1. 动态感知 DeepSeek Harness 当前会话或工作区绑定的根目录
  const sessionCwd = typeof props?.useSessions === 'function' && props?.sessionId
    ? props.useSessions((s: any) => s?.byId?.[props?.sessionId]?.cwd)
    : undefined;

  const workspaces = typeof props?.useWorkspaces === 'function'
    ? props.useWorkspaces((s: any) => s?.items)
    : undefined;

  const activeWorkspace = React.useMemo(() => {
    if (sessionCwd) return sessionCwd;
    if (Array.isArray(workspaces)) {
      const matched = workspaces.find((w: any) => w.sessionIds?.includes(props?.sessionId));
      if (matched?.path) return matched.path;
      if (workspaces[0]?.path) return workspaces[0].path;
    }
    return '';
  }, [sessionCwd, workspaces, props?.sessionId]);

  // 2. 宿主主题自适应感知 (深色/浅色) 与 iframe 动态切肤通道
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

  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);

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

  // 当宿主主题切换时，向 iframe 发送无感无缝切肤消息
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

  const handleRefresh = () => {
    setKey((prev) => prev + 1);
    checkStatus();
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
      },
    },
    // DeepSeek Harness 原生风格精简操作条 (高度 34px)
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          height: '34px',
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
              padding: '1px 6px',
              borderRadius: '4px',
              background: themeStyles.bgLayer1,
              border: `0.5px solid ${themeStyles.borderSubtle}`,
              fontSize: '11px',
              color: themeStyles.textTertiary,
              fontFamily: 'monospace',
            },
          },
          workspaceShortName
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
            onClick: handleRefresh,
            title: '刷新视窗',
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

export function apply(ctx: any): void {
  // 注入会话顶部视图列表: 注册「代码图谱」标签页 (与「对话」、「轨迹」并列)
  if (ctx.slots && typeof ctx.slots.inject === 'function') {
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
  }
}

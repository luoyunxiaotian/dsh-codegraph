import React from 'react';

export const inject = ['slots'];

const h = React.createElement;

/**
 * 安全的 createPortal 包装器 (兼容各种打包与模块加载环境，并附带 try-catch 容灾)
 */
function safeCreatePortal(children: any, container: any) {
  if (!container || typeof document === 'undefined') return null;
  try {
    // 兼容 ESM 与 CJS 静态映射
    const rd = require('react-dom');
    const portalFn = rd?.createPortal || rd?.default?.createPortal;
    if (typeof portalFn === 'function') {
      return portalFn(children, container);
    }
  } catch (err) {
    console.warn('[dsh-codegraph] safeCreatePortal error:', err);
  }
  return null;
}

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
 * 智能 DOM 锚定 Hook:
 * 解决 React 18 父组件在状态更新时重新 reconcile 子元素导致外来 DOM 节点被冲刷的问题。
 * 当宿主组件 re-render 冲掉胶囊按钮时，毫秒级捕获并触发 Portal 重新附着，保证绝对常驻不消失！
 */
function useHeroPortalTarget(): { container: HTMLElement | null; renderKey: number } {
  const [state, setState] = React.useState<{ container: HTMLElement | null; renderKey: number }>({
    container: null,
    renderKey: 0,
  });

  React.useEffect(() => {
    if (typeof document === 'undefined') return;

    let timer: any = null;

    const inspect = () => {
      const row = document.querySelector('[class*="heroWorkspaceRow"]') as HTMLElement | null;
      if (!row) {
        setState((prev) => (prev.container !== null ? { container: null, renderKey: prev.renderKey + 1 } : prev));
        return;
      }
      const existingBtn = row.querySelector('[data-codegraph-hero-btn]');
      if (!existingBtn) {
        setState((prev) => ({ container: row, renderKey: prev.renderKey + 1 }));
      }
    };

    inspect();

    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(inspect, 30);
    });

    observer.observe(document.body, { childList: true, subtree: true });
    const interval = setInterval(inspect, 300);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      observer.disconnect();
    };
  }, []);

  return state;
}

/**
 * 代码图谱主面板组件 (同时支持作为独立 Tab 视图或新会话 Overlay 浮层呈现)
 */
function CodeGraphViewPanel(props: any) {
  // 1. 严格在组件顶层调用 React Hooks，严禁在 useMemo 或条件语句内部调用 hook
  const sessionCwd = typeof props?.useSessions === 'function' && props?.sessionId
    ? props.useSessions((s: any) => s?.byId?.[props?.sessionId]?.cwd)
    : undefined;

  const workspaces = typeof props?.useWorkspaces === 'function'
    ? props.useWorkspaces((s: any) => s?.items)
    : undefined;

  // 2. 动态感知工作区根目录 (优先支持会话专属自定义路径持久化记忆)
  const activeWorkspace = React.useMemo(() => {
    if (props?.sessionId && typeof localStorage !== 'undefined') {
      const boundWs = localStorage.getItem(`dsh_cg_ws_${props.sessionId}`);
      if (boundWs && boundWs.trim()) {
        return boundWs.trim();
      }
    }
    if (props?.activeWorkspace) return props.activeWorkspace;
    if (sessionCwd) return sessionCwd;
    if (Array.isArray(workspaces) && workspaces.length > 0) {
      if (props?.sessionId) {
        const matched = workspaces.find((w: any) => w.sessionIds?.includes(props?.sessionId));
        if (matched?.path) return matched.path;
      }
      if (workspaces[0]?.path) return workspaces[0].path;
    }
    if (typeof document !== 'undefined') {
      try {
        const chip =
          document.querySelector('[class*="heroWorkspaceRow"] button') ||
          document.querySelector('button[aria-label*="工作区"]') ||
          document.querySelector('button[aria-label*="workspace"]');
        const text = chip?.textContent?.trim();
        if (text && Array.isArray(workspaces)) {
          const found = workspaces.find((w: any) => w.title === text || w.path?.endsWith(text));
          if (found?.path) return found.path;
        }
        if (text && (text.includes(':') || text.includes('/') || text.includes('\\'))) {
          return text;
        }
      } catch {}
    }
    return '';
  }, [props?.activeWorkspace, sessionCwd, workspaces, props?.sessionId, key]);

  // 3. 宿主主题与 iframe 交互
  const isDark = useHostTheme();
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);

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

  // 监听来自 Webview 的会话工作区变更通知
  React.useEffect(() => {
    const handleMsg = (e: MessageEvent) => {
      if (e.data?.type === 'codegraph:set-session-workspace' && e.data?.workspaceRoot) {
        const targetSid = e.data.sessionId || props?.sessionId;
        const targetWs = e.data.workspaceRoot;
        if (targetSid && targetWs && typeof localStorage !== 'undefined') {
          localStorage.setItem(`dsh_cg_ws_${targetSid}`, targetWs);
          setKey((prev) => prev + 1);
        }
      }
    };
    window.addEventListener('message', handleMsg);
    return () => window.removeEventListener('message', handleMsg);
  }, [props?.sessionId]);

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
    if (props?.sessionId) {
      params.set('sessionId', props.sessionId);
    }
    params.set('theme', isDark ? 'dark' : 'light');
    return `${base}/?${params.toString()}`;
  }, [activeWorkspace, props?.sessionId, key, isDark]);

  // 4. 状态检测与向 CodeGraph 后台同步当前工作区
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

  // 5. 监听来自嵌入 iframe 的图谱上下文注入请求，自动填入下方聊天框
  React.useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === 'codegraph:insert-chat') {
        const textToInsert = e.data.payload;
        if (!textToInsert) return;

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

  // 6. 键盘 Esc 关闭浮层
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
    // 仅在浮层模式下展示极简顶部返回栏 (在正常会话 Tab 模式下由 Webview 顶部控制台完整接管，零冗余)
    props?.isOverlay
      ? h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 12px',
              height: '32px',
              background: themeStyles.bgPanel,
              borderBottom: `0.5px solid ${themeStyles.borderSubtle}`,
              fontSize: '12px',
              flexShrink: 0,
              userSelect: 'none',
              zIndex: 10,
            },
          },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            h(
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
                  borderRadius: '12px',
                  padding: '2px 8px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  outline: 'none',
                },
              },
              h('span', { style: { fontSize: '12px', lineHeight: 1 } }, '←'),
              h('span', null, '返回新对话')
            ),
            h(
              'div',
              {
                title: `当前工作区:\n${activeWorkspace || '未检测到工作区'}`,
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '1px 7px',
                  borderRadius: '10px',
                  background: themeStyles.bgLayer1,
                  border: `0.5px solid ${themeStyles.borderSubtle}`,
                  fontSize: '11px',
                  color: themeStyles.textSecondary,
                  fontFamily: 'monospace',
                },
              },
              h('span', null, '📁'),
              h('span', null, workspaceShortName)
            )
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
                padding: '2px 8px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '11px',
                fontWeight: 500,
                lineHeight: '16px',
              },
            },
            '↗ 独立视窗'
          )
        )
      : null,
    // 离线提示横幅
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

let globalClientCtx: any = null;

/**
 * 智能探测当前 Hero 新会话界面用户选中的工作区绝对路径
 */
function detectHeroActiveWorkspace(): string {
  if (typeof document === 'undefined') return '';
  try {
    // 1. 获取工作区按钮 Chip 上的显示名称
    const chip =
      document.querySelector('[class*="heroWorkspaceRow"] button') ||
      document.querySelector('button[aria-label*="工作区"]') ||
      document.querySelector('button[aria-label*="workspace"]');
    const chipText = chip?.textContent?.trim() || '';

    // 2. 从 DSH workspaces 服务匹配真实全量文件系统路径
    const ctx = globalClientCtx;
    const uiWorkspace = ctx?.uiWorkspace || ctx?.get?.('uiWorkspace');
    const workspacesService = uiWorkspace?.workspaces || ctx?.workspaces || ctx?.get?.('workspaces');
    const items: Array<{ path: string; title?: string; workspaceId?: string }> =
      workspacesService?.list?.getSnapshot?.()?.items || [];

    if (chipText && items.length > 0) {
      const found = items.find(
        (w) =>
          w.title === chipText ||
          w.path?.endsWith('/' + chipText) ||
          w.path?.endsWith('\\' + chipText) ||
          w.path?.toLowerCase().includes(chipText.toLowerCase())
      );
      if (found?.path) return found.path;
    }

    // 3. 如果 chip 文本包含盘符或路径分隔符，直接作为路径使用
    if (chipText && (chipText.includes(':') || chipText.includes('/') || chipText.includes('\\'))) {
      return chipText;
    }

    // 4. 匹配最近活跃的工作区
    if (items.length > 0 && items[0]?.path) {
      return items[0].path;
    }

    // 5. 从 localStorage 获取上次记忆的工作区
    const lastRecent = localStorage.getItem('dsh.recentWorkspace');
    if (lastRecent) return lastRecent;
  } catch {}
  return '';
}

/**
 * 为指定工作区在 DSH 中直接创建/打开空白会话窗口并导航直达代码图谱视图 (0 Token)
 */
async function createAndOpenCodeGraphSession(activeWorkspace: string): Promise<boolean> {
  if (!activeWorkspace) return false;

  try {
    const ctx = globalClientCtx;
    const uiWorkspace = ctx?.uiWorkspace || ctx?.get?.('uiWorkspace');
    const workspacesService = uiWorkspace?.workspaces || ctx?.workspaces || ctx?.get?.('workspaces');
    const sessionsService = uiWorkspace?.sessions || ctx?.sessions || ctx?.get?.('sessions');

    const norm = (p: string) => p.replace(/[\\\/]+/g, '/').toLowerCase().trim();
    const targetNorm = norm(activeWorkspace);

    // 1. 查找或创建对应的工作区 ID
    let targetWorkspaceId: string | undefined;
    if (workspacesService?.list) {
      try {
        const items = workspacesService.list.getSnapshot?.()?.items || [];
        const matched = items.find((w: any) => {
          if (!w?.path) return false;
          const wNorm = norm(w.path);
          return wNorm === targetNorm || wNorm.endsWith('/' + targetNorm) || targetNorm.endsWith('/' + wNorm);
        });

        if (matched?.workspaceId) {
          targetWorkspaceId = matched.workspaceId;
        } else if (typeof workspacesService.create === 'function') {
          const res = await workspacesService.create({ path: activeWorkspace });
          targetWorkspaceId = res?.workspaceId || res?.workspace?.workspaceId || res?.value?.workspace?.workspaceId;
        }
      } catch (e) {
        console.warn('[dsh-codegraph] 匹配 workspaceId 警告:', e);
      }
    }

    // 2. 首选方案: 调用 uiWorkspace.openWorkspace 或 startSession (0 Token 原生导航)
    if (uiWorkspace) {
      if (targetWorkspaceId && typeof uiWorkspace.openWorkspace === 'function') {
        try {
          await uiWorkspace.openWorkspace(targetWorkspaceId, (nextId: string) => {
            try {
              localStorage.setItem(
                `dsh.conversation.${nextId}`,
                JSON.stringify({ view: 'codegraph', draft: '', viewRequest: null })
              );
            } catch {}
          });
          return true;
        } catch (err) {
          console.warn('[dsh-codegraph] uiWorkspace.openWorkspace 异常:', err);
        }
      }

      if (typeof uiWorkspace.startSession === 'function') {
        try {
          uiWorkspace.startSession(targetWorkspaceId);
          return true;
        } catch (err) {
          console.warn('[dsh-codegraph] uiWorkspace.startSession 异常:', err);
        }
      }
    }

    // 3. 次选方案: 调用 DSH sessions.create 创建空白会话 (0 Token)
    let newSessionId: string | undefined;
    if (sessionsService && typeof sessionsService.create === 'function') {
      try {
        newSessionId = await sessionsService.create({
          workspaceId: targetWorkspaceId,
          cwd: activeWorkspace,
        });
      } catch (e) {
        console.warn('[dsh-codegraph] sessionsService.create 异常:', e);
      }
    }

    if (newSessionId) {
      // 预先设置该会话的首选视图为 'codegraph' (代码图谱)
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(
            `dsh.conversation.${newSessionId}`,
            JSON.stringify({ view: 'codegraph', draft: '', viewRequest: null })
          );
        }
      } catch {}

      // 导航切换进入该新会话窗口
      if (uiWorkspace && typeof uiWorkspace.openSession === 'function') {
        uiWorkspace.openSession(newSessionId);
        return true;
      }
    }
  } catch (err) {
    console.error('[dsh-codegraph] 创建会话窗口严重异常:', err);
  }
  return false;
}

/**
 * 新对话 Hero 工作区行旁边的胶囊按钮组件
 */
function HeroCapsuleButton({
  isDark,
  onOpenOverlay,
}: {
  isDark: boolean;
  onOpenOverlay: (ws: string) => void;
}) {
  const [isHovered, setIsHovered] = React.useState(false);
  const [isCreating, setIsCreating] = React.useState(false);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const targetWs = detectHeroActiveWorkspace();
    if (!targetWs) {
      alert('💡 提示：请先在左侧选择或关联一个项目工作区文件夹，再生成代码图谱。');
      try {
        const chipBtn = document.querySelector(
          '[class*="heroWorkspaceRow"] button, button[class*="workspace"]'
        ) as HTMLButtonElement;
        if (chipBtn) chipBtn.click();
      } catch {}
      return;
    }

    setIsCreating(true);

    // 1. 同步通知 CodeGraph 后台服务装配该工作区 (非阻塞，即使离线也不抛异常)
    try {
      await fetch('http://127.0.0.1:3333/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceRoot: targetWs }),
      }).catch(() => {});
    } catch {}

    // 2. 优先通过 DSH 原生机制创建空白会话并直达图谱标签页 (0 Token)
    let navigated = false;
    try {
      navigated = await createAndOpenCodeGraphSession(targetWs);
    } catch (err) {
      console.warn('[dsh-codegraph] 创建会话窗口未完成，降级为浮层模式:', err);
    }

    setIsCreating(false);

    // 3. 降级模式: 若未能自动导航切入新会话窗口，立即平滑就地展开全屏沉浸式图谱浮层
    if (!navigated) {
      onOpenOverlay(targetWs);
    }
  };

  return h(
    'button',
    {
      type: 'button',
      'data-codegraph-hero-btn': 'true',
      onClick: handleClick,
      onMouseEnter: () => setIsHovered(true),
      onMouseLeave: () => setIsHovered(false),
      disabled: isCreating,
      title: '生成当前工作区代码图谱 (0 Token · 本地静态架构分析)',
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        height: '26px',
        padding: '0 10px',
        marginLeft: '6px',
        borderRadius: '13px',
        fontSize: '11px',
        fontWeight: 500,
        cursor: isCreating ? 'wait' : 'pointer',
        opacity: isCreating ? 0.8 : 1,
        background: isHovered
          ? (isDark ? 'rgba(65, 118, 230, 0.22)' : 'rgba(65, 118, 230, 0.12)')
          : (isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.05)'),
        color: isHovered ? '#4176e6' : (isDark ? '#e1e4ea' : '#333333'),
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
    h('span', { style: { fontSize: '12px', lineHeight: 1 } }, isCreating ? '⏳' : '🧭'),
    h('span', null, isCreating ? '正在创建会话...' : '生成代码图谱')
  );
}

/**
 * 全局常驻根插槽管理器 (挂载在 shell.overlay: scope="root", 永不卸载)
 * 1. 负责在新会话 Hero 界面通过 Portal 附着胶囊按钮 (绝对常驻不消失、零闪烁)
 * 2. 托管图谱降级浮层 (严格限制在 CenterColumn 内部，严禁使用 fixed 9999 遮挡宿主左侧边栏与标题栏)
 */
function CodeGraphShellManager(props: any) {
  const isDark = useHostTheme();
  const [heroContainer, setHeroContainer] = React.useState<HTMLElement | null>(null);
  const [centerContainer, setCenterContainer] = React.useState<HTMLElement | null>(null);
  const [overlayState, setOverlayState] = React.useState<{ isOpen: boolean; workspace: string }>({
    isOpen: false,
    workspace: '',
  });

  // 1. 持续监测 heroWorkspaceRow 挂载点与中心会话区容器
  React.useEffect(() => {
    if (typeof document === 'undefined') return;

    const inspect = () => {
      const row = document.querySelector('[class*="heroWorkspaceRow"]') as HTMLElement | null;
      setHeroContainer((prev) => (prev !== row ? row : prev));

      const center = (
        document.querySelector('[data-conversation-content]') ||
        document.querySelector('[class*="centerColumn"]') ||
        document.querySelector('[class*="CenterColumn"]') ||
        document.querySelector('main')
      ) as HTMLElement | null;
      setCenterContainer((prev) => (prev !== center ? center : prev));
    };

    inspect();

    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { childList: true, subtree: true });
    const interval = setInterval(inspect, 200);

    return () => {
      clearInterval(interval);
      observer.disconnect();
    };
  }, []);

  // 2. 监听全局打开图谱浮层事件 (供底栏工具栏等外部触发)
  React.useEffect(() => {
    const handleOpen = (e: any) => {
      const ws = e.detail?.workspace || detectHeroActiveWorkspace();
      setOverlayState({ isOpen: true, workspace: ws });
    };
    window.addEventListener('codegraph:open-overlay', handleOpen);
    return () => window.removeEventListener('codegraph:open-overlay', handleOpen);
  }, []);

  const overlayPanel = overlayState.isOpen
    ? h(CodeGraphViewPanel, {
        ...props,
        isOverlay: true,
        activeWorkspace: overlayState.workspace,
        onClose: () => setOverlayState({ isOpen: false, workspace: '' }),
      })
    : null;

  return h(
    React.Fragment,
    null,
    // A. 附着在 Hero 界面工作区行旁的胶囊按钮
    heroContainer
      ? safeCreatePortal(
          h(HeroCapsuleButton, {
            isDark,
            onOpenOverlay: (ws: string) => setOverlayState({ isOpen: true, workspace: ws }),
          }),
          heroContainer
        )
      : null,

    // B. 图谱浮层 (降级保障: 严格限制在主工作区内部，绝不覆盖左侧边栏与标题栏)
    overlayState.isOpen && overlayPanel
      ? (centerContainer
          ? safeCreatePortal(
              h(
                'div',
                {
                  style: {
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    zIndex: 60,
                    background: isDark ? '#151517' : '#ffffff',
                  },
                },
                overlayPanel
              ),
              centerContainer
            )
          : h(
              'div',
              {
                style: {
                  position: 'fixed',
                  top: 'var(--dsh-titlebar-height, 0px)',
                  left: 'var(--dsh-windows-sidebar-width, 280px)',
                  right: 0,
                  bottom: 0,
                  zIndex: 60,
                  background: isDark ? '#151517' : '#ffffff',
                },
              },
              overlayPanel
            ))
      : null
  );
}

/**
 * 注入输入框底栏工具栏的快捷组件 (挂载在 conversation.input.right)
 */
function InputCodeGraphUnifiedSlot(props: any) {
  const sessionCwd = typeof props?.useSessions === 'function' && props?.sessionId
    ? props.useSessions((s: any) => s?.byId?.[props?.sessionId]?.cwd)
    : undefined;

  const [isHovered, setIsHovered] = React.useState(false);
  const isDark = useHostTheme();

  const handleInputBtnClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // 1. 如果当前处在已激活的会话中，尝试直接点击切换至「代码图谱」Tab
    if (typeof document !== 'undefined') {
      const tabBtns = Array.from(document.querySelectorAll('button[role="tab"]'));
      const graphTab = tabBtns.find(
        (b) => b.textContent?.includes('代码图谱') || b.textContent?.includes('图谱')
      ) as HTMLButtonElement;
      if (graphTab) {
        graphTab.click();
        return;
      }
    }

    // 2. 否则如果处在 Hero 界面，优先直接创建空白会话直达图谱 (0 Token)
    const ws = sessionCwd || detectHeroActiveWorkspace();
    if (ws) {
      try {
        const opened = await createAndOpenCodeGraphSession(ws);
        if (opened) return;
      } catch {}
    }

    // 3. 降级模式: 向全局 Shell 发送打开图谱事件
    window.dispatchEvent(new CustomEvent('codegraph:open-overlay', { detail: { workspace: ws } }));
  };

  return h(
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
  );
}

/**
 * DSH 插件注册入口
 */
export function apply(ctx: any): void {
  globalClientCtx = ctx;

  if (ctx.slots && typeof ctx.slots.inject === 'function') {
    // 1. 注入会话顶部视图列表: 注册「代码图谱」标签页 (有会话时与「对话」、「轨迹」并列)
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

    // 2. 注入全局常驻根插槽 shell.overlay (scope="root", 永不销毁)
    //    安全常驻呈现新会话 Hero 界面的「🧭 生成代码图谱」按钮，并托管全局图谱 Overlay
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register(
        {
          name: 'shell.overlay',
          id: 'codegraph-shell-manager',
          order: 50,
        },
        CodeGraphShellManager
      )
    );

    // 3. 注入输入框底栏工具栏 (conversation.input.right)
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




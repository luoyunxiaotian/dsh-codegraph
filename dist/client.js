const registerCodeGraph = (require) => {
  var module = { exports: {} };
  var exports = module.exports;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// packages/harness-adapter/src/client.ts
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);
var import_react = __toESM(require("react"), 1);
var inject = ["slots", "sessions", "workspaces", "uiWorkspace"];
var h = import_react.default.createElement;
function safeCreatePortal(children, container) {
  if (!container || typeof document === "undefined") return null;
  try {
    const rd = require("react-dom");
    const portalFn = rd?.createPortal || rd?.default?.createPortal;
    if (typeof portalFn === "function") {
      return portalFn(children, container);
    }
  } catch (err) {
    console.warn("[dsh-codegraph] safeCreatePortal error:", err);
  }
  return null;
}
function useHostTheme() {
  const [isDark, setIsDark] = import_react.default.useState(() => {
    if (typeof document !== "undefined") {
      return document.body.hasAttribute("data-ds-dark-theme") || document.documentElement.classList.contains("dark") || document.documentElement.getAttribute("data-theme") === "dark";
    }
    return false;
  });
  import_react.default.useEffect(() => {
    const updateTheme = () => {
      const dark = typeof document !== "undefined" && (document.body.hasAttribute("data-ds-dark-theme") || document.documentElement.classList.contains("dark") || document.documentElement.getAttribute("data-theme") === "dark");
      setIsDark(dark);
    };
    updateTheme();
    const observer = new MutationObserver(() => {
      updateTheme();
    });
    if (document.body) {
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["data-ds-dark-theme", "class", "data-theme"]
      });
    }
    if (document.documentElement) {
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-ds-dark-theme", "class", "data-theme"]
      });
    }
    return () => observer.disconnect();
  }, []);
  return isDark;
}
function useHeroPortalTarget() {
  const [state, setState] = import_react.default.useState({
    container: null,
    renderKey: 0
  });
  import_react.default.useEffect(() => {
    if (typeof document === "undefined") return;
    let timer = null;
    const inspect = () => {
      const row = document.querySelector('[class*="heroWorkspaceRow"]');
      if (!row) {
        setState((prev) => prev.container !== null ? { container: null, renderKey: prev.renderKey + 1 } : prev);
        return;
      }
      const existingBtn = row.querySelector("[data-codegraph-hero-btn]");
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
function CodeGraphViewPanel(props) {
  const sessionCwd = typeof props?.useSessions === "function" && props?.sessionId ? props.useSessions((s) => s?.byId?.[props?.sessionId]?.cwd) : void 0;
  const workspaces = typeof props?.useWorkspaces === "function" ? props.useWorkspaces((s) => s?.items) : void 0;
  const activeWorkspace = import_react.default.useMemo(() => {
    if (props?.activeWorkspace) return props.activeWorkspace;
    if (sessionCwd) return sessionCwd;
    if (Array.isArray(workspaces) && workspaces.length > 0) {
      if (props?.sessionId) {
        const matched = workspaces.find((w) => w.sessionIds?.includes(props?.sessionId));
        if (matched?.path) return matched.path;
      }
      if (workspaces[0]?.path) return workspaces[0].path;
    }
    if (typeof document !== "undefined") {
      try {
        const chip = document.querySelector('[class*="heroWorkspaceRow"] button') || document.querySelector('button[aria-label*="\u5DE5\u4F5C\u533A"]') || document.querySelector('button[aria-label*="workspace"]');
        const text = chip?.textContent?.trim();
        if (text && Array.isArray(workspaces)) {
          const found = workspaces.find((w) => w.title === text || w.path?.endsWith(text));
          if (found?.path) return found.path;
        }
        if (text && (text.includes(":") || text.includes("/") || text.includes("\\"))) {
          return text;
        }
      } catch {
      }
    }
    return "";
  }, [props?.activeWorkspace, sessionCwd, workspaces, props?.sessionId]);
  const isDark = useHostTheme();
  const iframeRef = import_react.default.useRef(null);
  import_react.default.useEffect(() => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        {
          type: "codegraph:theme-change",
          theme: isDark ? "dark" : "light"
        },
        "*"
      );
    }
  }, [isDark]);
  const handleIframeLoad = () => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        {
          type: "codegraph:theme-change",
          theme: isDark ? "dark" : "light"
        },
        "*"
      );
    }
  };
  const [key, setKey] = import_react.default.useState(0);
  const [status, setStatus] = import_react.default.useState("checking");
  const [statusText, setStatusText] = import_react.default.useState("\u6B63\u5728\u68C0\u6D4B\u5F15\u64CE\u72B6\u6001...");
  const [isScanning, setIsScanning] = import_react.default.useState(false);
  const iframeUrl = import_react.default.useMemo(() => {
    const base = "http://127.0.0.1:3333";
    const params = new URLSearchParams();
    if (activeWorkspace) {
      params.set("workspace", activeWorkspace);
    }
    params.set("theme", isDark ? "dark" : "light");
    return `${base}/?${params.toString()}`;
  }, [activeWorkspace, key, isDark]);
  const checkStatus = import_react.default.useCallback(async () => {
    setStatus("checking");
    try {
      if (activeWorkspace) {
        await fetch("http://127.0.0.1:3333/api/workspace", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceRoot: activeWorkspace })
        }).catch(() => {
        });
      }
      const queryUrl = activeWorkspace ? `http://127.0.0.1:3333/api/status?workspace=${encodeURIComponent(activeWorkspace)}` : "http://127.0.0.1:3333/api/status";
      const res = await fetch(queryUrl, { mode: "cors" });
      if (res.ok) {
        const data = await res.json();
        setStatus("online");
        setStatusText(data.initialized && data.meta ? `\u5DF2\u88C5\u914D (${data.meta.fileCount || 0} \u6587\u4EF6)` : "\u5C31\u7EEA");
      } else {
        setStatus("offline");
        setStatusText("\u672A\u5C31\u7EEA");
      }
    } catch {
      setStatus("offline");
      setStatusText("\u670D\u52A1\u672A\u542F\u52A8");
    }
  }, [activeWorkspace]);
  import_react.default.useEffect(() => {
    checkStatus();
    const timer = setInterval(checkStatus, 1e4);
    return () => clearInterval(timer);
  }, [checkStatus]);
  import_react.default.useEffect(() => {
    if (activeWorkspace) {
      setKey((prev) => prev + 1);
    }
  }, [activeWorkspace]);
  import_react.default.useEffect(() => {
    const handleMessage = (e) => {
      if (e.data?.type === "codegraph:insert-chat") {
        const textToInsert = e.data.payload;
        if (!textToInsert) return;
        const composerInput = document.querySelector("[data-composer-input]");
        if (composerInput) {
          composerInput.focus();
          const success = document.execCommand("insertText", false, textToInsert + "\n");
          if (!success) {
            composerInput.innerText = (composerInput.innerText ? composerInput.innerText + "\n" : "") + textToInsert;
            composerInput.dispatchEvent(new Event("input", { bubbles: true }));
          }
        }
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);
  import_react.default.useEffect(() => {
    if (!props?.isOverlay || !props?.onClose) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        props.onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [props?.isOverlay, props?.onClose]);
  const handleRefresh = () => {
    setKey((prev) => prev + 1);
    checkStatus();
  };
  const handleTriggerScan = async () => {
    if (!activeWorkspace) {
      alert("\u8BF7\u5148\u9009\u62E9\u76EE\u6807\u5DE5\u4F5C\u533A");
      return;
    }
    setIsScanning(true);
    setStatusText("\u5168\u91CF\u626B\u63CF\u4E2D...");
    try {
      const res = await fetch("http://127.0.0.1:3333/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceRoot: activeWorkspace })
      });
      if (res.ok) {
        setKey((prev) => prev + 1);
        await checkStatus();
      }
    } catch (err) {
      console.warn("[dsh-codegraph] \u626B\u63CF\u89E6\u53D1\u5F02\u5E38:", err);
    } finally {
      setIsScanning(false);
    }
  };
  const handleOpenBrowser = () => {
    window.open(iframeUrl, "_blank");
  };
  const workspaceShortName = import_react.default.useMemo(() => {
    if (!activeWorkspace) return "\u672A\u9009\u5B9A\u5DE5\u4F5C\u533A";
    const normalized = activeWorkspace.replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    return parts[parts.length - 1] || activeWorkspace;
  }, [activeWorkspace]);
  const themeStyles = import_react.default.useMemo(() => {
    if (isDark) {
      return {
        bgBase: "#151517",
        bgPanel: "#151517",
        bgLayer1: "#232324",
        textPrimary: "#f9fafb",
        textSecondary: "#cfd3d6",
        textTertiary: "#979da6",
        borderSubtle: "rgba(255, 255, 255, 0.08)",
        borderMedium: "rgba(255, 255, 255, 0.14)",
        codeBg: "#151517"
      };
    } else {
      return {
        bgBase: "#f7f8fa",
        bgPanel: "#ffffff",
        bgLayer1: "#f2f4f7",
        textPrimary: "#111827",
        textSecondary: "#4b5563",
        textTertiary: "#6b7280",
        borderSubtle: "rgba(0, 0, 0, 0.08)",
        borderMedium: "rgba(0, 0, 0, 0.14)",
        codeBg: "#ffffff"
      };
    }
  }, [isDark]);
  return h(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: themeStyles.bgBase,
        color: themeStyles.textPrimary,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
        overflow: "hidden",
        ...props?.isOverlay ? {
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 90,
          boxShadow: isDark ? "0 0 24px rgba(0, 0, 0, 0.5)" : "0 0 24px rgba(0, 0, 0, 0.1)"
        } : {}
      }
    },
    // 操作工具栏 (高度 36px)
    h(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 12px",
          height: "36px",
          background: themeStyles.bgPanel,
          borderBottom: `0.5px solid ${themeStyles.borderSubtle}`,
          fontSize: "12px",
          flexShrink: 0,
          userSelect: "none"
        }
      },
      h(
        "div",
        { style: { display: "flex", alignItems: "center", gap: "8px" } },
        props?.isOverlay ? h(
          "button",
          {
            type: "button",
            onClick: props?.onClose,
            title: "\u8FD4\u56DE\u65B0\u5BF9\u8BDD\u754C\u9762 (Esc)",
            style: {
              display: "flex",
              alignItems: "center",
              gap: "4px",
              background: isDark ? "rgba(65, 118, 230, 0.15)" : "rgba(65, 118, 230, 0.1)",
              border: "0.5px solid rgba(65, 118, 230, 0.4)",
              color: "#4176e6",
              borderRadius: "14px",
              padding: "2px 10px",
              fontSize: "11px",
              fontWeight: 600,
              cursor: "pointer",
              marginRight: "6px",
              transition: "all 0.15s ease",
              outline: "none"
            }
          },
          h("span", { style: { fontSize: "12px", lineHeight: 1 } }, "\u2190"),
          h("span", null, "\u8FD4\u56DE\u65B0\u5BF9\u8BDD")
        ) : null,
        h(
          "span",
          {
            style: {
              width: "18px",
              height: "18px",
              borderRadius: "4px",
              background: "rgba(65, 118, 230, 0.15)",
              border: "0.5px solid rgba(65, 118, 230, 0.3)",
              color: "#4176e6",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "10px",
              fontWeight: 700
            }
          },
          "CG"
        ),
        h(
          "span",
          { style: { fontWeight: 600, color: themeStyles.textPrimary, fontSize: "12px", letterSpacing: "-0.2px" } },
          "CodeGraph"
        ),
        h(
          "div",
          {
            title: `\u5F53\u524D\u5DE5\u4F5C\u533A:
${activeWorkspace || "\u672A\u68C0\u6D4B\u5230\u5DE5\u4F5C\u533A"}`,
            style: {
              display: "flex",
              alignItems: "center",
              gap: "4px",
              padding: "1px 7px",
              borderRadius: "12px",
              background: themeStyles.bgLayer1,
              border: `0.5px solid ${themeStyles.borderSubtle}`,
              fontSize: "11px",
              color: themeStyles.textSecondary,
              fontFamily: "monospace"
            }
          },
          h("span", null, "\u{1F4C1}"),
          h("span", null, workspaceShortName)
        ),
        h(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: "4px",
              fontSize: "11px",
              color: status === "online" ? "#22c55e" : status === "offline" ? "#f59e0b" : themeStyles.textTertiary,
              marginLeft: "2px"
            }
          },
          h("span", {
            style: {
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: status === "online" ? "#22c55e" : status === "offline" ? "#f59e0b" : themeStyles.textTertiary,
              display: "inline-block"
            }
          }),
          h("span", null, statusText)
        )
      ),
      h(
        "div",
        { style: { display: "flex", alignItems: "center", gap: "6px" } },
        h(
          "button",
          {
            onClick: handleTriggerScan,
            disabled: isScanning,
            title: "\u5168\u91CF\u91CD\u65B0\u626B\u63CF\u5F53\u524D\u9879\u76EE AST \u5E76\u66F4\u65B0\u56FE\u8C31",
            style: {
              background: "transparent",
              color: isScanning ? themeStyles.textTertiary : "#4176e6",
              border: "0.5px solid rgba(65, 118, 230, 0.35)",
              padding: "2px 8px",
              borderRadius: "4px",
              cursor: isScanning ? "not-allowed" : "pointer",
              fontSize: "11px",
              lineHeight: "18px",
              transition: "all 0.15s"
            }
          },
          isScanning ? "\u27F3 \u626B\u63CF\u4E2D..." : "\u21BB \u91CD\u65B0\u626B\u63CF"
        ),
        h(
          "button",
          {
            onClick: handleRefresh,
            title: "\u91CD\u65B0\u52A0\u8F7D\u56FE\u8C31\u89C6\u7A97",
            style: {
              background: "transparent",
              color: themeStyles.textSecondary,
              border: `0.5px solid ${themeStyles.borderMedium}`,
              padding: "2px 8px",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "11px",
              lineHeight: "18px",
              transition: "all 0.15s"
            }
          },
          "\u5237\u65B0"
        ),
        h(
          "button",
          {
            onClick: handleOpenBrowser,
            title: "\u5728\u72EC\u7ACB\u6D4F\u89C8\u5668\u7A97\u53E3\u4E2D\u5168\u5C4F\u6253\u5F00",
            style: {
              background: "#4176e6",
              color: "#ffffff",
              border: "none",
              padding: "2px 10px",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "11px",
              fontWeight: 500,
              lineHeight: "18px",
              transition: "background 0.15s"
            }
          },
          "\u2197 \u72EC\u7ACB\u89C6\u7A97"
        )
      )
    ),
    // 离线提示横幅
    status === "offline" ? h(
      "div",
      {
        style: {
          padding: "6px 14px",
          background: themeStyles.bgLayer1,
          borderBottom: `0.5px solid ${themeStyles.borderSubtle}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: "12px",
          color: themeStyles.textSecondary,
          flexShrink: 0
        }
      },
      h(
        "div",
        { style: { display: "flex", alignItems: "center", gap: "6px" } },
        h("span", null, "\u{1F4A1} \u63D0\u793A\uFF1A\u540E\u53F0\u5F15\u64CE\u672A\u8FDE\u63A5\u3002\u8BF7\u8FD0\u884C\u6839\u76EE\u5F55\u4E0B "),
        h(
          "code",
          {
            style: {
              background: themeStyles.codeBg,
              padding: "1px 5px",
              borderRadius: "4px",
              color: "#4176e6",
              border: `0.5px solid ${themeStyles.borderSubtle}`,
              fontFamily: "monospace"
            }
          },
          "\u542F\u52A8CodeGraph.bat"
        ),
        h("span", null, "\uFF0C\u6216\u70B9\u51FB\u53F3\u4FA7\u91CD\u8BD5\u3002")
      ),
      h(
        "button",
        {
          onClick: checkStatus,
          style: {
            background: "#4176e6",
            color: "#ffffff",
            border: "none",
            padding: "2px 8px",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "11px"
          }
        },
        "\u91CD\u8BD5"
      )
    ) : null,
    // 嵌入式 Webview 画布
    h("iframe", {
      ref: iframeRef,
      key,
      src: iframeUrl,
      onLoad: handleIframeLoad,
      style: {
        flex: 1,
        width: "100%",
        height: "100%",
        border: "none",
        background: themeStyles.bgBase
      },
      title: "CodeGraph Studio"
    })
  );
}
var globalClientCtx = null;
async function createAndOpenCodeGraphSession(activeWorkspace) {
  if (!activeWorkspace) return false;
  try {
    const ctx = globalClientCtx;
    const workspacesService = ctx?.workspaces || ctx?.get?.("workspaces");
    const sessionsService = ctx?.sessions || ctx?.get?.("sessions");
    const uiWorkspaceService = ctx?.uiWorkspace || ctx?.get?.("uiWorkspace");
    let targetWorkspaceId;
    if (workspacesService?.list) {
      try {
        const items = workspacesService.list.getSnapshot()?.items || [];
        const norm = (p) => p.replace(/[\\\/]+/g, "/").toLowerCase().trim();
        const targetNorm = norm(activeWorkspace);
        const matched = items.find((w) => {
          if (!w?.path) return false;
          const wNorm = norm(w.path);
          return wNorm === targetNorm || wNorm.endsWith("/" + targetNorm) || targetNorm.endsWith("/" + wNorm);
        });
        if (matched?.workspaceId) {
          targetWorkspaceId = matched.workspaceId;
        } else if (typeof workspacesService.create === "function") {
          const created = await workspacesService.create({ path: activeWorkspace });
          targetWorkspaceId = created?.workspaceId;
        }
      } catch (e) {
        console.warn("[dsh-codegraph] \u5339\u914D workspaceId \u8B66\u544A:", e);
      }
    }
    let newSessionId;
    if (sessionsService && typeof sessionsService.create === "function") {
      newSessionId = await sessionsService.create({
        workspaceId: targetWorkspaceId,
        cwd: activeWorkspace
      });
    }
    if (!newSessionId) {
      console.warn("[dsh-codegraph] \u4F1A\u8BDD\u521B\u5EFA\u672A\u8FD4\u56DE sessionId");
      return false;
    }
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(
          `dsh.conversation.${newSessionId}`,
          JSON.stringify({ view: "codegraph", draft: "", viewRequest: null })
        );
      }
    } catch {
    }
    try {
      await fetch("http://127.0.0.1:3333/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceRoot: activeWorkspace })
      });
    } catch (err) {
      console.warn("[dsh-codegraph] \u540E\u53F0\u670D\u52A1\u8FDE\u63A5\u5F02\u5E38:", err);
    }
    if (uiWorkspaceService && typeof uiWorkspaceService.openSession === "function") {
      uiWorkspaceService.openSession(newSessionId);
      return true;
    }
  } catch (err) {
    console.error("[dsh-codegraph] \u521B\u5EFA\u4F1A\u8BDD\u7A97\u53E3\u5931\u8D25:", err);
  }
  return false;
}
function HeroCapsuleButton({
  activeWorkspace,
  isDark,
  onOpen
}) {
  const [isHovered, setIsHovered] = import_react.default.useState(false);
  const [isCreating, setIsCreating] = import_react.default.useState(false);
  const handleClick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!activeWorkspace) {
      alert("\u{1F4A1} \u63D0\u793A\uFF1A\u8BF7\u5148\u5728\u5DE6\u4FA7\u9009\u62E9\u6216\u5173\u8054\u4E00\u4E2A\u9879\u76EE\u5DE5\u4F5C\u533A\u6587\u4EF6\u5939\uFF0C\u518D\u751F\u6210\u4EE3\u7801\u56FE\u8C31\u3002");
      try {
        const chipBtn = document.querySelector(
          '[class*="heroWorkspaceRow"] button, button[class*="workspace"]'
        );
        if (chipBtn) chipBtn.click();
      } catch {
      }
      return;
    }
    setIsCreating(true);
    try {
      const success = await createAndOpenCodeGraphSession(activeWorkspace);
      if (success) {
        setIsCreating(false);
        return;
      }
    } catch (err) {
      console.warn("[dsh-codegraph] \u521B\u5EFA\u4F1A\u8BDD\u7A97\u53E3\u672A\u5B8C\u6210\uFF0C\u964D\u7EA7\u4E3A\u6D6E\u5C42\u6A21\u5F0F:", err);
    }
    try {
      await fetch("http://127.0.0.1:3333/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceRoot: activeWorkspace })
      }).catch(() => {
      });
    } catch {
    }
    setIsCreating(false);
    onOpen();
  };
  return h(
    "button",
    {
      type: "button",
      "data-codegraph-hero-btn": "true",
      onClick: handleClick,
      onMouseEnter: () => setIsHovered(true),
      onMouseLeave: () => setIsHovered(false),
      disabled: isCreating,
      title: activeWorkspace ? `\u4E3A\u3010${activeWorkspace}\u3011\u521B\u5EFA\u4F1A\u8BDD\u5E76\u5236\u4F5C\u4EE3\u7801\u56FE\u8C31 (0 Token)` : "\u751F\u6210\u5F53\u524D\u5DE5\u4F5C\u533A\u4EE3\u7801\u56FE\u8C31 (0 Token)",
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        height: "28px",
        padding: "0 11px",
        marginLeft: "6px",
        borderRadius: "14px",
        fontSize: "12px",
        fontWeight: 500,
        cursor: isCreating ? "wait" : "pointer",
        opacity: isCreating ? 0.8 : 1,
        background: isHovered ? isDark ? "rgba(65, 118, 230, 0.22)" : "rgba(65, 118, 230, 0.12)" : isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.05)",
        color: isHovered ? "#4176e6" : isDark ? "#e1e4ea" : "#333333",
        border: isHovered ? "0.5px solid rgba(65, 118, 230, 0.5)" : isDark ? "0.5px solid rgba(255, 255, 255, 0.12)" : "0.5px solid rgba(0, 0, 0, 0.1)",
        transition: "all 0.15s ease",
        outline: "none",
        boxShadow: isHovered ? "0 0 10px rgba(65, 118, 230, 0.25)" : "none",
        userSelect: "none",
        whiteSpace: "nowrap",
        flexShrink: 0
      }
    },
    h("span", { style: { fontSize: "13px", lineHeight: 1 } }, isCreating ? "\u23F3" : "\u{1F9ED}"),
    h("span", null, isCreating ? "\u6B63\u5728\u521B\u5EFA\u4F1A\u8BDD..." : "\u751F\u6210\u4EE3\u7801\u56FE\u8C31")
  );
}
function InputCodeGraphUnifiedSlot(props) {
  const sessionCwd = typeof props?.useSessions === "function" && props?.sessionId ? props.useSessions((s) => s?.byId?.[props?.sessionId]?.cwd) : void 0;
  const workspaces = typeof props?.useWorkspaces === "function" ? props.useWorkspaces((s) => s?.items) : void 0;
  const [isHovered, setIsHovered] = import_react.default.useState(false);
  const [isOpen, setIsOpen] = import_react.default.useState(false);
  const isDark = useHostTheme();
  const portalTarget = useHeroPortalTarget();
  const activeWorkspace = import_react.default.useMemo(() => {
    if (sessionCwd) return sessionCwd;
    if (Array.isArray(workspaces) && workspaces.length > 0) {
      if (props?.sessionId) {
        const matched = workspaces.find((w) => w.sessionIds?.includes(props?.sessionId));
        if (matched?.path) return matched.path;
      }
      if (workspaces[0]?.path) return workspaces[0].path;
    }
    if (typeof document !== "undefined") {
      try {
        const chip = document.querySelector('[class*="heroWorkspaceRow"] button') || document.querySelector('button[aria-label*="\u5DE5\u4F5C\u533A"]') || document.querySelector('button[aria-label*="workspace"]');
        const text = chip?.textContent?.trim();
        if (text && Array.isArray(workspaces)) {
          const found = workspaces.find((w) => w.title === text || w.path?.endsWith(text));
          if (found?.path) return found.path;
        }
        if (text && (text.includes(":") || text.includes("/") || text.includes("\\"))) {
          return text;
        }
      } catch {
      }
    }
    return "";
  }, [sessionCwd, workspaces, props?.sessionId]);
  const handleInputBtnClick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!activeWorkspace) {
      alert("\u{1F4A1} \u63D0\u793A\uFF1A\u8BF7\u5148\u9009\u62E9\u9879\u76EE\u5DE5\u4F5C\u533A\u6587\u4EF6\u5939");
      return;
    }
    if (typeof document !== "undefined") {
      const tabBtns = Array.from(document.querySelectorAll('button[role="tab"]'));
      const graphTab = tabBtns.find(
        (b) => b.textContent?.includes("\u4EE3\u7801\u56FE\u8C31") || b.textContent?.includes("\u56FE\u8C31")
      );
      if (graphTab) {
        graphTab.click();
        return;
      }
    }
    if (!props?.sessionId || props?.session?.blank) {
      const ok = await createAndOpenCodeGraphSession(activeWorkspace);
      if (ok) return;
    }
    setIsOpen(true);
  };
  return h(
    import_react.default.Fragment,
    null,
    // A. 输入框底栏快捷按钮 (位于发送按钮旁)
    h(
      "button",
      {
        type: "button",
        onClick: handleInputBtnClick,
        onMouseEnter: () => setIsHovered(true),
        onMouseLeave: () => setIsHovered(false),
        title: "\u4EE3\u7801\u56FE\u8C31 (0 Token \u76F4\u63A5\u67E5\u770B/\u751F\u6210)",
        style: {
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          height: "24px",
          padding: "0 8px",
          borderRadius: "4px",
          fontSize: "11px",
          fontWeight: 500,
          cursor: "pointer",
          background: isHovered ? isDark ? "rgba(65, 118, 230, 0.2)" : "rgba(65, 118, 230, 0.12)" : "transparent",
          color: isHovered ? "#4176e6" : isDark ? "#9ca3af" : "#6b7280",
          border: isHovered ? "0.5px solid rgba(65, 118, 230, 0.4)" : "0.5px solid transparent",
          transition: "all 0.15s ease",
          outline: "none"
        }
      },
      h("span", { style: { fontSize: "12px", lineHeight: 1 } }, "\u{1F9ED}"),
      h("span", null, "\u56FE\u8C31")
    ),
    // B. 新会话 Hero 界面胶囊按钮 (通过 safeCreatePortal 附着 heroWorkspaceRow)
    portalTarget.container ? safeCreatePortal(
      h(HeroCapsuleButton, {
        key: portalTarget.renderKey,
        activeWorkspace,
        isDark,
        onOpen: () => setIsOpen(true)
      }),
      portalTarget.container
    ) : null,
    // C. 沉浸式图谱工作台浮层 (全屏 Overlay 展开，0 Token 降级保障)
    isOpen && typeof document !== "undefined" ? safeCreatePortal(
      h(CodeGraphViewPanel, {
        ...props,
        isOverlay: true,
        onClose: () => setIsOpen(false),
        activeWorkspace
      }),
      document.querySelector("[data-conversation-content]") || document.body
    ) : null
  );
}
function apply(ctx) {
  globalClientCtx = ctx;
  if (ctx.slots && typeof ctx.slots.inject === "function") {
    ctx.slots.inject(
      "conversation.view",
      () => ctx.slots.register(
        {
          name: "conversation.view",
          id: "codegraph",
          order: 15,
          label: () => "\u4EE3\u7801\u56FE\u8C31"
        },
        CodeGraphViewPanel
      )
    );
    ctx.slots.inject(
      "conversation.input.right",
      () => ctx.slots.register(
        {
          name: "conversation.input.right",
          id: "codegraph-input-action",
          order: 5
        },
        InputCodeGraphUnifiedSlot
      )
    );
  }
}

  return module.exports;
};
if (typeof window !== "undefined" && window.__ModuleLoader__ && typeof window.__ModuleLoader__.load === "function") {
  window.__ModuleLoader__.load({ id: "dsh-codegraph", factory: registerCodeGraph });
  window.__ModuleLoader__.load({ id: "@codegraph/harness-adapter", factory: registerCodeGraph });
}


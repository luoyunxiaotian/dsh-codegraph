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
var inject = ["slots"];
var h = import_react.default.createElement;
function CodeGraphViewPanel(props) {
  const sessionCwd = typeof props?.useSessions === "function" && props?.sessionId ? props.useSessions((s) => s?.byId?.[props?.sessionId]?.cwd) : void 0;
  const workspaces = typeof props?.useWorkspaces === "function" ? props.useWorkspaces((s) => s?.items) : void 0;
  const activeWorkspace = import_react.default.useMemo(() => {
    if (sessionCwd) return sessionCwd;
    if (Array.isArray(workspaces)) {
      const matched = workspaces.find((w) => w.sessionIds?.includes(props?.sessionId));
      if (matched?.path) return matched.path;
      if (workspaces[0]?.path) return workspaces[0].path;
    }
    return "";
  }, [sessionCwd, workspaces, props?.sessionId]);
  const [isDark, setIsDark] = import_react.default.useState(() => {
    if (typeof document !== "undefined") {
      return document.body.hasAttribute("data-ds-dark-theme") || document.documentElement.classList.contains("dark") || document.documentElement.getAttribute("data-theme") === "dark";
    }
    return false;
  });
  const iframeRef = import_react.default.useRef(null);
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
  const iframeUrl = import_react.default.useMemo(() => {
    const base = "http://127.0.0.1:3333";
    const params = new URLSearchParams();
    if (activeWorkspace) {
      params.set("workspace", activeWorkspace);
    }
    params.set("theme", isDark ? "dark" : "light");
    return `${base}/?${params.toString()}`;
  }, [activeWorkspace, key]);
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
  const handleRefresh = () => {
    setKey((prev) => prev + 1);
    checkStatus();
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
        overflow: "hidden"
      }
    },
    // DeepSeek Harness 原生风格精简操作条 (高度 34px)
    h(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 12px",
          height: "34px",
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
        // DeepSeek Blue 徽章
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
        // 工作区小标签
        h(
          "div",
          {
            title: `\u5F53\u524D\u5DE5\u4F5C\u533A:
${activeWorkspace || "\u672A\u68C0\u6D4B\u5230\u5DE5\u4F5C\u533A"}`,
            style: {
              display: "flex",
              alignItems: "center",
              gap: "4px",
              padding: "1px 6px",
              borderRadius: "4px",
              background: themeStyles.bgLayer1,
              border: `0.5px solid ${themeStyles.borderSubtle}`,
              fontSize: "11px",
              color: themeStyles.textTertiary,
              fontFamily: "monospace"
            }
          },
          workspaceShortName
        ),
        // 状态圆点
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
            onClick: handleRefresh,
            title: "\u5237\u65B0\u89C6\u7A97",
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
    // 离线提示横幅 (DSH 标准提示风格)
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
function apply(ctx) {
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
  }
}

  return module.exports;
};
if (typeof window !== "undefined" && window.__ModuleLoader__ && typeof window.__ModuleLoader__.load === "function") {
  window.__ModuleLoader__.load({ id: "dsh-codegraph", factory: registerCodeGraph });
  window.__ModuleLoader__.load({ id: "@codegraph/harness-adapter", factory: registerCodeGraph });
}


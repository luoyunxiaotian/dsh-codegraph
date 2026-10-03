/**
 * 与 DeepSeek Harness 桌面端宿主进行跨视窗通信的交互工具
 */

export interface InsertChatOptions {
  toastMessage?: string;
  title?: string;
}

type ToastListener = (message: string) => void;
const toastListeners = new Set<ToastListener>();

export function showToast(message: string): void {
  toastListeners.forEach((listener) => {
    try {
      listener(message);
    } catch {}
  });
}

export function subscribeToast(listener: ToastListener): () => void {
  toastListeners.add(listener);
  return () => {
    toastListeners.delete(listener);
  };
}

/**
 * 将文本内容插入到 DeepSeek Harness 下方聊天输入框，并同步复制到剪贴板
 */
export function insertIntoChat(text: string, options: InsertChatOptions = {}): void {
  const trimmed = text.trim();
  if (!trimmed) return;

  // 1. 发送跨视窗消息至 DeepSeek Harness 宿主框架
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(
        {
          type: 'codegraph:insert-chat',
          payload: trimmed,
          title: options.title,
        },
        '*'
      );
    }
  } catch (err) {
    console.warn('[CodeGraph] 发送消息至宿主失败:', err);
  }

  // 2. 剪贴板双保险复制
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(trimmed).catch(() => {});
    }
  } catch {}

  // 3. 触发前端微型气泡提示
  const defaultMsg = options.toastMessage || '✓ 已添加至下方聊天框 (已同步复制)';
  showToast(defaultMsg);
}

/**
 * 仅复制文本到剪贴板并提示
 */
export function copyToClipboard(text: string, label: string = '内容'): void {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
      showToast(`✓ 已复制 ${label} 到剪贴板`);
    }
  } catch {
    showToast(`无法访问剪贴板`);
  }
}

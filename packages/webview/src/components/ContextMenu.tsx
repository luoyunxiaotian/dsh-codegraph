import React, { useEffect, useRef } from 'react';

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  description?: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
  onClick: () => void;
}

export interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  title?: string;
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  x,
  y,
  items,
  title,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // 边界保护与坐标自适应反弹
  const menuWidth = 240;
  const estimatedHeight = items.length * 36 + (title ? 32 : 16);

  const left = x + menuWidth > window.innerWidth ? Math.max(8, x - menuWidth) : x;
  const top = y + estimatedHeight > window.innerHeight ? Math.max(8, y - estimatedHeight) : y;

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('mousedown', handleMouseDown, true);
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('mousedown', handleMouseDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      style={{ left: `${left}px`, top: `${top}px` }}
      className="fixed z-50 w-[240px] bg-dsh-layer1 border border-dsh-border2 rounded-lg shadow-2xl py-1.5 backdrop-blur-md select-none animate-in fade-in zoom-in-95 duration-100"
      onContextMenu={(e) => e.preventDefault()}
    >
      {title && (
        <div className="px-3 py-1.5 mb-1 border-b border-dsh-border1 text-[11px] font-semibold text-dsh-tertiary truncate">
          {title}
        </div>
      )}

      {items.map((item, index) => (
        <React.Fragment key={index}>
          {item.divider && <div className="h-[1px] bg-dsh-border1 my-1" />}
          <button
            type="button"
            disabled={item.disabled}
            onClick={() => {
              if (!item.disabled) {
                item.onClick();
                onClose();
              }
            }}
            className={`w-full flex items-center justify-between px-3 py-1.5 text-[12px] text-left transition-colors ${
              item.disabled
                ? 'opacity-40 cursor-not-allowed text-dsh-dimmed'
                : item.danger
                ? 'text-red-400 hover:bg-red-500/10'
                : 'text-dsh-secondary hover:text-dsh-primary hover:bg-dsh-layer2'
            }`}
          >
            <div className="flex items-center gap-2 truncate">
              {item.icon && <span className="w-3.5 h-3.5 shrink-0 text-dsh-tertiary">{item.icon}</span>}
              <span className="truncate">{item.label}</span>
            </div>
            {item.shortcut && (
              <span className="text-[10px] text-dsh-dimmed font-mono ml-2 shrink-0">{item.shortcut}</span>
            )}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
};

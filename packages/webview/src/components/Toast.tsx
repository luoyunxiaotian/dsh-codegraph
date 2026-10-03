import React, { useState, useEffect } from 'react';
import { subscribeToast } from '../utils/chatBridge.js';
import { CheckCircle2 } from 'lucide-react';

export const Toast: React.FC = () => {
  const [toast, setToast] = useState<{ message: string; id: number } | null>(null);

  useEffect(() => {
    let timer: any = null;
    const unsubscribe = subscribeToast((msg) => {
      setToast({ message: msg, id: Date.now() });
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        setToast(null);
      }, 2500);
    });

    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!toast) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 pointer-events-none animate-in fade-in slide-in-from-bottom-2 duration-150">
      <div className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-dsh-layer1 border border-dsh-border3 text-dsh-primary shadow-2xl text-[12px] font-medium backdrop-blur-md">
        <CheckCircle2 className="w-4 h-4 text-dsh-green shrink-0" />
        <span>{toast.message}</span>
      </div>
    </div>
  );
};

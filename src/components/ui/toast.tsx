"use client";

import { Check, CircleAlert } from "lucide-react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Short confirmations and errors ("Link copied", "Couldn't save"). Announced through a
 * polite live region so screen-reader users hear them too.
 */
type Toast = { id: number; message: string; tone: "info" | "error" };

const ToastContext = createContext<(message: string, tone?: Toast["tone"]) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, tone: Toast["tone"] = "info") => {
    const id = nextId++;
    setToasts((current) => [...current.slice(-2), { id, message, tone }]);
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === "error" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto flex max-w-md items-start gap-2.5 rounded-lg px-3.5 py-2.5 text-sm font-medium shadow-float motion-safe:animate-toast-in",
              toast.tone === "error" ? "bg-danger text-on-accent" : "bg-fg text-canvas",
            )}
          >
            {toast.tone === "error" ? (
              <CircleAlert className="mt-px size-4 shrink-0" aria-hidden />
            ) : (
              <Check className="mt-px size-4 shrink-0" aria-hidden />
            )}
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

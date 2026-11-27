import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog } from "./ui";
import { useI18n } from "../i18n";

type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
};

type ConfirmRequest = ConfirmOptions & {
  id: number;
  resolve: (accepted: boolean) => void;
};

const ConfirmContext = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null);
const rejectConfirmation = () => Promise.resolve(false);

/** 将需要用户确认的动作统一交给应用内的 UI 弹框。 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const nextID = useRef(0);
  const [requests, setRequests] = useState<ConfirmRequest[]>([]);
  const requestsRef = useRef(requests);
  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      const id = ++nextID.current;
      const next = [...requestsRef.current, { ...options, id, resolve }];
      requestsRef.current = next;
      setRequests(next);
    });
  }, []);
  const active = requests[0];
  const finish = useCallback((accepted: boolean) => {
    const [request, ...remaining] = requestsRef.current;
    if (!request) return;
    requestsRef.current = remaining;
    request.resolve(accepted);
    setRequests(remaining);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {active ? (
        <ConfirmDialog
          title={active.title}
          message={active.message}
          confirmLabel={active.confirmLabel ?? t("common.confirm")}
          danger={active.danger ?? false}
          onConfirm={() => finish(true)}
          onClose={() => finish(false)}
        />
      ) : null}
    </ConfirmContext.Provider>
  );
}

/** 在事件处理器中请求确认，结果通过 Promise 返回。 */
export function useConfirm() {
  return useContext(ConfirmContext) ?? rejectConfirmation;
}

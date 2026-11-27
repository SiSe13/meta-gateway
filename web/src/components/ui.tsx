import { AlertTriangle, ChevronDown, Info, LoaderCircle, X } from "lucide-react";
import {
  Button as HeroButton,
  Card,
  Checkbox as HeroCheckbox,
  Input as HeroInput,
  Modal as HeroModal,
  TextArea as HeroTextArea,
  Switch as HeroSwitch,
  Tabs as HeroTabs,
  useOverlayState,
} from "@heroui/react";
import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { SearchableSelect } from "./SearchableSelect";
import { useI18n } from "../i18n";
import { formatErrorObject } from "../formatError";
import { registerOverlay } from "./overlayStack";

const PageActionHost = createContext<HTMLElement | null>(null);

/** 保留 HeroUI 未写入 DOM 的原生标题提示，并合并调用方的按钮 ref。 */
function useButtonTitleRef(
  title: string | undefined,
  forwardedRef: React.Ref<HTMLButtonElement> | undefined,
) {
  return useCallback(
    (node: HTMLButtonElement | null) => {
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
      if (!node) return;
      if (title) node.title = title;
      else node.removeAttribute("title");
    },
    [forwardedRef, title],
  );
}

/** Lets a page's data-owning child place actions in its shared page header. */
export function PageActions({ children }: { children: ReactNode }) {
  const host = useContext(PageActionHost);
  return host ? createPortal(children, host) : null;
}

export function Button({
  children,
  variant = "primary",
  icon,
  className,
  type = "button",
  loading = false,
  disabled,
  ...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value"> & {
  variant?: "primary" | "secondary" | "danger" | "quiet" | "link";
  icon?: ReactNode;
  loading?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
  value?: string;
}) {
  const { onClick, value, title, ref: forwardedRef, form, ...buttonProps } = props;
  const buttonRef = useButtonTitleRef(title, forwardedRef);
  const heroVariant =
    variant === "secondary"
      ? "secondary"
      : variant === "danger"
        ? "danger"
        : variant === "quiet" || variant === "link"
          ? "ghost"
          : "primary";
  return (
    <HeroButton
      type={type}
      variant={heroVariant}
      isDisabled={disabled || loading}
      isPending={loading}
      className={["button", `button-${variant}`, className].filter(Boolean).join(" ")}
      value={value}
      form={form}
      {...(buttonProps as React.ComponentProps<typeof HeroButton>)}
      onClick={(event) => {
        onClick?.(event as React.MouseEvent<HTMLButtonElement>);
        if (type === "submit" && form) {
          const ownerForm = document.getElementById(form);
          if (ownerForm instanceof HTMLFormElement) ownerForm.requestSubmit();
        }
      }}
      ref={buttonRef}
    >
      {loading ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : icon}
      {children}
    </HeroButton>
  );
}

export function IconButton({
  label,
  children,
  className,
  type = "button",
  disabled,
  ...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value"> & {
  label: string;
  // React 19 passes ref as a regular prop; callers anchor popovers to it.
  ref?: React.Ref<HTMLButtonElement>;
  value?: string;
}) {
  const { onClick, value, title, ref: forwardedRef, ...buttonProps } = props;
  const buttonRef = useButtonTitleRef(title, forwardedRef);
  return (
    <HeroButton
      type={type}
      isIconOnly
      variant="ghost"
      isDisabled={disabled}
      className={["icon-button", className].filter(Boolean).join(" ")}
      aria-label={label}
      value={value}
      {...(buttonProps as React.ComponentProps<typeof HeroButton>)}
      onClick={onClick as React.ComponentProps<typeof HeroButton>["onClick"]}
      ref={buttonRef}
    >
      {children}
    </HeroButton>
  );
}

/** 使用 HeroUI 输入框承接项目内的文本、数字、密码等输入。 */
export function TextInput(props: React.ComponentProps<typeof HeroInput>) {
  return <HeroInput {...props} />;
}

/** 使用 HeroUI 文本域承接多行文本编辑。 */
export function TextAreaControl(props: React.ComponentProps<typeof HeroTextArea>) {
  return <HeroTextArea {...props} />;
}

/** 用统一的可搜索 UI 下拉框承接表单里原先的原生 select。 */
export function SelectControl({
  value,
  defaultValue,
  onChange,
  children,
  disabled,
  name,
  className,
  placeholder,
  "aria-label": ariaLabel,
}: {
  value?: string | number;
  defaultValue?: string | number;
  onChange: React.ChangeEventHandler<HTMLSelectElement>;
  children: ReactNode;
  disabled?: boolean;
  name?: string;
  className?: string;
  placeholder?: string;
  "aria-label"?: string;
}) {
  const [uncontrolledValue, setUncontrolledValue] = useState(String(defaultValue ?? ""));
  const selectedValue = String(value ?? uncontrolledValue);
  const options = Children.toArray(children)
    .filter(isValidElement)
    .map((child) => {
      const props = child.props as { value?: string | number; children?: ReactNode };
      return { value: String(props.value ?? ""), label: String(props.children ?? "") };
    });
  return (
    <>
      <SearchableSelect
        ariaLabel={ariaLabel}
        className={className}
        placeholder={placeholder}
        value={selectedValue}
        disabled={disabled}
        options={options}
        onChange={(next) => {
          if (value === undefined) setUncontrolledValue(next);
          onChange({ target: { value: next } } as React.ChangeEvent<HTMLSelectElement>);
        }}
      />
      {name ? <input type="hidden" name={name} value={selectedValue} disabled={disabled} /> : null}
    </>
  );
}

/** 统一渲染项目表单中使用的 UI 复选框，并兼容原生 change 事件回调。 */
export function CheckboxControl({
  checked,
  onChange,
  disabled,
  name,
  value = "on",
  className,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onChange: React.ChangeEventHandler<HTMLInputElement>;
  disabled?: boolean;
  name?: string;
  value?: string;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <>
      <HeroCheckbox
        aria-label={ariaLabel}
        isSelected={checked}
        isDisabled={disabled}
        className={className}
        onChange={(selected) =>
          onChange({ target: { checked: selected } } as React.ChangeEvent<HTMLInputElement>)
        }
      >
        <HeroCheckbox.Content>
          <HeroCheckbox.Control>
            <HeroCheckbox.Indicator />
          </HeroCheckbox.Control>
          {ariaLabel ? <span className="sr-only">{ariaLabel}</span> : null}
        </HeroCheckbox.Content>
      </HeroCheckbox>
      {name && checked ? <input type="hidden" name={name} value={value} /> : null}
    </>
  );
}

/** 使用项目 UI 开关呈现设置页中的布尔项。 */
export function SwitchControl({
  checked,
  onChange,
  disabled,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onChange: React.ChangeEventHandler<HTMLInputElement>;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <HeroSwitch
      aria-label={ariaLabel}
      isSelected={checked}
      isDisabled={disabled}
      onChange={(selected) =>
        onChange({ target: { checked: selected } } as React.ChangeEvent<HTMLInputElement>)
      }
    >
      <HeroSwitch.Content>
        <HeroSwitch.Control>
          <HeroSwitch.Thumb />
        </HeroSwitch.Control>
        {ariaLabel ? <span className="sr-only">{ariaLabel}</span> : null}
      </HeroSwitch.Content>
    </HeroSwitch>
  );
}

export function Page({
  as: Tag = "main",
  title,
  description,
  hideHeading = false,
  actions,
  children,
  className = "",
}: {
  as?: "main" | "section";
  title: string;
  description: string;
  hideHeading?: boolean;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const [actionHost, setActionHost] = useState<HTMLDivElement | null>(null);
  return (
    <PageActionHost.Provider value={actionHost}>
      <Tag className={`page ${className}`.trim()}>
        <header className={`page-header${hideHeading ? " page-header--actions-only" : ""}`}>
          {hideHeading ? null : (
            <div className="page-heading">
              <h1>{title}</h1>
              <p>{description}</p>
            </div>
          )}
          <div className="toolbar page-actions" ref={setActionHost}>
            {actions}
          </div>
        </header>
        {children}
      </Tag>
    </PageActionHost.Provider>
  );
}

// Collapsible-panel state is tab scoped: the sidebar navigates away and back,
// and a panel the operator folded should stay folded for that session.
function readPanelOpen(storageKey: string | undefined, fallback: boolean) {
  if (!storageKey) return fallback;
  try {
    const raw = sessionStorage.getItem(`panel.${storageKey}`);
    return raw == null ? fallback : raw === "1";
  } catch {
    return fallback;
  }
}

function storePanelOpen(storageKey: string | undefined, open: boolean) {
  if (!storageKey) return;
  try {
    sessionStorage.setItem(`panel.${storageKey}`, open ? "1" : "0");
  } catch {
    // Storage may be disabled; keep the state for this render tree only.
  }
}

export function Panel({
  title,
  titleHelp,
  actions,
  children,
  className = "",
  id,
  collapsible = false,
  defaultOpen = true,
  storageKey,
  summary,
  lede,
}: {
  title?: string;
  titleHelp?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Optional DOM id (used by in-page section navigation). */
  id?: string;
  /** Turn the header into a disclosure toggle so the body can fold away. */
  collapsible?: boolean;
  /** Starting body visibility; ignored once the operator has toggled it. */
  defaultOpen?: boolean;
  /** sessionStorage key that remembers the folded state across navigation. */
  storageKey?: string;
  /** Compact readout shown beside the title while the body is folded. */
  summary?: ReactNode;
  /**
   * One short line in the body saying what this panel is for. A lede is read at a
   * glance; a paragraph is skipped, and two paragraphs of explanation stacked in
   * one card is how a page starts looking like documentation.
   */
  lede?: string;
}) {
  const { t } = useI18n();
  const bodyId = useId();
  const [open, setOpen] = useState(() => readPanelOpen(storageKey, defaultOpen));
  const folded = collapsible && !open;
  const toggle = () => {
    setOpen((prev) => {
      storePanelOpen(storageKey, !prev);
      return !prev;
    });
  };
  return (
    <Card
      id={id}
      role="region"
      aria-label={title}
      className={`panel heroui-card ${className}${folded ? " is-collapsed" : ""}`.trim()}
    >
      {(title || actions) && (
        <header className="panel-header">
          {title ? (
            <div className="panel-title">
              {collapsible ? (
                <HeroButton
                  type="button"
                  variant="ghost"
                  className="panel-toggle"
                  aria-expanded={open}
                  aria-controls={bodyId}
                  aria-label={title}
                  ref={(element) =>
                    element?.setAttribute("title", open ? t("common.collapse") : t("common.expand"))
                  }
                  onPress={toggle}
                >
                  <ChevronDown size={14} className="panel-toggle-icon" aria-hidden="true" />
                  <h2>{title}</h2>
                </HeroButton>
              ) : (
                <h2>{title}</h2>
              )}
              {/* Panel-level help stays behind the (i): it is mechanics (an env
                  variable, what a container rebuild does), it applies whether or
                  not you are reading this card right now, and as a paragraph it
                  competes with the controls it is supposed to stay out of the way
                  of. Field-level hints are the opposite case and stay visible. */}
              {titleHelp ? <InfoTip label={titleHelp} /> : null}
              {folded && summary ? <span className="panel-summary">{summary}</span> : null}
            </div>
          ) : null}
          <div className="toolbar">{actions}</div>
        </header>
      )}
      {collapsible ? (
        <div className="panel-body" id={bodyId} hidden={folded}>
          {lede ? <p className="panel-lede muted">{lede}</p> : null}
          {children}
        </div>
      ) : (
        <>
          {lede ? <p className="panel-lede muted">{lede}</p> : null}
          {children}
        </>
      )}
    </Card>
  );
}

export function Dialog({
  title,
  children,
  onClose,
  actions,
  className,
  closeAction,
  danger = false,
  busy = false,
  preventBackdropDismiss = false,
}: {
  title: ReactNode;
  children: ReactNode;
  onClose: () => void;
  actions?: ReactNode;
  className?: string;
  closeAction?: ReactNode;
  danger?: boolean;
  busy?: boolean;
  preventBackdropDismiss?: boolean;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<() => void>(() => {});
  const state = useOverlayState({
    defaultOpen: true,
    onOpenChange: (open) => {
      if (!open && !busy) onClose();
    },
  });
  closeRef.current = () => {
    if (!busy) state.close();
  };
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    return registerOverlay(() => closeRef.current(), { element: dialog });
  }, []);
  return (
    <HeroModal state={state}>
      <HeroModal.Trigger className="dialog-trigger">
        <span aria-hidden="true" />
      </HeroModal.Trigger>
      <HeroModal.Backdrop
        ref={dialogRef}
        className="dialog-backdrop"
        isDismissable={!busy && !preventBackdropDismiss}
        isKeyboardDismissDisabled
      >
        <HeroModal.Container>
          <HeroModal.Dialog
            className={["dialog", className].filter(Boolean).join(" ")}
            aria-labelledby={titleId}
            aria-busy={busy || undefined}
          >
            <HeroModal.Header>
              <div className={danger ? "danger-title" : ""}>
                {danger && <AlertTriangle size={18} />}
                <HeroModal.Heading id={titleId}>{title}</HeroModal.Heading>
              </div>
              {closeAction ?? (
                <IconButton label={t("common.close")} onClick={state.close} disabled={busy}>
                  <X size={18} />
                </IconButton>
              )}
            </HeroModal.Header>
            <HeroModal.Body className="dialog-body">
              <fieldset className="overlay-fields" disabled={busy}>
                {children}
              </fieldset>
            </HeroModal.Body>
            {actions ? (
              <HeroModal.Footer>
                <fieldset className="overlay-actions" disabled={busy}>
                  {actions}
                </fieldset>
              </HeroModal.Footer>
            ) : null}
          </HeroModal.Dialog>
        </HeroModal.Container>
      </HeroModal.Backdrop>
    </HeroModal>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  className,
  pending,
  error,
  danger = true,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  className?: string;
  pending?: boolean;
  error?: unknown;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog
      title={title}
      className={className}
      onClose={onClose}
      danger={danger}
      busy={pending}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button variant={danger ? "danger" : "primary"} loading={pending} onClick={onConfirm}>
            {pending ? t("common.working") : (confirmLabel ?? t("common.delete"))}
          </Button>
        </>
      }
    >
      <p>{message}</p>
      {error ? <ErrorState error={error} /> : null}
    </Dialog>
  );
}

type InfoTipPlacement = "above" | "below" | "left" | "right";

type InfoTipPosition = {
  top: number;
  left: number;
  placement: InfoTipPlacement;
};

export function InfoTip({ label }: { label: string }) {
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const bubbleRef = useRef<HTMLSpanElement | null>(null);
  const tooltipId = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [position, setPosition] = useState<InfoTipPosition | null>(null);
  const open = hovered || focused;

  const placeBubble = useCallback(() => {
    const trigger = triggerRef.current;
    const bubble = bubbleRef.current;
    if (!trigger || !bubble) return;

    const triggerRect = trigger.getBoundingClientRect();
    const bubbleRect = bubble.getBoundingClientRect();
    const gap = 8;
    const padding = 12;
    const centeredLeft = triggerRect.left + (triggerRect.width - bubbleRect.width) / 2;
    const centeredTop = triggerRect.top + (triggerRect.height - bubbleRect.height) / 2;
    const candidates: Array<InfoTipPosition> = [
      {
        placement: "right",
        top: centeredTop,
        left: triggerRect.right + gap,
      },
      {
        placement: "left",
        top: centeredTop,
        left: triggerRect.left - bubbleRect.width - gap,
      },
      {
        placement: "below",
        top: triggerRect.bottom + gap,
        left: centeredLeft,
      },
      {
        placement: "above",
        top: triggerRect.top - bubbleRect.height - gap,
        left: centeredLeft,
      },
    ];
    const fits = (candidate: InfoTipPosition) =>
      candidate.left >= padding &&
      candidate.top >= padding &&
      candidate.left + bubbleRect.width <= window.innerWidth - padding &&
      candidate.top + bubbleRect.height <= window.innerHeight - padding;
    const chosen = candidates.find(fits) ?? candidates[2]!;
    const left = Math.max(
      padding,
      Math.min(chosen.left, window.innerWidth - bubbleRect.width - padding),
    );
    const top = Math.max(
      padding,
      Math.min(chosen.top, window.innerHeight - bubbleRect.height - padding),
    );
    setPosition({ top, left, placement: chosen.placement });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    placeBubble();
    const frame = window.requestAnimationFrame(placeBubble);
    const reposition = () => placeBubble();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, placeBubble]);

  useEffect(() => {
    const bubble = bubbleRef.current;
    if (!open || !bubble) return;
    return registerOverlay(
      () => {
        setHovered(false);
        setFocused(false);
      },
      { modal: false, transient: true, element: bubble },
    );
  }, [open]);

  const bubble =
    open && typeof document !== "undefined"
      ? createPortal(
          <span
            ref={bubbleRef}
            id={tooltipId}
            className="info-tip-bubble"
            data-placement={position?.placement ?? "below"}
            data-visible={position ? "true" : "false"}
            style={position ? { top: position.top, left: position.left } : { top: 0, left: 0 }}
            role="tooltip"
          >
            {label}
          </span>,
          document.body,
        )
      : null;

  return (
    <>
      <span
        ref={triggerRef}
        className="info-tip"
        tabIndex={0}
        role="img"
        aria-label={label}
        aria-describedby={open ? tooltipId : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        <Info size={13} aria-hidden="true" />
      </span>
      {bubble}
    </>
  );
}

export function Field({
  label,
  children,
  hint,
  labelAction,
  error,
  required,
  className,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  labelAction?: ReactNode;
  /** Shown under the control when the value fails validation. Announced. */
  error?: string;
  required?: boolean;
  className?: string;
}) {
  const errorId = useId();
  const controlId = useId();
  // Every hint rides in the (i) beside the label. A paragraph under the control
  // pushed the form down and competed with the thing it explained, and splitting
  // hints into "short enough to show" and "long enough to hide" made two fields
  // side by side look like different kinds of field. One rule, one look:
  // the label names the control, the (i) explains it. The tip carries the text as
  // its accessible name, so it is still announced and still keyboard-reachable.
  // A message about the current *state* (loading, nothing found yet, an error) is
  // not a field explanation and stays on screen where it can be seen.
  const described = [error ? errorId : null].filter(Boolean).join(" ");
  const describedChild =
    isValidElement<Record<string, unknown>>(children) && children.type !== "label"
      ? cloneElement(children, {
          ...(labelAction ? { id: controlId } : {}),
          "aria-describedby": described || undefined,
          "aria-invalid": error ? true : undefined,
          "aria-required": required ? true : undefined,
        })
      : children;
  const labelContent = (
    <span className="field-label">
      <span>{label}</span>
      {required ? (
        <span className="field-required" aria-hidden="true">
          *
        </span>
      ) : null}
      {hint ? <InfoTip label={hint} /> : null}
    </span>
  );

  return (
    <div className={["field", error ? "is-invalid" : null, className].filter(Boolean).join(" ")}>
      {/* The label wraps the control so clicking its name still focuses the field.
          The hint is the (i) beside the label, not a paragraph below it. */}
      {labelAction ? (
        <>
          <div className="field-label-row">
            <label className="field-label-wrap" htmlFor={controlId}>
              {labelContent}
            </label>
            <span className="field-label-action">{labelAction}</span>
          </div>
          <div className="field-control-wrap">{describedChild}</div>
        </>
      ) : (
        <label className="field-label-wrap">
          {labelContent}
          {describedChild}
        </label>
      )}
      {error ? (
        <span className="field-error" id={errorId} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function StatusBadge({ value }: { value: string | boolean }) {
  const { status } = useI18n();
  const raw = typeof value === "boolean" ? (value ? "enabled" : "disabled") : String(value);
  return (
    <span className={`badge badge-${raw.toLowerCase().replaceAll("_", "-")}`}>{status(value)}</span>
  );
}

export function Loading() {
  const { t } = useI18n();
  return (
    <div className="state">
      <LoaderCircle className="spin" size={20} />
      <span>{t("common.loading")}</span>
    </div>
  );
}

export function Empty({ children }: { children?: ReactNode }) {
  const { t } = useI18n();
  return <div className="state state-empty">{children ?? t("common.empty")}</div>;
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const { t } = useI18n();
  const formatted = formatErrorObject(error, t);
  const cause =
    formatted.cause.trim().toLocaleLowerCase() === formatted.title.trim().toLocaleLowerCase()
      ? ""
      : formatted.cause;
  return (
    <div className="state state-error" role="alert">
      <AlertTriangle size={18} />
      <div className="error-state-body">
        <strong>{formatted.title}</strong>
        {cause ? <span>{cause}</span> : null}
        {formatted.fix ? <span className="error-state-fix">{formatted.fix}</span> : null}
      </div>
      {retry && (
        <Button variant="secondary" onClick={retry}>
          {t("common.retry")}
        </Button>
      )}
    </div>
  );
}

export function DataTable({
  headers,
  children,
  empty,
  fill = false,
}: {
  headers: ReactNode[];
  children: ReactNode;
  empty?: boolean;
  /** 填满父级纵向布局中的剩余高度。 */
  fill?: boolean;
}) {
  if (empty) return <Empty />;
  return (
    <div className={`table-wrap${fill ? " is-fill" : ""}`} data-columns={headers.length}>
      <table>
        <thead>
          <tr>
            {headers.map((h, index) => (
              <th key={index}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Tabs({
  items,
  active,
  onChange,
  className = "",
}: {
  items: Array<{ value: string; label: string; icon?: ReactNode }>;
  active: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <HeroTabs
      className={`hero-tabs ${className}`.trim()}
      orientation="horizontal"
      selectedKey={active}
      onSelectionChange={(key) => onChange(String(key))}
    >
      <HeroTabs.List className="tabs">
        {items.map((item) => (
          <HeroTabs.Tab id={item.value} key={item.value}>
            {item.icon}
            {item.label}
          </HeroTabs.Tab>
        ))}
      </HeroTabs.List>
    </HeroTabs>
  );
}

export function formatDate(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const lang =
    typeof document !== "undefined" ? document.documentElement.lang || undefined : undefined;
  return new Intl.DateTimeFormat(lang, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}

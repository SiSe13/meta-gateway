import { ChevronDown, MoreHorizontal } from "lucide-react";
import { Description, Dropdown, Header, Label, Separator } from "@heroui/react";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { registerOverlay } from "./overlayStack";

export type ActionMenuItem = {
  key: string;
  label: string;
  icon?: ReactNode;
  group?: string;
  danger?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onSelect: () => void;
};

type MenuPosition = { top: number; left: number };

type ActionMenuGroup = {
  key: string;
  label?: string;
  danger: boolean;
  items: ActionMenuItem[];
};

export function ActionMenu({
  label,
  title,
  disabled,
  items,
  compact = false,
  open: openControlled,
  onOpenChange,
  position,
}: {
  label: string;
  title?: string;
  disabled?: boolean;
  items: ActionMenuItem[];
  compact?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  position?: MenuPosition;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = (openControlled ?? localOpen) && items.length > 0;
  const isContext = Boolean(position);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLElement>(null);
  const wasOpenRef = useRef(open);
  const restoreFocusRef = useRef(false);
  const closeRef = useRef<() => void>(() => {});
  const groups = useMemo(() => {
    const grouped = new Map<string, ActionMenuGroup>();
    for (const item of items) {
      const key = item.danger ? "__danger__" : (item.group ?? "");
      if (!grouped.has(key)) {
        grouped.set(key, { key, label: item.group, danger: !!item.danger, items: [] });
      }
      grouped.get(key)!.items.push(item);
    }
    return [...grouped.values()].sort((a, b) => Number(a.danger) - Number(b.danger));
  }, [items]);

  // 由调用方控制的菜单同步打开状态，普通菜单则使用本地状态。
  const setOpen = (value: boolean) => {
    if (!value) {
      restoreFocusRef.current = Boolean(
        !isContext &&
        popoverRef.current?.contains(document.activeElement) &&
        triggerRef.current?.isConnected,
      );
    }
    onOpenChange?.(value);
    if (openControlled === undefined) setLocalOpen(value);
  };
  const close = () => setOpen(false);
  closeRef.current = close;

  // 关闭菜单时仅在焦点原本位于菜单内时将其还给触发器。
  useEffect(() => {
    if (wasOpenRef.current && !open && restoreFocusRef.current) {
      triggerRef.current?.focus({ preventScroll: true });
      restoreFocusRef.current = false;
    }
    wasOpenRef.current = open;
  }, [open]);

  // 将 HeroUI 菜单登记到共享浮层栈，保证它先于所在对话框响应 Escape。
  useEffect(() => {
    const popover = popoverRef.current;
    if (!open || !popover) return;
    const unregister = registerOverlay(() => closeRef.current(), {
      modal: false,
      transient: true,
      element: popover,
    });
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && (popover.contains(target) || rootRef.current?.contains(target)))
        return;
      closeRef.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    popover.addEventListener("keydown", onKeyDown);
    return () => {
      unregister();
      window.removeEventListener("pointerdown", onPointerDown, true);
      popover.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // 行右键菜单固定在鼠标位置；滚动菜单内容不关闭，滚动页面则关闭。
  useEffect(() => {
    const popover = popoverRef.current;
    if (!open || !isContext || !popover) return;
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && popover.contains(event.target)) return;
      closeRef.current();
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [open, isContext]);

  const selectItem = (key: string | number) => {
    const item = items.find((entry) => entry.key === String(key));
    if (!item || disabled || item.disabled) return;
    close();
    item.onSelect();
  };

  const positionStyle: CSSProperties | undefined =
    isContext && position
      ? {
          position: "fixed",
          top: position.top,
          left: position.left,
          width: 1,
          height: 1,
          padding: 0,
          visibility: "hidden",
          pointerEvents: "none",
        }
      : undefined;

  return (
    <div ref={rootRef} className={`action-menu${isContext ? " action-menu-context-anchor" : ""}`}>
      <Dropdown isOpen={open} onOpenChange={setOpen}>
        {isContext ? (
          <Dropdown.Trigger
            ref={triggerRef}
            aria-hidden="true"
            aria-label={label}
            isDisabled
            className="action-menu-context-trigger"
            style={positionStyle}
          />
        ) : compact ? (
          <Dropdown.Trigger
            ref={triggerRef}
            type="button"
            className="icon-button action-menu-trigger"
            aria-label={label}
            isDisabled={disabled || items.length === 0}
          >
            <MoreHorizontal size={16} />
          </Dropdown.Trigger>
        ) : (
          <Dropdown.Trigger
            ref={triggerRef}
            type="button"
            className="button button-secondary"
            isDisabled={disabled || items.length === 0}
          >
            <MoreHorizontal size={14} aria-hidden="true" />
            {label}
            <ChevronDown size={14} aria-hidden="true" />
          </Dropdown.Trigger>
        )}
        <Dropdown.Popover
          ref={popoverRef}
          isNonModal
          shouldSkipAnimation
          className={
            "action-menu-panel action-menu-panel-floating" +
            (isContext ? " action-menu-panel-context" : "")
          }
          placement={isContext ? "bottom start" : "bottom end"}
          offset={isContext ? 0 : 6}
          isOpen={open}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {title ? (
            <div className="action-menu-title" title={title}>
              {title}
            </div>
          ) : null}
          <Dropdown.Menu
            aria-label={title ?? label}
            className="action-menu-list"
            shouldCloseOnSelect={false}
            onAction={selectItem}
          >
            {groups.map((group, groupIndex) => {
              const showHeading =
                group.label && !(group.items.length === 1 && group.items[0]?.label === group.label);
              return (
                <Fragment key={group.key}>
                  {groupIndex > 0 ? <Separator className="action-menu-separator" /> : null}
                  <Dropdown.Section>
                    {showHeading ? (
                      <Header className="action-menu-group-label">{group.label}</Header>
                    ) : null}
                    {group.items.map((item) => {
                      const inactive = Boolean(disabled || item.disabled);
                      const hint = inactive ? item.disabledReason : undefined;
                      return (
                        <Dropdown.Item
                          key={item.key}
                          id={item.key}
                          textValue={item.label}
                          aria-label={item.label}
                          ref={(element) => {
                            if (!element) return;
                            if (inactive) element.setAttribute("aria-disabled", "true");
                            else element.removeAttribute("aria-disabled");
                          }}
                          aria-disabled={inactive || undefined}
                          variant={item.danger ? "danger" : "default"}
                          className={`action-menu-item${item.danger ? " is-danger" : ""}`}
                        >
                          <span className="action-menu-icon" aria-hidden="true">
                            {item.icon}
                          </span>
                          <span className="action-menu-copy">
                            <Label>{item.label}</Label>
                            {hint ? <Description>{hint}</Description> : null}
                          </span>
                        </Dropdown.Item>
                      );
                    })}
                  </Dropdown.Section>
                </Fragment>
              );
            })}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </div>
  );
}

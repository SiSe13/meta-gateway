import type { ReactNode } from "react";

/**
 * Branded empty / first-run surface. Keep drama lower than the connect page
 * but higher than a blank table message.
 */
export function EmptyHero({
  kicker,
  title,
  body,
  actions,
  icon,
  className = "",
}: {
  kicker?: string;
  title: string;
  body: string;
  actions?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={["empty-hero", className].filter(Boolean).join(" ")}>
      <div className="empty-hero-glow" aria-hidden="true" />
      {icon ? (
        <div className="empty-hero-icon" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      {kicker ? <p className="empty-hero-kicker">{kicker}</p> : null}
      <strong className="empty-hero-title">{title}</strong>
      <p className="empty-hero-body">{body}</p>
      {actions ? <div className="empty-hero-actions">{actions}</div> : null}
    </div>
  );
}

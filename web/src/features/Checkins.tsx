import { CheckinsPanel } from "./ops";

/**
 * Top-level check-in surface for the built-in scheduler and its history.
 */
export function Checkins() {
  return (
    <main className="page checkins-page">
      <div className="ops-canvas">
        <CheckinsPanel />
      </div>
    </main>
  );
}

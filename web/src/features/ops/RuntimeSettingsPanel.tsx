import { useQuery } from "@tanstack/react-query";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type ReactNode,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronRight, LoaderCircle } from "lucide-react";
import { Button as HeroButton, Input as HeroInput, TextArea as HeroTextArea } from "@heroui/react";
import { api } from "../../api/client";
import { updateState } from "../../lib/updateState";
import type { RuntimeEditableSettings } from "../../api/types";
import { useAdminMutation } from "../../hooks/useAdminMutation";
import { useI18n } from "../../i18n";
import { useSession } from "../../session";
import { useUnsavedChanges } from "../../lib/unsavedChanges";
import {
  Button,
  SwitchControl,
  Dialog,
  ErrorState,
  InfoTip,
  Loading,
  Panel,
  StatusBadge,
  SelectControl,
} from "../../components/ui";
import { AlertRulesPanel } from "./AlertRulesPanel";
import { ErrorRulesPanel } from "./ErrorRulesPanel";
import { PromptGuardPanel } from "./PromptGuardPanel";
import { MaintenancePanel } from "./MaintenancePanel";
import { FactoryResetPanel } from "./FactoryResetPanel";
import { TOTPPanel } from "./TOTPPanel";
import { ModePanel } from "../../team/ModePanel";
import { CronSchedulePicker } from "./CronSchedulePicker";
import { RuntimeRow, SettingState, ValidatedNumberInput } from "./runtimeControls";
import { UpdateDialog } from "../UpdateDialog";
import {
  RUNTIME_GROUPS,
  RUNTIME_SECTION_BY_KEY,
  runtimeSectionMenuKey,
  RUNTIME_ZERO_MEANS_DEFAULT,
  type RuntimeSection,
} from "./runtimeNavigation";

const SECTION_BY_KEY = RUNTIME_SECTION_BY_KEY;

function numberOr(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Update comparison is dotted-numeric only (see updatecheck.IsNewer); anything
// else (e.g. "dev") can never register as an update, so the panel must not
// claim "up to date" for it.
function isReleaseVersion(version: string) {
  return /^v?\d+(\.\d+)*(-[\w.]+)?$/.test(version.trim());
}

type EditableKey = keyof RuntimeEditableSettings;

/** undefined and "" are the same absent value across the API boundary. */
function scalarOrEmpty(value: unknown) {
  return value === undefined || value === null ? "" : value;
}

function sameSetting(a: unknown, b: unknown) {
  if (Array.isArray(a) || Array.isArray(b)) {
    return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
  }
  return scalarOrEmpty(a) === scalarOrEmpty(b);
}

/**
 * One section: its card, the badge that says whether it overrides the
 * deployment default, and the way back to that default. With instant save there
 * is no page-level Save to undo a section with, so the undo lives on the
 * section itself.
 */
interface SectionCardProps {
  section?: RuntimeSection;
  sectionKey?: string;
  busy: boolean;
  actions?: ReactNode;
  /** Panel mechanics, shown behind the (i) in the header. */
  info?: string;
  className?: string;
  children: ReactNode;
  changed: boolean;
  onRestore: () => void;
}

function SectionCard({
  section: sectionProp,
  sectionKey,
  changed,
  onRestore,
  busy,
  actions,
  info,
  className = "",
  children,
}: SectionCardProps) {
  const { t } = useI18n();
  const section = sectionProp ?? (sectionKey ? SECTION_BY_KEY.get(sectionKey) : undefined);
  if (!section) return null;
  return (
    // The grid item is a slot this page owns; the card is its content. A panel
    // that is itself the grid item also matches the skins' own `.panel + .panel`
    // spacing rule, which pushed every right-hand card 18px down its own row.
    <div className={className ? `runtime-card-slot ${className}` : "runtime-card-slot"}>
      <Panel className="runtime-section" id={`runtime-${section.key}`}>
        <div className="panel-header">
          <div className="panel-title">
            <h3>{t(section.label)}</h3>
            {/* Mechanics go behind the (i): as a paragraph above the controls they
                wrap to two or three lines and end up louder than the settings. */}
            {info ? <InfoTip label={info} /> : null}
            <SettingState state={changed ? "changed" : "default"} />
          </div>
          <div className="toolbar">
            {actions}
            <Button variant="quiet" disabled={busy || !changed} onClick={onRestore}>
              {t("ops.runtime.resetSection")}
            </Button>
          </div>
        </div>
        <div className="form-grid runtime-rows">{children}</div>
      </Panel>
    </div>
  );
}

/** Admin-writable runtime parameters with hot reload. */
export function RuntimeSettingsPanel({
  onDirtyChange,
}: {
  /** Lets the surrounding settings page guard its own tab switches. */
  onDirtyChange?: (dirty: boolean) => void;
} = {}) {
  const { client, role } = useSession();
  const { t, locale } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const s = api(client!);
  const query = useQuery({
    queryKey: ["runtime-settings"],
    queryFn: ({ signal }) => s.runtimeSettings(signal),
  });
  const [draft, setDraft] = useState<RuntimeEditableSettings | null>(null);
  // Every edit goes through the ref before it goes through state: the
  // container-level blur/change handlers run in the same tick as the edit and
  // would otherwise read the previous render's draft.
  const draftRef = useRef<RuntimeEditableSettings | null>(null);
  // The last server-confirmed snapshot. "Dirty" means the draft drifted from
  // it, which is what the unload guard and the status line report.
  const baselineRef = useRef("");
  const [baseline, setBaseline] = useState("");
  const [remoteChanged, setRemoteChanged] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // One write at a time: a commit made while the previous one is in flight is
  // coalesced into a single follow-up PUT of the latest draft, so two rapid
  // toggles cannot land out of order.
  const savingRef = useRef(false);
  const queuedRef = useRef(false);
  // One selection drives the page: the rail highlights it, the flow renders its
  // group's sections. Two states (a group and a section) could disagree — and
  // did, back when the page carried both a category tab bar and an anchor row.
  const [activeSectionKey, setActiveSectionKey] = useState<string>(
    searchParams.get("section") && RUNTIME_SECTION_BY_KEY.has(searchParams.get("section")!)
      ? searchParams.get("section")!
      : RUNTIME_GROUPS[0]!.sections[0]!.key,
  );
  const [pendingScroll, setPendingScroll] = useState<string | null>(null);
  // The image-failover switch is the one switch whose click is not a save: it
  // opens a dialog that asks how far the replay set should reach, because the
  // far end of it can bill one picture twice.
  const [confirmingImagesFailover, setConfirmingImagesFailover] = useState(false);
  const [armAmbiguous, setArmAmbiguous] = useState(false);
  const [armUncertain, setArmUncertain] = useState(false);
  // While an explicit jump is settling, keep the requested section active.
  const spyPauseUntilRef = useRef(0);
  // The spy reads the current selection from a ref: the listener is attached once
  // per group, and a closure over the state would compare against a stale key.
  const activeSectionKeyRef = useRef(activeSectionKey);
  const [updateOpen, setUpdateOpen] = useState(false);
  // The deployment parameters are read-only facts read off the query, so their
  // filter lives outside the draft: narrowing the list must not mark the page
  // dirty or block a tab switch.
  const [paramFilter, setParamFilter] = useState("");
  const [paramShowAll, setParamShowAll] = useState(false);
  const [deploymentOpen, setDeploymentOpen] = useState(false);
  const draftJson = draft ? JSON.stringify(draft) : "";
  const dirty = draftJson !== "" && draftJson !== baseline;
  // The panel's own update entry opens a dialog instead of navigating, so the
  // in-app predicate is not needed here any more; the browser-level guard is
  // what still protects an uncommitted draft, and the settings page guards its
  // tab switches.
  useUnsavedChanges(dirty);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const save = useAdminMutation({
    mutationFn: (body: RuntimeEditableSettings) => s.updateRuntimeSettings(body),
    invalidateKeys: [["runtime-settings"]],
    // The status line beside the source pill is where a failed instant save is
    // reported; a toast on top of it would be a second voice saying the same
    // thing, and there is no dialog to dismiss this time.
    toastOnError: false,
    onSuccess: (snapshot, variables) => {
      const incoming = JSON.stringify(snapshot.editable);
      baselineRef.current = incoming;
      setBaseline(incoming);
      // Adopt the server's normalised values only when nothing was typed while
      // the request was in flight. Otherwise a resolved default (an outbound
      // limit sent as 0 comes back as the deployment value) would leave the
      // field looking permanently unsaved.
      if (JSON.stringify(variables) === JSON.stringify(draftRef.current)) {
        draftRef.current = snapshot.editable;
        setDraft(snapshot.editable);
      }
      setSaveState("saved");
    },
    onError: () => setSaveState("error"),
    onSettled: () => {
      savingRef.current = false;
      if (queuedRef.current) {
        queuedRef.current = false;
        flush();
      }
    },
  });

  const reset = useAdminMutation({
    mutationFn: () => s.resetRuntimeSettings(),
    invalidateKeys: [["runtime-settings"]],
    onSuccess: (snapshot) => {
      const incoming = JSON.stringify(snapshot.editable);
      baselineRef.current = incoming;
      setBaseline(incoming);
      draftRef.current = snapshot.editable;
      setDraft(snapshot.editable);
      setRemoteChanged(false);
      setSaveState("idle");
    },
  });

  /**
   * Write the current draft. Called on every blur and on every checkbox/select
   * change — never from a keystroke, so a half-typed number ("300" on its way
   * to "3") is never what lands upstream.
   */
  function flush() {
    const body = draftRef.current;
    if (!body) return;
    // Blur fires whenever focus moves between two fields, including ones the
    // operator never touched: only a real difference is worth a PUT.
    if (JSON.stringify(body) === baselineRef.current) return;
    if (savingRef.current) {
      queuedRef.current = true;
      return;
    }
    savingRef.current = true;
    setSaveState("saving");
    save.mutate(body);
  }

  useEffect(() => {
    const editable = query.data?.editable;
    if (!editable) return;
    const incoming = JSON.stringify(editable);
    const local = draftRef.current ? JSON.stringify(draftRef.current) : null;
    // A local draft that differs from what the server last confirmed means the
    // operator is mid-edit: report that the server moved instead of overwriting
    // what they typed.
    if (local !== null && local !== baselineRef.current) {
      if (incoming !== baselineRef.current) setRemoteChanged(true);
      return;
    }
    baselineRef.current = incoming;
    setBaseline(incoming);
    draftRef.current = { ...editable };
    setDraft({ ...editable });
    setRemoteChanged(false);
  }, [query.data]);

  const updateCheckQuery = useQuery({
    queryKey: ["update-check"],
    queryFn: ({ signal }) => s.updateCheck(signal),
    staleTime: 10 * 60_000,
    refetchInterval: 30 * 60_000,
  });
  const refreshUpdate = useAdminMutation({
    mutationFn: () => s.refreshUpdateCheck(),
    invalidateKeys: [["update-check"]],
  });

  // Take the server's values and drop the local draft. Offered next to "keep
  // mine": the operator decides which side wins, instead of the page deciding
  // for them (silently, as it used to).
  const reloadFromServer = () => {
    const editable = query.data?.editable;
    if (!editable) return;
    const incoming = JSON.stringify(editable);
    baselineRef.current = incoming;
    setBaseline(incoming);
    draftRef.current = { ...editable };
    setDraft({ ...editable });
    setRemoteChanged(false);
    setSaveState("idle");
    save.reset();
    reset.reset();
  };
  const keepLocalDraft = () => {
    const editable = query.data?.editable;
    if (editable) {
      const incoming = JSON.stringify(editable);
      baselineRef.current = incoming;
      setBaseline(incoming);
    }
    setRemoteChanged(false);
  };

  // Rules of Hooks: everything below here may return early (error, loading), so
  // the group and the two effects that follow the reader are declared above it.
  // The group is derivable from the selection alone — which is exactly why the
  // page needs one selection rather than a group plus a section.
  const activeGroup =
    RUNTIME_GROUPS.find((group) => group.sections.some((s) => s.key === activeSectionKey)) ??
    RUNTIME_GROUPS[0]!;

  useEffect(() => {
    const requested = searchParams.get("section");
    if (!requested || !RUNTIME_SECTION_BY_KEY.has(requested) || requested === activeSectionKey)
      return;
    spyPauseUntilRef.current = Date.now() + 900;
    setActiveSectionKey(requested);
    setPendingScroll(requested);
  }, [activeSectionKey, searchParams]);

  useEffect(() => {
    activeSectionKeyRef.current = activeSectionKey;
  }, [activeSectionKey]);

  // Scrolling waits for paint: a section in another group is not in the DOM yet
  // when the click lands, so the jump has to happen after the flow re-renders.
  //
  // It is an instant jump rather than a smooth one, measured rather than assumed:
  // a smooth scroll here stalled mid-flight when the flow re-rendered under it
  // (466px, then it stopped), and the page ended between two sections. A jump has
  // no animation to interrupt.
  useEffect(() => {
    if (!pendingScroll) return;
    const el = document.getElementById(`runtime-${pendingScroll}`);
    if (!el) return;
    if (typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "start" });
    }
    setPendingScroll(null);
  }, [pendingScroll, activeGroup, query.data]);

  // The index follows the reader. A long settings page whose index points at a
  // section you scrolled past is worse than no index at all.
  //
  // A scroll listener rather than an IntersectionObserver, and not for taste: the
  // observer was attached and its margins were right, but its callbacks never moved
  // the rail on this page (measured in the browser, not guessed). Reading the
  // sections' own positions is a few getBoundingClientRect calls per event over
  // seven elements, and it says exactly what "the section you are reading" means:
  // the last one whose top has passed the reading line.
  useEffect(() => {
    const onScroll = () => {
      if (Date.now() < spyPauseUntilRef.current) return;
      const nodes = activeGroup.sections
        .map((section) => document.getElementById(`runtime-${section.key}`))
        .filter((node): node is HTMLElement => node !== null);
      if (nodes.length === 0) return;
      const tops = nodes.map((node) => node.getBoundingClientRect().top);
      // With no layout to read — jsdom, or a render before paint puts nothing on
      // the page yet — every section reports the same position and there is no
      // "section you are reading" to name. Guessing would move the rail off the
      // section the operator chose.
      if (new Set(tops).size < 2) return;
      const readingLine = 96;
      // The section whose start is closest to the reading line.
      let best = Number.POSITIVE_INFINITY;
      let bestId = nodes[0]!.id;
      for (const node of nodes) {
        const distance = Math.abs(node.getBoundingClientRect().top - readingLine);
        if (distance < best) {
          best = distance;
          bestId = node.id;
        }
      }
      // Two cards in one row share their top and therefore tie exactly, so the
      // tie has to be broken by what the rail already says — otherwise the first
      // of the pair would steal the rail from the one you clicked, every time the
      // tie is resolved again.
      const currentKey = activeSectionKeyRef.current;
      const currentTop = document
        .getElementById(`runtime-${currentKey}`)
        ?.getBoundingClientRect().top;
      if (currentTop !== undefined && Math.abs(currentTop - readingLine) <= best + 1) {
        return;
      }
      const sectionKey = bestId.replace(/^runtime-/, "");
      setActiveSectionKey(sectionKey);
      setSearchParams(
        (current) => {
          current.set("section", sectionKey);
          return current;
        },
        { replace: true },
      );
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
    // `query.data` is a dependency as well as the group: on the first render the
    // panel is still loading and no section exists to read, while the group object
    // is stable across renders — so without it this would never attach once the
    // settings arrived.
  }, [activeGroup, query.data, setSearchParams]);

  if (query.isError) {
    return (
      <Panel>
        <ErrorState error={query.error} retry={() => query.refetch()} />
      </Panel>
    );
  }
  if (query.isPending || !draft) {
    return (
      <Panel>
        <Loading />
      </Panel>
    );
  }

  const data = query.data!;
  // Tolerated as absent: the panel must still render (and simply call
  // everything "default") if the bootstrap layer is missing from the payload.
  const bootstrap = data.env_bootstrap;
  // Only the global reset blocks input: an instant save must not freeze the
  // form the operator is still working in.
  const busy = reset.isPending;

  const isChanged = (key: EditableKey) => {
    const value = draft[key];
    if (RUNTIME_ZERO_MEANS_DEFAULT.has(key) && !value) return false;
    return !sameSetting(value, bootstrap?.[key]);
  };
  const sectionChanged = (section: RuntimeSection) => section.fields.some(isChanged);
  // 左侧合并菜单选择后，只显示该主题下的设置卡片。
  const activeMenuKey = runtimeSectionMenuKey(SECTION_BY_KEY.get(activeSectionKey)!);
  const isSectionVisible = (key: string) => {
    const section = SECTION_BY_KEY.get(key);
    return section !== undefined && runtimeSectionMenuKey(section) === activeMenuKey;
  };
  const isSectionChanged = (key: string) => {
    const s = SECTION_BY_KEY.get(key);
    return s ? sectionChanged(s) : false;
  };
  const restoreSectionByKey = (key: string) => {
    const s = SECTION_BY_KEY.get(key);
    if (s) restoreSection(s);
  };
  const patch = <K extends EditableKey>(key: K, value: RuntimeEditableSettings[K]) => {
    const current = draftRef.current;
    if (!current) return;
    const next = { ...current, [key]: value };
    draftRef.current = next;
    setDraft(next);
    // Keep a failure visible until the next successful write retires it.
    setSaveState((prev) => (prev === "error" ? prev : "idle"));
  };

  const restoreSection = (section: RuntimeSection) => {
    const current = draftRef.current;
    if (!current || !bootstrap) return;
    const next = { ...current } as unknown as Record<string, unknown>;
    const defaults = bootstrap as unknown as Record<string, unknown>;
    for (const key of section.fields) next[key] = defaults[key];
    const typed = next as unknown as RuntimeEditableSettings;
    draftRef.current = typed;
    setDraft(typed);
    flush();
  };

  const handleSectionBlur = (event: FocusEvent<HTMLDivElement>) => {
    const target = event.target;
    // Checkboxes and selects commit on change — they have no reliable blur
    // moment — so the change handler below owns them.
    if (
      target instanceof HTMLInputElement &&
      (target.type === "checkbox" || target.type === "radio")
    )
      return;
    if (target instanceof HTMLSelectElement) return;
    // A field the validator has already flagged must not be written: with
    // instant save there is no later chance to fix it before the PUT.
    if (target instanceof HTMLElement && target.getAttribute("aria-invalid") === "true") return;
    flush();
  };

  const handleSectionChange = (event: ChangeEvent<HTMLDivElement>) => {
    const target = event.target;
    const isToggle = target instanceof HTMLInputElement && target.type === "checkbox";
    if (isToggle || target instanceof HTMLSelectElement) flush();
  };

  const updateInfo = updateCheckQuery.data;
  const updateResult = (() => {
    if (!draft.update_check_enabled)
      return <span className="muted">{t("ops.runtime.updateOff")}</span>;
    if (!updateInfo) return <span className="muted">{t("ops.runtime.updateNotYet")}</span>;
    if (!updateInfo.latest && updateInfo.error)
      return <span className="muted">{t("ops.runtime.updateFailed")}</span>;
    if (!isReleaseVersion(updateInfo.current))
      return (
        <span className="muted">
          {t("ops.runtime.updateDevBuild", {
            current: updateInfo.current,
            version: updateInfo.latest || "—",
          })}
        </span>
      );
    if (updateInfo.has_update)
      return (
        <a
          className="runtime-update-link"
          href={updateInfo.release_url || undefined}
          target="_blank"
          rel="noreferrer"
        >
          {t("ops.runtime.updateFound", { version: updateInfo.latest })}
        </a>
      );
    const state = updateState(updateInfo);
    if (state === "current") return <span>{t("ops.runtime.updateUpToDate")}</span>;
    if (state === "ahead")
      return (
        <span>
          {t("updates.channelIsNewer", {
            current: updateInfo.current,
            latest: updateInfo.latest,
            channel: t(updateInfo.channel === "beta" ? "updates.beta" : "updates.stable"),
          })}
        </span>
      );
    return <span>{t(`updates.state.${state}`)}</span>;
  })();

  // The deployment layer: what the process actually read at startup. Without
  // it, "the gateway timed out at 60s" is unanswerable from the console — the
  // ceiling is in a deployment file, and a variable compose never passed looks
  // exactly like a deliberate default.
  const allParams = data.deployment_parameters ?? [];
  const needle = paramFilter.trim().toLowerCase();
  const matchedParams = needle
    ? allParams.filter((param) => param.key.toLowerCase().includes(needle))
    : allParams;
  const envParamCount = allParams.filter((param) => param.from_env).length;
  // Only the variables the container really set are shown until asked
  // otherwise: a value that fell back to a code default is the same on every
  // deployment, so it is the env-provided rows that answer "why is this 60s".
  const showEveryParam = paramShowAll || needle !== "";
  const visibleParams = showEveryParam
    ? matchedParams
    : matchedParams.filter((param) => param.from_env);
  const hiddenParamCount = matchedParams.length - visibleParams.length;

  const status =
    saveState === "error" ? (
      <>
        <StatusBadge value="error" />
        <span>{t("ops.runtime.saveFailed")}</span>
      </>
    ) : save.isPending ? (
      <>
        <LoaderCircle size={13} className="spin" aria-hidden="true" />
        <span>{t("ops.runtime.saving")}</span>
      </>
    ) : dirty ? (
      <span className="runtime-settings-unsaved">{t("ops.runtime.unsaved")}</span>
    ) : saveState === "saved" ? (
      <>
        <StatusBadge value="success" />
        <span>{t("ops.runtime.saved")}</span>
      </>
    ) : null;

  return (
    <div className="runtime-settings">
      {status ? (
        <div className="toolbar runtime-status-row">
          <span className="runtime-save-status" role="status">
            {status}
          </span>
          {saveState === "error" ? (
            <Button variant="quiet" onClick={flush}>
              {t("common.retry")}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="runtime-layout">
        <div
          className="runtime-cards-grid"
          key={activeGroup.key}
          onBlur={handleSectionBlur}
          onChange={handleSectionChange}
        >
          {isSectionVisible("relay") ? (
            <SectionCard
              sectionKey="relay"
              changed={isSectionChanged("relay")}
              busy={busy}
              onRestore={() => restoreSectionByKey("relay")}
            >
              <RuntimeRow
                label={t("ops.runtime.crossChannelFailover")}
                hint={t("ops.runtime.crossChannelFailoverHint")}
                changed={isChanged("cross_channel_failover_enabled")}
              >
                <SwitchControl
                  checked={draft.cross_channel_failover_enabled}
                  disabled={busy}
                  onChange={(e) => {
                    patch("cross_channel_failover_enabled", e.target.checked);
                    flush();
                  }}
                />
              </RuntimeRow>

              <RuntimeRow
                label={t("ops.runtime.retryTimes")}
                hint={t("ops.runtime.retryTimesHint")}
                changed={isChanged("retry_times")}
              >
                <ValidatedNumberInput
                  min={0}
                  max={100}
                  disabled={busy || !draft.cross_channel_failover_enabled}
                  value={draft.retry_times}
                  onChange={(e) =>
                    patch("retry_times", numberOr(e.target.value, draft.retry_times))
                  }
                />
              </RuntimeRow>
              <RuntimeRow
                label={t("ops.runtime.channelRetryTimes")}
                hint={t("ops.runtime.channelRetryTimesHint")}
                changed={isChanged("channel_retry_times")}
              >
                <ValidatedNumberInput
                  min={0}
                  max={5}
                  disabled={busy}
                  value={draft.channel_retry_times}
                  onChange={(e) =>
                    patch(
                      "channel_retry_times",
                      numberOr(e.target.value, draft.channel_retry_times),
                    )
                  }
                />
              </RuntimeRow>
              <RuntimeRow
                label={t("ops.runtime.imagesFailover")}
                hint={t("ops.runtime.imagesFailoverHint")}
                changed={
                  isChanged("images_failover_enabled") ||
                  isChanged("images_failover_include_ambiguous") ||
                  isChanged("images_failover_include_uncertain")
                }
              >
                <SwitchControl
                  checked={draft.images_failover_enabled}
                  disabled={busy}
                  onChange={(e) => {
                    const on = e.target.checked;
                    if (on) {
                      // One switch on the page; the scope of the replay set is
                      // chosen inside the arming dialog. Fresh state every time,
                      // so a previous half-armed choice never leaks in.
                      setArmAmbiguous(false);
                      setArmUncertain(false);
                      setConfirmingImagesFailover(true);
                      return;
                    }
                    // Disarming is free and clears everything, never leaving a
                    // half-armed state behind.
                    patch("images_failover_enabled", false);
                    patch("images_failover_include_ambiguous", false);
                    patch("images_failover_include_uncertain", false);
                    flush();
                  }}
                />
              </RuntimeRow>
            </SectionCard>
          ) : null}

          {isSectionVisible("routing") ? (
            <SectionCard
              sectionKey="routing"
              changed={isSectionChanged("routing")}
              busy={busy}
              onRestore={() => restoreSectionByKey("routing")}
            >
              <RuntimeRow
                label={t("ops.runtime.latencyAware")}
                hint={t("ops.runtime.latencyAwareHint")}
                changed={isChanged("routing_latency_aware")}
              >
                <SwitchControl
                  checked={draft.routing_latency_aware}
                  disabled={busy}
                  onChange={(e) => {
                    patch("routing_latency_aware", e.target.checked);
                    flush();
                  }}
                />
              </RuntimeRow>
              <RuntimeRow
                label={t("ops.runtime.errorAware")}
                hint={t("ops.runtime.errorAwareHint")}
                changed={isChanged("routing_error_aware")}
              >
                <SwitchControl
                  checked={draft.routing_error_aware}
                  disabled={busy}
                  onChange={(e) => {
                    patch("routing_error_aware", e.target.checked);
                    flush();
                  }}
                />
              </RuntimeRow>
              <RuntimeRow
                label={t("ops.runtime.concurrencyGuard")}
                hint={t("ops.runtime.concurrencyGuardHint")}
                changed={isChanged("routing_concurrency_enabled")}
              >
                <SwitchControl
                  checked={draft.routing_concurrency_enabled}
                  disabled={busy}
                  onChange={(e) => {
                    patch("routing_concurrency_enabled", e.target.checked);
                    flush();
                  }}
                />
              </RuntimeRow>
              <RuntimeRow
                label={t("ops.runtime.concurrencyLimit")}
                hint={t("ops.runtime.concurrencyLimitHint")}
                changed={isChanged("routing_concurrency_limit")}
              >
                <ValidatedNumberInput
                  min={1}
                  max={100000}
                  disabled={busy}
                  value={draft.routing_concurrency_limit}
                  onChange={(e) =>
                    patch(
                      "routing_concurrency_limit",
                      numberOr(e.target.value, draft.routing_concurrency_limit),
                    )
                  }
                />
              </RuntimeRow>
            </SectionCard>
          ) : null}

          {isSectionVisible("stableFirst") ? (
            <SectionCard
              sectionKey="stableFirst"
              changed={isSectionChanged("stableFirst")}
              busy={busy}
              onRestore={() => restoreSectionByKey("stableFirst")}
            >
              <RuntimeRow
                label={t("ops.runtime.stableFirst")}
                hint={t("ops.runtime.stableFirstHint")}
                changed={isChanged("stable_first_enabled")}
              >
                <SwitchControl
                  checked={draft.stable_first_enabled}
                  disabled={busy}
                  onChange={(e) => {
                    patch("stable_first_enabled", e.target.checked);
                    flush();
                  }}
                />
              </RuntimeRow>
              <RuntimeRow
                label={t("ops.runtime.stableFirstDenominator")}
                hint={t("ops.runtime.stableFirstDenominatorHint")}
                changed={isChanged("stable_first_denominator")}
              >
                <ValidatedNumberInput
                  min={2}
                  max={1000}
                  disabled={busy}
                  value={draft.stable_first_denominator}
                  onChange={(e) =>
                    patch(
                      "stable_first_denominator",
                      numberOr(e.target.value, draft.stable_first_denominator),
                    )
                  }
                />
              </RuntimeRow>
              <RuntimeRow
                label={t("ops.runtime.stableFirstPromote")}
                hint={t("ops.runtime.stableFirstPromoteHint")}
                changed={isChanged("stable_first_promote_requests")}
              >
                <ValidatedNumberInput
                  min={1}
                  max={100000}
                  disabled={busy}
                  value={draft.stable_first_promote_requests}
                  onChange={(e) =>
                    patch(
                      "stable_first_promote_requests",
                      numberOr(e.target.value, draft.stable_first_promote_requests),
                    )
                  }
                />
              </RuntimeRow>
            </SectionCard>
          ) : null}

          {isSectionVisible("sticky") ? (
            <SectionCard
              sectionKey="sticky"
              changed={isSectionChanged("sticky")}
              busy={busy}
              onRestore={() => restoreSectionByKey("sticky")}
            >
              <RuntimeRow
                label={t("ops.runtime.stickyEnabled")}
                hint={t("ops.runtime.stickyEnabledHint")}
                changed={isChanged("sticky_enabled")}
              >
                <SwitchControl
                  checked={draft.sticky_enabled}
                  disabled={busy}
                  onChange={(e) => {
                    patch("sticky_enabled", e.target.checked);
                    flush();
                  }}
                />
              </RuntimeRow>
              <RuntimeRow
                label={t("ops.runtime.stickyTTL")}
                hint={t("ops.runtime.stickyTTLHint")}
                changed={isChanged("sticky_ttl_minutes")}
              >
                <ValidatedNumberInput
                  min={1}
                  max={1440}
                  disabled={busy || !draft.sticky_enabled}
                  value={draft.sticky_ttl_minutes}
                  onChange={(e) =>
                    patch("sticky_ttl_minutes", numberOr(e.target.value, draft.sticky_ttl_minutes))
                  }
                />
              </RuntimeRow>
            </SectionCard>
          ) : null}

          {isSectionVisible("limits") ? (
            <SectionCard
              sectionKey="limits"
              changed={isSectionChanged("limits")}
              busy={busy}
              onRestore={() => restoreSectionByKey("limits")}
              className="is-wide-section is-two-column-section"
            >
              {/* Four peer limits, four peer rows: the per-minute rate and its
                  burst used to share one multi-column block, which is exactly
                  the shape the index-and-rows page does not have. */}
              <RuntimeRow
                label={`${t("ops.runtime.relayRate")} · ${t("ops.runtime.ratePerMinute")}`}
                hint={t("ops.runtime.relayRateHint")}
                changed={isChanged("relay_rate_per_minute")}
              >
                <ValidatedNumberInput
                  min={0}
                  max={1000000}
                  disabled={busy}
                  value={draft.relay_rate_per_minute}
                  onChange={(e) =>
                    patch(
                      "relay_rate_per_minute",
                      numberOr(e.target.value, draft.relay_rate_per_minute),
                    )
                  }
                />
              </RuntimeRow>
              <RuntimeRow
                label={`${t("ops.runtime.relayRate")} · ${t("ops.runtime.rateBurst")}`}
                hint={t("ops.runtime.relayRateHint")}
                changed={isChanged("relay_rate_burst")}
              >
                <ValidatedNumberInput
                  min={0}
                  max={1000000}
                  disabled={busy}
                  value={draft.relay_rate_burst}
                  onChange={(e) =>
                    patch("relay_rate_burst", numberOr(e.target.value, draft.relay_rate_burst))
                  }
                />
              </RuntimeRow>
              <RuntimeRow
                label={`${t("ops.runtime.adminRate")} · ${t("ops.runtime.ratePerMinute")}`}
                hint={t("ops.runtime.adminRateHint")}
                changed={isChanged("admin_rate_per_minute")}
              >
                <ValidatedNumberInput
                  min={0}
                  max={1000000}
                  disabled={busy}
                  value={draft.admin_rate_per_minute}
                  onChange={(e) =>
                    patch(
                      "admin_rate_per_minute",
                      numberOr(e.target.value, draft.admin_rate_per_minute),
                    )
                  }
                />
              </RuntimeRow>
              <RuntimeRow
                label={`${t("ops.runtime.adminRate")} · ${t("ops.runtime.rateBurst")}`}
                hint={t("ops.runtime.adminRateHint")}
                changed={isChanged("admin_rate_burst")}
              >
                <ValidatedNumberInput
                  min={0}
                  max={1000000}
                  disabled={busy}
                  value={draft.admin_rate_burst}
                  onChange={(e) =>
                    patch("admin_rate_burst", numberOr(e.target.value, draft.admin_rate_burst))
                  }
                />
              </RuntimeRow>
            </SectionCard>
          ) : null}

          {isSectionVisible("errorRules") ? (
            <div className="runtime-card-slot">
              <ErrorRulesPanel />
            </div>
          ) : null}
          {isSectionVisible("promptGuard") ? (
            <div className="runtime-card-slot">
              <PromptGuardPanel />
            </div>
          ) : null}

          {isSectionVisible("cooldown") ? (
            <SectionCard
              sectionKey="cooldown"
              changed={isSectionChanged("cooldown")}
              busy={busy}
              onRestore={() => restoreSectionByKey("cooldown")}
            >
              <RuntimeRow
                label={t("ops.runtime.faultProtection")}
                hint={t("ops.runtime.faultProtectionHint")}
                changed={isChanged("fault_protection_enabled")}
              >
                <SwitchControl
                  checked={draft.fault_protection_enabled}
                  disabled={busy}
                  onChange={(e) => {
                    patch("fault_protection_enabled", e.target.checked);
                    flush();
                  }}
                />
              </RuntimeRow>
              <RuntimeRow
                label={t("ops.runtime.cooldown")}
                hint={t("ops.runtime.cooldownHint")}
                changed={isChanged("cooldown_seconds")}
              >
                <ValidatedNumberInput
                  min={0}
                  max={86400}
                  disabled={busy || !draft.fault_protection_enabled}
                  value={draft.cooldown_seconds}
                  onChange={(e) =>
                    patch("cooldown_seconds", numberOr(e.target.value, draft.cooldown_seconds))
                  }
                />
              </RuntimeRow>
              <RuntimeRow
                label={t("ops.runtime.autoDisable")}
                hint={t("ops.runtime.autoDisableHint")}
                changed={isChanged("channel_auto_disable_threshold")}
              >
                <ValidatedNumberInput
                  min={0}
                  max={1000}
                  disabled={busy || !draft.fault_protection_enabled}
                  value={draft.channel_auto_disable_threshold}
                  onChange={(e) =>
                    patch(
                      "channel_auto_disable_threshold",
                      numberOr(e.target.value, draft.channel_auto_disable_threshold),
                    )
                  }
                />
              </RuntimeRow>
              <RuntimeRow
                label={t("ops.runtime.recoveryInterval")}
                hint={t("ops.runtime.recoveryIntervalHint")}
                changed={isChanged("recovery_probe_interval_seconds")}
              >
                <ValidatedNumberInput
                  min={10}
                  max={86400}
                  disabled={
                    busy || !draft.fault_protection_enabled || !draft.recovery_probe_enabled
                  }
                  value={draft.recovery_probe_interval_seconds}
                  onChange={(e) =>
                    patch(
                      "recovery_probe_interval_seconds",
                      numberOr(e.target.value, draft.recovery_probe_interval_seconds),
                    )
                  }
                />
              </RuntimeRow>
              <RuntimeRow
                label={t("ops.runtime.recoveryProbe")}
                hint={t("ops.runtime.recoveryProbeHint")}
                changed={isChanged("recovery_probe_enabled")}
              >
                <SwitchControl
                  checked={draft.recovery_probe_enabled}
                  disabled={busy || !draft.fault_protection_enabled}
                  onChange={(e) => {
                    patch("recovery_probe_enabled", e.target.checked);
                    flush();
                  }}
                />
              </RuntimeRow>
            </SectionCard>
          ) : null}

          {isSectionVisible("health") ? (
            <SectionCard
              sectionKey="health"
              changed={isSectionChanged("health")}
              busy={busy}
              onRestore={() => restoreSectionByKey("health")}
            >
              <RuntimeRow
                label={t("ops.runtime.healthSweep")}
                hint={t("ops.runtime.healthSweepHint")}
                changed={isChanged("health_sweep_enabled")}
              >
                <SwitchControl
                  checked={draft.health_sweep_enabled}
                  disabled={busy}
                  onChange={(e) => {
                    patch("health_sweep_enabled", e.target.checked);
                    flush();
                  }}
                />
              </RuntimeRow>
              <RuntimeRow
                label={t("ops.runtime.healthSweepInterval")}
                hint={t("ops.runtime.healthSweepIntervalHint")}
                changed={isChanged("health_sweep_interval_seconds")}
              >
                <ValidatedNumberInput
                  min={10}
                  max={86400}
                  disabled={busy || !draft.health_sweep_enabled}
                  value={draft.health_sweep_interval_seconds}
                  onChange={(e) =>
                    patch(
                      "health_sweep_interval_seconds",
                      numberOr(e.target.value, draft.health_sweep_interval_seconds),
                    )
                  }
                />
              </RuntimeRow>
              <RuntimeRow
                label={t("ops.runtime.healthSweepJitter")}
                hint={t("ops.runtime.healthSweepJitterHint")}
                changed={isChanged("health_sweep_jitter_seconds")}
              >
                <ValidatedNumberInput
                  min={0}
                  max={3600}
                  disabled={busy || !draft.health_sweep_enabled}
                  customError={
                    draft.health_sweep_interval_seconds >= 10 &&
                    draft.health_sweep_interval_seconds <= 86400 &&
                    draft.health_sweep_jitter_seconds > draft.health_sweep_interval_seconds
                      ? t("ops.runtime.validation.jitterExceedsInterval", {
                          interval: draft.health_sweep_interval_seconds,
                        })
                      : undefined
                  }
                  value={draft.health_sweep_jitter_seconds}
                  onChange={(e) =>
                    patch(
                      "health_sweep_jitter_seconds",
                      numberOr(e.target.value, draft.health_sweep_jitter_seconds),
                    )
                  }
                />
              </RuntimeRow>
              <RuntimeRow
                label={t("ops.runtime.healthSweepDegraded")}
                hint={t("ops.runtime.healthSweepDegradedHint")}
                changed={isChanged("health_sweep_degraded_ms")}
              >
                <ValidatedNumberInput
                  min={100}
                  max={60000}
                  disabled={busy || !draft.health_sweep_enabled}
                  value={draft.health_sweep_degraded_ms}
                  onChange={(e) =>
                    patch(
                      "health_sweep_degraded_ms",
                      numberOr(e.target.value, draft.health_sweep_degraded_ms),
                    )
                  }
                />
              </RuntimeRow>
              <RuntimeRow
                label={t("ops.runtime.healthSweepConcurrency")}
                hint={t("ops.runtime.healthSweepConcurrencyHint")}
                changed={isChanged("health_sweep_concurrency")}
              >
                <ValidatedNumberInput
                  min={1}
                  max={64}
                  disabled={busy || !draft.health_sweep_enabled}
                  value={draft.health_sweep_concurrency}
                  onChange={(e) =>
                    patch(
                      "health_sweep_concurrency",
                      numberOr(e.target.value, draft.health_sweep_concurrency),
                    )
                  }
                />
              </RuntimeRow>
              <RuntimeRow
                label={t("ops.runtime.healthSweepTimeout")}
                hint={t("ops.runtime.healthSweepTimeoutHint")}
                changed={isChanged("health_sweep_timeout_seconds")}
              >
                <ValidatedNumberInput
                  min={1}
                  max={120}
                  disabled={busy || !draft.health_sweep_enabled}
                  value={draft.health_sweep_timeout_seconds}
                  onChange={(e) =>
                    patch(
                      "health_sweep_timeout_seconds",
                      numberOr(e.target.value, draft.health_sweep_timeout_seconds),
                    )
                  }
                />
              </RuntimeRow>
            </SectionCard>
          ) : null}

          {isSectionVisible("sync") ? (
            <SectionCard
              sectionKey="sync"
              changed={isSectionChanged("sync")}
              busy={busy}
              onRestore={() => restoreSectionByKey("sync")}
            >
              <RuntimeRow
                label={t("ops.runtime.discoveryCron")}
                hint={t("ops.runtime.discoveryCronHint")}
                changed={isChanged("discovery_cron")}
                wide
              >
                <CronSchedulePicker
                  disabled={busy}
                  value={draft.discovery_cron ?? ""}
                  onChange={(cron) => patch("discovery_cron", cron)}
                />
              </RuntimeRow>
              <RuntimeRow
                label={t("ops.runtime.defaultModelSyncMode")}
                hint={t("ops.runtime.defaultModelSyncModeHint")}
                changed={isChanged("default_model_sync_mode")}
              >
                <SelectControl
                  disabled={busy}
                  value={draft.default_model_sync_mode ?? "manual"}
                  onChange={(e) => {
                    patch("default_model_sync_mode", e.target.value === "auto" ? "auto" : "manual");
                    flush();
                  }}
                >
                  <option value="manual">{t("channels.syncModeManual")}</option>
                  <option value="auto">{t("channels.syncModeAuto")}</option>
                </SelectControl>
              </RuntimeRow>
            </SectionCard>
          ) : null}

          {isSectionVisible("probe") ? (
            <SectionCard
              sectionKey="probe"
              changed={isSectionChanged("probe")}
              busy={busy}
              info={t("ops.runtime.probeIntro")}
              onRestore={() => restoreSectionByKey("probe")}
            >
              <p className="muted panel-lede">{t("ops.runtime.probeLede")}</p>
              {/* The scope is chosen where the pick lists are (模型 → 模型工具 → 模型探测),
                  so this card states it instead of offering a second editor for it. */}
              <p className="muted" role="status">
                {t("ops.runtime.probeScope", {
                  channels:
                    (draft.probe_channels ?? []).length === 0
                      ? t("ops.runtime.probeScopeAllChannels")
                      : t("ops.runtime.probeScopeChannels", {
                          count: (draft.probe_channels ?? []).length,
                        }),
                  models:
                    (draft.probe_models ?? []).length === 0
                      ? t("ops.runtime.probeScopeAllModels")
                      : t("ops.runtime.probeScopeModels", {
                          count: (draft.probe_models ?? []).length,
                        }),
                })}
                <span className="field-hint"> {t("ops.runtime.probeScopeHint")}</span>
              </p>
              <RuntimeRow
                label={t("ops.runtime.probeCron")}
                hint={t("ops.runtime.probeCronHint")}
                changed={isChanged("probe_cron")}
                wide
              >
                <CronSchedulePicker
                  disabled={busy}
                  value={draft.probe_cron ?? ""}
                  onChange={(cron) => patch("probe_cron", cron)}
                />
              </RuntimeRow>
              <RuntimeRow
                label={t("ops.runtime.probePrompt")}
                hint={t("ops.runtime.probePromptHint")}
                changed={isChanged("probe_prompt")}
              >
                <HeroInput
                  type="text"
                  placeholder="hi"
                  disabled={busy}
                  value={draft.probe_prompt ?? ""}
                  onChange={(e) => patch("probe_prompt", e.target.value)}
                />
              </RuntimeRow>
              <RuntimeRow
                label={t("ops.runtime.probeMaxTokens")}
                hint={t("ops.runtime.probeMaxTokensHint")}
                changed={isChanged("probe_max_tokens")}
              >
                <HeroInput
                  type="number"
                  min={1}
                  max={256}
                  disabled={busy}
                  value={draft.probe_max_tokens ?? 1}
                  onChange={(e) => patch("probe_max_tokens", Number(e.target.value))}
                />
              </RuntimeRow>
              <RuntimeRow
                label={t("ops.runtime.probeConcurrency")}
                hint={t("ops.runtime.probeConcurrencyHint")}
                changed={isChanged("probe_concurrency")}
              >
                <HeroInput
                  type="number"
                  min={1}
                  max={16}
                  disabled={busy}
                  value={draft.probe_concurrency ?? 4}
                  onChange={(e) => patch("probe_concurrency", Number(e.target.value))}
                />
              </RuntimeRow>
              <RuntimeRow
                label={t("ops.runtime.probeAutoDisable")}
                hint={t("ops.runtime.probeAutoDisableHint")}
                changed={isChanged("probe_auto_disable")}
              >
                <HeroInput
                  type="number"
                  min={0}
                  max={10}
                  disabled={busy}
                  value={draft.probe_auto_disable ?? 0}
                  onChange={(e) => patch("probe_auto_disable", Number(e.target.value))}
                />
              </RuntimeRow>
            </SectionCard>
          ) : null}

          {isSectionVisible("siteProbe") ? (
            <SectionCard
              sectionKey="siteProbe"
              changed={isSectionChanged("siteProbe")}
              busy={busy}
              info={t("ops.runtime.siteProbeIntro")}
              onRestore={() => restoreSectionByKey("siteProbe")}
            >
              <p className="muted panel-lede">{t("ops.runtime.siteProbeLede")}</p>
              <RuntimeRow
                label={t("ops.runtime.siteProbeInterval")}
                hint={t("ops.runtime.siteProbeIntervalHint")}
                changed={isChanged("site_probe_interval_seconds")}
              >
                <ValidatedNumberInput
                  min={60}
                  max={86400}
                  disabled={busy}
                  value={draft.site_probe_interval_seconds}
                  onChange={(e) =>
                    patch(
                      "site_probe_interval_seconds",
                      numberOr(e.target.value, draft.site_probe_interval_seconds),
                    )
                  }
                />
              </RuntimeRow>
              <RuntimeRow
                label={t("ops.runtime.siteProbeJitter")}
                hint={t("ops.runtime.siteProbeJitterHint")}
                changed={isChanged("site_probe_jitter_seconds")}
              >
                <ValidatedNumberInput
                  min={0}
                  max={3600}
                  disabled={busy}
                  customError={
                    draft.site_probe_interval_seconds >= 60 &&
                    draft.site_probe_jitter_seconds > draft.site_probe_interval_seconds
                      ? t("ops.runtime.validation.jitterExceedsInterval", {
                          interval: draft.site_probe_interval_seconds,
                        })
                      : undefined
                  }
                  value={draft.site_probe_jitter_seconds}
                  onChange={(e) =>
                    patch(
                      "site_probe_jitter_seconds",
                      numberOr(e.target.value, draft.site_probe_jitter_seconds),
                    )
                  }
                />
              </RuntimeRow>
            </SectionCard>
          ) : null}

          {isSectionVisible("siteNews") ? (
            <SectionCard
              sectionKey="siteNews"
              changed={isSectionChanged("siteNews")}
              busy={busy}
              info={t("ops.runtime.siteNewsIntro")}
              onRestore={() => restoreSectionByKey("siteNews")}
            >
              <p className="muted panel-lede">{t("ops.runtime.siteNewsLede")}</p>
              <RuntimeRow
                label={t("ops.runtime.siteNewsInterval")}
                hint={t("ops.runtime.siteNewsIntervalHint")}
                changed={isChanged("site_news_interval_seconds")}
              >
                <ValidatedNumberInput
                  min={0}
                  max={86400}
                  disabled={busy}
                  customError={
                    draft.site_news_interval_seconds > 0 && draft.site_news_interval_seconds < 60
                      ? t("ops.runtime.validation.siteNewsIntervalFloor")
                      : undefined
                  }
                  value={draft.site_news_interval_seconds}
                  onChange={(e) =>
                    patch(
                      "site_news_interval_seconds",
                      numberOr(e.target.value, draft.site_news_interval_seconds),
                    )
                  }
                />
              </RuntimeRow>
            </SectionCard>
          ) : null}

          {isSectionVisible("keepalive") ? (
            <SectionCard
              sectionKey="keepalive"
              changed={isSectionChanged("keepalive")}
              busy={busy}
              info={t("ops.runtime.keepaliveIntro")}
              onRestore={() => restoreSectionByKey("keepalive")}
              actions={
                <Link className="button button-quiet" to="/channels">
                  {t("ops.runtime.openKeepalive")}
                </Link>
              }
            >
              <p className="muted panel-lede">{t("ops.runtime.keepaliveLede")}</p>
              <RuntimeRow
                label={t("ops.runtime.keepaliveEnabled")}
                hint={t("ops.runtime.keepaliveEnabledHint")}
                changed={isChanged("keepalive_enabled")}
              >
                <SwitchControl
                  checked={draft.keepalive_enabled}
                  disabled={busy}
                  onChange={(e) => {
                    patch("keepalive_enabled", e.target.checked);
                    flush();
                  }}
                />
              </RuntimeRow>
              <RuntimeRow
                label={t("ops.runtime.keepaliveInterval")}
                hint={t("ops.runtime.keepaliveIntervalHint")}
                changed={isChanged("keepalive_check_interval_seconds")}
              >
                <ValidatedNumberInput
                  min={60}
                  max={86400}
                  disabled={busy}
                  value={draft.keepalive_check_interval_seconds}
                  onChange={(e) =>
                    patch(
                      "keepalive_check_interval_seconds",
                      numberOr(e.target.value, draft.keepalive_check_interval_seconds),
                    )
                  }
                />
              </RuntimeRow>
              <RuntimeRow
                label={t("ops.runtime.keepaliveDefaultIdleDays")}
                hint={t("ops.runtime.keepaliveDefaultIdleDaysHint")}
                changed={isChanged("keepalive_default_idle_days")}
              >
                <ValidatedNumberInput
                  min={0}
                  max={3650}
                  disabled={busy}
                  value={draft.keepalive_default_idle_days}
                  onChange={(e) =>
                    patch(
                      "keepalive_default_idle_days",
                      numberOr(e.target.value, draft.keepalive_default_idle_days),
                    )
                  }
                />
              </RuntimeRow>
            </SectionCard>
          ) : null}

          {isSectionVisible("audit") ? (
            <SectionCard
              sectionKey="audit"
              changed={isSectionChanged("audit")}
              busy={busy}
              onRestore={() => restoreSectionByKey("audit")}
            >
              <RuntimeRow
                label={t("ops.runtime.auditDays")}
                hint={t("ops.runtime.auditDaysHint")}
                changed={isChanged("audit_retention_days")}
              >
                <ValidatedNumberInput
                  min={0}
                  max={36500}
                  disabled={busy}
                  value={draft.audit_retention_days}
                  onChange={(e) =>
                    patch(
                      "audit_retention_days",
                      numberOr(e.target.value, draft.audit_retention_days),
                    )
                  }
                />
              </RuntimeRow>
              <RuntimeRow
                label={t("ops.runtime.auditRows")}
                hint={t("ops.runtime.auditRowsHint")}
                changed={isChanged("audit_retention_rows")}
              >
                <ValidatedNumberInput
                  min={0}
                  max={10000000}
                  disabled={busy}
                  value={draft.audit_retention_rows}
                  onChange={(e) =>
                    patch(
                      "audit_retention_rows",
                      numberOr(e.target.value, draft.audit_retention_rows),
                    )
                  }
                />
              </RuntimeRow>
            </SectionCard>
          ) : null}

          {isSectionVisible("alerts") ? (
            <SectionCard
              sectionKey="alerts"
              changed={isSectionChanged("alerts")}
              busy={busy}
              onRestore={() => restoreSectionByKey("alerts")}
            >
              <RuntimeRow
                label={t("ops.runtime.webhookURL")}
                hint={t("ops.runtime.webhookURLHint")}
                changed={isChanged("webhook_url")}
              >
                <HeroInput
                  type="url"
                  placeholder="https://hooks.example.com/ops"
                  disabled={busy}
                  value={draft.webhook_url ?? ""}
                  onChange={(e) => patch("webhook_url", e.target.value)}
                />
              </RuntimeRow>
              <RuntimeRow
                label={t("ops.runtime.webhookThrottle")}
                hint={t("ops.runtime.webhookThrottleHint")}
                changed={isChanged("webhook_throttle_seconds")}
              >
                <ValidatedNumberInput
                  min={1}
                  max={86400}
                  disabled={busy}
                  value={draft.webhook_throttle_seconds}
                  onChange={(e) =>
                    patch(
                      "webhook_throttle_seconds",
                      numberOr(e.target.value, draft.webhook_throttle_seconds),
                    )
                  }
                />
              </RuntimeRow>
              <RuntimeRow
                label={t("ops.runtime.alertConfigJson")}
                hint={t("ops.runtime.alertConfigJsonHint")}
                changed={isChanged("alert_config_json")}
                wide
              >
                <HeroTextArea
                  rows={6}
                  spellCheck={false}
                  className="mono"
                  disabled={busy}
                  placeholder={
                    '{"bark_url":"https://api.day.app/KEY","serverchan_key":"",' +
                    '"telegram_bot_token":"","telegram_chat_id":"",' +
                    '"smtp_host":"","smtp_port":587,"smtp_user":"","smtp_password":"",' +
                    '"smtp_from":"","smtp_to":"","cooldown_seconds":300,' +
                    '"daily_summary_enabled":true}'
                  }
                  value={draft.alert_config_json ?? ""}
                  onChange={(e) => patch("alert_config_json", e.target.value)}
                />
              </RuntimeRow>
              <RuntimeRow
                label={t("ops.runtime.alertSweepInterval")}
                hint={t("ops.runtime.alertSweepIntervalHint")}
                changed={isChanged("alert_sweep_interval_seconds")}
              >
                <ValidatedNumberInput
                  min={0}
                  max={86400}
                  disabled={busy}
                  value={draft.alert_sweep_interval_seconds}
                  onChange={(e) =>
                    patch(
                      "alert_sweep_interval_seconds",
                      numberOr(e.target.value, draft.alert_sweep_interval_seconds),
                    )
                  }
                />
              </RuntimeRow>
              <RuntimeRow
                label={t("ops.runtime.alertDailyInterval")}
                hint={t("ops.runtime.alertDailyIntervalHint")}
                changed={isChanged("alert_daily_summary_interval_seconds")}
              >
                <ValidatedNumberInput
                  min={0}
                  max={86400}
                  disabled={busy}
                  value={draft.alert_daily_summary_interval_seconds}
                  onChange={(e) =>
                    patch(
                      "alert_daily_summary_interval_seconds",
                      numberOr(e.target.value, draft.alert_daily_summary_interval_seconds),
                    )
                  }
                />
              </RuntimeRow>
            </SectionCard>
          ) : null}

          {isSectionVisible("alertRules") ? (
            <div className="runtime-card-slot">
              <AlertRulesPanel />
            </div>
          ) : null}

          {isSectionVisible("maintenance") ? (
            <SectionCard
              sectionKey="maintenance"
              changed={isSectionChanged("maintenance")}
              busy={busy}
              onRestore={() => restoreSectionByKey("maintenance")}
            >
              <RuntimeRow
                label={t("ops.maintenance.cron")}
                hint={t("ops.maintenance.cronHint")}
                changed={isChanged("db_gc_cron")}
              >
                <HeroInput
                  type="text"
                  placeholder="0 4 * * *"
                  disabled={busy}
                  value={draft.db_gc_cron ?? ""}
                  onChange={(e) => patch("db_gc_cron", e.target.value)}
                />
              </RuntimeRow>
            </SectionCard>
          ) : null}

          {isSectionVisible("server") ? (
            <SectionCard
              sectionKey="server"
              changed={isSectionChanged("server")}
              busy={busy}
              onRestore={() => restoreSectionByKey("server")}
              className="is-wide-section"
            >
              <RuntimeRow
                label={t("ops.runtime.proxyURL")}
                hint={t("ops.runtime.proxyURLHint")}
                changed={isChanged("proxy_url")}
              >
                <HeroInput
                  type="url"
                  placeholder="http://127.0.0.1:7897"
                  disabled={busy}
                  value={draft.proxy_url ?? ""}
                  onChange={(e) => patch("proxy_url", e.target.value)}
                />
              </RuntimeRow>

              <div className="runtime-subhead">
                <span className="field-label">{t("ops.runtime.outboundLimits")}</span>
                <span className="field-hint">{t("ops.runtime.outboundLimitsHint")}</span>
              </div>
              <RuntimeRow
                label={t("ops.runtime.outboundConnectTimeout")}
                hint={t("ops.runtime.outboundConnectTimeoutHint")}
                changed={isChanged("outbound_connect_timeout_seconds")}
              >
                <HeroInput
                  type="number"
                  min={0}
                  max={600}
                  disabled={busy}
                  value={draft.outbound_connect_timeout_seconds ?? 0}
                  onChange={(e) =>
                    patch("outbound_connect_timeout_seconds", Number(e.target.value))
                  }
                />
              </RuntimeRow>
              <RuntimeRow
                label={t("ops.runtime.outboundHeaderTimeout")}
                hint={t("ops.runtime.outboundHeaderTimeoutHint")}
                changed={isChanged("outbound_header_timeout_seconds")}
              >
                <HeroInput
                  type="number"
                  min={0}
                  max={3600}
                  disabled={busy}
                  value={draft.outbound_header_timeout_seconds ?? 0}
                  onChange={(e) => patch("outbound_header_timeout_seconds", Number(e.target.value))}
                />
              </RuntimeRow>
              <RuntimeRow
                label={t("ops.runtime.outboundImageHeaderTimeout")}
                hint={t("ops.runtime.outboundImageHeaderTimeoutHint")}
                changed={isChanged("outbound_image_header_timeout_seconds")}
              >
                <HeroInput
                  type="number"
                  min={0}
                  max={3600}
                  disabled={busy}
                  value={draft.outbound_image_header_timeout_seconds ?? 0}
                  onChange={(e) =>
                    patch("outbound_image_header_timeout_seconds", Number(e.target.value))
                  }
                />
              </RuntimeRow>
              <RuntimeRow
                label={t("ops.runtime.outboundTLSTimeout")}
                hint={t("ops.runtime.outboundTLSTimeoutHint")}
                changed={isChanged("outbound_tls_timeout_seconds")}
              >
                <HeroInput
                  type="number"
                  min={0}
                  max={600}
                  disabled={busy}
                  value={draft.outbound_tls_timeout_seconds ?? 0}
                  onChange={(e) => patch("outbound_tls_timeout_seconds", Number(e.target.value))}
                />
              </RuntimeRow>
              <RuntimeRow
                label={t("ops.runtime.outboundMaxIdleConns")}
                hint={t("ops.runtime.outboundMaxIdleConnsHint")}
                changed={isChanged("outbound_max_idle_conns")}
              >
                <HeroInput
                  type="number"
                  min={0}
                  max={100000}
                  disabled={busy}
                  value={draft.outbound_max_idle_conns ?? 0}
                  onChange={(e) => patch("outbound_max_idle_conns", Number(e.target.value))}
                />
              </RuntimeRow>
              <RuntimeRow
                label={t("ops.runtime.outboundMaxIdleConnsPerHost")}
                hint={t("ops.runtime.outboundMaxIdleConnsPerHostHint")}
                changed={isChanged("outbound_max_idle_conns_per_host")}
              >
                <HeroInput
                  type="number"
                  min={0}
                  max={100000}
                  disabled={busy}
                  value={draft.outbound_max_idle_conns_per_host ?? 0}
                  onChange={(e) =>
                    patch("outbound_max_idle_conns_per_host", Number(e.target.value))
                  }
                />
              </RuntimeRow>
              <RuntimeRow
                label={t("ops.runtime.relayMaxBodyMB")}
                hint={t("ops.runtime.relayMaxBodyMBHint", {
                  env: bootstrap.relay_max_body_mb ?? 0,
                })}
                changed={isChanged("relay_max_body_mb")}
              >
                <HeroInput
                  type="number"
                  min={0}
                  max={512}
                  disabled={busy}
                  value={draft.relay_max_body_mb ?? 0}
                  onChange={(e) => patch("relay_max_body_mb", Number(e.target.value))}
                />
              </RuntimeRow>
              <RuntimeRow
                label={t("ops.runtime.relayMaxImageMB")}
                hint={t("ops.runtime.relayMaxImageMBHint", {
                  env: bootstrap.relay_max_image_mb ?? 0,
                })}
                changed={isChanged("relay_max_image_mb")}
              >
                <HeroInput
                  type="number"
                  min={0}
                  max={1024}
                  disabled={busy}
                  value={draft.relay_max_image_mb ?? 0}
                  onChange={(e) => patch("relay_max_image_mb", Number(e.target.value))}
                />
              </RuntimeRow>

              {/* Read-only facts about the running process: a definition list,
                  so the paths and the build stamp read as one reference block
                  instead of six half-empty form rows. */}
              <div className="runtime-info-block">
                <div className="runtime-subhead">
                  <span className="field-label">{t("ops.runtime.instanceInfo")}</span>
                </div>
                <dl className="runtime-readouts">
                  <div className="runtime-readout">
                    <dt className="field-label">{t("ops.runtime.buildVersion")}</dt>
                    <dd className="mono">{updateCheckQuery.data?.current ?? "…"}</dd>
                  </div>
                  <div className="runtime-readout">
                    <dt className="field-label">{t("ops.runtime.httpAddr")}</dt>
                    <dd className="mono">{data.server_http_addr}</dd>
                  </div>
                  <div className="runtime-readout">
                    <dt className="field-label">{t("ops.runtime.dataDir")}</dt>
                    <dd className="mono">{data.data_dir}</dd>
                  </div>
                  <div className="runtime-readout">
                    <dt className="field-label">{t("ops.runtime.backupDir")}</dt>
                    <dd className="mono">{data.backup_dir}</dd>
                  </div>
                  <div className="runtime-readout">
                    <dt className="field-label">{t("ops.runtime.pluginsDir")}</dt>
                    <dd className="mono">{data.plugins_dir}</dd>
                  </div>
                  <div className="runtime-readout">
                    <dt className="field-label">{t("ops.runtime.metricsToken")}</dt>
                    <dd className="mono">
                      {data.metrics_token_masked
                        ? data.metrics_token_masked
                        : t("ops.runtime.metricsTokenNone")}
                    </dd>
                  </div>
                </dl>
              </div>

              <RuntimeRow
                label={t("ops.runtime.updateCheck")}
                hint={t("ops.runtime.updateCheckHint")}
                changed={isChanged("update_check_enabled")}
              >
                <SwitchControl
                  checked={draft.update_check_enabled}
                  disabled={busy}
                  onChange={(e) => {
                    patch("update_check_enabled", e.target.checked);
                    flush();
                  }}
                />
              </RuntimeRow>
              <div className="runtime-update-row">
                <Button
                  variant="secondary"
                  disabled={refreshUpdate.isPending || !draft.update_check_enabled}
                  onClick={() => refreshUpdate.mutate()}
                >
                  {refreshUpdate.isPending
                    ? t("ops.runtime.updateChecking")
                    : t("ops.runtime.updateNow")}
                </Button>
                <span className="runtime-update-result">{updateResult}</span>
              </div>
              {role === null || role === "owner" ? (
                <Button variant="secondary" onClick={() => setUpdateOpen(true)}>
                  {t("updates.dialogTitle")}
                </Button>
              ) : null}

              {/* The environment layer is a fact about the deployment, not a
                  runtime parameter, so it lives inside the section that owns
                  the process's own settings and starts folded. */}
              <div
                className={`runtime-subblock${deploymentOpen ? " is-open" : ""}`}
                data-testid="deployment-parameters"
              >
                <HeroButton
                  type="button"
                  className="runtime-subblock-toggle"
                  aria-expanded={deploymentOpen}
                  onPress={() => setDeploymentOpen((open) => !open)}
                >
                  <ChevronRight size={14} className="runtime-subblock-chevron" aria-hidden="true" />
                  <span className="runtime-subblock-title">
                    {t("ops.runtime.section.deployment")}
                  </span>
                  <span className="runtime-subblock-count">
                    {t("ops.runtime.deploymentEnvSummary", { count: envParamCount })}
                  </span>
                </HeroButton>
                {deploymentOpen ? (
                  <div className="runtime-subblock-body">
                    <p className="muted panel-lede">{t("ops.runtime.deploymentLede")}</p>
                    <HeroInput
                      className="runtime-param-filter"
                      type="search"
                      value={paramFilter}
                      placeholder={t("ops.runtime.paramFilter")}
                      aria-label={t("ops.runtime.paramFilter")}
                      onChange={(event) => setParamFilter(event.target.value)}
                    />
                    <div className="runtime-param-list">
                      {visibleParams.map((param) => (
                        <div className="runtime-param-row" key={param.key}>
                          <code className="runtime-param-key">{param.key}</code>
                          <span className="runtime-param-value mono">{param.value || "—"}</span>
                          <span
                            className={`runtime-param-source${param.from_env ? " is-env" : ""}`}
                          >
                            {param.from_env
                              ? t("ops.runtime.paramFromEnv")
                              : t("ops.runtime.paramDefault")}
                          </span>
                        </div>
                      ))}
                      {visibleParams.length === 0 ? (
                        <p className="muted runtime-param-empty">{t("ops.runtime.paramEmpty")}</p>
                      ) : null}
                    </div>
                    {hiddenParamCount > 0 ? (
                      <Button variant="quiet" onClick={() => setParamShowAll((show) => !show)}>
                        {showEveryParam
                          ? t("ops.runtime.deploymentEnvOnly")
                          : t("ops.runtime.deploymentShowAll", { count: hiddenParamCount })}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </SectionCard>
          ) : null}

          {isSectionVisible("totp") ? (
            <div className="runtime-card-slot">
              <TOTPPanel />
            </div>
          ) : null}
          {isSectionVisible("dbMaintenance") ? (
            <div className="runtime-card-slot">
              <MaintenancePanel />
            </div>
          ) : null}

          {isSectionVisible("users") ? (
            <div className="runtime-card-slot">
              <ModePanel
                request={(path, init) => client!.request(path, init)}
                locale={locale}
                className="runtime-section runtime-mode-settings-card"
              />
            </div>
          ) : null}

          {isSectionVisible("recovery") ? (
            <div className="runtime-card-slot runtime-recovery-stack">
              <div className="runtime-card-slot">
                <Panel title={t("ops.runtime.resetEnv")} lede={t("ops.runtime.resetEnvHint")}>
                  <Button
                    variant="secondary"
                    disabled={busy || !data.has_override}
                    loading={reset.isPending}
                    onClick={() => {
                      reset.reset();
                      reset.mutate();
                    }}
                  >
                    {reset.isPending ? t("common.working") : t("ops.runtime.resetEnv")}
                  </Button>
                </Panel>
              </div>
              <div className="runtime-card-slot">
                <FactoryResetPanel />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {remoteChanged ? (
        <div className="runtime-settings-notice" role="status">
          <div className="runtime-settings-notice-copy">
            <strong>{t("ops.runtime.remoteChanged")}</strong>
            <p className="field-hint">{t("ops.runtime.remoteChangedHint")}</p>
          </div>
          <span className="flex-spacer" />
          <Button variant="secondary" onClick={keepLocalDraft}>
            {t("ops.runtime.keepMine")}
          </Button>
          <Button variant="secondary" onClick={reloadFromServer}>
            {t("ops.runtime.reloadServer")}
          </Button>
        </div>
      ) : null}

      {/* The update entry used to deep-link into Settings → update channel. The
          channel is not a setting (it is the deployment's image tag), so the
          entry now opens the same dialog the top-bar pill does. */}
      {updateOpen && updateCheckQuery.data ? (
        <UpdateDialog update={updateCheckQuery.data} onClose={() => setUpdateOpen(false)} />
      ) : null}

      {/* The image switch is a single warned arm: the base scope replays only
          the failures that provably preceded generation; the two options widen
          it, and the wide one can bill a picture twice, so nothing is saved
          until the dialog is confirmed. Turning the switch back off is free and
          immediate. */}
      {confirmingImagesFailover ? (
        <Dialog
          title={t("ops.runtime.imagesFailoverDialogTitle")}
          onClose={() => setConfirmingImagesFailover(false)}
          danger
          actions={
            <>
              <Button variant="secondary" onClick={() => setConfirmingImagesFailover(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  patch("images_failover_enabled", true);
                  patch("images_failover_include_ambiguous", armAmbiguous);
                  patch("images_failover_include_uncertain", armUncertain);
                  setConfirmingImagesFailover(false);
                  flush();
                }}
              >
                {t("ops.runtime.imagesFailoverArm")}
              </Button>
            </>
          }
        >
          <p>{t("ops.runtime.imagesFailoverDialogIntro")}</p>
          <label className="images-arm-option">
            <SwitchControl
              checked={armAmbiguous}
              disabled={armUncertain}
              onChange={(e) => setArmAmbiguous(e.target.checked)}
            />
            <span>
              <strong>{t("ops.runtime.imagesFailoverArmAmbiguous")}</strong>
              <small>{t("ops.runtime.imagesFailoverArmAmbiguousNote")}</small>
            </span>
          </label>
          <label className="images-arm-option">
            <SwitchControl
              checked={armUncertain}
              onChange={(e) => {
                setArmUncertain(e.target.checked);
                // The blunt tier already replays 5xx; keeping the narrower box
                // in sync stops the two options from contradicting each other.
                if (e.target.checked) setArmAmbiguous(true);
              }}
            />
            <span>
              <strong>{t("ops.runtime.imagesFailoverArmUncertain")}</strong>
              <small>{t("ops.runtime.imagesFailoverArmUncertainNote")}</small>
            </span>
          </label>
        </Dialog>
      ) : null}
    </div>
  );
}

import { type FocusEvent } from "react";
import {
  Check,
  ChevronDown,
  ListChecks,
  Pencil,
  Plus,
  Target,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { Button as HeroButton, Checkbox as HeroCheckbox, Input as HeroInput } from "@heroui/react";
import type { Route, RoutingCandidate } from "../../api/types";
import { ActionMenu } from "../../components/ActionMenu";
import { Button, Empty, InfoTip } from "../../components/ui";
import { useAvailability } from "../../hooks/useAvailability";
import { formatGroupName } from "../../lib/format";
import { AvailabilityIndicator } from "../../components/AvailabilityIndicator";
import { RouteDetailHeader, type RouteDetailHeaderProps } from "./RouteDetailHeader";
import { RouteMemberList, type RouteMemberListProps } from "./RouteMemberList";
import { RoutePolicyCard, type RoutePolicyCardProps } from "./RoutePolicyCard";

/**
 * The detail half of the models workspace: which route is selected, what serves
 * it, the routing modes and the member list you reorder, plus the effective-policy
 * disclosure at the bottom.
 *
 * This is the A02 cut for the detail panel. It used to be a ~700-line JSX body
 * inside a 2,300-line component, holding three separate concerns at once: the
 * route's own summary and mode controls (`RouteDetailHeader`), the routing list
 * with its group tabs and bulk tools (`RouteMemberList`, plus the group chrome
 * here), and the gateway's effective policy (`RoutePolicyCard`). Each of those is
 * now its own file; this one decides how they are composed and owns the group
 * editing chrome, which belongs to the panel as a whole rather than to a row.
 */
type Text = (key: string, vars?: Record<string, string | number>) => string;

export type RouteDetailPanelProps = {
  t: Text;
  route: Route;
  /** The route's model name, used when a member does not rename it. */
  selectedModel: string;
  /* Header and policy render through their own components' props. */
  header: RouteDetailHeaderProps;
  policy: RoutePolicyCardProps;
  /* The single-mode banner. */
  singleModeActive: boolean;
  singleModePinned: RoutingCandidate | null | undefined;
  pinOutsideGroup: boolean;
  pinPending: boolean;
  onClearPin: () => void;
  /* Members section chrome. */
  showAdvanced: boolean;
  setShowAdvanced: (update: (value: boolean) => boolean) => void;
  openAddMember: () => void;
  setAutoMatchRoute: (route: Route) => void;
  bulkSelect: boolean;
  setBulkSelect: (update: (value: boolean) => boolean) => void;
  selectedMemberIds: Set<number>;
  setSelectedMemberIds: (next: Set<number>) => void;
  bulkToggleMembers: { mutate: (input: { enabled: boolean }) => unknown };
  selectAllMembers: () => void;
  clearMemberSelection: () => void;
  /* Groups. */
  groupNames: string[];
  activeGroup: string;
  setActiveGroup: (name: string) => void;
  groupCounts: Map<string, number>;
  groupDraft: {
    mode: "new" | "rename";
    from?: string;
    value: string;
    copyDefault?: boolean;
  } | null;
  setGroupDraft: (value: RouteDetailPanelProps["groupDraft"] | null) => void;
  submitGroupDraft: () => void;
  groupEditorBlur: (event: FocusEvent) => void;
  setRemoveGroup: (name: string) => void;
  /** Present when the router fell back to another group; the group it used. */
  groupFallback: { routeGroup?: string } | null;
  /** How many members the route has in total (all groups). */
  totalMemberCount: number;
  /* The member list. */
  list: RouteMemberListProps;
};

export function RouteDetailPanel(props: RouteDetailPanelProps) {
  const {
    t,
    route,
    showAdvanced,
    setShowAdvanced,
    openAddMember,
    setAutoMatchRoute,
    bulkSelect,
    setBulkSelect,
    selectedMemberIds,
    setSelectedMemberIds,
    bulkToggleMembers,
    selectAllMembers,
    clearMemberSelection,
    groupNames,
    activeGroup,
    setActiveGroup,
    groupCounts,
    groupDraft,
    setGroupDraft,
    submitGroupDraft,
    groupEditorBlur,
    setRemoveGroup,
    groupFallback,
    list,
  } = props;

  const availability = useAvailability({ routeIds: [route.id!], group: activeGroup });
  return (
    <>
      <RouteDetailHeader
        {...props.header}
        scopeLabel={t("availability.scope", { group: formatGroupName(activeGroup, t) })}
        availability={
          <AvailabilityIndicator
            item={availability.data?.routes.find((item) => item.route_id === route.id)}
            loading={availability.isPending}
            error={availability.isError}
          />
        }
      />

      {props.singleModeActive && route ? (
        <div className="single-mode-banner">
          <Target size={15} />
          <div className="single-mode-banner-body">
            <strong>
              {t("routing.singleModeBanner", {
                name: props.singleModePinned
                  ? props.singleModePinned.channel.name
                  : t("routing.singleModeMissingName"),
              })}
            </strong>
            <small>
              {props.singleModePinned
                ? t(
                    props.pinOutsideGroup
                      ? "routing.singleModeGroupMissing"
                      : "routing.singleModeHint",
                  )
                : t("routing.singleModeMissing")}
              {props.singleModePinned &&
              !props.pinOutsideGroup &&
              !props.singleModePinned.member.enabled
                ? ` ${t("routing.singleModeDisabledWarning")}`
                : ""}
            </small>
          </div>
          <Button variant="secondary" disabled={props.pinPending} onClick={props.onClearPin}>
            {t("routing.singleModeRestore")}
          </Button>
        </div>
      ) : null}

      <div className="member-section-heading">
        <HeroButton
          variant="ghost"
          type="button"
          aria-expanded={showAdvanced}
          onPress={() => setShowAdvanced((value) => !value)}
        >
          {t("modelsPage.members")}
          <ChevronDown
            size={14}
            className={showAdvanced ? "chevron-flip is-open" : "chevron-flip"}
          />
        </HeroButton>
        <InfoTip
          label={`${t("modelsPage.routingHint")} ${t("routing.reorderHint")} ${t("routing.groupTabsHint")}`}
        />
      </div>
      {showAdvanced ? (
        <section className="models-advanced">
          {bulkSelect && list.members.length > 0 ? (
            <div className="routing-bulk-bar">
              <span className="routing-bulk-count">
                {t("routing.bulkSelected", { count: selectedMemberIds.size })}
              </span>
              <Button
                variant="primary"
                icon={<Check size={14} />}
                disabled={selectedMemberIds.size === 0}
                onClick={() => bulkToggleMembers.mutate({ enabled: true })}
              >
                {t("routing.bulkEnable")}
              </Button>
              <Button
                variant="secondary"
                icon={<X size={14} />}
                disabled={selectedMemberIds.size === 0}
                onClick={() => bulkToggleMembers.mutate({ enabled: false })}
              >
                {t("routing.bulkDisable")}
              </Button>
              <Button
                variant="secondary"
                icon={<ListChecks size={14} />}
                onClick={selectAllMembers}
              >
                {t("routing.bulkSelectAll")}
              </Button>
              <Button variant="quiet" onClick={clearMemberSelection}>
                {t("routing.bulkClear")}
              </Button>
            </div>
          ) : null}
          {list.reorderMembers.isPending ? (
            <div className="routing-reorder-hint">
              <span>{t("routing.savingOrder")}</span>
            </div>
          ) : null}
          {/* One toolbar for the routing list: the group you are looking at on
              the left, what you can do to it on the right. Two separate rows
              spent a whole line on air before the first member appeared. */}
          <div className="member-group-toolbar">
            <div className="member-group-tabs">
              <div
                className="member-group-tablist"
                role="tablist"
                aria-label={t("routing.memberGroupLabel")}
              >
                {groupNames.map((name) => {
                  const active = name === activeGroup;
                  const count = groupCounts.get(name) ?? 0;
                  return (
                    <div key={name} className={`member-group-tab${active ? " is-active" : ""}`}>
                      <HeroButton
                        variant="ghost"
                        type="button"
                        aria-selected={active}
                        ref={(element) => {
                          if (!element) return;
                          element.setAttribute("role", "tab");
                          const title = count === 0 ? t("routing.groupEmptyHint") : "";
                          if (title) element.setAttribute("title", title);
                          else element.removeAttribute("title");
                        }}
                        onPress={() => setActiveGroup(name)}
                      >
                        <span className="member-group-tab-main">
                          {formatGroupName(name, t)}
                          <span className="member-group-count">{count}</span>
                        </span>
                      </HeroButton>
                      {name !== "default" ? (
                        <ActionMenu
                          compact
                          label={t("common.moreActions")}
                          items={[
                            {
                              key: "rename",
                              icon: <Pencil size={14} />,
                              label: t("routing.groupRename"),
                              onSelect: () =>
                                setGroupDraft({ mode: "rename", from: name, value: name }),
                            },
                            {
                              key: "delete",
                              icon: <Trash2 size={14} />,
                              label: t("routing.groupDelete"),
                              danger: true,
                              onSelect: () => setRemoveGroup(name),
                            },
                          ]}
                        />
                      ) : null}
                    </div>
                  );
                })}
                {groupDraft ? (
                  <HeroInput
                    className="member-group-input"
                    autoFocus
                    value={groupDraft.value}
                    maxLength={64}
                    placeholder={
                      groupDraft.mode === "new"
                        ? t("routing.groupNewPlaceholder")
                        : t("routing.groupRenamePlaceholder")
                    }
                    onChange={(event) =>
                      setGroupDraft({ ...groupDraft, value: event.target.value })
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") submitGroupDraft();
                      if (event.key === "Escape") setGroupDraft(null);
                    }}
                    onBlur={groupEditorBlur}
                  />
                ) : (
                  <HeroButton
                    variant="ghost"
                    type="button"
                    className="member-group-add"
                    onPress={() => setGroupDraft({ mode: "new", value: "" })}
                  >
                    <Plus size={12} />
                    {t("routing.groupNew")}
                  </HeroButton>
                )}
              </div>
              {groupDraft?.mode === "new" ? (
                <HeroCheckbox
                  className="member-group-copy"
                  isSelected={groupDraft.copyDefault ?? false}
                  onChange={(event) => setGroupDraft({ ...groupDraft, copyDefault: event })}
                  onBlur={groupEditorBlur}
                >
                  <HeroCheckbox.Content>
                    <HeroCheckbox.Control>
                      <HeroCheckbox.Indicator />
                    </HeroCheckbox.Control>
                    {t("routing.groupCopyDefault")}
                  </HeroCheckbox.Content>
                </HeroCheckbox>
              ) : null}
            </div>
            <span className="bar-spacer" />
            <Button variant="secondary" icon={<Plus size={14} />} onClick={openAddMember}>
              {t("routing.addMember")}
            </Button>
            {/* The bulk of what "add member" does over and over: one click attaches
                every enabled channel that really serves this model to the group
                being viewed. */}
            <Button
              variant="secondary"
              icon={<Wand2 size={14} />}
              title={t("modelsPage.autoMatchAddHint")}
              onClick={() => setAutoMatchRoute(route)}
            >
              {t("modelsPage.autoMatchAdd")}
            </Button>
            <Button
              variant={bulkSelect ? "primary" : "secondary"}
              onClick={() => {
                setBulkSelect((value) => !value);
                setSelectedMemberIds(new Set());
              }}
            >
              {t("routing.bulkSelect")}
            </Button>
          </div>
          {groupFallback ? (
            <p className="member-group-hint" role="status">
              {groupFallback.routeGroup
                ? t("routing.groupFallback", {
                    name: formatGroupName(activeGroup, t),
                    target: formatGroupName(groupFallback.routeGroup, t),
                  })
                : t("routing.groupFallbackAll", { name: formatGroupName(activeGroup, t) })}
            </p>
          ) : null}
          {props.totalMemberCount === 0 ? (
            <Empty>{t("routing.noMembers")}</Empty>
          ) : list.members.length === 0 ? (
            <div className="routing-group-empty">
              <span>
                {t("routing.groupEmpty", {
                  name: formatGroupName(activeGroup, t),
                })}
              </span>
              <Button variant="secondary" icon={<Plus size={14} />} onClick={openAddMember}>
                {t("routing.addMember")}
              </Button>
            </div>
          ) : (
            <RouteMemberList {...list} />
          )}
        </section>
      ) : null}

      <RoutePolicyCard {...props.policy} />
    </>
  );
}

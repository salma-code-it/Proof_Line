import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import { getProject, getTimeline } from "../api";
import {
  ArrowLeft,
  Filter,
  GitBranch,
  GitCommit,
  GitPullRequest,
  MessageSquare,
  AlertCircle,
  Activity,
  CheckCircle,
  ChevronDown,
  X,
  ExternalLink,
  CalendarDays,
  Users,
  MousePointerClick,
  FileCode2,
} from "lucide-react";

const EVENT_TYPES = [
  "All",
  "Commit",
  "Pull Request",
  "Review",
  "Comment",
  "Issue",
  "CI/CD",
  "Branch",
];

const EVENT_COLORS = {
  Commit: "#0a8f6c",
  "Pull Request": "#12203a",
  Review: "#64748b",
  Comment: "#b77a34",
  Issue: "#dc6868",
  "CI/CD": "#64748b",
  Branch: "#8a95a6",
  Activity: "#8a95a6",
};

export default function Timeline() {
  const { projectId } = useParams();
  const navigate = useNavigate();

  const [project, setProject] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const [events, setEvents] = useState([]);
  const [memberFilter, setMemberFilter] = useState("All");
  const [typeFilter, setTypeFilter] = useState("All");
  const [limit, setLimit] = useState(200);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const [projectData, timelineData] = await Promise.all([
          getProject(projectId),
          getTimeline(projectId, limit),
        ]);

        if (!active) return;

        setProject(projectData);
        setTimeline(
          timelineData && !Array.isArray(timelineData) ? timelineData : null
        );
        setEvents(normalizeTimeline(timelineData));
      } catch (err) {
        if (active) {
          setError(err.message || "Failed to load timeline.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    load();

    return () => {
      active = false;
    };
  }, [projectId, limit]);

  const members = useMemo(() => {
    const names = new Set();

    events.forEach((event) => {
      const member = getMember(event);
      if (member !== "Unknown member") names.add(member);
    });

    return [...names].sort((a, b) => a.localeCompare(b));
  }, [events]);

  const filtered = useMemo(() => {
    return events.filter((event) => {
      const memberOk =
        memberFilter === "All" || getMember(event) === memberFilter;

      const typeOk =
        typeFilter === "All" || normalizeType(event) === typeFilter;

      return memberOk && typeOk;
    });
  }, [events, memberFilter, typeFilter]);

  // Counts align with the project dashboard:
  // - Commits = unique SHAs (COMMIT + PR_COMMIT), not every row
  // - PRs     = unique PR numbers (one PR is one unit, not create+merge)
  // - Events  = backend summary when unfiltered, else filtered rows
  const eventCounts = useMemo(() => {
    const commitShas = new Set();
    let commitNoSha = 0;
    const prNumbers = new Set();
    let reviews = 0;

    filtered.forEach((event) => {
      const raw = getRawType(event);

      if (raw === "COMMIT" || raw === "PR_COMMIT") {
        const sha = getEventSha(event);
        if (sha) commitShas.add(sha);
        else commitNoSha += 1;
      }

      if (raw === "PR_CREATED" || raw === "PR_MERGED" || raw === "PR_COMMIT") {
        const n = getPrNumber(event);
        if (n != null) prNumbers.add(n);
      }

      if (raw === "REVIEW" || raw === "REVIEW_COMMENT") {
        reviews += 1;
      }
    });

    const noFilters = memberFilter === "All" && typeFilter === "All";
    const summaryTotal = timeline?.summary?.total_activity_events;
    const backendPrCount =
      noFilters && Array.isArray(timeline?.pull_request_timelines)
        ? timeline.pull_request_timelines.length
        : null;

    return {
      total:
        noFilters && typeof summaryTotal === "number"
          ? summaryTotal
          : filtered.length,
      members: new Set(
        filtered
          .map(getMember)
          .filter((name) => name !== "Unknown member")
      ).size,
      commits: commitShas.size + commitNoSha,
      pullRequests:
        backendPrCount != null ? backendPrCount : prNumbers.size,
      reviews,
    };
  }, [filtered, memberFilter, typeFilter, timeline]);

  if (loading) {
    return (
      <PageShell projectId={projectId}>
        <div className="flex min-h-screen items-center justify-center text-sm text-[#5b6678]">
          Loading evidence timeline...
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell projectId={projectId}>
      <header className="border-b border-[#cdd5df] bg-white">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between gap-5 px-5 sm:px-8">
          <div className="flex min-w-0 items-center gap-4">
            <button
              type="button"
              onClick={() => navigate(`/project/${projectId}`)}
              className="shrink-0 text-[#5b6678] transition hover:text-[#12203a]"
              aria-label="Back to project"
            >
              <ArrowLeft size={20} />
            </button>

            <div className="min-w-0">
              <h1 className="text-xl font-bold text-[#12203a]">
                Project Timeline
              </h1>
              <p className="mt-1 truncate text-sm text-[#5b6678]">
                {project?.name || "Project"} · observable GitHub activity
              </p>
            </div>
          </div>

          <select
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value))}
            className="shrink-0 rounded-md border border-[#cdd5df] bg-white px-3 py-2 text-xs text-[#5b6678] outline-none focus:border-[#0a8f6c]"
            aria-label="Number of events to load"
          >
            <option value={50}>Last 50 events</option>
            <option value={100}>Last 100 events</option>
            <option value={200}>Last 200 events</option>
            <option value={500}>Last 500 events</option>
          </select>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-5 py-8 sm:px-8">
        {error && <ErrorBox message={error} />}

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryMetric
            icon={Activity}
            label="Observable events"
            value={eventCounts.total}
            description="Activity events (after de-duplication)"
          />
          <SummaryMetric
            icon={Users}
            label="Active contributors"
            value={eventCounts.members}
            description="Members represented in this view"
          />
          <SummaryMetric
            icon={GitCommit}
            label="Commits"
            value={eventCounts.commits}
            description="Unique commits (SHA de-duplicated)"
          />
          <SummaryMetric
            icon={GitPullRequest}
            label="Pull requests"
            value={eventCounts.pullRequests}
            description="Unique pull requests (one PR = one unit)"
          />
        </section>

        <section className="rounded-xl border border-[#cdd5df] bg-white p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="mr-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#5b6678]">
              <Filter size={14} />
              Filters
            </div>

            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              className="rounded-md border border-[#cdd5df] bg-white px-3 py-2 text-xs text-[#5b6678] outline-none focus:border-[#0a8f6c]"
              aria-label="Filter by event type"
            >
              {EVENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type === "All" ? "All event types" : type}
                </option>
              ))}
            </select>

            <select
              value={memberFilter}
              onChange={(event) => setMemberFilter(event.target.value)}
              className="rounded-md border border-[#cdd5df] bg-white px-3 py-2 text-xs text-[#5b6678] outline-none focus:border-[#0a8f6c]"
              aria-label="Filter by contributor"
            >
              <option value="All">All contributors</option>
              {members.map((member) => (
                <option key={member} value={member}>
                  {member}
                </option>
              ))}
            </select>

            {(memberFilter !== "All" || typeFilter !== "All") && (
              <button
                type="button"
                onClick={() => {
                  setMemberFilter("All");
                  setTypeFilter("All");
                }}
                className="inline-flex items-center gap-1 rounded-md px-3 py-2 text-xs font-medium text-[#0a8f6c] hover:bg-[#0a8f6c]/10"
              >
                <X size={13} />
                Clear filters
              </button>
            )}
          </div>

          <p className="text-xs leading-5 text-[#8a95a6]">
            Filters apply to the graph and summary metrics below. Choose a
            contributor or event type to focus on specific activity.
          </p>
        </section>

        {!filtered.length ? (
          <div className="rounded-xl border border-dashed border-[#cdd5df] bg-white p-12 text-center">
            <Activity className="mx-auto mb-3 text-[#8a95a6]" size={25} />
            <h2 className="text-sm font-semibold text-[#12203a]">
              No matching activity
            </h2>
            <p className="mt-1 text-sm text-[#8a95a6]">
              Try another contributor or event type.
            </p>
          </div>
        ) : (
          <MemberTimeComparison events={filtered} />
        )}
      </main>
    </PageShell>
  );
}

/* =========================================================
   INTERACTIVE MEMBER TIMELINE
   One horizontal row per member. Each marker is evidence.
========================================================= */

function MemberTimeComparison({ events = [] }) {
  const [hiddenMembers, setHiddenMembers] = useState([]);
  const [typeVisibility, setTypeVisibility] = useState({
    Commit: true,
    "Pull Request": true,
    Review: true,
    Comment: true,
    Other: true,
  });
  const [selected, setSelected] = useState(null);

  const normalized = useMemo(() => {
    return events
      .map((event, index) => {
        const rawDate =
          event.timestamp ||
          event.created_at ||
          event.date ||
          event.time;

        const timestamp = rawDate ? new Date(rawDate).getTime() : NaN;

        return {
          ...event,
          _timestamp: timestamp,
          _key: String(
            event.id ??
              event.source_id ??
              `${timestamp}-${event.type || event.event_type}-${index}`
          ),
        };
      })
      .filter((event) => Number.isFinite(event._timestamp))
      .sort((a, b) => a._timestamp - b._timestamp);
  }, [events]);

  const members = useMemo(() => {
    return [...new Set(normalized.map(getMember))]
      .filter((member) => member !== "Unknown member")
      .sort((a, b) => a.localeCompare(b));
  }, [normalized]);

  const visibleMembers = members.filter(
    (member) => !hiddenMembers.includes(member)
  );

  const plottedEvents = normalized.filter((event) => {
    if (!visibleMembers.includes(getMember(event))) return false;

    const type = normalizeType(event);
    const category = [
      "Commit",
      "Pull Request",
      "Review",
      "Comment",
    ].includes(type)
      ? type
      : "Other";

    return typeVisibility[category];
  });

  useEffect(() => {
    if (
      selected &&
      !plottedEvents.some((event) => event._key === selected._key)
    ) {
      setSelected(null);
    }
  }, [selected, plottedEvents]);

  const minTime = normalized.length
    ? normalized[0]._timestamp
    : 0;

  const maxTime = normalized.length
    ? normalized[normalized.length - 1]._timestamp
    : 0;

  const duration = Math.max(maxTime - minTime, 1);
  const chartWidth = 1000;
  const left = 190;
  const right = 35;
  const plotWidth = chartWidth - left - right;
  const rowHeight = 64;
  const top = 52;
  const height = Math.max(
    top + visibleMembers.length * rowHeight + 25,
    145
  );

  const xPosition = (timestamp) =>
    left + ((timestamp - minTime) / duration) * plotWidth;

  const dateTicks = Array.from({ length: 5 }, (_, index) => {
    const timestamp = minTime + (duration * index) / 4;

    return {
      timestamp,
      x: left + (plotWidth * index) / 4,
      label: new Date(timestamp).toLocaleDateString([], {
        month: "short",
        day: "numeric",
        year:
          new Date(minTime).getFullYear() !==
          new Date(maxTime).getFullYear()
            ? "2-digit"
            : undefined,
      }),
    };
  });

  const selectedFiles = selected ? getFiles(selected) : [];

  if (!normalized.length) {
    return (
      <EmptyState message="No timestamped activity is available to plot." />
    );
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-xl border border-[#cdd5df] bg-white">
        <div className="border-b border-[#cdd5df] p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#0a8f6c]">
                <CalendarDays size={14} />
                Evidence over time
              </div>
              <h2 className="text-lg font-bold text-[#12203a]">
                Member contribution comparison
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-[#5b6678]">
                Each row represents one contributor. Marker positions show
                when their recorded GitHub activity happened. Select a
                marker to inspect its available evidence.
              </p>
            </div>

            <div className="rounded-lg bg-[#f1f3f5] px-3 py-2">
              <p className="text-xs text-[#5b6678]">Visible evidence</p>
              <p className="mt-1 text-lg font-bold text-[#12203a]">
                {plottedEvents.length}
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-3">
            {Object.entries(typeVisibility).map(([type, visible]) => (
              <label
                key={type}
                className="flex cursor-pointer items-center gap-2 text-xs text-[#5b6678]"
              >
                <input
                  type="checkbox"
                  checked={visible}
                  onChange={(event) =>
                    setTypeVisibility((current) => ({
                      ...current,
                      [type]: event.target.checked,
                    }))
                  }
                  className="accent-[#0a8f6c]"
                />
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{
                    backgroundColor:
                      type === "Other"
                        ? EVENT_COLORS.Activity
                        : EVENT_COLORS[type],
                  }}
                />
                {type}
              </label>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto px-3 py-5 sm:px-5">
          <svg
            viewBox={`0 0 ${chartWidth} ${height}`}
            className="w-full min-w-[700px]"
            role="img"
            aria-label="Interactive timeline comparing GitHub events for each member"
          >
            {dateTicks.map((tick) => (
              <g key={tick.timestamp}>
                <line
                  x1={tick.x}
                  x2={tick.x}
                  y1={top - 20}
                  y2={height - 12}
                  stroke="#cdd5df"
                  strokeDasharray="4 5"
                />
                <text
                  x={tick.x}
                  y={20}
                  fill="#5b6678"
                  fontSize="11"
                  textAnchor="middle"
                >
                  {tick.label}
                </text>
              </g>
            ))}

            {visibleMembers.map((member, rowIndex) => {
              const y = top + rowIndex * rowHeight + 20;
              const memberEvents = plottedEvents.filter(
                (event) => getMember(event) === member
              );

              return (
                <g key={member}>
                  <text
                    x={left - 14}
                    y={y + 4}
                    fill="#12203a"
                    fontSize="12"
                    fontWeight="600"
                    textAnchor="end"
                  >
                    {member.length > 24
                      ? `${member.slice(0, 23)}…`
                      : member}
                  </text>

                  <line
                    x1={left}
                    x2={chartWidth - right}
                    y1={y}
                    y2={y}
                    stroke="#e5e9ef"
                    strokeWidth="2"
                  />

                  {memberEvents.map((event) => {
                    const x = xPosition(event._timestamp);
                    const type = normalizeType(event);
                    const color = EVENT_COLORS[type] || EVENT_COLORS.Activity;
                    const active = selected?._key === event._key;

                    return (
                      <g
                        key={event._key}
                        onClick={() => setSelected(event)}
                        onKeyDown={(keyboardEvent) => {
                          if (
                            keyboardEvent.key === "Enter" ||
                            keyboardEvent.key === " "
                          ) {
                            keyboardEvent.preventDefault();
                            setSelected(event);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        aria-label={`${member}, ${type}, ${formatDate(
                          event._timestamp
                        )}`}
                        className="cursor-pointer"
                      >
                        <circle
                          cx={x}
                          cy={y}
                          r={active ? 11 : 8}
                          fill={color}
                          opacity={active ? 0.16 : 0.1}
                        />

                        {type === "Pull Request" ? (
                          <rect
                            x={x - (active ? 6 : 4)}
                            y={y - (active ? 6 : 4)}
                            width={active ? 12 : 8}
                            height={active ? 12 : 8}
                            rx="1.5"
                            fill={color}
                            stroke={active ? "#b77a34" : "white"}
                            strokeWidth={active ? 2.5 : 1.5}
                          />
                        ) : type === "Review" || type === "Comment" ? (
                          <path
                            d={`M ${x} ${y - (active ? 7 : 5)} L ${
                              x + (active ? 7 : 5)
                            } ${y} L ${x} ${
                              y + (active ? 7 : 5)
                            } L ${x - (active ? 7 : 5)} ${y} Z`}
                            fill={color}
                            stroke={active ? "#b77a34" : "white"}
                            strokeWidth={active ? 2.5 : 1.5}
                          />
                        ) : (
                          <circle
                            cx={x}
                            cy={y}
                            r={active ? 6 : 4}
                            fill={color}
                            stroke={active ? "#b77a34" : "white"}
                            strokeWidth={active ? 2.5 : 1.5}
                          />
                        )}

                        <title>
                          {member} · {type} · {formatDate(event._timestamp)}
                        </title>
                      </g>
                    );
                  })}
                </g>
              );
            })}

            {visibleMembers.length === 0 && (
              <text
                x={chartWidth / 2}
                y={height / 2}
                textAnchor="middle"
                fill="#8a95a6"
                fontSize="13"
              >
                Show a contributor to display their activity.
              </text>
            )}
          </svg>
        </div>

        <div className="border-t border-[#cdd5df] bg-[#f1f3f5]/50 px-5 py-4">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[#5b6678]">
            <LegendItem color={EVENT_COLORS.Commit} label="Commit" />
            <LegendItem
              color={EVENT_COLORS["Pull Request"]}
              label="Pull request (square)"
              shape="square"
            />
            <LegendItem
              color={EVENT_COLORS.Review}
              label="Review (diamond)"
              shape="diamond"
            />
            <LegendItem
              color={EVENT_COLORS.Comment}
              label="Comment (diamond)"
              shape="diamond"
            />
            <LegendItem color={EVENT_COLORS.Issue} label="Issue" />
          </div>
        </div>

        <div className="border-t border-[#cdd5df] p-5 sm:p-6">
          <div className="mb-3 flex items-center gap-2">
            <Users size={15} className="text-[#5b6678]" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#5b6678]">
              Compare contributors
            </h3>
          </div>

          <div className="flex flex-wrap gap-2">
            {members.map((member) => {
              const hidden = hiddenMembers.includes(member);

              return (
                <button
                  type="button"
                  key={member}
                  onClick={() => {
                    setHiddenMembers((current) =>
                      hidden
                        ? current.filter((name) => name !== member)
                        : [...current, member]
                    );
                  }}
                  className={`rounded-md border px-3 py-2 text-xs transition ${
                    hidden
                      ? "border-[#cdd5df] bg-white text-[#8a95a6]"
                      : "border-[#0a8f6c]/30 bg-[#0a8f6c]/10 text-[#0a8f6c]"
                  }`}
                >
                  {hidden ? "Show" : "Hide"} {member}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {selected && (
        <EvidenceDetails
          event={selected}
          files={selectedFiles}
          onClose={() => setSelected(null)}
        />
      )}

      <section className="rounded-lg border border-[#cdd5df] bg-white px-4 py-3">
        <div className="flex items-start gap-2">
          <MousePointerClick
            size={16}
            className="mt-0.5 shrink-0 text-[#0a8f6c]"
          />
          <p className="text-xs leading-5 text-[#5b6678]">
            <strong className="text-[#12203a]">How to read this graph:</strong>{" "}
            rows compare contributors, horizontal position represents time,
            and each marker represents a recorded event. The number of markers
            shows recorded activity, not the quality, difficulty, or ownership
            of a member's entire contribution.
          </p>
        </div>
      </section>
    </div>
  );
}

/* =========================================================
   SELECTED EVENT EVIDENCE
========================================================= */

function EvidenceDetails({ event, files, onClose }) {
  const type = normalizeType(event);
  const title =
    event.title ||
    event.message ||
    event.commit_message ||
    event.artifact ||
    event.metadata?.title ||
    "GitHub activity";

  const additions = firstDefined(
    event.additions,
    event.metadata?.additions
  );
  const deletions = firstDefined(
    event.deletions,
    event.metadata?.deletions
  );
  const changedFileCount = firstDefined(
    event.changed_files_count,
    event.files_count,
    event.metadata?.changed_files_count,
    files.length || undefined
  );
  const sha = firstDefined(
    event.sha,
    event.commit_sha,
    event.metadata?.sha
  );
  const branch = firstDefined(event.branch, event.metadata?.branch);
  const prNumber = firstDefined(
    event.number,
    event.pr_number,
    event.pull_number,
    event.metadata?.pr_number
  );
  const htmlUrl = firstDefined(
    event.html_url,
    event.url,
    event.metadata?.html_url,
    event.metadata?.url
  );

  return (
    <section className="overflow-hidden rounded-xl border border-[#cdd5df] bg-white">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#cdd5df] p-5 sm:p-6">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-[#0a8f6c]">
            Selected evidence
          </p>
          <h2 className="mt-1 text-lg font-bold text-[#12203a]">
            {type}
          </h2>
          <p className="mt-1 text-sm text-[#5b6678]">
            {getMember(event)} · {formatDate(event._timestamp)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {htmlUrl && (
            <a
              href={htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-[#cdd5df] px-3 py-2 text-xs font-medium text-[#12203a] hover:bg-[#f1f3f5]"
            >
              Open on GitHub
              <ExternalLink size={13} />
            </a>
          )}

          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[#cdd5df] p-2 text-[#5b6678] hover:bg-[#f1f3f5]"
            aria-label="Close evidence details"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="space-y-5 p-5 sm:p-6">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-[#5b6678]">
            Event description
          </p>
          <p className="break-words text-sm font-semibold leading-6 text-[#12203a]">
            {title}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <EvidenceMetric label="Files changed" value={changedFileCount ?? "—"} />
          <EvidenceMetric
            label="Additions"
            value={additions == null ? "—" : `+${additions}`}
            accent="green"
          />
          <EvidenceMetric
            label="Deletions"
            value={deletions == null ? "—" : `-${deletions}`}
            accent="red"
          />
          <EvidenceMetric
            label="Pull request"
            value={prNumber == null ? "—" : `#${prNumber}`}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <EvidenceTextRow label="SHA" value={sha} />
          <EvidenceTextRow label="Branch" value={branch} />
          <EvidenceTextRow
            label="Source"
            value={event.source || "GitHub"}
          />
          <EvidenceTextRow
            label="Event type"
            value={event.event_type || event.type}
          />
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-[#12203a]">
              <FileCode2 size={16} className="text-[#0a8f6c]" />
              File-level evidence
            </h3>
            <span className="text-xs text-[#8a95a6]">
              {files.length} file{files.length === 1 ? "" : "s"} available
            </span>
          </div>

          {files.length ? (
            <div className="overflow-hidden rounded-lg border border-[#cdd5df]">
              {files.slice(0, 5).map((file, index) => {
                const filename =
                  typeof file === "string"
                    ? file
                    : file?.filename ||
                      file?.path ||
                      file?.name ||
                      "Unknown file";

                const fileAdditions =
                  typeof file === "object" ? file.additions : undefined;
                const fileDeletions =
                  typeof file === "object" ? file.deletions : undefined;
                const fileStatus =
                  typeof file === "object" ? file.status : undefined;

                return (
                  <div
                    key={`${filename}-${index}`}
                    className="flex flex-wrap items-center justify-between gap-3 border-b border-[#cdd5df] px-3 py-3 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="break-all font-mono text-xs text-[#12203a]">
                        {filename}
                      </p>
                      {fileStatus && (
                        <p className="mt-1 text-[10px] uppercase tracking-wider text-[#8a95a6]">
                          {fileStatus}
                        </p>
                      )}
                    </div>

                    {fileAdditions != null || fileDeletions != null ? (
                      <div className="flex shrink-0 gap-2 font-mono text-xs">
                        <span className="text-[#0a8f6c]">
                          +{fileAdditions ?? 0}
                        </span>
                        <span className="text-[#b45353]">
                          -{fileDeletions ?? 0}
                        </span>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-[#cdd5df] bg-[#f1f3f5]/60 p-5 text-sm text-[#8a95a6]">
              File-level evidence was not included in this event's API
              response. This does not mean that no files changed.
            </div>
          )}

          {files.length > 5 && (
            <p className="mt-2 text-xs text-[#8a95a6]">
              Showing 5 of {files.length} files. Open the original GitHub
              evidence for the complete file list.
            </p>
          )}
        </div>

        {event.metadata && (
          <details className="rounded-lg border border-[#cdd5df]">
            <summary className="cursor-pointer px-4 py-3 text-xs font-semibold text-[#5b6678]">
              Inspect raw event metadata
            </summary>
            <pre className="max-h-72 overflow-auto border-t border-[#cdd5df] bg-[#f1f3f5] p-4 text-[10px] leading-5 text-[#5b6678]">
              {JSON.stringify(event.metadata, null, 2)}
            </pre>
          </details>
        )}

        <p className="text-xs leading-5 text-[#8a95a6]">
          Missing counts or file details are shown as unavailable, not as
          zero. This view describes observable GitHub evidence and should
          not be treated as a standalone measure of contribution quality.
        </p>
      </div>
    </section>
  );
}

/* =========================================================
   SMALL REUSABLE UI COMPONENTS
========================================================= */

function SummaryMetric({ icon: Icon, label, value, description }) {
  return (
    <div className="rounded-xl border border-[#cdd5df] bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-[#5b6678]">{label}</p>
        <Icon size={16} className="shrink-0 text-[#0a8f6c]" />
      </div>
      <p className="mt-3 text-2xl font-bold text-[#12203a]">{value}</p>
      <p className="mt-1 text-xs leading-5 text-[#8a95a6]">
        {description}
      </p>
    </div>
  );
}

function EvidenceMetric({ label, value, accent }) {
  const valueColor =
    accent === "green"
      ? "text-[#0a8f6c]"
      : accent === "red"
      ? "text-[#b45353]"
      : "text-[#12203a]";

  return (
    <div className="rounded-lg bg-[#f1f3f5] p-3">
      <p className="text-xs text-[#5b6678]">{label}</p>
      <p className={`mt-1 break-words text-lg font-semibold ${valueColor}`}>
        {value}
      </p>
    </div>
  );
}

function EvidenceTextRow({ label, value }) {
  if (value === undefined || value === null || value === "") return null;

  return (
    <div className="min-w-0 rounded-lg border border-[#cdd5df] p-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-[#8a95a6]">
        {label}
      </p>
      <p className="mt-1 break-all font-mono text-xs text-[#12203a]">
        {String(value)}
      </p>
    </div>
  );
}

function LegendItem({ color, label, shape = "circle" }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={`inline-block h-2.5 w-2.5 ${
          shape === "square"
            ? "rounded-[1px]"
            : shape === "diamond"
            ? "rotate-45 rounded-[1px]"
            : "rounded-full"
        }`}
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

function EmptyState({ message }) {
  return (
    <div className="rounded-xl border border-dashed border-[#cdd5df] bg-white p-12 text-center text-sm text-[#8a95a6]">
      {message}
    </div>
  );
}

function ErrorBox({ message }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      {message}
    </div>
  );
}

function PageShell({ projectId, children }) {
  return (
    <div className="flex min-h-screen bg-[#f1f3f5]">
      <Sidebar projectId={projectId} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/* =========================================================
   EVENT NORMALIZATION
========================================================= */

function normalizeTimeline(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.events)) return data.events;
  if (Array.isArray(data?.timeline)) return data.timeline;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

function getMember(event) {
  return (
    event.github_username ||
    event.username ||
    event.member_name ||
    event.author ||
    event.actor ||
    event.metadata?.github_username ||
    event.metadata?.author ||
    "Unknown member"
  );
}

function getRawType(event) {
  return String(
    event.event_type ||
      event.type ||
      event.metadata?.event_type ||
      "Activity"
  )
    .trim()
    .toUpperCase();
}

function getEventSha(event) {
  const sha =
    event.sha ||
    event.metadata?.sha ||
    event.metadata_json?.sha ||
    null;
  return typeof sha === "string" && sha.length > 0 ? sha : null;
}

function getPrNumber(event) {
  const raw =
    event.pr_number ??
    event.pr ??
    event.metadata?.pr_number ??
    event.metadata?.number ??
    event.metadata_json?.pr_number ??
    event.metadata_json?.number ??
    null;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function normalizeType(event) {
  const raw = getRawType(event);

  // Exact types first so PR_COMMIT is a Commit, not a Pull Request.
  if (raw === "COMMIT" || raw === "PR_COMMIT") return "Commit";
  if (raw === "PR_CREATED" || raw === "PR_MERGED") return "Pull Request";
  if (raw === "REVIEW" || raw === "REVIEW_COMMENT") {
    return raw === "REVIEW_COMMENT" ? "Comment" : "Review";
  }
  if (raw === "ISSUE_CREATED" || raw === "ISSUE_COMMENT") {
    return raw === "ISSUE_COMMENT" ? "Comment" : "Issue";
  }
  if (raw === "CI_RUN") return "CI/CD";
  if (raw === "BRANCH_CREATED") return "Branch";

  // Fallbacks for unexpected strings
  if (raw.includes("COMMIT")) return "Commit";
  if (raw.includes("PR_") || raw.includes("PULL")) return "Pull Request";
  if (raw.includes("REVIEW")) return "Review";
  if (raw.includes("COMMENT")) return "Comment";
  if (raw.includes("ISSUE")) return "Issue";
  if (raw.includes("CI") || raw.includes("WORKFLOW")) return "CI/CD";
  if (raw.includes("BRANCH")) return "Branch";

  return "Activity";
}

function getFiles(event) {
  const metadata = event.metadata || event.metadata_json || {};

  const files =
    event.files ||
    event.changed_files ||
    metadata.files ||
    metadata.changed_files ||
    metadata.file_changes ||
    [];

  if (Array.isArray(files)) return files;

  if (files && typeof files === "object") {
    return Object.entries(files).map(([filename, details]) => {
      if (details && typeof details === "object") {
        return { filename, ...details };
      }
      return filename;
    });
  }

  return [];
}

function firstDefined(...values) {
  return values.find(
    (value) => value !== undefined && value !== null && value !== ""
  );
}

function formatDate(value) {
  if (value === undefined || value === null || value === "") {
    return "Unknown time";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "Unknown time";

  return date.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
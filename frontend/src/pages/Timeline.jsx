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

export default function Timeline() {
  const { projectId } = useParams();
  const navigate = useNavigate();

  const [project, setProject] = useState(null);
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
    const values = new Set();

    events.forEach((event) => {
      const member = getMember(event);
      if (member !== "Unknown member") values.add(member);
    });

    return [...values].sort();
  }, [events]);

  const filtered = useMemo(() => {
    return events.filter((event) => {
      const memberOk =
        memberFilter === "All" ||
        getMember(event) === memberFilter;

      const typeOk =
        typeFilter === "All" ||
        normalizeType(event) === typeFilter;

      return memberOk && typeOk;
    });
  }, [events, memberFilter, typeFilter]);

  const grouped = useMemo(() => {
    const groups = new Map();

    filtered.forEach((event) => {
      const value =
        event.timestamp ||
        event.created_at ||
        event.date ||
        event.time;

      const date = value ? new Date(value) : null;

      const key =
        date && !Number.isNaN(date.getTime())
          ? date.toLocaleDateString([], {
              year: "numeric",
              month: "long",
              day: "numeric",
            })
          : "Unknown date";

      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(event);
    });

    return [...groups.entries()];
  }, [filtered]);

  if (loading) {
    return (
      <PageShell projectId={projectId}>
        <div className="flex min-h-screen items-center justify-center text-sm text-[#5b6678]">
          Loading evidence trail...
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell projectId={projectId}>
      <header className="bg-white border-b border-[#cdd5df]">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-20 flex items-center justify-between gap-5">
          <div className="flex items-center gap-4">
            <button
              onClick={() =>
                navigate(`/project/${projectId}`)
              }
              className="text-[#5b6678] hover:text-[#12203a]"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-xl font-bold text-[#12203a]">
                Project Timeline
              </h1>
              <p className="text-sm text-[#5b6678] mt-1">
                {project?.name || "Project"} · all observable GitHub activity
              </p>
            </div>
          </div>

          <select
            value={limit}
            onChange={(event) =>
              setLimit(Number(event.target.value))
            }
            className="rounded-md border border-[#cdd5df] bg-white px-3 py-2 text-xs text-[#5b6678] outline-none"
          >
            <option value={50}>Last 50</option>
            <option value={100}>Last 100</option>
            <option value={200}>Last 200</option>
            <option value={500}>Last 500</option>
          </select>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-5 sm:px-8 py-8 space-y-6">
        {error && <ErrorBox message={error} />}

        <section className="bg-white rounded-xl border border-[#cdd5df] p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#5b6678] mr-2">
              <Filter size={14} />
              Filters
            </div>

            <select
              value={typeFilter}
              onChange={(event) =>
                setTypeFilter(event.target.value)
              }
              className="rounded-md border border-[#cdd5df] px-3 py-2 text-xs text-[#5b6678]"
            >
              {EVENT_TYPES.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>

            <select
              value={memberFilter}
              onChange={(event) =>
                setMemberFilter(event.target.value)
              }
              className="rounded-md border border-[#cdd5df] px-3 py-2 text-xs text-[#5b6678]"
            >
              <option>All</option>
              {members.map((member) => (
                <option key={member}>{member}</option>
              ))}
            </select>
          </div>
        </section>

        {!filtered.length ? (
          <div className="rounded-xl border border-dashed border-[#cdd5df] bg-white p-12 text-center text-sm text-[#8a95a6]">
            No events match the selected filters.
          </div>
        ) : (
          grouped.map(([date, dayEvents]) => (
            <section key={date}>
              <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-[#5b6678]">
                {date}
              </h2>

              <div className="space-y-4">
                {dayEvents.map((event, index) => (
                  <TimelineCard
                    key={event.id || `${date}-${index}`}
                    event={event}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </main>
    </PageShell>
  );
}

function TimelineCard({ event }) {
  const [expanded, setExpanded] = useState(false);
  const files =
    event.files ||
    event.changed_files ||
    event.metadata?.files ||
    [];

  const type = normalizeType(event);
  const Icon = iconFor(type);

  return (
    <article className="bg-white rounded-xl border border-[#cdd5df] overflow-hidden">
      <button
        onClick={() => setExpanded((value) => !value)}
        className="w-full p-5 text-left hover:bg-[#f1f3f5]/60"
      >
        <div className="flex items-start justify-between gap-5">
          <div className="flex gap-4 min-w-0">
            <div className="w-9 h-9 shrink-0 rounded-md bg-[#f1f3f5] flex items-center justify-center text-[#0a8f6c]">
              <Icon size={17} />
            </div>

            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#0a8f6c]">
                {type}
              </p>

              <h3 className="mt-1 text-sm font-semibold text-[#12203a]">
                {event.title ||
                  event.message ||
                  event.commit_message ||
                  event.artifact ||
                  "GitHub activity"}
              </h3>

              <p className="mt-1 text-xs text-[#5b6678]">
                {getMember(event)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span className="text-xs text-[#8a95a6]">
              {formatDate(
                event.timestamp || event.created_at
              )}
            </span>
            <ChevronDown
              size={16}
              className={expanded ? "rotate-180" : ""}
            />
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[#cdd5df] p-5 bg-[#f1f3f5]/50 space-y-4">
          <DetailRow
            label="Event type"
            value={event.event_type || event.type}
          />
          <DetailRow
            label="Source"
            value={event.source || "GitHub"}
          />
          <DetailRow
            label="SHA"
            value={event.sha || event.commit_sha}
          />
          <DetailRow
            label="Branch"
            value={event.branch}
          />
          <DetailRow
            label="PR"
            value={
              event.number ||
              event.pr_number ||
              event.pull_number
            }
          />

          {files.length > 0 && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-[#5b6678]">
                Changed files
              </p>
              <div className="mt-2 space-y-1">
                {files.map((file, index) => (
                  <p
                    key={index}
                    className="font-mono text-xs text-[#12203a]"
                  >
                    {typeof file === "string"
                      ? file
                      : file?.filename || "Changed file"}
                  </p>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-[#5b6678]">
              Raw evidence
            </p>
            <pre className="mt-2 overflow-x-auto rounded-md bg-white border border-[#cdd5df] p-3 text-[10px] text-[#5b6678]">
              {JSON.stringify(event, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </article>
  );
}

function PageShell({ projectId, children }) {
  return (
    <div className="flex min-h-screen bg-[#f1f3f5]">
      <Sidebar projectId={projectId} />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

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
    "Unknown member"
  );
}

function normalizeType(event) {
  const raw = String(
    event.event_type || event.type || "Activity"
  ).toUpperCase();

  if (raw.includes("COMMIT")) return "Commit";
  if (raw.includes("PR_") || raw.includes("PULL")) return "Pull Request";
  if (raw.includes("REVIEW")) return "Review";
  if (raw.includes("COMMENT")) return "Comment";
  if (raw.includes("ISSUE")) return "Issue";
  if (raw.includes("CI") || raw.includes("WORKFLOW")) return "CI/CD";
  if (raw.includes("BRANCH")) return "Branch";

  return "Activity";
}

function iconFor(type) {
  switch (type) {
    case "Commit":
      return GitCommit;
    case "Pull Request":
      return GitPullRequest;
    case "Review":
      return MessageSquare;
    case "Comment":
      return MessageSquare;
    case "Issue":
      return AlertCircle;
    case "CI/CD":
      return Activity;
    case "Branch":
      return GitBranch;
    default:
      return CheckCircle;
  }
}

function formatDate(value) {
  if (!value) return "Unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";

  return date.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function DetailRow({ label, value }) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return (
    <div className="grid grid-cols-[100px_1fr] gap-4">
      <span className="text-xs font-semibold text-[#5b6678]">
        {label}
      </span>
      <span className="text-xs text-[#12203a] font-mono break-all">
        {String(value)}
      </span>
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

import React from "react";

const navy = "#12203a";
const teal = "#0a8f6c";
const border = "#cdd5df";
const muted = "#5b6678";
const light = "#f1f3f5";

export function EvidenceUnderstandingChart({
  data = [],
  projectId,
}) {
  const maxEvidence = Math.max(
    1,
    ...data.map((item) => Number(item.evidence) || 0)
  );

  if (!data.length) {
    return <EmptyChart message="No member evidence is available yet." />;
  }

  return (
    <div className="relative h-[360px] rounded-lg border border-[#cdd5df] bg-[#f1f3f5] p-8">
      <div className="absolute left-8 right-8 top-8 bottom-10 border-l border-b border-[#cdd5df]">
        {[25, 50, 75].map((value) => (
          <div
            key={value}
            className="absolute left-0 right-0 border-t border-[#cdd5df]/60"
            style={{ bottom: `${value}%` }}
          />
        ))}

        {data.map((item) => {
          const x =
            (Math.min(Number(item.evidence) || 0, maxEvidence) /
              maxEvidence) *
            100;

          const hasUnderstanding =
            item.understanding !== null &&
            item.understanding !== undefined &&
            Number.isFinite(Number(item.understanding));

          const y = hasUnderstanding
            ? Math.max(0, Math.min(100, Number(item.understanding)))
            : 2;

          const content = (
            <div className="group relative">
              <div
                className={[
                  "w-4 h-4 rounded-full ring-4 ring-white shadow-sm transition-transform group-hover:scale-125",
                  hasUnderstanding
                    ? "bg-[#0a8f6c]"
                    : "bg-[#8a95a6]",
                ].join(" ")}
              />
              <div className="absolute left-1/2 bottom-7 -translate-x-1/2 hidden group-hover:block z-20 whitespace-nowrap rounded-md bg-[#12203a] text-white px-2 py-1 text-[10px]">
                {item.name}: {item.evidence} evidence
                {hasUnderstanding
                  ? ` • Understanding ${item.understanding}/100`
                  : " • Understanding not evaluated"}
              </div>
            </div>
          );

          return projectId && item.id ? (
            <a
              key={item.id}
              href={`/project/${projectId}/member/${item.id}`}
              className="absolute -translate-x-1/2 translate-y-1/2"
              style={{
                left: `${x}%`,
                bottom: `${y}%`,
              }}
            >
              {content}
            </a>
          ) : (
            <div
              key={item.name}
              className="absolute -translate-x-1/2 translate-y-1/2"
              style={{
                left: `${x}%`,
                bottom: `${y}%`,
              }}
            >
              {content}
            </div>
          );
        })}
      </div>

      <span className="absolute left-1/2 bottom-2 -translate-x-1/2 text-[10px] font-bold uppercase tracking-wider text-[#5b6678]">
        Observable GitHub Evidence
      </span>

      <span className="absolute left-0 top-1/2 -translate-y-1/2 -rotate-90 text-[10px] font-bold uppercase tracking-wider text-[#5b6678]">
        Understanding
      </span>

      <div className="absolute top-3 right-4 flex items-center gap-4 text-[10px] text-[#5b6678]">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#0a8f6c]" />
          Evaluated
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#8a95a6]" />
          Not evaluated
        </span>
      </div>
    </div>
  );
}

export function TaskMemberChart({ evidenceGraph }) {
  const rows = normalizeGraph(evidenceGraph);

  if (!rows.length) {
    return <EmptyChart message="No task/member evidence relationships are available." />;
  }

  const tasks = [
    ...new Map(
      rows.flatMap((row) =>
        row.tasks.map((task) => [
          String(task.id),
          {
            id: task.id,
            name: task.name,
          },
        ])
      )
    ).values(),
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#cdd5df]">
            <th className="text-left py-3 pr-4 font-bold text-[#12203a]">
              Member
            </th>
            {tasks.map((task) => (
              <th
                key={task.id}
                className="py-3 px-2 text-center font-bold text-[#5b6678] min-w-[100px]"
              >
                {task.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.member_id} className="border-b border-[#cdd5df]">
              <td className="py-3 pr-4 font-medium text-[#12203a]">
                {row.member_name}
              </td>

              {tasks.map((task) => {
                const match = row.tasks.find(
                  (item) => String(item.id) === String(task.id)
                );

                return (
                  <td key={task.id} className="py-3 px-2 text-center">
                    {match ? (
                      <span
                        className={[
                          "inline-flex h-7 min-w-7 items-center justify-center rounded-md px-2 text-[10px] font-bold",
                          match.alignment === "ALIGNED"
                            ? "bg-[#0a8f6c]/10 text-[#0a8f6c]"
                            : match.alignment === "PARTIAL"
                              ? "bg-[#f1f3f5] text-[#5b6678]"
                              : "bg-[#f1f3f5] text-[#8a95a6]",
                        ].join(" ")}
                      >
                        {match.evidence_count ?? "•"}
                      </span>
                    ) : (
                      <span className="text-[#cdd5df]">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EvidenceBreakdownChart({ activity = {} }) {
  const metrics = [
    ["Commits", activity.commits],
    ["Pull Requests", activity.pull_requests],
    ["Reviews", activity.reviews],
    ["Comments", activity.comments],
    ["Issues", activity.issues],
    ["CI Runs", activity.ci_runs],
  ].filter(([, value]) => value !== null && value !== undefined);

  if (!metrics.length) {
    return <EmptyChart message="No activity breakdown was returned by the analysis." />;
  }

  const max = Math.max(
    1,
    ...metrics.map(([, value]) => Number(value) || 0)
  );

  return (
    <div className="space-y-4">
      {metrics.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[110px_1fr_45px] items-center gap-3">
          <span className="text-xs font-semibold text-[#5b6678]">
            {label}
          </span>
          <div className="h-2.5 rounded bg-[#f1f3f5] overflow-hidden">
            <div
              className="h-full rounded bg-[#0a8f6c]"
              style={{
                width: `${((Number(value) || 0) / max) * 100}%`,
              }}
            />
          </div>
          <span className="text-xs font-mono text-right text-[#12203a]">
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ActivityTimelineChart({ events = [] }) {
  if (!events.length) {
    return <EmptyChart message="No timeline aggregation is available." />;
  }

  const days = new Map();

  events.forEach((event) => {
    const value =
      event.timestamp ||
      event.created_at ||
      event.date ||
      event.time;

    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return;

    const key = date.toLocaleDateString([], {
      month: "short",
      day: "numeric",
    });

    days.set(key, (days.get(key) || 0) + 1);
  });

  const values = [...days.entries()];
  const max = Math.max(1, ...values.map(([, value]) => value));

  return (
    <div className="space-y-3">
      {values.slice(-7).map(([day, value]) => (
        <div key={day} className="grid grid-cols-[55px_1fr_30px] gap-3 items-center">
          <span className="text-xs text-[#5b6678]">{day}</span>
          <div className="h-2 rounded bg-[#f1f3f5] overflow-hidden">
            <div
              className="h-full bg-[#0a8f6c] rounded"
              style={{ width: `${(value / max) * 100}%` }}
            />
          </div>
          <span className="text-xs text-[#12203a] text-right">
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

export function TimelineChart({ events = [] }) {
  const recent = events.slice(0, 8);

  if (!recent.length) {
    return <EmptyChart message="No recent activity was returned." />;
  }

  return (
    <div className="space-y-5">
      {recent.map((event, index) => (
        <div
          key={event.id || `${event.timestamp}-${index}`}
          className="flex gap-4"
        >
          <div className="pt-1">
            <span className="block w-2.5 h-2.5 rounded-full bg-[#0a8f6c]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#0a8f6c]">
                {formatEventType(event)}
              </span>
              <span className="text-[10px] text-[#8a95a6]">
                {formatDate(event.timestamp || event.created_at)}
              </span>
            </div>
            <p className="mt-1 text-sm font-semibold text-[#12203a] truncate">
              {event.title ||
                event.message ||
                event.commit_message ||
                event.artifact ||
                "GitHub activity"}
            </p>
            <p className="mt-1 text-xs text-[#5b6678]">
              {event.github_username ||
                event.member_name ||
                event.author ||
                event.actor ||
                "Unknown member"}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function normalizeGraph(graph) {
  if (!graph) return [];

  const raw =
    graph.members ||
    graph.nodes ||
    graph.member_task_relationships ||
    graph.items ||
    [];

  if (!Array.isArray(raw)) return [];

  return raw
    .map((row) => ({
      member_id: row.member_id ?? row.id,
      member_name:
        row.member_name ||
        row.display_name ||
        row.github_username ||
        row.name ||
        "Member",
      tasks: Array.isArray(row.tasks)
        ? row.tasks.map((task) => ({
            id: task.task_id ?? task.id,
            name:
              task.task_name ||
              task.name ||
              task.task ||
              "Task",
            alignment: task.alignment,
            evidence_count:
              task.evidence_count ??
              task.events_count ??
              task.count,
          }))
        : [],
    }))
    .filter((row) => row.tasks.length);
}

function formatEventType(event) {
  return String(event.event_type || event.type || "ACTIVITY")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDate(value) {
  if (!value) return "Unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function EmptyChart({ message }) {
  return (
    <div className="min-h-[180px] flex items-center justify-center rounded-lg border border-dashed border-[#cdd5df] bg-[#f1f3f5] px-6 text-center text-sm text-[#8a95a6]">
      {message}
    </div>
  );
}

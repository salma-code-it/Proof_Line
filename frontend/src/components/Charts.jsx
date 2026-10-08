import React from "react";

const navy = "#12203a";
const teal = "#0a8f6c";
const border = "#cdd5df";
const muted = "#5b6678";
const light = "#f1f3f5";
const gray = "#8a95a6";

export function EvidenceUnderstandingChart({ data = [] }) {
  if (!data.length) {
    return (
      <div className="border border-[#cdd5df] rounded-lg bg-white p-6">
        <div className="text-sm font-semibold text-[#12203a]">
          Evidence Understanding
        </div>
        <p className="mt-2 text-sm text-gray-500">
          No evidence understanding data is available.
        </p>
      </div>
    );
  }

  // Accept several possible data shapes from the analysis response.
  const normalized = data
    .map((item) => {
      const label =
        item.label ||
        item.name ||
        item.type ||
        item.category ||
        "Unknown";

      const value = Number(
        item.value ??
          item.count ??
          item.total ??
          item.events ??
          item.evidence ??
          0
      );

      return {
        label,
        value: Number.isFinite(value) ? value : 0,
      };
    })
    .filter((item) => item.value >= 0);

  if (!normalized.length) {
    return (
      <div className="border border-[#cdd5df] rounded-lg bg-white p-6">
        <div className="text-sm font-semibold text-[#12203a]">
          Evidence Understanding
        </div>
        <p className="mt-2 text-sm text-gray-500">
          No evidence understanding data is available.
        </p>
      </div>
    );
  }

  const maxValue = Math.max(...normalized.map((item) => item.value), 1);

  return (
    <div className="border border-[#cdd5df] rounded-lg bg-white p-6">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h3 className="text-sm font-semibold text-[#12203a]">
            Evidence Understanding
          </h3>
          <p className="mt-1 text-xs text-gray-500">
            Distribution of the evidence collected for the project.
          </p>
        </div>

        <div className="text-xs text-gray-400">
          {normalized.length} categories
        </div>
      </div>

      <div className="space-y-4">
        {normalized.map((item, index) => {
          const percentage =
            maxValue > 0 ? (item.value / maxValue) * 100 : 0;

          return (
            <div key={`${item.label}-${index}`}>
              <div className="flex items-center justify-between gap-4 mb-1.5">
                <span className="text-sm text-[#12203a] truncate">
                  {item.label}
                </span>

                <span className="text-sm font-semibold text-[#12203a]">
                  {item.value}
                </span>
              </div>

              <div className="h-2 rounded-full bg-[#f1f3f5] overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#0a8f6c] transition-all"
                  style={{
                    width: `${Math.max(percentage, item.value > 0 ? 3 : 0)}%`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
export function TaskMemberChart({ evidenceGraph, taskAnalysis = [] }) {
  const graphRows = normalizeGraph(evidenceGraph);
  const rows =
    graphRows.length > 0
      ? graphRows
      : normalizeTaskAnalysis(taskAnalysis);

  if (!rows.length) {
    return (
      <EmptyChart message="No task/member evidence relationships are available." />
    );
  }

  const tasks = [
    ...new Map(
      rows.flatMap((row) =>
        row.tasks.map((task) => [
          String(task.id),
          { id: task.id, name: task.name },
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
                className="py-3 px-2 text-center font-bold text-[#5b6678] min-w-[110px]"
              >
                {task.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={String(row.member_id)}
              className="border-b border-[#cdd5df]"
            >
              <td className="py-3 pr-4 font-medium text-[#12203a]">
                {row.member_name}
              </td>
              {tasks.map((task) => {
                const match = row.tasks.find(
                  (item) => String(item.id) === String(task.id)
                );

                return (
                  <td
                    key={String(task.id)}
                    className="py-3 px-2 text-center"
                  >
                    {match ? (
                      <span
                        className={[
                          "inline-flex min-h-7 min-w-7 items-center justify-center rounded-md px-2 text-[10px] font-bold",
                          match.alignment === "ALIGNED"
                            ? "bg-[#0a8f6c]/10 text-[#0a8f6c]"
                            : match.alignment === "PARTIAL"
                            ? "bg-[#f1f3f5] text-[#5b6678]"
                            : "bg-[#f1f3f5] text-[#8a95a6]",
                        ].join(" ")}
                        title={
                          match.evidence_count !== null &&
                          match.evidence_count !== undefined
                            ? `${match.evidence_count} evidence units`
                            : "Observable evidence relationship"
                        }
                      >
                        {match.evidence_count !== null &&
                        match.evidence_count !== undefined
                          ? match.evidence_count
                          : "•"}
                      </span>
                    ) : (
                      <span className="text-[#cdd5df]">–</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4 text-[11px] leading-relaxed text-[#8a95a6]">
        Relationships are displayed only when returned by the evidence graph
        or task analysis. Automatically discovered work areas use the
        contributors returned by the backend.
      </p>
    </div>
  );
}

export function EvidenceBreakdownChart({ activity = {} }) {
  const metrics = [
    ["Commits", activity.commits],
    ["Pull Requests", activity.pull_requests],
    ["Reviews", activity.reviews],
    ["Review Comments", activity.review_comments],
    ["Issues", activity.issues],
    ["CI Runs", activity.ci_runs],
  ].filter(
    ([, value]) =>
      value !== null &&
      value !== undefined &&
      Number.isFinite(Number(value))
  );

  if (!metrics.length) {
    return (
      <EmptyChart message="No activity breakdown was returned by the analysis." />
    );
  }

  const max = Math.max(1, ...metrics.map(([, value]) => Number(value)));

  return (
    <div className="space-y-4">
      {metrics.map(([label, value]) => (
        <div
          key={label}
          className="grid grid-cols-[120px_1fr_45px] items-center gap-3"
        >
          <span className="text-xs font-semibold text-[#5b6678]">
            {label}
          </span>
          <div className="h-2.5 rounded bg-[#f1f3f5] overflow-hidden">
            <div
              className="h-full rounded bg-[#0a8f6c]"
              style={{ width: `${(Number(value) / max) * 100}%` }}
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

export function ContributionScoreChart({ data = [] }) {
  if (!data.length) {
    return (
      <EmptyChart message="No contribution analysis available. Run project analysis first." />
    );
  }

  const sorted = [...data].sort(
    (a, b) =>
      (Number(b.activity_score_0_100) || 0) -
      (Number(a.activity_score_0_100) || 0)
  );

  return (
    <div className="space-y-4">
      {sorted.map((member, index) => {
        const score = Number(member.activity_score_0_100);
        const valid =
          member.activity_score_0_100 !== null &&
          member.activity_score_0_100 !== undefined &&
          Number.isFinite(score);

        return (
          <div
            key={
              member.member_id ??
              member.github_username ??
              `${member.display_name}-${index}`
            }
          >
            <div className="mb-1.5 flex justify-between gap-3 text-xs">
              <span className="font-semibold text-[#12203a]">
                {member.display_name || member.github_username || "Member"}
              </span>
              <span className="font-mono text-[#5b6678]">
                {valid ? `${score}/100` : "—"}
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded bg-[#f1f3f5]">
              <div
                className="h-full rounded bg-[#0a8f6c]"
                style={{
                  width: `${
                    valid ? Math.max(0, Math.min(100, score)) : 0
                  }%`,
                }}
              />
            </div>
          </div>
        );
      })}
      <p className="text-[11px] leading-relaxed text-[#8a95a6]">
        A formula-based activity indicator, not a grade, an ownership
        percentage, or a measure of understanding.
      </p>
    </div>
  );
}

export function MemberFileActivityChart({ data = [] }) {
  const [searchTerm, setSearchTerm] = React.useState("");
  const [sortBy, setSortBy] = React.useState("total");

  if (!data.length) {
    return <EmptyChart message="No file-type activity is available." />;
  }

  const categories = [
    { label: "Code", key: "files_code" },
    { label: "Model", key: "files_model" },
    { label: "Docs", key: "files_docs" },
    { label: "Config", key: "files_config" },
    { label: "Data", key: "files_data" },
    { label: "Other", key: "files_other" },
  ];

  const getValue = (member, key) => {
    const value = Number(member.components?.[key] ?? 0);
    return Number.isFinite(value) ? value : 0;
  };

  const getName = (member) =>
    member.display_name || member.github_username || "Member";

  const filteredData = data
    .filter((member) => {
      const search = searchTerm.trim().toLowerCase();

      if (!search) return true;

      return (
        getName(member).toLowerCase().includes(search) ||
        String(member.github_username || "")
          .toLowerCase()
          .includes(search)
      );
    })
    .sort((a, b) => {
      if (sortBy === "name") {
        return getName(a).localeCompare(getName(b));
      }

      const totalA = categories.reduce(
        (sum, category) => sum + getValue(a, category.key),
        0
      );

      const totalB = categories.reduce(
        (sum, category) => sum + getValue(b, category.key),
        0
      );

      return totalB - totalA;
    });

  return (
    <div className="space-y-4">
      {/* Search and sorting */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <input
          type="text"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Search member or GitHub username..."
          className="w-full sm:max-w-sm rounded-md border border-[#cdd5df] px-3 py-2 text-sm text-[#12203a] outline-none focus:border-[#0a8f6c] focus:ring-2 focus:ring-[#0a8f6c]/20"
          aria-label="Search contributors"
        />

        <select
          value={sortBy}
          onChange={(event) => setSortBy(event.target.value)}
          className="rounded-md border border-[#cdd5df] px-3 py-2 text-sm text-[#12203a] outline-none focus:border-[#0a8f6c]"
          aria-label="Sort contributors"
        >
          <option value="total">Highest total points</option>
          <option value="name">Name (A–Z)</option>
        </select>
      </div>

      <p className="text-xs text-[#5b6678]">
        Showing {filteredData.length} of {data.length} contributors
      </p>

      {/* Compact table */}
      <div className="overflow-x-auto rounded-lg border border-[#cdd5df]">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead className="bg-[#f1f3f5]">
            <tr className="text-left text-[11px] uppercase tracking-wide text-[#5b6678]">
              <th className="px-4 py-3 font-semibold">Contributor</th>
              {categories.map((category) => (
                <th
                  key={category.key}
                  className="px-3 py-3 text-right font-semibold"
                >
                  {category.label}
                </th>
              ))}
              <th className="px-4 py-3 text-right font-semibold">
                Total points
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-[#cdd5df]">
            {filteredData.map((member, index) => {
              const total = categories.reduce(
                (sum, category) =>
                  sum + getValue(member, category.key),
                0
              );

              return (
                <tr
                  key={
                    member.member_id ??
                    member.github_username ??
                    `${getName(member)}-${index}`
                  }
                  className="hover:bg-[#f8fafb]"
                >
                  <td className="px-4 py-3">
                    <div className="font-semibold text-[#12203a]">
                      {getName(member)}
                    </div>
                    {member.github_username && (
                      <div className="mt-0.5 text-xs text-[#8a95a6]">
                        @{member.github_username}
                      </div>
                    )}
                  </td>

                  {categories.map((category) => (
                    <td
                      key={category.key}
                      className="px-3 py-3 text-right font-mono text-xs text-[#12203a]"
                    >
                      {getValue(member, category.key).toFixed(1)}
                    </td>
                  ))}

                  <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-[#0a8f6c]">
                    {total.toFixed(1)}
                  </td>
                </tr>
              );
            })}

            {filteredData.length === 0 && (
              <tr>
                <td
                  colSpan={categories.length + 2}
                  className="px-4 py-8 text-center text-sm text-[#8a95a6]"
                >
                  No contributors match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] leading-relaxed text-[#8a95a6]">
        Values are weighted component points calculated by the backend,
        not raw file counts. Total points are the sum of the six displayed
        components and should not be interpreted as a grade or ownership.
      </p>
    </div>
  );
}

function normalizeGraph(graph) {
  if (!graph) return [];

  const raw =
    graph.members ||
    graph.member_task_relationships ||
    graph.items ||
    [];

  if (!Array.isArray(raw)) {
    return normalizeGraphNodesAndEdges(graph);
  }

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
        ? row.tasks
            .map((task) => ({
              id:
                task.task_id ??
                task.id ??
                task.task_name ??
                task.name,
              name:
                task.task_name ||
                task.name ||
                task.task ||
                "Task",
              alignment: task.alignment,
              evidence_count:
                task.evidence_count ??
                task.events_count ??
                task.evidence_units ??
                task.count ??
                null,
            }))
            .filter(
              (task) => task.id !== null && task.id !== undefined
            )
        : [],
    }))
    .filter((row) => row.tasks.length);
}

function normalizeGraphNodesAndEdges(graph) {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];

  if (!nodes.length || !edges.length) return [];

  const members = nodes.filter((node) => {
    const type = String(
      node.type || node.node_type || node.kind || ""
    ).toLowerCase();
    return type.includes("member") || node.member_id !== undefined;
  });

  const tasks = nodes.filter((node) => {
    const type = String(
      node.type || node.node_type || node.kind || ""
    ).toLowerCase();
    return (
      type.includes("task") ||
      type.includes("work") ||
      node.task_id !== undefined
    );
  });

  if (!members.length || !tasks.length) return [];

  const taskByNodeId = new Map(
    tasks.map((task) => [String(task.id ?? task.node_id), task])
  );

  return members
    .map((member) => {
      const memberNodeId = String(member.id ?? member.node_id);

      const memberTasks = edges
        .filter((edge) => {
          const source = String(edge.source ?? edge.from);
          const target = String(edge.target ?? edge.to);
          return source === memberNodeId || target === memberNodeId;
        })
        .map((edge) => {
          const source = String(edge.source ?? edge.from);
          const target = String(edge.target ?? edge.to);
          const taskNodeId =
            source === memberNodeId ? target : source;
          return taskByNodeId.get(taskNodeId);
        })
        .filter(Boolean)
        .map((task) => ({
          id: task.task_id ?? task.id ?? task.node_id,
          name: task.task_name || task.name || "Task",
          alignment: null,
          evidence_count: null,
        }));

      return {
        member_id: member.member_id ?? member.id ?? member.node_id,
        member_name:
          member.member_name ||
          member.display_name ||
          member.github_username ||
          member.name ||
          "Member",
        tasks: memberTasks,
      };
    })
    .filter((row) => row.tasks.length);
}

function normalizeTaskAnalysis(taskAnalysis) {
  if (!Array.isArray(taskAnalysis)) return [];

  const rows = new Map();

  taskAnalysis.forEach((task, taskIndex) => {
    if (!task || !Array.isArray(task.contributors)) return;

    const taskId =
      task.task_id ?? task.id ?? `task-analysis-${taskIndex}`;
    const taskName =
      task.name ||
      task.task_name ||
      task.title ||
      `Work area ${taskIndex + 1}`;

    task.contributors.forEach((contributor, contributorIndex) => {
      const normalized = normalizeContributor(contributor);
      if (!normalized) return;

      const memberKey =
        normalized.member_id ??
        normalized.github_username ??
        normalized.member_name ??
        `member-${contributorIndex}`;

      if (!rows.has(String(memberKey))) {
        rows.set(String(memberKey), {
          member_id: normalized.member_id ?? memberKey,
          member_name:
            normalized.member_name ||
            normalized.github_username ||
            "Member",
          tasks: [],
        });
      }

      rows.get(String(memberKey)).tasks.push({
        id: taskId,
        name: taskName,
        alignment:
          normalized.alignment ??
          normalized.evidence_status ??
          null,
        evidence_count:
          normalized.evidence_count ??
          normalized.evidence_units ??
          null,
      });
    });
  });

  return [...rows.values()].filter((row) => row.tasks.length);
}

function normalizeContributor(contributor) {
  if (typeof contributor === "string") {
    return { member_name: contributor };
  }

  if (typeof contributor !== "object" || contributor === null) {
    return null;
  }

  return {
    member_id: contributor.member_id ?? contributor.id ?? null,
    member_name:
      contributor.member_name ??
      contributor.display_name ??
      contributor.name ??
      contributor.member ??
      null,
    github_username:
      contributor.github_username ??
      contributor.username ??
      contributor.login ??
      null,
    alignment: contributor.alignment ?? null,
    evidence_count:
      contributor.evidence_count ??
      contributor.events_count ??
      contributor.count ??
      null,
    evidence_units: contributor.evidence_units ?? null,
    evidence_status: contributor.evidence_status ?? null,
  };
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
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import { getMemberData } from "../api";
import {
  ArrowLeft,
  ExternalLink,
  FileCode,
  GitCommit,
  GitPullRequest,
  GitBranch,
  Play,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

export default function Members() {
  const { projectId, memberId } = useParams();
  const navigate = useNavigate();

  if (!memberId) {
    return <MembersList projectId={projectId} />;
  }

  return (
    <MemberDetail
      projectId={projectId}
      memberId={memberId}
      navigate={navigate}
    />
  );
}

function MembersList({ projectId }) {
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const result = await import("../api").then((module) =>
          Promise.all([
            module.getProject(projectId),
            module.getLatestAnalysis(projectId),
          ])
        );

        if (!active) return;

        setData({
          project: result[0],
          analysis: result[1],
        });
      } catch (err) {
        if (active) {
          setError(err.message || "Failed to load members.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      active = false;
    };
  }, [projectId]);

  const patterns = Array.isArray(data?.analysis?.patterns)
    ? data.analysis.patterns
    : [];

  const patternsByMember = useMemo(() => {
    const map = new Map();

    patterns.forEach((pattern) => {
      const key = String(pattern.member || "").toLowerCase();

      if (!key) return;

      if (!map.has(key)) {
        map.set(key, []);
      }

      map.get(key).push(pattern);
    });

    return map;
  }, [patterns]);

  if (loading) {
    return (
      <PageShell projectId={projectId}>
        Loading members...
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell projectId={projectId}>
        <ErrorBox message={error} />
      </PageShell>
    );
  }

  const members = data?.project?.github_contributors || [];
  const analyses = data?.analysis?.member_analysis || [];

  return (
    <PageShell projectId={projectId}>
      <PageHeader
        title="Project Members"
        subtitle="Observable evidence by member"
        onBack={() => navigate(`/project/${projectId}`)}
      />

      <main className="max-w-6xl mx-auto px-5 sm:px-8 py-8 space-y-8">
        {/* ---------------------------------------------------------- */}
        {/* Observable patterns                                         */}
        {/* ---------------------------------------------------------- */}

        {patterns.length > 0 && (
          <section className="bg-white rounded-xl border border-[#cdd5df] p-6">
            <div className="mb-5">
              <p className="text-xs font-bold uppercase tracking-wider text-[#0a8f6c]">
                Observable patterns
              </p>

              <h2 className="mt-1 text-lg font-bold text-[#12203a]">
                Activity signals across members
              </h2>

              <p className="mt-1 text-sm text-[#5b6678]">
                Deterministic observations from the analysis — not
                accusations or contribution scores.
              </p>
            </div>

            <div className="space-y-3">
              {patterns.map((pattern, index) => (
                <div
                  key={`${pattern.type}-${pattern.member}-${index}`}
                  className="rounded-lg border border-[#cdd5df] bg-[#f1f3f5] p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#0a8f6c]">
                          {String(
                            pattern.type || "PATTERN"
                          ).replaceAll("_", " ")}
                        </span>

                        {pattern.severity && (
                          <span className="text-[10px] font-semibold uppercase text-[#8a95a6]">
                            {pattern.severity}
                          </span>
                        )}
                      </div>

                      <p className="mt-1 text-sm font-semibold text-[#12203a]">
                        {pattern.member || "Member"}
                      </p>

                      <p className="mt-1 text-xs leading-relaxed text-[#5b6678]">
                        {pattern.description}
                      </p>

                      {Array.isArray(pattern.files) &&
                        pattern.files.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {pattern.files.slice(0, 6).map((file) => (
                              <span
                                key={file}
                                className="rounded bg-white border border-[#cdd5df] px-1.5 py-0.5 font-mono text-[10px] text-[#5b6678]"
                              >
                                {shortPath(file)}
                              </span>
                            ))}

                            {pattern.files.length > 6 && (
                              <span className="text-[10px] text-[#8a95a6]">
                                +{pattern.files.length - 6} more
                              </span>
                            )}
                          </div>
                        )}
                    </div>

                    {pattern.event_count != null && (
                      <div className="text-right shrink-0">
                        <p className="text-lg font-bold text-[#12203a]">
                          {pattern.event_count}
                        </p>

                        <p className="text-[10px] text-[#5b6678]">
                          events
                          {pattern.window_minutes
                            ? ` / ${pattern.window_minutes}m`
                            : ""}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ---------------------------------------------------------- */}
        {/* Members                                                     */}
        {/* ---------------------------------------------------------- */}

        <section className="bg-white rounded-xl border border-[#cdd5df] overflow-hidden">
          <div className="p-6 border-b border-[#cdd5df]">
            <h2 className="text-lg font-bold text-[#12203a]">
              Members
            </h2>

            <p className="text-sm text-[#5b6678] mt-1">
              This is evidence, not a contribution leaderboard.
            </p>
          </div>

          <div className="divide-y divide-[#cdd5df]">
            {members.length === 0 ? (
              <p className="p-6 text-sm text-[#8a95a6]">
                No members were returned for this project.
              </p>
            ) : (
              members.map((member) => {
                const result = analyses.find(
                  (item) =>
                    Number(item.member_id) === Number(member.id)
                );

                const nameKey = String(
                  member.display_name ||
                    member.github_username ||
                    ""
                ).toLowerCase();

                const memberPatterns =
                  patternsByMember.get(nameKey) || [];

                return (
                  <button
                    key={member.id}
                    onClick={() =>
                      navigate(
                        `/project/${projectId}/member/${member.id}`
                      )
                    }
                    className="w-full p-5 flex items-center justify-between text-left hover:bg-[#f1f3f5]"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-[#12203a]">
                        {member.display_name ||
                          member.github_username}
                      </p>

                      <p className="text-xs text-[#5b6678] mt-1">
                        @{member.github_username}
                      </p>

                      {memberPatterns.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {memberPatterns.map((pattern, index) => (
                            <span
                              key={`${pattern.type}-${index}`}
                              className="rounded bg-[#f1f3f5] border border-[#cdd5df] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#0a8f6c]"
                            >
                              {String(
                                pattern.type || ""
                              ).replaceAll("_", " ")}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="text-right shrink-0 ml-4">
                      <p className="text-lg font-bold text-[#12203a]">
                        {getEvidenceCount(result)}
                      </p>

                      <p className="text-xs text-[#5b6678]">
                        evidence events
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>
      </main>
    </PageShell>
  );
}

function MemberDetail({ projectId, memberId, navigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showAllCommits, setShowAllCommits] = useState(false);
  const [expandedCommit, setExpandedCommit] = useState(null);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const result = await getMemberData(projectId, memberId);

        if (active) {
          setData(result);
        }
      } catch (err) {
        if (active) {
          setError(err.message || "Failed to load member.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      active = false;
    };
  }, [projectId, memberId]);

  const member = data?.member || {};

  const analysis = findMemberAnalysis(
    data?.analysis,
    memberId
  );

  const activity = analysis?.activity || {};
  const details = analysis?.details || {};

  const commits = Array.isArray(details.commits)
    ? details.commits
    : [];

  const pullRequests = Array.isArray(details.pull_requests)
    ? details.pull_requests
    : [];

  const githubUsername =
    member.github_username ||
    analysis?.github_username ||
    member.login ||
    "";

  const displayName =
    member.display_name ||
    analysis?.display_name ||
    githubUsername ||
    "Member";

  const profileUrl = githubUsername
    ? `https://github.com/${githubUsername}`
    : null;

  /* -------------------------------------------------------------- */
  /* Branch aggregation                                             */
  /* -------------------------------------------------------------- */

  const branches = useMemo(() => {
    const counts = new Map();

    pullRequests.forEach((pr) => {
      const branch = pr.branch || pr.branch_name;

      if (!branch) return;

      if (!counts.has(branch)) {
        counts.set(branch, {
          name: branch,
          prs: 0,
          merged: 0,
          files: new Set(),
        });
      }

      const row = counts.get(branch);

      row.prs += 1;

      if (pr.merged) {
        row.merged += 1;
      }

      if (Array.isArray(pr.files)) {
        pr.files.forEach((file) => {
          const filename =
            typeof file === "string"
              ? file
              : file?.filename;

          if (filename) {
            row.files.add(filename);
          }
        });
      }
    });

    return [...counts.values()]
      .map((branch) => ({
        ...branch,
        files: branch.files.size,
      }))
      .sort((a, b) => b.prs - a.prs);
  }, [pullRequests]);

  /* -------------------------------------------------------------- */
  /* Unique file activity                                           */
  /* -------------------------------------------------------------- */

  const fileActivity = useMemo(() => {
    const map = new Map();

    function ensureFile(filename) {
      if (!filename) return null;

      if (!map.has(filename)) {
        map.set(filename, {
          filename,
          commits: new Set(),
          pullRequests: new Set(),
          additions: 0,
          deletions: 0,
        });
      }

      return map.get(filename);
    }

    /* -------------------------- */
    /* Files from commits         */
    /* -------------------------- */

    commits.forEach((commit, commitIndex) => {
      const files = Array.isArray(commit.files)
        ? commit.files
        : [];

      files.forEach((file) => {
        const filename =
          typeof file === "string"
            ? file
            : file?.filename;

        const row = ensureFile(filename);

        if (!row) return;

        row.commits.add(
          commit.sha || `commit-${commitIndex}`
        );

        if (typeof file === "object") {
          row.additions += Number(
            file.additions || 0
          );

          row.deletions += Number(
            file.deletions || 0
          );
        }
      });
    });

    /* -------------------------- */
    /* Files from pull requests   */
    /* -------------------------- */

    pullRequests.forEach((pr, prIndex) => {
      const files = Array.isArray(pr.files)
        ? pr.files
        : [];

      files.forEach((file) => {
        const filename =
          typeof file === "string"
            ? file
            : file?.filename;

        const row = ensureFile(filename);

        if (!row) return;

        row.pullRequests.add(
          pr.number || `pr-${prIndex}`
        );

        if (typeof file === "object") {
          row.additions += Number(
            file.additions || 0
          );

          row.deletions += Number(
            file.deletions || 0
          );
        }
      });
    });

    return [...map.values()]
      .map((row) => ({
        filename: row.filename,
        commits: row.commits.size,
        pullRequests: row.pullRequests.size,
        additions: row.additions,
        deletions: row.deletions,
        totalChanges:
          row.additions + row.deletions,
      }))
      .sort((a, b) => {
        if (b.totalChanges !== a.totalChanges) {
          return b.totalChanges - a.totalChanges;
        }

        return b.commits - a.commits;
      });
  }, [commits, pullRequests]);

  /* -------------------------------------------------------------- */
  /* Evidence chains                                                */
  /* -------------------------------------------------------------- */

  const evidenceChains = useMemo(() => {
    const chains = Array.isArray(
      data?.analysis?.evidence_chains
    )
      ? data.analysis.evidence_chains
      : [];

    const username = String(
      githubUsername || ""
    ).toLowerCase();

    const name = String(
      displayName || ""
    ).toLowerCase();

    return chains.filter((chain) => {
      const author = String(
        chain.author || ""
      ).toLowerCase();

      const githubName = String(
        chain.github_username || ""
      ).toLowerCase();

      return (
        (username &&
          (githubName === username ||
            author === username)) ||
        (name && author === name)
      );
    });
  }, [
    data?.analysis?.evidence_chains,
    githubUsername,
    displayName,
  ]);

  /* -------------------------------------------------------------- */
  /* Member patterns                                                 */
  /* -------------------------------------------------------------- */

  const memberPatterns = useMemo(() => {
    const patterns = Array.isArray(
      data?.analysis?.patterns
    )
      ? data.analysis.patterns
      : [];

    const username = String(
      githubUsername || ""
    ).toLowerCase();

    const name = String(
      displayName || ""
    ).toLowerCase();

    return patterns.filter((pattern) => {
      const patternMember = String(
        pattern.member || ""
      ).toLowerCase();

      return (
        patternMember === username ||
        patternMember === name
      );
    });
  }, [
    data?.analysis?.patterns,
    githubUsername,
    displayName,
  ]);

  /* -------------------------------------------------------------- */

  if (loading) {
    return (
      <PageShell projectId={projectId}>
        Tracing member evidence...
      </PageShell>
    );
  }

  if (error && !data) {
    return (
      <PageShell projectId={projectId}>
        <ErrorBox message={error} />
      </PageShell>
    );
  }

  const visibleCommits = showAllCommits
    ? commits
    : commits.slice(0, 10);

  /* -------------------------------------------------------------- */
  /* Activity chart data                                             */
  /* -------------------------------------------------------------- */

  const activityRows = [
    {
      label: "Commits",
      value: Number(activity.commits || 0),
    },
    {
      label: "Pull requests",
      value: Number(activity.pull_requests || 0),
    },
    {
      label: "Reviews",
      value: Number(activity.reviews || 0),
    },
    {
      label: "Review comments",
      value: Number(activity.review_comments || 0),
    },
  ];

  const maxActivity = Math.max(
    ...activityRows.map((row) => row.value),
    1
  );

  return (
    <PageShell projectId={projectId}>
      <PageHeader
        title={displayName}
        subtitle={
          githubUsername
            ? `@${githubUsername}`
            : "GitHub member"
        }
        onBack={() =>
          navigate(
            `/project/${projectId}/members`
          )
        }
      />

      <main className="max-w-6xl mx-auto px-5 sm:px-8 py-8 space-y-8">

        {/* ====================================================== */}
        {/* MEMBER OVERVIEW                                        */}
        {/* ====================================================== */}

        <section className="bg-white rounded-xl border border-[#cdd5df] p-6">
          <div className="flex flex-wrap items-start justify-between gap-5">

            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-[#0a8f6c]">
                Observable evidence
              </p>

              <h2 className="mt-1 text-xl font-bold text-[#12203a]">
                {displayName}
              </h2>

              {githubUsername && (
                <p className="mt-1 text-sm text-[#5b6678]">
                  @{githubUsername}
                </p>
              )}

              {analysis?.evidence_status && (
                <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-[#0a8f6c]">
                  Evidence status:{" "}
                  {analysis.evidence_status}
                </p>
              )}
            </div>

            {profileUrl && (
              <a
                href={profileUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 text-sm font-semibold text-[#0a8f6c]"
              >
                GitHub profile
                <ExternalLink size={14} />
              </a>
            )}
          </div>

          {/* ---------------------------------------------------- */}
          {/* Compact metrics                                      */}
          {/* ---------------------------------------------------- */}

          <div className="mt-7 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-5 border-t border-[#cdd5df] pt-6">

            <CompactMetric
              label="Commits"
              value={activity.commits}
            />

            <CompactMetric
              label="Pull Requests"
              value={activity.pull_requests}
            />

            <CompactMetric
              label="Merged PRs"
              value={activity.merged_pull_requests}
            />

            <CompactMetric
              label="Branches"
              value={branches.length}
            />

            <CompactMetric
              label="Reviews"
              value={activity.reviews}
            />

            <CompactMetric
              label="Active days"
              value={activity.active_days}
            />

          </div>
        </section>

        {/* ====================================================== */}
        {/* ACTIVITY DISTRIBUTION                                  */}
        {/* ====================================================== */}

        <section className="bg-white rounded-xl border border-[#cdd5df] p-6">

          <div className="mb-6">
            <p className="text-xs font-bold uppercase tracking-wider text-[#0a8f6c]">
              Activity distribution
            </p>

            <h2 className="mt-1 text-lg font-bold text-[#12203a]">
              Observable activity
            </h2>

            <p className="mt-1 text-sm text-[#5b6678]">
              Relative volume of recorded GitHub evidence.
            </p>
          </div>

          <div className="space-y-4">

            {activityRows.map((row) => (
              <div
                key={row.label}
                className="grid grid-cols-[130px_1fr_45px] items-center gap-4"
              >

                <span className="text-xs font-medium text-[#5b6678]">
                  {row.label}
                </span>

                <div className="h-2 rounded-full bg-[#f1f3f5] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#0a8f6c]"
                    style={{
                      width: `${Math.max(
                        (row.value / maxActivity) * 100,
                        row.value > 0 ? 4 : 0
                      )}%`,
                    }}
                  />
                </div>

                <span className="text-right text-sm font-bold text-[#12203a]">
                  {row.value}
                </span>

              </div>
            ))}

          </div>
        </section>

        {/* ====================================================== */}
        {/* UNIQUE FILE ACTIVITY                                  */}
        {/* ====================================================== */}

        <section className="bg-white rounded-xl border border-[#cdd5df] overflow-hidden">

          <div className="p-6 border-b border-[#cdd5df]">

            <div className="flex flex-wrap items-end justify-between gap-3">

              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[#0a8f6c]">
                  File activity
                </p>

                <h2 className="mt-1 text-lg font-bold text-[#12203a]">
                  Files touched ({fileActivity.length})
                </h2>

                <p className="mt-1 text-sm text-[#5b6678]">
                  Unique files aggregated across commits and
                  pull requests.
                </p>
              </div>

              <div className="text-xs text-[#8a95a6]">
                No duplicate file entries
              </div>

            </div>
          </div>

          {fileActivity.length === 0 ? (
            <p className="p-6 text-sm text-[#8a95a6]">
              No changed files were returned.
            </p>
          ) : (
            <div className="divide-y divide-[#cdd5df]">

              {fileActivity.slice(0, 20).map((file) => (
                <div
                  key={file.filename}
                  className="px-6 py-3.5 flex flex-wrap items-center justify-between gap-4 hover:bg-[#f1f3f5]/50"
                >

                  <div className="min-w-0 flex items-center gap-3">

                    <FileCode
                      size={15}
                      className="text-[#0a8f6c] shrink-0"
                    />

                    <span
                      className="font-mono text-xs text-[#12203a] truncate"
                      title={file.filename}
                    >
                      {file.filename}
                    </span>

                  </div>

                  <div className="flex items-center gap-5 shrink-0">

                    <span className="text-xs text-[#5b6678]">
                      {file.commits} commit
                      {file.commits !== 1 ? "s" : ""}
                    </span>

                    <span className="text-xs text-[#5b6678]">
                      {file.pullRequests} PR
                      {file.pullRequests !== 1
                        ? "s"
                        : ""}
                    </span>

                    {(file.additions > 0 ||
                      file.deletions > 0) && (
                      <span className="font-mono text-[11px]">
                        <span className="text-[#0a8f6c]">
                          +{file.additions}
                        </span>{" "}
                        <span className="text-[#8a95a6]">
                          −{file.deletions}
                        </span>
                      </span>
                    )}

                  </div>
                </div>
              ))}

              {fileActivity.length > 20 && (
                <div className="px-6 py-3 text-xs text-[#8a95a6]">
                  Showing 20 of {fileActivity.length} unique
                  files.
                </div>
              )}

            </div>
          )}
        </section>

        {/* ====================================================== */}
        {/* COMMIT HISTORY                                         */}
        {/* ====================================================== */}

        <section className="bg-white rounded-xl border border-[#cdd5df] p-6">

          <div className="mb-6">

            <div className="flex items-center gap-2">

              <GitCommit
                size={18}
                className="text-[#0a8f6c]"
              />

              <div>
                <h2 className="text-lg font-bold text-[#12203a]">
                  Commit history
                </h2>

                <p className="text-sm text-[#5b6678] mt-0.5">
                  Select a commit to inspect its changed files.
                </p>
              </div>

            </div>

          </div>

          {commits.length === 0 ? (
            <p className="text-sm text-[#8a95a6]">
              No commits were returned for this member.
            </p>
          ) : (
            <div className="relative">

              {/* Timeline vertical line */}
              <div className="absolute left-[7px] top-3 bottom-3 w-px bg-[#cdd5df]" />

              <div className="space-y-2">

                {visibleCommits.map(
                  (commit, index) => {
                    const key =
                      commit.sha ||
                      `commit-${index}`;

                    const open =
                      expandedCommit === key;

                    const files = Array.isArray(
                      commit.files
                    )
                      ? commit.files
                      : [];

                    return (
                      <div
                        key={key}
                        className="relative pl-7"
                      >

                        {/* Timeline dot */}
                        <div className="absolute left-0 top-5 w-[15px] h-[15px] rounded-full border-2 border-white bg-[#0a8f6c] ring-1 ring-[#cdd5df]" />

                        <button
                          type="button"
                          onClick={() =>
                            setExpandedCommit(
                              open ? null : key
                            )
                          }
                          className="w-full text-left rounded-lg border border-[#cdd5df] p-4 hover:bg-[#f1f3f5]/60"
                        >

                          <div className="flex items-start justify-between gap-4">

                            <div className="min-w-0">

                              <div className="flex flex-wrap items-center gap-2">

                                <span className="font-mono text-[10px] font-bold text-[#0a8f6c]">
                                  {commit.sha
                                    ? String(
                                        commit.sha
                                      ).slice(0, 7)
                                    : "commit"}
                                </span>

                                <span className="text-[10px] text-[#8a95a6]">
                                  {formatDate(
                                    commit.date
                                  )}
                                </span>

                              </div>

                              <p className="mt-1 text-sm font-semibold text-[#12203a]">
                                {commit.message ||
                                  "No commit message"}
                              </p>

                              <div className="mt-2 flex flex-wrap gap-4 text-xs text-[#5b6678]">

                                <span>
                                  {files.length} file
                                  {files.length !== 1
                                    ? "s"
                                    : ""}
                                </span>

                                {(commit.additions !=
                                  null ||
                                  commit.deletions !=
                                    null) && (
                                  <span className="font-mono">
                                    <span className="text-[#0a8f6c]">
                                      +
                                      {commit.additions ??
                                        0}
                                    </span>{" "}
                                    <span>
                                      −
                                      {commit.deletions ??
                                        0}
                                    </span>
                                  </span>
                                )}

                              </div>

                            </div>

                            {open ? (
                              <ChevronUp
                                size={16}
                                className="text-[#8a95a6] shrink-0"
                              />
                            ) : (
                              <ChevronDown
                                size={16}
                                className="text-[#8a95a6] shrink-0"
                              />
                            )}

                          </div>
                        </button>

                        {/* Expanded commit */}
                        {open && (
                          <div className="mt-1 rounded-lg border border-[#cdd5df] bg-[#f1f3f5]/60 p-4">

                            {commit.url && (
                              <a
                                href={commit.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0a8f6c]"
                              >
                                View commit on GitHub
                                <ExternalLink size={12} />
                              </a>
                            )}

                            {files.length > 0 && (
                              <div className="mt-4">

                                <p className="text-[10px] font-bold uppercase tracking-wider text-[#5b6678]">
                                  Changed files
                                </p>

                                <div className="mt-2 divide-y divide-[#cdd5df] rounded-lg border border-[#cdd5df] bg-white">

                                  {files.map(
                                    (
                                      file,
                                      fileIndex
                                    ) => {
                                      const filename =
                                        typeof file ===
                                        "string"
                                          ? file
                                          : file?.filename;

                                      return (
                                        <div
                                          key={`${key}-${fileIndex}`}
                                          className="px-3 py-2 flex items-center justify-between gap-3"
                                        >

                                          <div className="flex items-center gap-2 min-w-0">

                                            <FileCode
                                              size={12}
                                              className="text-[#0a8f6c] shrink-0"
                                            />

                                            <span className="font-mono text-[11px] text-[#12203a] truncate">
                                              {filename ||
                                                "Changed file"}
                                            </span>

                                          </div>

                                          {typeof file ===
                                            "object" &&
                                            (file.additions !=
                                              null ||
                                              file.deletions !=
                                                null) && (
                                              <span className="font-mono text-[10px] shrink-0">

                                                <span className="text-[#0a8f6c]">
                                                  +
                                                  {file.additions ??
                                                    0}
                                                </span>{" "}

                                                <span className="text-[#8a95a6]">
                                                  −
                                                  {file.deletions ??
                                                    0}
                                                </span>

                                              </span>
                                            )}

                                        </div>
                                      );
                                    }
                                  )}

                                </div>
                              </div>
                            )}

                            {files.length === 0 && (
                              <p className="mt-3 text-xs text-[#8a95a6]">
                                No file list for this commit.
                              </p>
                            )}

                          </div>
                        )}
                      </div>
                    );
                  }
                )}

              </div>
            </div>
          )}

          {commits.length > 10 && (
            <button
              type="button"
              onClick={() =>
                setShowAllCommits(
                  (value) => !value
                )
              }
              className="w-full mt-5 py-2.5 rounded-md border border-[#cdd5df] text-sm font-semibold text-[#12203a] hover:bg-[#f1f3f5]"
            >
              {showAllCommits
                ? "Show fewer commits"
                : `Show all ${commits.length} commits`}
            </button>
          )}
        </section>

        {/* ====================================================== */}
        {/* PULL REQUESTS                                          */}
        {/* ====================================================== */}

        {pullRequests.length > 0 && (
          <section className="bg-white rounded-xl border border-[#cdd5df] overflow-hidden">

            <div className="p-6 border-b border-[#cdd5df]">

              <div className="flex items-center gap-2">

                <GitPullRequest
                  size={18}
                  className="text-[#0a8f6c]"
                />

                <div>
                  <h2 className="text-lg font-bold text-[#12203a]">
                    Pull requests
                  </h2>

                  <p className="text-sm text-[#5b6678] mt-0.5">
                    PR work units attributed to this member.
                  </p>
                </div>

              </div>
            </div>

            <div className="divide-y divide-[#cdd5df]">

              {pullRequests.map((pr, index) => {
                const files = Array.isArray(pr.files)
                  ? pr.files
                  : [];

                return (
                  <div
                    key={
                      pr.number ||
                      `pr-${index}`
                    }
                    className="px-6 py-4 hover:bg-[#f1f3f5]/50"
                  >

                    <div className="flex items-start justify-between gap-5">

                      <div className="min-w-0">

                        <div className="flex flex-wrap items-center gap-2">

                          <span className="text-[10px] font-bold uppercase tracking-wider text-[#0a8f6c]">
                            PR #{pr.number}
                          </span>

                          {pr.merged && (
                            <span className="text-[10px] font-semibold uppercase text-[#5b6678]">
                              merged
                            </span>
                          )}

                        </div>

                        <p className="mt-1 text-sm font-semibold text-[#12203a]">
                          {pr.title ||
                            "Pull request"}
                        </p>

                        {pr.branch && (
                          <p className="mt-1 font-mono text-xs text-[#5b6678]">
                            {pr.branch}

                            {pr.base_branch
                              ? ` → ${pr.base_branch}`
                              : ""}
                          </p>
                        )}

                      </div>

                      <div className="text-right shrink-0">

                        <p className="text-sm font-bold text-[#12203a]">
                          {files.length}
                        </p>

                        <p className="text-[10px] text-[#8a95a6]">
                          files
                        </p>

                      </div>

                    </div>

                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[#5b6678]">

                      {pr.pr_commit_count !=
                        null && (
                        <span>
                          {pr.pr_commit_count} commits
                        </span>
                      )}

                      {files.length > 0 && (
                        <span>
                          {files
                            .slice(0, 4)
                            .map(
                              (
                                file,
                                fileIndex
                              ) => (
                                <React.Fragment
                                  key={
                                    fileIndex
                                  }
                                >
                                  {fileIndex > 0 &&
                                    " · "}

                                  {shortPath(
                                    typeof file ===
                                      "string"
                                      ? file
                                      : file?.filename
                                  )}
                                </React.Fragment>
                              )
                            )}

                          {files.length > 4 &&
                            ` · +${
                              files.length - 4
                            } more`}
                        </span>
                      )}

                    </div>
                  </div>
                );
              })}

            </div>
          </section>
        )}

        {/* ====================================================== */}
        {/* BRANCH ACTIVITY                                        */}
        {/* ====================================================== */}

        {branches.length > 0 && (
          <section className="bg-white rounded-xl border border-[#cdd5df] overflow-hidden">

            <div className="p-6 border-b border-[#cdd5df]">

              <div className="flex items-center gap-2">

                <GitBranch
                  size={18}
                  className="text-[#0a8f6c]"
                />

                <div>
                  <h2 className="text-lg font-bold text-[#12203a]">
                    Branch activity
                  </h2>

                  <p className="text-sm text-[#5b6678] mt-0.5">
                    Branches observed through pull requests.
                  </p>
                </div>

              </div>
            </div>

            <div className="divide-y divide-[#cdd5df]">

              {branches.map((branch) => (
                <div
                  key={branch.name}
                  className="px-6 py-3.5 flex flex-wrap items-center justify-between gap-4"
                >

                  <div className="min-w-0">

                    <p className="font-mono text-sm font-semibold text-[#12203a] truncate">
                      {branch.name}
                    </p>

                    <p className="mt-1 text-xs text-[#5b6678]">
                      {branch.files} unique file
                      {branch.files !== 1
                        ? "s"
                        : ""}{" "}
                      touched
                    </p>

                  </div>

                  <div className="flex items-center gap-5 text-xs text-[#5b6678]">

                    <span>
                      {branch.prs} PR
                      {branch.prs !== 1
                        ? "s"
                        : ""}
                    </span>

                    <span>
                      {branch.merged} merged
                    </span>

                  </div>

                </div>
              ))}

            </div>
          </section>
        )}

        {/* ====================================================== */}
        {/* OBSERVABLE PATTERNS                                    */}
        {/* ====================================================== */}

        {memberPatterns.length > 0 && (
          <section className="bg-white rounded-xl border border-[#cdd5df] p-6">

            <div className="mb-5">

              <p className="text-xs font-bold uppercase tracking-wider text-[#0a8f6c]">
                Analysis signals
              </p>

              <h2 className="mt-1 text-lg font-bold text-[#12203a]">
                Observable patterns
              </h2>

              <p className="mt-1 text-sm text-[#5b6678]">
                Signals linked to this member in the analysis.
              </p>

            </div>

            <div className="divide-y divide-[#cdd5df]">

              {memberPatterns.map(
                (pattern, index) => (
                  <div
                    key={`${pattern.type}-${index}`}
                    className="py-4 first:pt-0 last:pb-0"
                  >

                    <div className="flex flex-wrap items-center gap-2">

                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#0a8f6c]">
                        {String(
                          pattern.type || ""
                        ).replaceAll(
                          "_",
                          " "
                        )}
                      </span>

                      {pattern.severity && (
                        <span className="text-[10px] uppercase text-[#8a95a6]">
                          {pattern.severity}
                        </span>
                      )}

                    </div>

                    <p className="mt-1 text-sm text-[#5b6678]">
                      {pattern.description}
                    </p>

                  </div>
                )
              )}

            </div>
          </section>
        )}

        {/* ====================================================== */}
        {/* PROOF OF UNDERSTANDING                                 */}
        {/* ====================================================== */}

        <section className="bg-[#12203a] rounded-xl p-7 text-white">

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">

            <div>

              <p className="text-xs font-bold uppercase tracking-wider text-[#7fe0c0]">
                Proof of Understanding
              </p>

              <h2 className="mt-1 text-xl font-bold">
                Verify understanding separately from GitHub activity.
              </h2>

              <p className="mt-2 text-sm text-[#b8c2d3] max-w-2xl">
                GitHub evidence shows observable activity. The proof
                step checks whether the member can explain the work.
              </p>

            </div>

            <button
              onClick={() =>
                navigate(
                  `/project/${projectId}/understanding/tasks?member=${memberId}`
                )
              }
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-md bg-[#0a8f6c] text-white font-semibold hover:bg-[#087a5a]"
            >
              Start Understanding Check
              <Play size={15} />
            </button>

          </div>
        </section>
      </main>
    </PageShell>
  );
}

function PageShell({ projectId, children }) {
  return (
    <div className="flex min-h-screen bg-[#f1f3f5]">
      <Sidebar projectId={projectId} />

      <div className="flex-1 min-w-0">
        {children}
      </div>
    </div>
  );
}

function PageHeader({
  title,
  subtitle,
  onBack,
}) {
  return (
    <header className="bg-white border-b border-[#cdd5df]">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 h-20 flex items-center gap-4">

        <button
          onClick={onBack}
          className="text-[#5b6678] hover:text-[#12203a]"
        >
          <ArrowLeft size={20} />
        </button>

        <div>
          <h1 className="text-xl font-bold text-[#12203a]">
            {title}
          </h1>

          <p className="text-sm text-[#5b6678] mt-1">
            {subtitle}
          </p>
        </div>

      </div>
    </header>
  );
}

function CompactMetric({ label, value }) {
  return (
    <div>
      <p className="text-2xl font-bold text-[#12203a]">
        {value ?? "—"}
      </p>

      <p className="text-xs text-[#5b6678] mt-1">
        {label}
      </p>
    </div>
  );
}

function EvidenceStat({ label, value }) {
  return (
    <div className="rounded-lg bg-[#f1f3f5] p-4">
      <p className="text-2xl font-bold text-[#12203a]">
        {value ?? "—"}
      </p>

      <p className="text-xs text-[#5b6678] mt-1">
        {label}
      </p>
    </div>
  );
}

function TimelineItem({ event }) {
  const files =
    event.files ||
    event.changed_files ||
    event.metadata?.files ||
    [];

  return (
    <article className="border-l-2 border-[#cdd5df] pl-5 py-1">

      <div className="flex flex-wrap justify-between gap-2">

        <span className="text-[10px] font-bold uppercase tracking-wider text-[#0a8f6c]">
          {String(
            event.event_type ||
              event.type ||
              "Activity"
          ).replaceAll("_", " ")}
        </span>

        <span className="text-xs text-[#8a95a6]">
          {formatDate(
            event.timestamp ||
              event.created_at
          )}
        </span>

      </div>

      <p className="mt-1 text-sm font-semibold text-[#12203a]">
        {event.title ||
          event.message ||
          event.commit_message ||
          event.label ||
          event.artifact ||
          "GitHub activity"}
      </p>

      {files.length > 0 && (
        <div className="mt-3 space-y-1">

          {files.slice(0, 6).map(
            (file, index) => (
              <div
                key={index}
                className="flex items-center gap-2 text-xs text-[#5b6678] font-mono"
              >

                <FileCode size={12} />

                {typeof file === "string"
                  ? file
                  : file?.filename ||
                    "Changed file"}

              </div>
            )
          )}

        </div>
      )}
    </article>
  );
}

function findMemberAnalysis(
  analysis,
  memberId
) {
  return (
    analysis?.member_analysis?.find(
      (item) =>
        Number(item.member_id) ===
        Number(memberId)
    ) || null
  );
}

function getEvidenceCount(result) {
  if (!result) return 0;

  if (result.total_events != null) {
    return result.total_events;
  }

  if (result.evidence_events != null) {
    return result.evidence_events;
  }

  const activity = result.activity || {};

  return [
    "commits",
    "pull_requests",
    "reviews",
    "review_comments",
    "issues",
    "ci_runs",
  ]
    .map((key) => activity[key])
    .filter((value) => value != null)
    .reduce(
      (sum, value) =>
        sum + Number(value || 0),
      0
    );
}

function normalizeTimeline(data) {
  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data?.events)) {
    return data.events;
  }

  if (Array.isArray(data?.timeline)) {
    return data.timeline;
  }

  return [];
}

function formatDate(value) {
  if (!value) {
    return "Unknown time";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  return date.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function shortPath(path) {
  const text = String(path || "");

  if (text.length <= 42) {
    return text;
  }

  const parts = text.split("/");

  if (parts.length <= 2) {
    return text.slice(0, 39) + "...";
  }

  return (
    parts[0] +
    "/…/" +
    parts[parts.length - 1]
  );
}

function ErrorBox({ message }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex gap-3">

      <AlertCircle
        size={17}
        className="shrink-0"
      />

      {message}
    </div>
  );
}
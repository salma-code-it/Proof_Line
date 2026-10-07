import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import {
  getMemberData,
  getTaskEvidence,
} from "../api";
import {
  ArrowLeft,
  ExternalLink,
  FileCode,
  GitCommit,
  GitPullRequest,
  MessageSquare,
  CheckCircle,
  Play,
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
        if (active) setError(err.message || "Failed to load members.");
      } finally {
        if (active) setLoading(false);
      }
    }

    load();

    return () => {
      active = false;
    };
  }, [projectId]);

  if (loading) {
    return <PageShell projectId={projectId}>Loading members...</PageShell>;
  }

  if (error) {
    return <PageShell projectId={projectId}><ErrorBox message={error} /></PageShell>;
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

      <main className="max-w-6xl mx-auto px-5 sm:px-8 py-8">
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
                    <div>
                      <p className="font-semibold text-[#12203a]">
                        {member.display_name ||
                          member.github_username}
                      </p>
                      <p className="text-xs text-[#5b6678] mt-1">
                        @{member.github_username}
                      </p>
                    </div>
                    <div className="text-right">
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
  const [selectedEvidence, setSelectedEvidence] = useState(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const result = await getMemberData(projectId, memberId);
        if (active) setData(result);
      } catch (err) {
        if (active) setError(err.message || "Failed to load member.");
      } finally {
        if (active) setLoading(false);
      }
    }

    load();

    return () => {
      active = false;
    };
  }, [projectId, memberId]);

  async function viewTaskEvidence(taskId) {
    setEvidenceLoading(true);
    setError("");

    try {
      const result = await getTaskEvidence(projectId, taskId);
      setSelectedEvidence(result);
    } catch (err) {
      setError(err.message || "Failed to load task evidence.");
    } finally {
      setEvidenceLoading(false);
    }
  }

  if (loading) {
    return <PageShell projectId={projectId}>Tracing member evidence...</PageShell>;
  }

  if (error && !data) {
    return (
      <PageShell projectId={projectId}>
        <ErrorBox message={error} />
      </PageShell>
    );
  }

  const member = data?.member || {};
  const analysis = findMemberAnalysis(
    data?.analysis,
    memberId
  );

  const activity = analysis?.activity || {};
  const timeline = normalizeTimeline(data?.timeline);
  const tasks = getMemberTasks(data?.analysis, memberId);

  const githubUsername =
    member.github_username ||
    member.login ||
    "";

  const profileUrl = githubUsername
    ? `https://github.com/${githubUsername}`
    : null;

  return (
    <PageShell projectId={projectId}>
      <PageHeader
        title={member.display_name || githubUsername || "Member"}
        subtitle={
          githubUsername ? `@${githubUsername}` : "GitHub member"
        }
        onBack={() =>
          navigate(`/project/${projectId}/members`)
        }
      />

      <main className="max-w-6xl mx-auto px-5 sm:px-8 py-8 space-y-8">
        {error && <ErrorBox message={error} />}

        <section className="bg-white rounded-xl border border-[#cdd5df] p-6">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-[#0a8f6c]">
                Observable evidence
              </p>
              <h2 className="mt-1 text-xl font-bold text-[#12203a]">
                {member.display_name || githubUsername || "Member"}
              </h2>
              {githubUsername && (
                <p className="mt-1 text-sm text-[#5b6678]">
                  @{githubUsername}
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

          <div className="mt-7 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <EvidenceStat
              label="Commits"
              value={activity.commits}
            />
            <EvidenceStat
              label="Pull Requests"
              value={activity.pull_requests}
            />
            <EvidenceStat
              label="Reviews"
              value={activity.reviews}
            />
            <EvidenceStat
              label="Comments"
              value={activity.comments}
            />
            <EvidenceStat
              label="Issues"
              value={activity.issues}
            />
            <EvidenceStat
              label="Active days"
              value={activity.active_days}
            />
          </div>
        </section>

        <section className="bg-white rounded-xl border border-[#cdd5df] p-6">
          <div className="mb-5">
            <h2 className="text-lg font-bold text-[#12203a]">
              Evidence Overview
            </h2>
            <p className="text-sm text-[#5b6678] mt-1">
              Counts returned by the project analysis.
            </p>
          </div>

          <div className="space-y-4">
            {[
              ["Commits", activity.commits],
              ["Pull Requests", activity.pull_requests],
              ["Reviews", activity.reviews],
              ["Comments", activity.comments],
              ["Issues", activity.issues],
              ["CI Activity", activity.ci_runs],
            ]
              .filter(([, value]) => value !== undefined && value !== null)
              .map(([label, value]) => (
                <EvidenceBar
                  key={label}
                  label={label}
                  value={value}
                  max={Math.max(
                    1,
                    ...[
                      activity.commits,
                      activity.pull_requests,
                      activity.reviews,
                      activity.comments,
                      activity.issues,
                      activity.ci_runs,
                    ]
                      .filter((v) => v !== undefined && v !== null)
                      .map(Number)
                  )}
                />
              ))}
          </div>
        </section>

        <section className="bg-white rounded-xl border border-[#cdd5df] p-6">
          <div className="flex items-center justify-between gap-4 mb-5">
            <div>
              <h2 className="text-lg font-bold text-[#12203a]">
                Related Tasks
              </h2>
              <p className="text-sm text-[#5b6678] mt-1">
                Tasks connected to this member's observable evidence.
              </p>
            </div>
          </div>

          {tasks.length === 0 ? (
            <p className="text-sm text-[#8a95a6]">
              No task/member relationship is available yet.
            </p>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {tasks.map((task) => (
                <div
                  key={task.task_id}
                  className="rounded-lg border border-[#cdd5df] p-5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-semibold text-[#12203a]">
                        {task.task}
                      </h3>
                      <p className="text-xs text-[#5b6678] mt-2">
                        Evidence: {task.evidence_count ?? "available"}
                      </p>
                    </div>
                    <span className="text-[10px] font-bold uppercase text-[#0a8f6c]">
                      {task.alignment || "EVIDENCE"}
                    </span>
                  </div>

                  <button
                    onClick={() => viewTaskEvidence(task.task_id)}
                    disabled={evidenceLoading}
                    className="mt-4 w-full py-2.5 rounded-md border border-[#cdd5df] text-sm font-semibold text-[#12203a] hover:bg-[#f1f3f5]"
                  >
                    {evidenceLoading
                      ? "Loading..."
                      : "View Evidence"}
                  </button>
                </div>
              ))}
            </div>
          )}

          {selectedEvidence && (
            <EvidencePanel
              evidence={selectedEvidence}
              onClose={() => setSelectedEvidence(null)}
            />
          )}
        </section>

        <section className="bg-white rounded-xl border border-[#cdd5df] p-6">
          <div className="mb-5">
            <h2 className="text-lg font-bold text-[#12203a]">
              Member Timeline
            </h2>
            <p className="text-sm text-[#5b6678] mt-1">
              Detailed observable activity for this member.
            </p>
          </div>

          <div className="space-y-4">
            {timeline.length === 0 ? (
              <p className="text-sm text-[#8a95a6]">
                No member timeline events were returned.
              </p>
            ) : (
              timeline.slice(0, 30).map((event, index) => (
                <TimelineItem
                  key={event.id || index}
                  event={event}
                />
              ))
            )}
          </div>
        </section>

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
                GitHub evidence shows observable activity. The proof step
                checks whether the member can explain the work.
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
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function PageHeader({ title, subtitle, onBack }) {
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

function EvidenceStat({ label, value }) {
  return (
    <div className="rounded-lg bg-[#f1f3f5] p-4">
      <p className="text-2xl font-bold text-[#12203a]">
        {value ?? "—"}
      </p>
      <p className="text-xs text-[#5b6678] mt-1">{label}</p>
    </div>
  );
}

function EvidenceBar({ label, value, max }) {
  return (
    <div className="grid grid-cols-[110px_1fr_45px] gap-3 items-center">
      <span className="text-xs font-semibold text-[#5b6678]">
        {label}
      </span>
      <div className="h-2.5 rounded bg-[#f1f3f5] overflow-hidden">
        <div
          className="h-full rounded bg-[#0a8f6c]"
          style={{
            width: `${Math.min(100, (Number(value) / max) * 100)}%`,
          }}
        />
      </div>
      <span className="text-xs font-mono text-right text-[#12203a]">
        {value}
      </span>
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
            event.event_type || event.type || "Activity"
          )
            .replaceAll("_", " ")}
        </span>
        <span className="text-xs text-[#8a95a6]">
          {formatDate(event.timestamp || event.created_at)}
        </span>
      </div>

      <p className="mt-1 text-sm font-semibold text-[#12203a]">
        {event.title ||
          event.message ||
          event.commit_message ||
          event.artifact ||
          "GitHub activity"}
      </p>

      {files.length > 0 && (
        <div className="mt-3 space-y-1">
          {files.slice(0, 8).map((file, index) => (
            <div
              key={index}
              className="flex items-center gap-2 text-xs text-[#5b6678] font-mono"
            >
              <FileCode size={12} />
              {typeof file === "string"
                ? file
                : file?.filename || "Changed file"}
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function EvidencePanel({ evidence, onClose }) {
  return (
    <div className="mt-5 rounded-lg border border-[#cdd5df] bg-[#f1f3f5] p-5">
      <div className="flex justify-between gap-4">
        <h3 className="font-bold text-[#12203a]">
          Task Evidence
        </h3>
        <button
          onClick={onClose}
          className="text-xs font-semibold text-[#5b6678]"
        >
          Close
        </button>
      </div>
      <pre className="mt-4 overflow-x-auto text-xs text-[#12203a] whitespace-pre-wrap">
        {JSON.stringify(evidence, null, 2)}
      </pre>
    </div>
  );
}

function findMemberAnalysis(analysis, memberId) {
  return (
    analysis?.member_analysis?.find(
      (item) =>
        Number(item.member_id) === Number(memberId)
    ) || null
  );
}

function getEvidenceCount(result) {
  if (!result) return 0;
  if (result.evidence_events != null) return result.evidence_events;

  const activity = result.activity || {};
  return [
    "commits",
    "pull_requests",
    "reviews",
    "comments",
    "issues",
    "ci_runs",
  ]
    .map((key) => activity[key])
    .filter((value) => value != null)
    .reduce((sum, value) => sum + Number(value || 0), 0);
}

function getMemberTasks(analysis, memberId) {
  const row = analysis?.task_member_matching?.members?.find(
    (item) =>
      Number(item.member_id) === Number(memberId)
  );

  return row?.tasks || [];
}

function normalizeTimeline(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.events)) return data.events;
  if (Array.isArray(data?.timeline)) return data.timeline;
  return [];
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

function ErrorBox({ message }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      {message}
    </div>
  );
}

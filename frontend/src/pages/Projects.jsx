
import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import {
  getDashboardData,
  createProject,
  analyzeProject,
  getContributionAnalysis,
} from "../api";
import {
  TaskMemberChart,
  EvidenceBreakdownChart,
  TimelineChart,
  ContributionScoreChart,
  MemberFileActivityChart,
} from "../components/Charts";
import {
  ArrowLeft,
  ExternalLink,
  RefreshCw,
  Users,
  CheckSquare,
  Activity,
  GitCommit,
  AlertCircle,
} from "lucide-react";

export default function Projects() {
  const { projectId } = useParams();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [contributionAnalysis, setContributionAnalysis] = useState(null);
  const [contributionError, setContributionError] = useState("");
  const [loading, setLoading] = useState(Boolean(projectId));
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");

  const [nameInput, setNameInput] = useState("");
  const [urlInput, setUrlInput] = useState("");

  const isCreatePage = !projectId;
  async function loadDashboard() {
    if (!projectId) return;

    setLoading(true);
    setError("");
    setContributionError("");

    try {
      const [dashboardResult, contributionResult] =
        await Promise.allSettled([
          getDashboardData(projectId),
          getContributionAnalysis(projectId),
        ]);

      // Dashboard data is required for the page.
      if (dashboardResult.status === "rejected") {
        throw dashboardResult.reason;
      }

      setData(dashboardResult.value);

      // Contribution data is optional for the rest of the dashboard.
      if (contributionResult.status === "fulfilled") {
        setContributionAnalysis(contributionResult.value);
      } else {
        setContributionAnalysis(null);
        setContributionError(
          contributionResult.reason?.message ||
            "Could not load contribution analysis."
        );
      }
    } catch (err) {
      setError(err.message || "Failed to load project.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, [projectId]);

    
  // Create a project
  async function handleCreate(event) {
    event.preventDefault();

    if (!nameInput.trim() || !urlInput.trim()) {
      setError("Project name and repository URL are required.");
      return;
    }

    setAnalyzing(true);
    setError("");

    try {
      const project = await createProject({
        name: nameInput.trim(),
        repo_url: urlInput.trim(),
      });

      if (!project?.id) {
        throw new Error(
          "The backend created the project but did not return its ID."
        );
      }

      await analyzeProject(project.id);
      navigate(`/project/${project.id}`);
    } catch (err) {
      setError(
        err.message ||
          "The project could not be saved and analyzed."
      );
    } finally {
      setAnalyzing(false);
    }
  }

    
  // Analyze the project again 
  async function handleAnalyze() {
    if (!projectId) return;

    setAnalyzing(true);
    setError("");

    try {
      await analyzeProject(projectId);
      await loadDashboard();
    } catch (err) {
      setError(err.message || "Analysis failed.");
    } finally {
      setAnalyzing(false);
    }
  }

    
  // Create project page
  if (isCreatePage) {
    return (
      <div className="flex min-h-screen bg-[#f1f3f5]">
        <Sidebar />

        <main className="flex-1 flex items-center justify-center p-6">
          <form
            onSubmit={handleCreate}
            className="w-full max-w-xl bg-white border border-[#cdd5df] rounded-xl p-8"
          >
            <div className="mb-8">
              <p className="text-xs font-bold uppercase tracking-wider text-[#0a8f6c]">
                New project
              </p>

              <h1 className="mt-2 text-2xl font-bold text-[#12203a]">
                Analyze a GitHub project
              </h1>

              <p className="mt-2 text-sm leading-relaxed text-[#5b6678]">
                Save the repository, collect deterministic GitHub evidence,
                and build the project evidence trail.
              </p>
            </div>

            {error && <ErrorBox message={error} />}

            <div className="space-y-5">
              <Field
                label="Project name"
                value={nameInput}
                onChange={setNameInput}
                placeholder="e.g. ML Prediction Project"
              />

              <Field
                label="GitHub repository URL"
                value={urlInput}
                onChange={setUrlInput}
                placeholder="https://github.com/owner/repository"
                type="url"
              />

              <button
                type="submit"
                disabled={analyzing}
                className="w-full rounded-md bg-[#12203a] py-3 text-sm font-semibold text-white hover:bg-[#1d3158] disabled:opacity-50"
              >
                {analyzing
                  ? "Saving project and collecting evidence..."
                  : "Save & Analyze Project"}
              </button>
            </div>
          </form>
        </main>
      </div>
    );
  }
  // Loading page
  if (loading && !data) {
    return (
      <div className="flex min-h-screen bg-[#f1f3f5]">
        <Sidebar projectId={projectId} />

        <main className="flex-1 flex items-center justify-center text-sm text-[#5b6678]">
          Loading project evidence...
        </main>
      </div>
    );
  }

    
  // Project not found or unavailable 
  if (!data?.project) {
    return (
      <div className="flex min-h-screen bg-[#f1f3f5]">
        <Sidebar projectId={projectId} />

        <main className="flex-1 p-8">
          <ErrorBox
            message={error || "Project data is unavailable."}
          />
        </main>
      </div>
    );
  }

  const {
    project,
    analysis,
    timeline,
    evidenceGraph,
  } = data;

  const members = Array.isArray(project.github_contributors)
    ? project.github_contributors
    : [];

  const events = normalizeEvents(timeline);

  const memberAnalysis = Array.isArray(analysis?.member_analysis)
    ? analysis.member_analysis
    : [];
  const contributionMembers = Array.isArray(
    contributionAnalysis?.members
  )
    ? contributionAnalysis.members
    : [];
  const configuredTasks = Array.isArray(project.tasks)
    ? project.tasks
    : [];

  const taskAnalysisRaw = Array.isArray(analysis?.task_analysis)
    ? analysis.task_analysis
    : [];

  const taskCount =
    configuredTasks.length > 0
      ? configuredTasks.length
      : taskAnalysisRaw.length;
  const taskAnalysis = taskAnalysisRaw.map((task, index) => {
    const taskId = task.task_id ?? task.id ?? `work-area-${index}`;

    const taskName =
      task.name || task.task_name || `Work area ${index + 1}`;

    const evidenceUnits = getNumericValue(task.evidence_units);

    const contributors = Array.isArray(task.contributors)
      ? task.contributors.map((c) => {
          if (typeof c === "string") {
            return {
              member_name: c,
              evidence_units: evidenceUnits,
            };
          }

          return {
            ...c,
            evidence_units:
              getNumericValue(c.evidence_units) ??
              getNumericValue(c.evidence_count) ??
              evidenceUnits,
          };
        })
      : [];

    return {
      ...task,
      task_id: taskId,
      id: taskId,
      name: taskName,
      contributors,
    };
  });

  const scatterData = members
    .map((member) => {
      const result = findMemberAnalysis(member, memberAnalysis);
      const evidenceCount = getMemberEvidenceCount(result);

      return {
        id: member.id ?? result?.member_id ?? null,
        name:
          member.display_name ||
          member.github_username ||
          result?.display_name ||
          result?.github_username ||
          "Member",
        evidence: evidenceCount !== null ? evidenceCount : 0,
        understanding:
          getNumericValue(result?.understanding_score) ??
          getNumericValue(result?.understanding) ??
          null,
      };
    })
    .filter((item) => item.evidence !== null);

  const activity = getCollectionActivity(analysis, memberAnalysis);

  const evidenceEvents =
    activity.events_stored ??
    activity.evidence_events ??
    getNumericValue(analysis?.total_events) ??
    null;

  return (
    <div className="flex min-h-screen bg-[#f1f3f5]">
      <Sidebar projectId={projectId} />

      <div className="flex-1 min-w-0 pb-16">
        <header className="sticky top-0 z-30 bg-white border-b border-[#cdd5df]">
          <div className="max-w-7xl mx-auto px-5 sm:px-8 h-20 flex items-center justify-between gap-5">
            <div className="flex items-center gap-4 min-w-0">
              <button
                onClick={() => navigate("/")}
                className="text-[#5b6678] hover:text-[#12203a]"
              >
                <ArrowLeft size={20} />
              </button>

              <div className="min-w-0">
                <h1 className="text-lg font-bold text-[#12203a] truncate">
                  {project.name}
                </h1>

                <p className="text-xs text-[#5b6678] font-mono truncate">
                  {project.repo_url ||
                    project.repo ||
                    "GitHub repository"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              {project.repo_url && (
                <a
                  href={project.repo_url}
                  target="_blank"
                  rel="noreferrer"
                  className="hidden sm:inline-flex items-center gap-2 px-3 py-2 rounded-md border border-[#cdd5df] text-sm font-medium text-[#5b6678] hover:text-[#12203a]"
                >
                  GitHub
                  <ExternalLink size={14} />
                </a>
              )}

              <button
                onClick={handleAnalyze}
                disabled={analyzing}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#12203a] text-white text-sm font-semibold hover:bg-[#1d3158] disabled:opacity-50"
              >
                <RefreshCw
                  size={15}
                  className={analyzing ? "animate-spin" : ""}
                />

                {analyzing ? "Analyzing..." : "Analyze Project"}
              </button>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-5 sm:px-8 py-8 space-y-8">
          {error && <ErrorBox message={error} />}

          {/* Project Overview */}
          <section>
            <div className="mb-5">
              <p className="text-xs font-bold uppercase tracking-wider text-[#0a8f6c]">
                Project overview
              </p>

              <h2 className="mt-1 text-2xl font-bold text-[#12203a]">
                Observable evidence
              </h2>

              <p className="mt-1 text-sm text-[#5b6678]">
                Deterministic repository activity collected for this project.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <MetricCard
                icon={<Users size={17} />}
                label="Members"
                value={members.length}
                onClick={() =>
                  navigate(`/project/${projectId}/members`)
                }
              />

              <MetricCard
                icon={<CheckSquare size={17} />}
                label="Tasks"
                value={taskCount}
                onClick={() =>
                  navigate(
                    `/project/${projectId}/understanding/tasks`
                  )
                }
              />

              <MetricCard
                icon={<Activity size={17} />}
                label="Evidence events"
                value={evidenceEvents}
              />

              <MetricCard
                icon={<GitCommit size={17} />}
                label="Commits"
                value={activity.commits}
              />
            </div>
          </section>

          {/* Task Matrix and Repository Activity */}
          <div className="grid xl:grid-cols-2 gap-6">
            <section className="bg-white rounded-xl border border-[#cdd5df] p-6">
              <div className="mb-5">
                <h2 className="text-lg font-bold text-[#12203a]">
                  Task × Member Evidence
                </h2>

                <p className="mt-1 text-sm text-[#5b6678]">
                  Relationships returned by the evidence analysis. Automatic
                  work areas use the contributors already returned by the
                  backend.
                </p>
              </div>

              <TaskMemberChart
                evidenceGraph={evidenceGraph}
                taskAnalysis={taskAnalysis}
              />
            </section>

            <section className="bg-white rounded-xl border border-[#cdd5df] p-6">
              <div className="mb-5">
                <h2 className="text-lg font-bold text-[#12203a]">
                  Repository Activity
                </h2>

                <p className="mt-1 text-sm text-[#5b6678]">
                  Project-level metrics actually returned by the analysis.
                </p>
              </div>

              <EvidenceBreakdownChart activity={activity} />
            </section>
          </div>

          {/* Member Contribution Evidence */}
          <section className="space-y-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-[#0a8f6c]">
                Member analysis
              </p>

              <h2 className="mt-1 text-2xl font-bold text-[#12203a]">
                Member Contribution Evidence
              </h2>

              <p className="mt-1 text-sm leading-relaxed text-[#5b6678]">
                Compare observable GitHub activity, activity indicators, and
                file-type evidence for each member. These metrics describe
                recorded activity; they do not establish intellectual
                ownership or prove understanding.
              </p>
            </div>

            {contributionError && (
              <ErrorBox message={contributionError} />
            )}

            {/* Chart 1: Contribution Activity Score */}
            <div className="bg-white rounded-xl border border-[#cdd5df] p-6">
              <div className="mb-5">
                <h2 className="text-lg font-bold text-[#12203a]">
                  Activity Indicator
                </h2>

                <p className="mt-1 text-sm text-[#5b6678]">
                  The formula-based, capped activity score returned by
                  contribution.py.
                </p>
              </div>

              <ContributionScoreChart data={contributionMembers} />
            </div>

            {/* Chart 3: File-Type Activity */}
            <div className="bg-white rounded-xl border border-[#cdd5df] p-6">
              <div className="mb-5">
                <h2 className="text-lg font-bold text-[#12203a]">
                  File-Type Activity by Member
                </h2>

                <p className="mt-1 text-sm text-[#5b6678]">
                  Compare the file-type component values returned by the
                  backend, including code, model, documentation, configuration,
                  and data files.
                </p>
              </div>

              <MemberFileActivityChart data={contributionMembers} />
            </div>
          </section>

          {/* Recent Activity */}
          <section className="bg-white rounded-xl border border-[#cdd5df] p-6">
            <div className="flex items-center justify-between gap-4 mb-5">
              <div>
                <h2 className="text-lg font-bold text-[#12203a]">
                  Recent Activity
                </h2>

                <p className="mt-1 text-sm text-[#5b6678]">
                  Chronological GitHub evidence.
                </p>
              </div>

              <button
                onClick={() =>
                  navigate(`/project/${projectId}/timeline`)
                }
                className="text-sm font-semibold text-[#0a8f6c] hover:underline"
              >
                View full timeline
              </button>
            </div>

            <TimelineChart events={events} />
          </section>

          {/* Members */}
          <section className="bg-white rounded-xl border border-[#cdd5df] p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-lg font-bold text-[#12203a]">
                  Members
                </h2>

                <p className="mt-1 text-sm text-[#5b6678]">
                  Observable evidence per project member.
                </p>
              </div>

              <button
                onClick={() =>
                  navigate(`/project/${projectId}/members`)
                }
                className="text-sm font-semibold text-[#0a8f6c] hover:underline"
              >
                View all
              </button>
            </div>

            <div className="divide-y divide-[#cdd5df]">
              {members.length === 0 ? (
                <p className="py-6 text-sm text-[#8a95a6]">
                  No project members were returned.
                </p>
              ) : (
                members.map((member) => {
                  const result = findMemberAnalysis(
                    member,
                    memberAnalysis
                  );

                  const evidence = getMemberEvidenceCount(result);

                  return (
                    <button
                      key={member.id ?? member.github_username}
                      onClick={() =>
                        member.id &&
                        navigate(
                          `/project/${projectId}/member/${member.id}`
                        )
                      }
                      className="w-full flex items-center justify-between py-4 text-left hover:bg-[#f1f3f5] px-2 rounded-md"
                    >
                      <div>
                        <p className="text-sm font-semibold text-[#12203a]">
                          {member.display_name ||
                            member.github_username}
                        </p>

                        <p className="text-xs text-[#5b6678]">
                          @{member.github_username}
                        </p>
                      </div>

                      <span className="text-sm font-semibold text-[#5b6678]">
                        {evidence !== null
                          ? `${evidence} evidence`
                          : "—"}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}) {
  return (
    <label className="block">
      <span className="block text-sm font-semibold text-[#12203a] mb-2">
        {label}
      </span>

      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-[#cdd5df] px-4 py-3 outline-none focus:ring-2 focus:ring-[#0a8f6c]/30 focus:border-[#0a8f6c]"
      />
    </label>
  );
}

// Metric Card
function MetricCard({ icon, label, value, onClick }) {
  const content = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-[#0a8f6c]">{icon}</span>

        {onClick && (
          <span className="text-xs text-[#8a95a6]">View →</span>
        )}
      </div>

      <p className="mt-5 text-3xl font-bold text-[#12203a]">
        {value !== null && value !== undefined ? value : "—"}
      </p>

      <p className="mt-1 text-sm text-[#5b6678]">{label}</p>
    </>
  );

  if (!onClick) {
    return (
      <div className="bg-white rounded-xl border border-[#cdd5df] p-5">
        {content}
      </div>
    );
  }

  return (
    <button
      onClick={onClick}
      className="bg-white rounded-xl border border-[#cdd5df] p-5 text-left hover:border-[#0a8f6c]"
    >
      {content}
    </button>
  );
}

function ErrorBox({ message }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex gap-3">
      <AlertCircle size={17} className="shrink-0 mt-0.5" />
      <span>{message}</span>
    </div>
  );
}

function normalizeEvents(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.events)) return data.events;
  if (Array.isArray(data?.timeline)) return data.timeline;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

// Repository Activity
function getCollectionActivity(analysis, memberAnalysis = []) {
  const collection = analysis?.collection || {};

  const totalReviews = memberAnalysis.reduce((sum, member) => {
    const count =
      member.event_counts?.REVIEW ??
      member.activity?.reviews ??
      0;

    return sum + Number(count || 0);
  }, 0);

  const totalReviewComments = memberAnalysis.reduce(
    (sum, member) => {
      const count =
        member.event_counts?.REVIEW_COMMENT ??
        member.activity?.review_comments ??
        member.activity?.comments ??
        0;

      return sum + Number(count || 0);
    },
    0
  );

  return {
    commits:
      getNumericValue(collection.commits_collected) ??
      getNumericValue(collection.commits),

    pull_requests:
      getNumericValue(collection.pull_requests_analyzed) ??
      getNumericValue(collection.pull_requests),

    reviews:
      getNumericValue(collection.reviews_collected) ??
      getNumericValue(collection.reviews) ??
      (totalReviews > 0 ? totalReviews : null),

    review_comments:
      getNumericValue(collection.review_comments_collected) ??
      getNumericValue(collection.review_comments) ??
      (totalReviewComments > 0 ? totalReviewComments : null),

    issues:
      getNumericValue(collection.issues_collected) ??
      getNumericValue(collection.issues),

    ci_runs:
      getNumericValue(collection.workflow_runs_collected) ??
      getNumericValue(collection.ci_runs),

    events_stored:
      getNumericValue(collection.events_stored) ??
      getNumericValue(collection.total_events),

    evidence_events: getNumericValue(collection.evidence_events),
  };
}

// Member Evidence Count
function getMemberEvidenceCount(memberAnalysis) {
  if (!memberAnalysis) return null;

  const directValues = [
    memberAnalysis.total_events,
    memberAnalysis.evidence_events,
    memberAnalysis.evidence_units,
    memberAnalysis.observable_evidence,
  ];

  for (const value of directValues) {
    const numeric = getNumericValue(value);
    if (numeric !== null) return numeric;
  }

  const activity = memberAnalysis.activity || {};
  const totals = memberAnalysis.totals || {};

  const nestedValues = [
    activity.evidence_events,
    activity.evidence_units,
    activity.observable_evidence,
    totals.changed_files_count,
  ];

  for (const value of nestedValues) {
    const numeric = getNumericValue(value);
    if (numeric !== null) return numeric;
  }

  return null;
}

// Find Matching Member Analysis
function findMemberAnalysis(member, memberAnalysis) {
  if (!Array.isArray(memberAnalysis)) return null;

  return (
    memberAnalysis.find(
      (item) =>
        member.id !== undefined &&
        item.member_id !== undefined &&
        Number(item.member_id) === Number(member.id)
    ) ||
    memberAnalysis.find(
      (item) =>
        member.github_username &&
        item.github_username &&
        String(item.github_username).toLowerCase() ===
          String(member.github_username).toLowerCase()
    ) ||
    null
  );
}
// Numeric Value Helper
function getNumericValue(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
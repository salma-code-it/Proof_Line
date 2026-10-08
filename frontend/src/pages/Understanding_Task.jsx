import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import {
  getProject,
  getLatestAnalysis,
  generateTasks,
  matchTasksToMembers,
  generateUnderstandingQuestions,
} from "../api";
import {
  ArrowLeft,
  Sparkles,
  Target,
  CheckCircle,
  AlertCircle,
  Play,
  FileCode,
  Search,
  ChevronDown,
  ChevronUp,
  Users,
  ListChecks,
  GitBranch,
  ShieldCheck,
  CircleHelp,
  RefreshCw,
} from "lucide-react";

  
// Normalization helpers
function normalizeTasks(raw) {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((t) => t && (t.name || t.task_name || t.id || t.task_id))
    .map((t, index) => ({
      ...t,
      id: t.id ?? t.task_id ?? `task-${index}`,
      name: t.name || t.task_name || `Task ${index + 1}`,
      file_patterns: normalizeFileList(t.file_patterns),
      evidence_files: normalizeFileList(t.evidence_files),
    }));
}

function normalizeFileList(value) {
  if (Array.isArray(value)) {
    return [
      ...new Set(
        value
          .map((item) => (typeof item === "string" ? item : String(item || "")))
          .map((s) => s.replace(/\\/g, "/").trim())
          .filter(Boolean)
      ),
    ];
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return normalizeFileList(parsed);
    } catch {
      // The value is not JSON; continue with plain text.
    }

    if (trimmed.includes(",")) {
      return [
        ...new Set(
          trimmed
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        ),
      ];
    }

    return [trimmed];
  }

  return [];
}

function sameId(a, b) {
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

function mergeTaskLists(...lists) {
  const byKey = new Map();

  for (const list of lists) {
    for (const task of normalizeTasks(list)) {
      const key = String(task.id ?? task.name).toLowerCase();
      const previous = byKey.get(key);

      if (!previous) {
        byKey.set(key, task);
        continue;
      }

      const previousFiles =
        (previous.evidence_files?.length || 0) +
        (previous.file_patterns?.length || 0);

      const nextFiles =
        (task.evidence_files?.length || 0) +
        (task.file_patterns?.length || 0);

      if (nextFiles >= previousFiles) {
        byKey.set(key, { ...previous, ...task });
      }
    }
  }

  return [...byKey.values()];
}

function getMemberName(member) {
  return (
    member?.display_name ||
    member?.github_username ||
    member?.member ||
    member?.member_name ||
    "Unknown member"
  );
}

function getAlignment(match) {
  const value = String(match?.alignment || "UNASSESSED").toUpperCase();

  if (value.includes("ALIGN") && !value.includes("PARTIAL")) {
    return "ALIGNED";
  }

  if (value.includes("PARTIAL")) return "PARTIAL";
  if (value.includes("WEAK")) return "WEAK";
  if (value.includes("NO_MATCH") || value.includes("UNMATCHED")) {
    return "NO MATCH";
  }

  return value.replace(/_/g, " ");
}

function getConfidence(match) {
  const value = match?.confidence;

  if (value == null || value === "") return "Not provided";

  if (typeof value === "number") {
    return value <= 1
      ? `${Math.round(value * 100)}%`
      : `${Math.round(value)}%`;
  }

  return String(value);
}

function shortPath(path, maxLength = 65) {
  if (!path || typeof path !== "string") return "";
  if (path.length <= maxLength) return path;

  return `…${path.slice(-(maxLength - 1))}`;
}

  
// Main page
  

export default function Understanding_Task() {
  const { projectId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const queryMemberId = searchParams.get("member");

  const [project, setProject] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [selectedMember, setSelectedMember] = useState(queryMemberId || "");
  const [tasks, setTasks] = useState([]);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Presentation state
  const [taskSearch, setTaskSearch] = useState("");
  const [matchSearch, setMatchSearch] = useState("");
  const [matrixSearch, setMatrixSearch] = useState("");
  const [matrixMemberFilter, setMatrixMemberFilter] = useState("all");
  const [matrixAlignmentFilter, setMatrixAlignmentFilter] = useState("all");
  const [expandedTaskId, setExpandedTaskId] = useState(null);
  const [expandedMatchId, setExpandedMatchId] = useState(null);
  const [matrixPage, setMatrixPage] = useState(1);

  const MATRIX_PAGE_SIZE = 12;

  async function loadData({ preferTasks } = {}) {
    const [projectData, analysisData] = await Promise.all([
      getProject(projectId),
      getLatestAnalysis(projectId),
    ]);

    setProject(projectData);

    setAnalysis((previous) => {
      const incoming = analysisData || {};

      if (
        previous?.task_member_matching &&
        !incoming.task_member_matching
      ) {
        return {
          ...incoming,
          task_member_matching: previous.task_member_matching,
        };
      }

      return incoming;
    });

    const merged = mergeTaskLists(
      projectData?.tasks,
      analysisData?.tasks,
      preferTasks
    );

    setTasks((current) => {
      if (merged.length >= current.length) return merged;

      if (preferTasks && preferTasks.length >= current.length) {
        return mergeTaskLists(preferTasks, merged);
      }

      return mergeTaskLists(current, merged);
    });

    const contributors = projectData?.github_contributors || [];

    if (contributors.length > 0) {
      const selectedExists = contributors.some((member) =>
        sameId(member.id, selectedMember)
      );

      if (!selectedMember || !selectedExists) {
        setSelectedMember(String(contributors[0].id));
      }
    } else if (!selectedMember) {
      setSelectedMember("");
    }
  }

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError("");

      try {
        await loadData();
      } catch (err) {
        if (active) {
          setError(err.message || "Failed to load tasks.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    load();

    return () => {
      active = false;
    };

  }, [projectId]);

  const contributors = project?.github_contributors || [];

  const selectedMemberMeta = useMemo(
    () =>
      contributors.find((member) => sameId(member.id, selectedMember)) ||
      null,
    [contributors, selectedMember]
  );

  const selectedLabel = getMemberName(selectedMemberMeta);

  const allMatches = useMemo(() => {
    const matching = analysis?.task_member_matching || {};
    const rows = Array.isArray(matching.members) ? matching.members : [];

    return rows.flatMap((member) =>
      (member.tasks || []).map((task, index) => ({
        id: `${member.member_id}-${task.task_id ?? index}`,
        member_id: member.member_id,
        member_name:
          member.member ||
          member.display_name ||
          member.github_username ||
          "Member",
        task_id: task.task_id,
        task_name: task.task || task.task_name || "Unnamed task",
        alignment: task.alignment,
        confidence: task.confidence,
        reason: task.reason,
        evidence_units: task.evidence_units ?? task.evidence_count ?? 0,
        matched_files: normalizeFileList(
          task.matched_files || task.files
        ),
        primary_file: task.primary_file || null,
        commit_shas: Array.isArray(task.commit_shas)
          ? task.commit_shas
          : [],
        pr_numbers: Array.isArray(task.pr_numbers)
          ? task.pr_numbers
          : [],
      }))
    );
  }, [analysis]);

  const memberMatches = useMemo(() => {
    if (!selectedMember) return [];

    return allMatches.filter((match) =>
      sameId(match.member_id, selectedMember)
    );
  }, [allMatches, selectedMember]);

  const filteredTasks = useMemo(() => {
    const query = taskSearch.trim().toLowerCase();

    if (!query) return tasks;

    return tasks.filter((task) => {
      const searchable = [
        task.name,
        task.description,
        ...normalizeFileList(task.file_patterns),
        ...normalizeFileList(task.evidence_files),
      ]
        .join(" ")
        .toLowerCase();

      return searchable.includes(query);
    });
  }, [tasks, taskSearch]);

  const filteredMemberMatches = useMemo(() => {
    const query = matchSearch.trim().toLowerCase();

    if (!query) return memberMatches;

    return memberMatches.filter((match) =>
      [
        match.task_name,
        match.member_name,
        match.reason,
        ...match.matched_files,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [memberMatches, matchSearch]);

  const filteredMatrix = useMemo(() => {
    const query = matrixSearch.trim().toLowerCase();

    return allMatches.filter((match) => {
      const matchesMember =
        matrixMemberFilter === "all" ||
        sameId(match.member_id, matrixMemberFilter);

      const matchesAlignment =
        matrixAlignmentFilter === "all" ||
        getAlignment(match) === matrixAlignmentFilter;

      const matchesSearch =
        !query ||
        [
          match.member_name,
          match.task_name,
          match.reason,
          ...match.matched_files,
        ]
          .join(" ")
          .toLowerCase()
          .includes(query);

      return matchesMember && matchesAlignment && matchesSearch;
    });
  }, [
    allMatches,
    matrixSearch,
    matrixMemberFilter,
    matrixAlignmentFilter,
  ]);

  useEffect(() => {
    setMatrixPage(1);
  }, [matrixSearch, matrixMemberFilter, matrixAlignmentFilter]);

  const matrixPageCount = Math.max(
    1,
    Math.ceil(filteredMatrix.length / MATRIX_PAGE_SIZE)
  );

  const paginatedMatrix = filteredMatrix.slice(
    (matrixPage - 1) * MATRIX_PAGE_SIZE,
    matrixPage * MATRIX_PAGE_SIZE
  );

  const alignedCount = memberMatches.filter(
    (match) => getAlignment(match) === "ALIGNED"
  ).length;

  const partialCount = memberMatches.filter(
    (match) => getAlignment(match) === "PARTIAL"
  ).length;

  const totalEvidence = memberMatches.reduce(
    (sum, match) => sum + (Number(match.evidence_units) || 0),
    0
  );

    
  // Actions
  async function handleGenerateTasks() {
    setBusy("generate");
    setError("");
    setMessage("");

    try {
      const result = await generateTasks(projectId);

      const fromApi = mergeTaskLists(result?.all_tasks, result?.tasks);

      if (fromApi.length) {
        setTasks(fromApi);
      }

      await loadData({ preferTasks: fromApi });

      setMessage(
        `Generated ${fromApi.length || result?.generated || 0} task(s) from repository evidence.`
      );
    } catch (err) {
      setError(err.message || "Failed to generate tasks.");
    } finally {
      setBusy("");
    }
  }

  async function handleMatchTasks() {
    setBusy("match");
    setError("");
    setMessage("");

    try {
      const result = await matchTasksToMembers(projectId);

      const matching =
        result?.matching ||
        result?.task_member_matching || {
          members: result?.members || [],
          tasks: result?.tasks || [],
          status: result?.status,
        };

      setAnalysis((previous) => ({
        ...(previous || {}),
        task_member_matching: matching,
      }));

      await loadData();

      // Re-apply the latest result if the analysis endpoint is stale.
      setAnalysis((previous) => ({
        ...(previous || {}),
        task_member_matching: matching,
      }));

      const memberRows = Array.isArray(matching?.members)
        ? matching.members
        : [];

      const pairCount = memberRows.reduce(
        (sum, row) =>
          sum + (Array.isArray(row.tasks) ? row.tasks.length : 0),
        0
      );

      setMessage(
        pairCount > 0
          ? `Matched ${pairCount} task–member pair(s) across ${memberRows.length} member(s). Review the evidence and its limitations below.`
          : "Matching finished, but no task–member pairs were returned. Check the generated tasks and repository evidence."
      );
    } catch (err) {
      setError(err.message || "Failed to match tasks.");
    } finally {
      setBusy("");
    }
  }

  async function handleStartProof() {
    if (!selectedMember) {
      setError("Select a member before starting the proof.");
      return;
    }

    const memberExists = contributors.some((member) =>
      sameId(member.id, selectedMember)
    );

    if (!memberExists) {
      setError("The selected member is no longer available in this project.");
      return;
    }

    setBusy("questions");
    setError("");
    setMessage("");

    try {
      const result = await generateUnderstandingQuestions(
        projectId,
        Number(selectedMember)
      );

      const sessionId = result?.session_id ?? result?.sessionId;
      const questions = Array.isArray(result?.questions)
        ? result.questions
        : [];

      if (!sessionId) {
        throw new Error("The backend did not return a session_id.");
      }

      if (!questions.length) {
        throw new Error(
          "The backend returned no understanding questions."
        );
      }

      navigate(
        `/project/${projectId}/member/${selectedMember}/understanding/questions`,
        {
          state: {
            sessionId,
            questions,
            memberId: Number(selectedMember),
            projectName: project?.name,
          },
        }
      );
    } catch (err) {
      setError(
        err.message || "Failed to generate understanding questions."
      );
    } finally {
      setBusy("");
    }
  }

  if (loading) {
    return (
      <PageShell projectId={projectId}>
        <div className="flex min-h-screen items-center justify-center text-sm text-[#5b6678]">
          Loading understanding tasks...
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell projectId={projectId}>
      {/* Header */}
      <header className="border-b border-[#cdd5df] bg-white">
        <div className="mx-auto flex h-20 max-w-6xl items-center gap-4 px-5 sm:px-8">
          <button
            onClick={() => navigate(`/project/${projectId}`)}
            aria-label="Back to project"
            className="rounded-md p-2 text-[#5b6678] hover:bg-[#f1f3f5] hover:text-[#12203a]"
          >
            <ArrowLeft size={20} />
          </button>

          <div className="min-w-0">
            <h1 className="text-xl font-bold text-[#12203a]">
              Proof of Understanding
            </h1>
            <p className="mt-1 text-sm text-[#5b6678]">
              Tasks, evidence matching, and question preparation
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-5 py-8 sm:px-8">
        {error && <ErrorBox message={error} />}
        {message && <SuccessBox message={message} />}

        {/* Intro */}
        <section className="rounded-xl border border-[#cdd5df] bg-white p-6 sm:p-8">
          <p className="text-xs font-bold uppercase tracking-wider text-[#0a8f6c]">
            Evidence-based assessment
          </p>
          <h2 className="mt-2 max-w-3xl text-2xl font-bold text-[#12203a]">
            GitHub evidence is not the same as understanding.
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[#5b6678]">
            Collect repository evidence, connect tasks to contributors,
            and prepare questions that ask members to explain the work
            associated with that evidence.
          </p>
        </section>

        {/* Main actions */}
        <section className="grid gap-5 md:grid-cols-2">
          <ActionCard
            icon={<Sparkles size={19} />}
            title="Generate Tasks"
            description="Create concrete project tasks from repository evidence and changed files."
            button={
              <button
                onClick={handleGenerateTasks}
                disabled={Boolean(busy)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#12203a] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === "generate" ? (
                  <RefreshCw size={15} className="animate-spin" />
                ) : (
                  <Sparkles size={15} />
                )}
                {busy === "generate" ? "Generating..." : "Generate Tasks"}
              </button>
            }
          />

          <ActionCard
            icon={<Target size={19} />}
            title="Match Tasks to Members"
            description="Compare task descriptions with contributors' repository evidence. Review the matched files before drawing conclusions."
            button={
              <button
                onClick={handleMatchTasks}
                disabled={Boolean(busy) || tasks.length === 0}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-[#cdd5df] px-4 py-2.5 text-sm font-semibold text-[#12203a] hover:bg-[#f1f3f5] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === "match" ? (
                  <RefreshCw size={15} className="animate-spin" />
                ) : (
                  <Target size={15} />
                )}
                {busy === "match" ? "Matching..." : "Match Tasks"}
              </button>
            }
          />
        </section>

        {/* Generated tasks */}
        <section>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-[#0a8f6c]">
                Repository tasks
              </p>
              <h2 className="mt-1 text-lg font-bold text-[#12203a]">
                Available Tasks
              </h2>
              <p className="mt-1 text-sm text-[#5b6678]">
                Inspect the tasks before matching them to contributors.
              </p>
            </div>

            <span className="rounded-md bg-white px-3 py-2 text-xs font-semibold text-[#0a8f6c]">
              {tasks.length} task{tasks.length !== 1 ? "s" : ""}
            </span>
          </div>

          {tasks.length > 0 && (
            <div className="mb-4">
              <SearchField
                value={taskSearch}
                onChange={setTaskSearch}
                placeholder="Search tasks or file paths..."
              />
            </div>
          )}

          {tasks.length === 0 ? (
            <EmptyState
              icon={<ListChecks size={22} />}
              title="No tasks generated yet"
              description="Generate tasks after analyzing the repository. The tasks will appear here for review."
            />
          ) : filteredTasks.length === 0 ? (
            <EmptyState
              title="No matching tasks"
              description="Try another search term."
            />
          ) : (
            <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredTasks.map((task, index) => (
                <TaskCard
                  key={task.id || task.task_id || `task-${index}`}
                  task={task}
                  index={index}
                  expanded={expandedTaskId === String(task.id)}
                  onToggle={() =>
                    setExpandedTaskId((current) =>
                      current === String(task.id) ? null : String(task.id)
                    )
                  }
                />
              ))}
            </div>
          )}
        </section>

        {/* Member selection and matching */}
        <section className="overflow-hidden rounded-xl border border-[#cdd5df] bg-white">
          <div className="border-b border-[#cdd5df] p-6">
            <p className="text-xs font-bold uppercase tracking-wider text-[#0a8f6c]">
              Individual assessment
            </p>
            <h2 className="mt-1 text-lg font-bold text-[#12203a]">
              Start Proof of Understanding
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[#5b6678]">
              Select a contributor to inspect their matched tasks, review
              the evidence, and prepare an understanding check.
            </p>

            <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <label className="block min-w-0">
                <span className="mb-2 block text-sm font-semibold text-[#12203a]">
                  Contributor
                </span>
                <select
                  value={selectedMember}
                  onChange={(event) => {
                    setSelectedMember(event.target.value);
                    setExpandedMatchId(null);
                  }}
                  className="w-full min-w-0 rounded-md border border-[#cdd5df] bg-white px-4 py-3 text-sm text-[#12203a] outline-none focus:ring-2 focus:ring-[#0a8f6c]/30"
                >
                  <option value="">Select a contributor</option>
                  {contributors.map((member) => (
                    <option key={member.id} value={String(member.id)}>
                      {getMemberName(member)} — @{member.github_username || "unknown"}
                    </option>
                  ))}
                </select>
              </label>

              <button
                onClick={handleStartProof}
                disabled={Boolean(busy) || !selectedMember}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#12203a] px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 md:w-auto"
              >
                {busy === "questions" ? (
                  <RefreshCw size={15} className="animate-spin" />
                ) : (
                  <Play size={15} />
                )}
                {busy === "questions"
                  ? "Generating questions..."
                  : "Start Understanding Check"}
              </button>
            </div>
          </div>

          {selectedMember ? (
            <>
              {/* Compact overview */}
              <div className="grid grid-cols-2 border-b border-[#cdd5df] sm:grid-cols-4">
                <SummaryMetric
                  label="Matched tasks"
                  value={memberMatches.length}
                  icon={<ListChecks size={16} />}
                />
                <SummaryMetric
                  label="Aligned"
                  value={alignedCount}
                  icon={<CheckCircle size={16} />}
                />
                <SummaryMetric
                  label="Partial"
                  value={partialCount}
                  icon={<AlertCircle size={16} />}
                />
                <SummaryMetric
                  label="Evidence units"
                  value={totalEvidence}
                  icon={<GitBranch size={16} />}
                />
              </div>

              <div className="space-y-5 p-5 sm:p-6">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-[#12203a]">
                      Evidence review
                    </h3>
                    <p className="mt-1 text-sm text-[#5b6678]">
                      {selectedLabel}: inspect the task alignment and
                      the files used to support each match.
                    </p>
                  </div>
                  <span className="text-xs text-[#8a95a6]">
                    {filteredMemberMatches.length} of {memberMatches.length} shown
                  </span>
                </div>

                {memberMatches.length > 0 && (
                  <SearchField
                    value={matchSearch}
                    onChange={setMatchSearch}
                    placeholder="Search this member's tasks, reasons, or files..."
                  />
                )}

                {memberMatches.length === 0 ? (
                  <EmptyState
                    icon={<Target size={22} />}
                    title="No matched tasks for this contributor"
                    description={
                      allMatches.length === 0
                        ? "Run Match Tasks first to calculate task-to-member evidence."
                        : "Try another contributor or run Match Tasks again."
                    }
                  />
                ) : filteredMemberMatches.length === 0 ? (
                  <EmptyState
                    title="No matching evidence"
                    description="Try a different search term."
                  />
                ) : (
                  <div className="overflow-hidden rounded-lg border border-[#cdd5df]">
                    <div className="hidden grid-cols-[minmax(0,1.7fr)_100px_100px_90px_40px] gap-3 bg-[#f1f3f5] px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-[#5b6678] md:grid">
                      <span>Task</span>
                      <span>Alignment</span>
                      <span>Confidence</span>
                      <span>Evidence</span>
                      <span />
                    </div>

                    <div className="divide-y divide-[#cdd5df]">
                      {filteredMemberMatches.map((match) => {
                        const expanded = expandedMatchId === match.id;

                        return (
                          <div key={match.id} className="min-w-0">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedMatchId((current) =>
                                  current === match.id ? null : match.id
                                )
                              }
                              className="grid w-full min-w-0 grid-cols-1 gap-3 px-4 py-4 text-left transition hover:bg-[#f1f3f5]/70 md:grid-cols-[minmax(0,1.7fr)_100px_100px_90px_40px] md:items-center"
                            >
                              <div className="min-w-0">
                                <p className="break-words text-sm font-semibold text-[#12203a]">
                                  {match.task_name}
                                </p>
                                <p className="mt-1 text-xs text-[#5b6678]">
                                  {match.matched_files.length} matched file
                                  {match.matched_files.length !== 1 ? "s" : ""}
                                </p>
                              </div>

                              <div className="flex flex-wrap items-center gap-2 md:block">
                                <span className="md:hidden text-xs text-[#8a95a6]">
                                  Alignment:
                                </span>
                                <AlignmentBadge value={match.alignment} />
                              </div>

                              <div className="text-xs text-[#5b6678]">
                                <span className="md:hidden text-[#8a95a6]">
                                  Confidence:{" "}
                                </span>
                                {getConfidence(match)}
                              </div>

                              <div className="text-xs font-semibold text-[#12203a]">
                                <span className="md:hidden text-[#8a95a6]">
                                  Evidence units:{" "}
                                </span>
                                {match.evidence_units}
                              </div>

                              <div className="hidden justify-end text-[#8a95a6] md:flex">
                                {expanded ? (
                                  <ChevronUp size={17} />
                                ) : (
                                  <ChevronDown size={17} />
                                )}
                              </div>
                            </button>

                            {expanded && (
                              <MatchDetails match={match} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="p-8">
              <EmptyState
                icon={<Users size={22} />}
                title="Choose a contributor"
                description="Their task matches and evidence summary will appear here."
              />
            </div>
          )}
        </section>

        {/* All member matches */}
        {allMatches.length > 0 && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[#0a8f6c]">
                  Cross-member comparison
                </p>
                <h2 className="mt-1 text-lg font-bold text-[#12203a]">
                  All Task × Member Matches
                </h2>
                <p className="mt-1 max-w-2xl text-sm text-[#5b6678]">
                  Compare which contributors are associated with each task,
                  inspect alignment, and open the underlying file evidence.
                </p>
              </div>
              <span className="rounded-md bg-white px-3 py-2 text-xs font-semibold text-[#0a8f6c]">
                {allMatches.length} pairs
              </span>
            </div>

            {/* Search and filters */}
            <div className="grid gap-3 rounded-xl border border-[#cdd5df] bg-white p-4 md:grid-cols-[minmax(0,1fr)_190px_160px]">
              <SearchField
                value={matrixSearch}
                onChange={setMatrixSearch}
                placeholder="Search task, contributor, or file..."
              />

              <select
                value={matrixMemberFilter}
                onChange={(event) => setMatrixMemberFilter(event.target.value)}
                className="min-w-0 rounded-md border border-[#cdd5df] bg-white px-3 py-2.5 text-sm text-[#12203a] outline-none focus:ring-2 focus:ring-[#0a8f6c]/30"
              >
                <option value="all">All contributors</option>
                {contributors.map((member) => (
                  <option key={member.id} value={String(member.id)}>
                    {getMemberName(member)}
                  </option>
                ))}
              </select>

              <select
                value={matrixAlignmentFilter}
                onChange={(event) =>
                  setMatrixAlignmentFilter(event.target.value)
                }
                className="min-w-0 rounded-md border border-[#cdd5df] bg-white px-3 py-2.5 text-sm text-[#12203a] outline-none focus:ring-2 focus:ring-[#0a8f6c]/30"
              >
                <option value="all">All alignments</option>
                <option value="ALIGNED">Aligned</option>
                <option value="PARTIAL">Partial</option>
                <option value="WEAK">Weak</option>
                <option value="NO MATCH">No match</option>
              </select>
            </div>

            {/* Comparison table */}
            <div className="overflow-hidden rounded-xl border border-[#cdd5df] bg-white">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-left">
                  <thead className="bg-[#f1f3f5]">
                    <tr>
                      <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-[#5b6678]">
                        Task
                      </th>
                      <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-[#5b6678]">
                        Contributor
                      </th>
                      <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-[#5b6678]">
                        Alignment
                      </th>
                      <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-[#5b6678]">
                        Evidence units
                      </th>
                      <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-[#5b6678]">
                        Files
                      </th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-[#cdd5df]">
                    {paginatedMatrix.map((match) => (
                      <React.Fragment key={`matrix-${match.id}`}>
                        <tr
                          className={
                            sameId(match.member_id, selectedMember)
                              ? "bg-[#0a8f6c]/[0.035]"
                              : "hover:bg-[#f1f3f5]/60"
                          }
                        >
                          <td className="max-w-[260px] px-4 py-3">
                            <p
                              className="break-words text-sm font-semibold text-[#12203a]"
                              title={match.task_name}
                            >
                              {match.task_name}
                            </p>
                          </td>

                          <td className="px-4 py-3 text-sm text-[#5b6678]">
                            {match.member_name}
                          </td>

                          <td className="px-4 py-3">
                            <AlignmentBadge value={match.alignment} />
                          </td>

                          <td className="px-4 py-3 text-sm tabular-nums text-[#12203a]">
                            {match.evidence_units}
                          </td>

                          <td className="px-4 py-3 text-sm text-[#5b6678]">
                            {match.matched_files.length}
                          </td>

                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() =>
                                setExpandedMatchId((current) =>
                                  current === `matrix-${match.id}`
                                    ? null
                                    : `matrix-${match.id}`
                                )
                              }
                              className="rounded-md border border-[#cdd5df] p-2 text-[#5b6678] hover:bg-[#f1f3f5]"
                              aria-label={`View evidence for ${match.task_name}`}
                            >
                              {expandedMatchId === `matrix-${match.id}` ? (
                                <ChevronUp size={15} />
                              ) : (
                                <ChevronDown size={15} />
                              )}
                            </button>
                          </td>
                        </tr>

                        {expandedMatchId === `matrix-${match.id}` && (
                          <tr>
                            <td colSpan={6} className="p-0">
                              <MatchDetails match={match} />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}

                    {paginatedMatrix.length === 0 && (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-4 py-10 text-center text-sm text-[#8a95a6]"
                        >
                          No matches found for these filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#cdd5df] px-4 py-3">
                <p className="text-xs text-[#5b6678]">
                  Showing{" "}
                  {filteredMatrix.length === 0
                    ? 0
                    : (matrixPage - 1) * MATRIX_PAGE_SIZE + 1}
                  {"–"}
                  {Math.min(
                    matrixPage * MATRIX_PAGE_SIZE,
                    filteredMatrix.length
                  )}{" "}
                  of {filteredMatrix.length} matches
                </p>

                <div className="flex items-center gap-2">
                  <button
                    disabled={matrixPage <= 1}
                    onClick={() =>
                      setMatrixPage((page) => Math.max(1, page - 1))
                    }
                    className="rounded-md border border-[#cdd5df] px-3 py-1.5 text-xs font-semibold text-[#12203a] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span className="text-xs tabular-nums text-[#5b6678]">
                    {matrixPage} / {matrixPageCount}
                  </span>
                  <button
                    disabled={matrixPage >= matrixPageCount}
                    onClick={() =>
                      setMatrixPage((page) =>
                        Math.min(matrixPageCount, page + 1)
                      )
                    }
                    className="rounded-md border border-[#cdd5df] px-3 py-1.5 text-xs font-semibold text-[#12203a] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>
    </PageShell>
  );
}

  
// Task card
  

function TaskCard({ task, index, expanded, onToggle }) {
  const patterns = normalizeFileList(task.file_patterns);
  const evidenceFiles = normalizeFileList(task.evidence_files);
  const displayFiles = evidenceFiles.length > 0 ? evidenceFiles : patterns;
  const previewFiles = displayFiles.slice(0, expanded ? 30 : 3);

  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-[#cdd5df] bg-white transition hover:border-[#aebbc9]">
      <div className="min-w-0 flex-1 p-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="shrink-0 pt-0.5 text-xs font-bold tabular-nums text-[#0a8f6c]">
            {String(index + 1).padStart(2, "0")}
          </span>

          <div className="min-w-0 flex-1">
            <h3 className="break-words text-sm font-bold leading-relaxed text-[#12203a]">
              {task.name || task.task_name || "Unnamed task"}
            </h3>

            {task.description && (
              <p className="mt-2 whitespace-pre-line break-words text-xs leading-relaxed text-[#5b6678]">
                {task.description}
              </p>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-[#f1f3f5] px-2 py-1 text-[11px] text-[#5b6678]">
            <FileCode size={12} />
            {displayFiles.length} file{displayFiles.length !== 1 ? "s" : ""}
          </span>

          {task.source && (
            <span
              className="max-w-full truncate rounded-md border border-[#cdd5df] px-2 py-1 text-[10px] text-[#8a95a6]"
              title={task.source}
            >
              {task.source}
            </span>
          )}
        </div>

        {displayFiles.length > 0 && (
          <div className="mt-4 min-w-0">
            <p className="mb-2 text-[11px] font-semibold text-[#5b6678]">
              {evidenceFiles.length > 0 ? "Evidence files" : "File patterns"}
            </p>

            <div className="min-w-0 space-y-1.5">
              {previewFiles.map((file) => (
                <div
                  key={file}
                  className="flex min-w-0 items-start gap-2 rounded-md bg-[#f1f3f5]/80 px-2.5 py-2"
                  title={file}
                >
                  <FileCode
                    size={12}
                    className="mt-0.5 shrink-0 text-[#0a8f6c]"
                  />
                  <span className="min-w-0 flex-1 break-all font-mono text-[10px] leading-relaxed text-[#5b6678]">
                    {shortPath(file, expanded ? 160 : 58)}
                  </span>
                </div>
              ))}
            </div>

            {!expanded && displayFiles.length > 3 && (
              <p className="mt-2 text-[11px] text-[#8a95a6]">
                +{displayFiles.length - 3} more file
                {displayFiles.length - 3 !== 1 ? "s" : ""}
              </p>
            )}
          </div>
        )}

        {displayFiles.length === 0 && (
          <p className="mt-4 rounded-md border border-dashed border-[#cdd5df] px-3 py-3 text-xs text-[#8a95a6]">
            No file paths attached to this task yet.
          </p>
        )}
      </div>

      {(displayFiles.length > 3 || task.description?.length > 180) && (
        <button
          onClick={onToggle}
          className="flex items-center justify-center gap-2 border-t border-[#cdd5df] px-4 py-3 text-xs font-semibold text-[#5b6678] hover:bg-[#f1f3f5]"
        >
          {expanded ? "Show less" : "View task details"}
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      )}
    </article>
  );
}

  
// Match details
  

function MatchDetails({ match }) {
  const files = match.matched_files || [];

  return (
    <div className="min-w-0 border-t border-[#cdd5df] bg-[#f1f3f5]/50 p-4 sm:p-5">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ShieldCheck size={15} className="shrink-0 text-[#0a8f6c]" />
            <h4 className="text-xs font-bold uppercase tracking-wide text-[#12203a]">
              Matching explanation
            </h4>
          </div>

          <p className="mt-2 break-words text-sm leading-relaxed text-[#5b6678]">
            {match.reason ||
              "No explanation was provided by the matching engine."}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <DetailPill
              label="Alignment"
              value={getAlignment(match)}
            />
            <DetailPill
              label="Confidence"
              value={getConfidence(match)}
            />
            <DetailPill
              label="Evidence units"
              value={match.evidence_units ?? 0}
            />
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-bold uppercase tracking-wide text-[#12203a]">
              Matched files
            </h4>
            <span className="shrink-0 text-[11px] text-[#8a95a6]">
              {files.length} total
            </span>
          </div>

          {files.length > 0 ? (
            <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto">
              {files.map((file) => (
                <div
                  key={file}
                  title={file}
                  className="flex min-w-0 items-start gap-2 rounded-md border border-[#cdd5df] bg-white px-2.5 py-2"
                >
                  <FileCode
                    size={12}
                    className="mt-0.5 shrink-0 text-[#0a8f6c]"
                  />
                  <span className="min-w-0 flex-1 break-all font-mono text-[10px] leading-relaxed text-[#5b6678]">
                    {file}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 rounded-md border border-dashed border-[#cdd5df] p-3 text-xs text-[#8a95a6]">
              No matched file paths were returned.
            </p>
          )}
        </div>
      </div>

      {(match.commit_shas?.length > 0 || match.pr_numbers?.length > 0) && (
        <div className="mt-4 border-t border-[#cdd5df] pt-3">
          <p className="mb-2 text-xs font-semibold text-[#12203a]">
            Related repository references
          </p>

          <div className="flex flex-wrap gap-2">
            {match.commit_shas.map((sha) => (
              <span
                key={sha}
                title={sha}
                className="max-w-full break-all rounded-md border border-[#cdd5df] bg-white px-2 py-1 font-mono text-[10px] text-[#5b6678]"
              >
                Commit: {String(sha).slice(0, 12)}
              </span>
            ))}

            {match.pr_numbers.map((number) => (
              <span
                key={number}
                className="rounded-md border border-[#cdd5df] bg-white px-2 py-1 text-[10px] text-[#5b6678]"
              >
                PR #{number}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex items-start gap-2 rounded-md border border-[#cdd5df] bg-white p-3">
        <CircleHelp size={15} className="mt-0.5 shrink-0 text-[#8a95a6]" />
        <p className="text-xs leading-relaxed text-[#5b6678]">
          A file match indicates an association with repository activity;
          it does not by itself prove authorship, task ownership, or
          understanding. Review the file context and ask the contributor
          to explain the implementation.
        </p>
      </div>
    </div>
  );
}

  
// Reusable UI
  

function ActionCard({ icon, title, description, button }) {
  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-[#cdd5df] bg-white p-6">
      <div className="flex min-w-0 gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#f1f3f5] text-[#0a8f6c]">
          {icon}
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-[#12203a]">{title}</h3>
          <p className="mt-1 break-words text-sm leading-relaxed text-[#5b6678]">
            {description}
          </p>
        </div>
      </div>

      <div className="mt-auto pt-5">{button}</div>
    </section>
  );
}

function SummaryMetric({ label, value, icon }) {
  return (
    <div className="min-w-0 border-b border-r border-[#cdd5df] p-4 last:border-r-0 sm:border-b-0">
      <div className="flex items-center gap-2 text-[#8a95a6]">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="mt-2 break-words text-2xl font-bold tabular-nums text-[#12203a]">
        {value}
      </p>
    </div>
  );
}

function AlignmentBadge({ value }) {
  const alignment = getAlignment({ alignment: value });

  const styles = {
    ALIGNED: "border-[#0a8f6c]/20 bg-[#0a8f6c]/10 text-[#0a8f6c]",
    PARTIAL: "border-[#b77a34]/25 bg-[#b77a34]/10 text-[#9b6425]",
    WEAK: "border-[#cdd5df] bg-[#f1f3f5] text-[#5b6678]",
    "NO MATCH": "border-red-200 bg-red-50 text-red-700",
  };

  return (
    <span
      className={`inline-flex max-w-full items-center rounded-md border px-2 py-1 text-[10px] font-bold ${styles[alignment] || styles.WEAK}`}
    >
      {alignment}
    </span>
  );
}

function DetailPill({ label, value }) {
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-md border border-[#cdd5df] bg-white px-2.5 py-1.5 text-[10px]">
      <span className="text-[#8a95a6]">{label}</span>
      <span className="break-words font-semibold text-[#12203a]">
        {value}
      </span>
    </span>
  );
}

function SearchField({ value, onChange, placeholder }) {
  return (
    <label className="flex min-w-0 items-center gap-2 rounded-md border border-[#cdd5df] bg-white px-3 py-2.5 focus-within:ring-2 focus-within:ring-[#0a8f6c]/20">
      <Search size={15} className="shrink-0 text-[#8a95a6]" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-sm text-[#12203a] outline-none placeholder:text-[#8a95a6]"
      />
    </label>
  );
}

function EmptyState({ icon, title, description }) {
  return (
    <div className="rounded-xl border border-dashed border-[#cdd5df] bg-white p-8 text-center sm:p-10">
      {icon && (
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-[#f1f3f5] text-[#8a95a6]">
          {icon}
        </div>
      )}
      <h3 className="mt-3 text-sm font-semibold text-[#12203a]">{title}</h3>
      {description && (
        <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-[#8a95a6]">
          {description}
        </p>
      )}
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

function ErrorBox({ message }) {
  return (
    <div className="flex min-w-0 items-start gap-3 break-words rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      <AlertCircle size={17} className="mt-0.5 shrink-0" />
      <span className="min-w-0">{message}</span>
    </div>
  );
}

function SuccessBox({ message }) {
  return (
    <div className="flex min-w-0 items-start gap-3 break-words rounded-lg border border-[#0a8f6c]/20 bg-[#0a8f6c]/5 p-4 text-sm text-[#0a8f6c]">
      <CheckCircle size={17} className="mt-0.5 shrink-0" />
      <span className="min-w-0">{message}</span>
    </div>
  );
}
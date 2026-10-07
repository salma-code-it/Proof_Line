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
  FileText,
} from "lucide-react";

export default function Understanding_Task() {
  const { projectId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const queryMemberId = searchParams.get("member");

  const [project, setProject] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [selectedMember, setSelectedMember] =
    useState(queryMemberId || "");

  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function loadData() {
    const [projectData, analysisData] = await Promise.all([
      getProject(projectId),
      getLatestAnalysis(projectId),
    ]);

    setProject(projectData);
    setAnalysis(analysisData);

    const availableTasks =
      projectData?.tasks ||
      analysisData?.tasks ||
      [];

    setTasks(availableTasks);

    if (
      !selectedMember &&
      projectData?.github_contributors?.length
    ) {
      setSelectedMember(
        String(projectData.github_contributors[0].id)
      );
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

  const contributors =
    project?.github_contributors || [];

  const matches = useMemo(() => {
    const rows =
      analysis?.task_member_matching?.members || [];

    return rows.flatMap((member) =>
      (member.tasks || []).map((task) => ({
        id: `${member.member_id}-${task.task_id}`,
        member_id: member.member_id,
        member_name:
          member.member ||
          member.display_name ||
          member.github_username ||
          "Member",
        task_id: task.task_id,
        task_name: task.task,
        alignment: task.alignment,
        evidence_count: task.evidence_count,
      }))
    );
  }, [analysis]);

  async function handleGenerateTasks() {
    setBusy("generate");
    setError("");
    setMessage("");

    try {
      const result = await generateTasks(projectId);
      await loadData();
      setMessage(
        result?.message ||
          "Tasks were generated from the project evidence."
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
      await loadData();
      setMessage(
        result?.message ||
          "Tasks were matched against member evidence."
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

    setBusy("questions");
    setError("");
    setMessage("");

    try {
      const result =
        await generateUnderstandingQuestions(
          projectId,
          selectedMember
        );

      const sessionId =
        result?.session_id ?? result?.sessionId;

      const questions = Array.isArray(result?.questions)
        ? result.questions
        : [];

      if (!sessionId) {
        throw new Error(
          "The backend did not return a session_id."
        );
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
        err.message ||
          "Failed to generate understanding questions."
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
      <header className="bg-white border-b border-[#cdd5df]">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-20 flex items-center gap-4">
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
              Proof of Understanding
            </h1>
            <p className="text-sm text-[#5b6678] mt-1">
              Tasks, evidence matching, and question preparation
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-5 sm:px-8 py-8 space-y-8">
        {error && <ErrorBox message={error} />}
        {message && <SuccessBox message={message} />}

        <section className="bg-white rounded-xl border border-[#cdd5df] p-6">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-wider text-[#0a8f6c]">
              Why this step exists
            </p>
            <h2 className="mt-2 text-2xl font-bold text-[#12203a]">
              GitHub evidence is not the same as understanding.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-[#5b6678]">
              GroupProof first collects observable repository evidence.
              This page prepares evidence-grounded questions so a member
              can explain the work associated with that evidence.
            </p>
          </div>
        </section>

        <section className="grid md:grid-cols-2 gap-5">
          <ActionCard
            icon={<Sparkles size={19} />}
            title="Generate Tasks"
            description="Create concrete project tasks from the collected repository evidence."
            button={
              <button
                onClick={handleGenerateTasks}
                disabled={Boolean(busy)}
                className="w-full py-2.5 rounded-md bg-[#12203a] text-white text-sm font-semibold disabled:opacity-50"
              >
                {busy === "generate"
                  ? "Generating..."
                  : "Generate Tasks"}
              </button>
            }
          />

          <ActionCard
            icon={<Target size={19} />}
            title="Match Tasks to Members"
            description="Connect tasks to members using deterministic observable evidence."
            button={
              <button
                onClick={handleMatchTasks}
                disabled={Boolean(busy)}
                className="w-full py-2.5 rounded-md border border-[#cdd5df] text-[#12203a] text-sm font-semibold hover:bg-[#f1f3f5] disabled:opacity-50"
              >
                {busy === "match"
                  ? "Matching..."
                  : "Match Tasks"}
              </button>
            }
          />
        </section>

        <section>
          <div className="mb-4">
            <h2 className="text-lg font-bold text-[#12203a]">
              Available Tasks
            </h2>
            <p className="text-sm text-[#5b6678] mt-1">
              Tasks currently stored for this project.
            </p>
          </div>

          {tasks.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#cdd5df] bg-white p-10 text-center text-sm text-[#8a95a6]">
              No tasks are stored yet. Generate tasks above after
              repository analysis.
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {tasks.map((task, index) => (
                <TaskCard
                  key={task.id || task.task_id || index}
                  task={task}
                  index={index}
                />
              ))}
            </div>
          )}
        </section>

        <section className="bg-white rounded-xl border border-[#cdd5df] p-6">
          <div className="mb-5">
            <h2 className="text-lg font-bold text-[#12203a]">
              Start Proof of Understanding
            </h2>
            <p className="text-sm text-[#5b6678] mt-1">
              Questions will be generated from the selected member's
              actual evidence.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <label className="flex-1 w-full">
              <span className="block mb-2 text-sm font-semibold text-[#12203a]">
                Member
              </span>

              <select
                value={selectedMember}
                onChange={(event) =>
                  setSelectedMember(event.target.value)
                }
                className="w-full rounded-md border border-[#cdd5df] bg-white px-4 py-3 text-sm text-[#12203a] outline-none focus:ring-2 focus:ring-[#0a8f6c]/30"
              >
                <option value="">Select a member</option>
                {contributors.map((member) => (
                  <option
                    key={member.id}
                    value={member.id}
                  >
                    {member.display_name ||
                      member.github_username}{" "}
                    — @{member.github_username}
                  </option>
                ))}
              </select>
            </label>

            <button
              onClick={handleStartProof}
              disabled={
                Boolean(busy) || !selectedMember
              }
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-md bg-[#12203a] text-white font-semibold disabled:opacity-50"
            >
              {busy === "questions"
                ? "Generating questions..."
                : "Start Understanding Check"}
              <Play size={15} />
            </button>
          </div>
        </section>

        {matches.length > 0 && (
          <section>
            <div className="mb-4">
              <h2 className="text-lg font-bold text-[#12203a]">
                Task × Member Matching
              </h2>
              <p className="text-sm text-[#5b6678] mt-1">
                Evidence relationships returned by the analysis.
              </p>
            </div>

            <div className="bg-white rounded-xl border border-[#cdd5df] overflow-hidden divide-y divide-[#cdd5df]">
              {matches.map((match) => (
                <div
                  key={match.id}
                  className="p-4 flex items-center justify-between gap-4"
                >
                  <div>
                    <p className="text-sm font-semibold text-[#12203a]">
                      {match.task_name}
                    </p>
                    <p className="text-xs text-[#5b6678] mt-1">
                      {match.member_name}
                    </p>
                  </div>

                  <span className="px-2.5 py-1 rounded bg-[#f1f3f5] text-[10px] font-bold text-[#0a8f6c]">
                    {match.alignment || "EVIDENCE"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </PageShell>
  );
}

function ActionCard({ icon, title, description, button }) {
  return (
    <section className="bg-white rounded-xl border border-[#cdd5df] p-6">
      <div className="flex gap-3">
        <div className="w-9 h-9 rounded-md bg-[#f1f3f5] text-[#0a8f6c] flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div>
          <h3 className="font-bold text-[#12203a]">{title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-[#5b6678]">
            {description}
          </p>
        </div>
      </div>
      <div className="mt-5">{button}</div>
    </section>
  );
}

function TaskCard({ task, index }) {
  const patterns = Array.isArray(task.file_patterns)
    ? task.file_patterns
    : [];

  return (
    <article className="bg-white rounded-xl border border-[#cdd5df] p-5">
      <div className="flex gap-3">
        <span className="text-xs font-bold text-[#0a8f6c]">
          {String(index + 1).padStart(2, "0")}
        </span>

        <div className="min-w-0">
          <h3 className="font-semibold text-[#12203a]">
            {task.name ||
              task.task_name ||
              "Unnamed task"}
          </h3>

          {task.description && (
            <p className="mt-2 text-xs leading-relaxed text-[#5b6678]">
              {task.description}
            </p>
          )}

          {patterns.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {patterns.slice(0, 4).map((pattern) => (
                <span
                  key={pattern}
                  className="px-1.5 py-0.5 rounded bg-[#f1f3f5] font-mono text-[10px] text-[#5b6678]"
                >
                  {pattern}
                </span>
              ))}
            </div>
          )}

          {task.source && (
            <p className="mt-3 text-[10px] uppercase tracking-wider text-[#8a95a6]">
              {task.source}
            </p>
          )}
        </div>
      </div>
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

function ErrorBox({ message }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex gap-3">
      <AlertCircle size={17} className="shrink-0" />
      {message}
    </div>
  );
}

function SuccessBox({ message }) {
  return (
    <div className="rounded-lg border border-[#0a8f6c]/20 bg-[#0a8f6c]/5 p-4 text-sm text-[#0a8f6c] flex gap-3">
      <CheckCircle size={17} className="shrink-0" />
      {message}
    </div>
  );
}

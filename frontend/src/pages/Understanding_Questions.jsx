import React, { useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import { evaluateUnderstanding } from "../api";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  FileText,
  GitCommit,
  GitPullRequest,
  AlertCircle,
  Lightbulb,
  MessageSquareText,
  RotateCcw,
  Target,
  Trophy,
  XCircle,
} from "lucide-react";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function getFirstValue(...values) {
  return values.find(
    (value) => value !== undefined && value !== null && value !== ""
  );
}

function normalizeStatus(status) {
  return String(status || "NOT_EVALUATED")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

function readableStatus(status) {
  const labels = {
    FULL_UNDERSTANDING: "Full understanding",
    GOOD_UNDERSTANDING: "Good understanding",
    UNDERSTOOD: "Understood",
    CORRECT: "Correct",
    PARTIAL: "Partial understanding",
    PARTIALLY_CORRECT: "Partial understanding",
    INSUFFICIENT_EVIDENCE: "Insufficient evidence",
    INSUFFICIENT: "Insufficient evidence",
    INCORRECT: "Incorrect",
    NOT_ANSWERED: "Not answered",
    NEEDS_IMPROVEMENT: "Needs improvement",
    NOT_EVALUATED: "Not evaluated",
  };

  const normalized = normalizeStatus(status);

  return (
    labels[normalized] ||
    normalized.toLowerCase().replace(/_/g, " ")
  );
}

function getStatusStyle(status) {
  const normalized = normalizeStatus(status);

  if (
    [
      "FULL_UNDERSTANDING",
      "GOOD_UNDERSTANDING",
      "UNDERSTOOD",
      "CORRECT",
    ].includes(normalized)
  ) {
    return {
      color: "#087443",
      background: "#e7f7ef",
      border: "#b9e7ce",
      icon: CheckCircle,
    };
  }

  if (
    ["PARTIAL", "PARTIALLY_CORRECT", "NEEDS_IMPROVEMENT"].includes(
      normalized
    )
  ) {
    return {
      color: "#966315",
      background: "#fff5df",
      border: "#f0ddb0",
      icon: AlertCircle,
    };
  }

  if (
    [
      "INSUFFICIENT_EVIDENCE",
      "INSUFFICIENT",
      "INCORRECT",
      "NOT_ANSWERED",
    ].includes(normalized)
  ) {
    return {
      color: "#b42332",
      background: "#fff0f0",
      border: "#f3caca",
      icon: XCircle,
    };
  }

  return {
    color: "#5b6678",
    background: "#f1f3f5",
    border: "#dce1e8",
    icon: AlertCircle,
  };
}

function getQuestionId(question, index) {
  return String(
    getFirstValue(
      question?.id,
      question?.question_id,
      `q${index + 1}`
    )
  );
}

function getQuestionText(question) {
  if (typeof question === "string") return question;

  return (
    getFirstValue(
      question?.question,
      question?.question_text,
      question?.prompt,
      question?.text,
      question?.title
    ) || "Explain the work represented by this evidence."
  );
}

function getOverallScore(evaluation) {
  const rawScore = getFirstValue(
    evaluation?.overall_score,
    evaluation?.understanding_score,
    evaluation?.total_score,
    evaluation?.score
  );

  if (rawScore === undefined) return null;

  const number = Number(rawScore);

  if (!Number.isFinite(number)) return null;

  return Math.max(0, Math.min(100, number));
}

function getQuestionResults(evaluation) {
  const candidates = [
    evaluation?.question_results,
    evaluation?.questions,
    evaluation?.results,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

function getResultStatus(result) {
  return getFirstValue(
    result?.status,
    result?.result_status,
    result?.evaluation_status,
    result?.evaluation,
    "NOT_EVALUATED"
  );
}

function getResultScore(result) {
  const value = getFirstValue(
    result?.score,
    result?.question_score,
    result?.understanding_score
  );

  if (value === undefined) return null;

  const number = Number(value);

  if (!Number.isFinite(number)) return null;

  return Math.max(0, Math.min(100, number));
}

function getReferenceAnswer(result) {
  return getFirstValue(
    result?.reference_answer,
    result?.model_answer,
    result?.expected_answer,
    result?.correct_answer,
    ""
  );
}

function getFeedback(result) {
  return getFirstValue(
    result?.feedback,
    result?.comment,
    result?.explanation,
    result?.evaluation_feedback,
    ""
  );
}

function getAnswerText(answer) {
  if (typeof answer === "string") return answer;

  if (answer && typeof answer === "object") {
    return getFirstValue(
      answer.answer,
      answer.text,
      answer.response,
      ""
    );
  }

  return "";
}

function getScoreLevel(score) {
  if (score === null) return "Not available";
  if (score >= 80) return "High";
  if (score >= 50) return "Medium";
  return "Needs improvement";
}

function getEvidenceItems(result) {
  const items = [];

  const add = (type, value) => {
    if (value === undefined || value === null || value === "") return;

    items.push({
      type,
      value: String(value),
    });
  };

  const evidence = asArray(
    getFirstValue(
      result?.evidence_used,
      result?.evidence,
      result?.supporting_evidence
    )
  );

  evidence.forEach((item) => {
    if (typeof item === "string" || typeof item === "number") {
      add("other", item);
      return;
    }

    if (!item || typeof item !== "object") return;

    add(
      "file",
      getFirstValue(
        item.path,
        item.file_path,
        item.filename,
        item.file
      )
    );

    add(
      "commit",
      getFirstValue(
        item.commit_sha,
        item.sha,
        item.commit
      )
    );

    add(
      "pr",
      getFirstValue(
        item.pr_number,
        item.pull_request_number,
        item.pull_request
      )
    );

    if (
      !item.path &&
      !item.file_path &&
      !item.filename &&
      !item.file &&
      !item.commit_sha &&
      !item.sha &&
      !item.commit &&
      !item.pr_number &&
      !item.pull_request_number &&
      !item.pull_request
    ) {
      add(
        "other",
        getFirstValue(
          item.description,
          item.title,
          item.message,
          item.name
        )
      );
    }
  });

  asArray(result?.files).forEach((item) => {
    add(
      "file",
      typeof item === "string"
        ? item
        : getFirstValue(
            item?.path,
            item?.file_path,
            item?.filename,
            item?.name
          )
    );
  });

  asArray(result?.commit_shas || result?.commits).forEach((item) => {
    add(
      "commit",
      typeof item === "string"
        ? item
        : getFirstValue(item?.sha, item?.commit_sha, item?.id)
    );
  });

  asArray(result?.pr_numbers || result?.pull_requests).forEach((item) => {
    add(
      "pr",
      typeof item === "number" || typeof item === "string"
        ? item
        : getFirstValue(item?.number, item?.pr_number, item?.id)
    );
  });

  const seen = new Set();

  return items.filter((item) => {
    const key = `${item.type}:${item.value}`;

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

export default function Understanding_Questions() {
  const { projectId, memberId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const state = location.state || {};
  const sessionId = state.sessionId;
  const questions = Array.isArray(state.questions)
    ? state.questions
    : [];

  const [answers, setAnswers] = useState({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [review, setReview] = useState(false);
  const [evaluation, setEvaluation] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [allowEmptyAnswers, setAllowEmptyAnswers] = useState(false);

  const currentQuestion = questions[currentIndex];

  const answeredCount = useMemo(
    () =>
      questions.filter((question, index) =>
        String(answers[getQuestionId(question, index)] || "").trim()
      ).length,
    [answers, questions]
  );

  // A session ID is required, but answers can be empty.
  // The backend still needs at least one generated question.
  if (!sessionId || questions.length === 0) {
    return (
      <PageShell projectId={projectId}>
        <main className="mx-auto max-w-2xl px-5 py-16 sm:px-8">
          <div className="rounded-2xl border border-[#cdd5df] bg-white p-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f1f3f5] text-[#5b6678]">
              <FileText size={25} />
            </div>

            <h1 className="mt-4 text-xl font-bold text-[#12203a]">
              No active understanding session
            </h1>

            <p className="mt-2 text-sm leading-6 text-[#5b6678]">
              Open Understanding Tasks and create a session with questions.
              You can submit empty answers once the questions are loaded.
            </p>

            <button
              type="button"
              onClick={() =>
                navigate(
                  `/project/${projectId}/understanding/tasks?member=${memberId}`
                )
              }
              className="mt-6 rounded-xl bg-[#12203a] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#203654]"
            >
              Return to Understanding Tasks
            </button>
          </div>
        </main>
      </PageShell>
    );
  }

  async function submitEvaluation() {
    if (submitting) return;

    setSubmitting(true);
    setError("");

    // Empty strings are deliberately permitted for demo testing.
    const submissionAnswers = {};

    questions.forEach((question, index) => {
      const questionId = getQuestionId(question, index);
      submissionAnswers[questionId] = getAnswerText(answers[questionId]);
    });

    try {
      const response = await evaluateUnderstanding(
        projectId,
        memberId,
        sessionId,
        submissionAnswers
      );

      // Support API helpers that return either response.data or data directly.
      const result = response?.data ?? response;

      setEvaluation(result);
    } catch (err) {
      const status = err?.response?.status;
      const backendMessage =
        err?.response?.data?.detail ||
        err?.response?.data?.message ||
        err?.message;

      if (status === 409) {
        setError(
          `This understanding session cannot be evaluated again. It may already have been evaluated or its state has changed. Return to Understanding Tasks and create a new session, then try again. Backend message: ${backendMessage || "409 Conflict"}`
        );
      } else if (status === 400) {
        setError(
          `The backend rejected this evaluation request. Check that the session contains generated questions. Details: ${backendMessage || "Bad Request"}`
        );
      } else {
        setError(
          backendMessage || "Understanding evaluation failed. Please try again."
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (evaluation) {
    return (
      <EvaluationResult
        projectId={projectId}
        memberId={memberId}
        evaluation={evaluation}
        questions={questions}
        answers={answers}
        onBack={() => setEvaluation(null)}
      />
    );
  }

  const progress = review
    ? 100
    : ((currentIndex + 1) / questions.length) * 100;

  const currentQuestionId = getQuestionId(
    currentQuestion,
    currentIndex
  );

  return (
    <PageShell projectId={projectId}>
      <header className="border-b border-[#cdd5df] bg-white">
        <div className="mx-auto flex h-20 max-w-4xl items-center justify-between gap-5 px-5 sm:px-8">
          <div className="flex min-w-0 items-center gap-4">
            <button
              type="button"
              onClick={() =>
                navigate(`/project/${projectId}/member/${memberId}`)
              }
              aria-label="Back to member evidence"
              className="shrink-0 text-[#5b6678] transition hover:text-[#12203a]"
            >
              <ArrowLeft size={20} />
            </button>

            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider text-[#0a8f6c]">
                Proof of Understanding
              </p>

              <h1 className="truncate text-lg font-bold text-[#12203a]">
                Evidence-grounded questions
              </h1>
            </div>
          </div>

          <span className="shrink-0 text-xs font-semibold text-[#5b6678] sm:text-sm">
            {review
              ? "Review"
              : `Question ${currentIndex + 1} / ${questions.length}`}
          </span>
        </div>
      </header>

      <div className="h-1 bg-[#cdd5df]">
        <div
          className="h-full bg-[#0a8f6c] transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      <main className="mx-auto max-w-3xl px-5 py-8 sm:px-8 sm:py-10">
        {error && <ErrorBox message={error} />}

        {!review ? (
          <QuestionView
            question={currentQuestion}
            answer={getAnswerText(answers[currentQuestionId])}
            onAnswer={(value) =>
              setAnswers((previous) => ({
                ...previous,
                [currentQuestionId]: value,
              }))
            }
            index={currentIndex}
          />
        ) : (
          <ReviewView
            questions={questions}
            answers={answers}
            onEdit={(index) => {
              setError("");
              setCurrentIndex(index);
              setReview(false);
            }}
          />
        )}

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              setError("");

              if (review) {
                setReview(false);
                setCurrentIndex(questions.length - 1);
              } else {
                setCurrentIndex((index) => Math.max(0, index - 1));
              }
            }}
            disabled={currentIndex === 0 && !review}
            className="inline-flex items-center gap-2 rounded-xl border border-[#cdd5df] bg-white px-4 py-2.5 text-sm font-semibold text-[#12203a] transition hover:bg-[#f1f3f5] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowLeft size={15} />
            Previous
          </button>

          {!review && currentIndex < questions.length - 1 && (
            <button
              type="button"
              onClick={() => {
                // Empty answers are allowed. Move to the next question.
                setError("");
                setCurrentIndex((index) => index + 1);
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-[#12203a] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#203654]"
            >
              Next
              <ArrowRight size={15} />
            </button>
          )}

          {!review && currentIndex === questions.length - 1 && (
            <button
              type="button"
              onClick={() => {
                setError("");
                setReview(true);
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-[#12203a] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#203654]"
            >
              Review Answers
              <ArrowRight size={15} />
            </button>
          )}

          {review && (
            <button
              type="button"
              onClick={submitEvaluation}
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-xl bg-[#0a8f6c] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#087958] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  Evaluating...
                </>
              ) : (
                <>
                  Evaluate ({answeredCount}/{questions.length} answered)
                  <ArrowRight size={15} />
                </>
              )}
            </button>
          )}
        </div>

        {review && (
          <div className="mt-4 rounded-xl border border-[#cdd5df] bg-white p-4">
            <p className="text-sm leading-6 text-[#5b6678]">
              <strong className="text-[#12203a]">Demo mode:</strong>{" "}
              You can evaluate with blank answers. The empty responses will
              be sent to the backend as empty strings.
            </p>

            <button
              type="button"
              onClick={() => {
                setAllowEmptyAnswers((value) => !value);
                setError("");
              }}
              className="mt-2 text-xs font-semibold text-[#0a8f6c] hover:underline"
            >
              {allowEmptyAnswers
                ? "Hide demo information"
                : "Show demo information"}
            </button>

            {allowEmptyAnswers && (
              <p className="mt-2 text-xs leading-5 text-[#5b6678]">
                If you receive 409 Conflict, create a new understanding
                session from the Tasks page. An already evaluated session
                generally cannot be evaluated a second time.
              </p>
            )}
          </div>
        )}
      </main>
    </PageShell>
  );
}

function QuestionView({ question, answer, onAnswer, index }) {
  const evidence = question?.evidence || {};

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-[#cdd5df] bg-white p-6 sm:p-7">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e8f6f0] text-sm font-bold text-[#0a8f6c]">
            {String(index + 1).padStart(2, "0")}
          </div>

          <p className="text-xs font-bold uppercase tracking-wider text-[#0a8f6c]">
            Question {index + 1}
          </p>
        </div>

        <h2 className="mt-5 break-words text-xl font-bold leading-relaxed text-[#12203a] sm:text-2xl">
          {getQuestionText(question)}
        </h2>
      </section>

      <EvidenceContext evidence={evidence} />

      <section className="rounded-2xl border border-[#cdd5df] bg-white p-5 sm:p-6">
        <label
          htmlFor="understanding-answer"
          className="mb-2 block text-sm font-bold text-[#12203a]"
        >
          Your answer
        </label>

        <p className="mb-4 text-sm leading-6 text-[#5b6678]">
          Explain your reasoning based on the evidence above. For demo
          testing, you can leave this field empty.
        </p>

        <textarea
          id="understanding-answer"
          value={answer}
          onChange={(event) => onAnswer(event.target.value)}
          placeholder="Type your answer here, or leave it empty for demo testing..."
          rows={8}
          className="min-h-[220px] w-full resize-y rounded-xl border border-[#cdd5df] bg-white p-4 text-sm leading-7 text-[#12203a] outline-none transition placeholder:text-[#8a95a6] focus:border-[#0a8f6c] focus:ring-4 focus:ring-[#0a8f6c]/10"
        />

        <div className="mt-2 flex justify-between gap-3 text-xs text-[#8a95a6]">
          <span>Blank answers are permitted in this demo.</span>
          <span className="shrink-0">{answer.length} characters</span>
        </div>
      </section>
    </div>
  );
}


function EvidenceContext({ evidence }) {
  const [expanded, setExpanded] = useState(true);

  const safeEvidence =
    evidence && typeof evidence === "object" ? evidence : {};

  const files = asArray(safeEvidence.files);
  const commits = asArray(safeEvidence.commit_shas);
  const prs = asArray(safeEvidence.pr_numbers);

  const hasEvidence =
    Boolean(safeEvidence.task) ||
    files.length > 0 ||
    commits.length > 0 ||
    prs.length > 0;

  return (
    <section className="overflow-hidden rounded-2xl border border-[#cdd5df] bg-white">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-4 bg-[#f8fafb] px-5 py-4 text-left sm:px-6"
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#e8f6f0] text-[#0a8f6c]">
            <FileText size={18} />
          </div>

          <div className="min-w-0">
            <p className="text-sm font-bold text-[#12203a]">
              Supporting evidence
            </p>
            <p className="mt-1 text-xs text-[#8a95a6]">
              Files, commits, and pull requests related to this question
            </p>
          </div>
        </div>

        {expanded ? (
          <ChevronUp size={18} className="shrink-0 text-[#5b6678]" />
        ) : (
          <ChevronDown size={18} className="shrink-0 text-[#5b6678]" />
        )}
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-[#e5e9ef] p-5 sm:p-6">
          {!hasEvidence && (
            <p className="text-sm leading-6 text-[#8a95a6]">
              No additional evidence details were included with this question.
            </p>
          )}

          {safeEvidence.task && (
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-[#8a95a6]">
                Task context
              </p>
              <div className="break-words rounded-xl border border-[#e0e5ec] bg-[#f8fafb] p-3 text-sm leading-6 text-[#5b6678]">
                {safeEvidence.task}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {files.length > 0 && (
              <EvidenceGroup title="Files" icon={FileText}>
                {files.map((file, index) => {
                  const value =
                    typeof file === "string"
                      ? file
                      : getFirstValue(
                          file?.path,
                          file?.file_path,
                          file?.filename,
                          file?.name
                        );

                  if (!value) return null;

                  return (
                    <EvidenceItem
                      key={`file-${value}-${index}`}
                      type="file"
                      value={value}
                    />
                  );
                })}
              </EvidenceGroup>
            )}

            {commits.length > 0 && (
              <EvidenceGroup title="Commits" icon={GitCommit}>
                {commits.map((commit, index) => {
                  const value =
                    typeof commit === "string"
                      ? commit
                      : getFirstValue(
                          commit?.sha,
                          commit?.commit_sha,
                          commit?.id
                        );

                  if (!value) return null;

                  return (
                    <EvidenceItem
                      key={`commit-${value}-${index}`}
                      type="commit"
                      value={value}
                    />
                  );
                })}
              </EvidenceGroup>
            )}

            {prs.length > 0 && (
              <EvidenceGroup title="Pull requests" icon={GitPullRequest}>
                {prs.map((pr, index) => {
                  const value =
                    typeof pr === "string" || typeof pr === "number"
                      ? pr
                      : getFirstValue(
                          pr?.number,
                          pr?.pr_number,
                          pr?.id
                        );

                  if (value === undefined || value === null) return null;

                  return (
                    <EvidenceItem
                      key={`pr-${value}-${index}`}
                      type="pr"
                      value={`PR #${value}`}
                    />
                  );
                })}
              </EvidenceGroup>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function EvidenceGroup({ title, icon: Icon, children }) {
  return (
    <div className="min-w-0">
      <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#8a95a6]">
        <Icon size={14} />
        {title}
      </p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function EvidenceItem({ type, value }) {
  const styles = {
    file: {
      label: "FILE",
      color: "#315b9b",
      background: "#eef4ff",
      icon: FileText,
    },
    commit: {
      label: "COMMIT",
      color: "#087443",
      background: "#e7f7ef",
      icon: GitCommit,
    },
    pr: {
      label: "PULL REQUEST",
      color: "#6741a5",
      background: "#f2eefe",
      icon: GitPullRequest,
    },
    other: {
      label: "EVIDENCE",
      color: "#5b6678",
      background: "#f1f3f5",
      icon: FileText,
    },
  };

  const style = styles[type] || styles.other;
  const Icon = style.icon;

  return (
    <div className="flex min-w-0 items-start gap-2.5 rounded-xl border border-[#e0e5ec] bg-white p-3">
      <div
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
        style={{ color: style.color, background: style.background }}
      >
        <Icon size={15} />
      </div>

      <div className="min-w-0 flex-1">
        <span
          className="inline-block rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide"
          style={{ color: style.color, background: style.background }}
        >
          {style.label}
        </span>

        <p className="mt-1.5 break-all text-xs leading-5 text-[#5b6678]">
          {String(value)}
        </p>
      </div>
    </div>
  );
}

function ReviewView({ questions, answers, onEdit }) {
  const unansweredCount = questions.filter((question, index) =>
    !String(answers[getQuestionId(question, index)] || "").trim()
  ).length;

  return (
    <section className="overflow-hidden rounded-2xl border border-[#cdd5df] bg-white">
      <div className="border-b border-[#e5e9ef] bg-[#f8fafb] p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e8f6f0] text-[#0a8f6c]">
            <MessageSquareText size={19} />
          </div>

          <div>
            <h2 className="text-xl font-bold text-[#12203a]">
              Review your answers
            </h2>
            <p className="mt-1 text-sm text-[#5b6678]">
              Check your responses before submitting the assessment.
            </p>
          </div>
        </div>

        {unansweredCount > 0 && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-[#f0ddb0] bg-[#fff8e8] p-3 text-sm leading-6 text-[#966315]">
            <AlertCircle size={17} className="mt-0.5 shrink-0" />
            {unansweredCount}{" "}
            {unansweredCount === 1 ? "question has" : "questions have"} no
            answer. This is allowed for demo testing.
          </div>
        )}
      </div>

      <div className="space-y-3 p-5 sm:p-6">
        {questions.map((question, index) => {
          const questionId = getQuestionId(question, index);
          const answer = getAnswerText(answers[questionId]);
          const answered = Boolean(answer.trim());

          return (
            <div
              key={questionId}
              className="rounded-xl border border-[#e0e5ec] p-4"
            >
              <div className="flex items-start gap-3">
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                    answered
                      ? "bg-[#e7f7ef] text-[#087443]"
                      : "bg-[#fff5df] text-[#966315]"
                  }`}
                >
                  {answered ? (
                    <CheckCircle size={17} />
                  ) : (
                    <AlertCircle size={17} />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-bold uppercase tracking-wider text-[#8a95a6]">
                      Question {index + 1}
                    </p>

                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        answered
                          ? "bg-[#e7f7ef] text-[#087443]"
                          : "bg-[#fff5df] text-[#966315]"
                      }`}
                    >
                      {answered ? "Answered" : "Empty answer"}
                    </span>
                  </div>

                  <p className="mt-2 break-words text-sm font-semibold leading-6 text-[#12203a]">
                    {getQuestionText(question)}
                  </p>

                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[#5b6678]">
                    {answer || "No answer provided."}
                  </p>

                  <button
                    type="button"
                    onClick={() => onEdit(index)}
                    className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-[#0a8f6c] hover:underline"
                  >
                    Edit answer
                    <ArrowRight size={13} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function EvaluationResult({
  projectId,
  memberId,
  evaluation,
  questions,
  answers,
  onBack,
}) {
  const navigate = useNavigate();

  const score = getOverallScore(evaluation);
  const results = getQuestionResults(evaluation);

  const level =
    getFirstValue(
      evaluation?.overall_level,
      evaluation?.understanding_level,
      evaluation?.level,
      evaluation?.rating
    ) || getScoreLevel(score);

  const summary = getFirstValue(
    evaluation?.overall_summary,
    evaluation?.summary,
    evaluation?.overall_feedback,
    evaluation?.feedback,
    ""
  );

  const advice = getFirstValue(
    evaluation?.advice,
    evaluation?.recommendation,
    evaluation?.next_steps,
    ""
  );

  const strengths = asArray(
    getFirstValue(evaluation?.strengths, evaluation?.what_went_well)
  );

  const improvements = asArray(
    getFirstValue(
      evaluation?.areas_to_improve,
      evaluation?.improvements,
      evaluation?.weaknesses
    )
  );

  const goodCount = results.filter((result) =>
    [
      "FULL_UNDERSTANDING",
      "GOOD_UNDERSTANDING",
      "UNDERSTOOD",
      "CORRECT",
    ].includes(normalizeStatus(getResultStatus(result)))
  ).length;

  const partialCount = results.filter((result) =>
    ["PARTIAL", "PARTIALLY_CORRECT"].includes(
      normalizeStatus(getResultStatus(result))
    )
  ).length;

  const insufficientCount = results.filter((result) =>
    [
      "INSUFFICIENT_EVIDENCE",
      "INSUFFICIENT",
      "INCORRECT",
      "NOT_ANSWERED",
    ].includes(normalizeStatus(getResultStatus(result)))
  ).length;

  const scoreColor =
    score === null
      ? "#8a95a6"
      : score >= 80
        ? "#0a8f6c"
        : score >= 50
          ? "#b77a34"
          : "#c44545";

  return (
    <PageShell projectId={projectId}>
      <header className="border-b border-[#cdd5df] bg-white">
        <div className="mx-auto flex h-20 max-w-6xl items-center gap-4 px-5 sm:px-8">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to answers"
            className="text-[#5b6678] transition hover:text-[#12203a]"
          >
            <ArrowLeft size={20} />
          </button>

          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-[#0a8f6c]">
              Proof of Understanding
            </p>
            <h1 className="text-lg font-bold text-[#12203a]">
              Evaluation Results
            </h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-7 px-5 py-8 sm:px-8 sm:py-10">
        <section className="overflow-hidden rounded-2xl border border-[#cdd5df] bg-white">
          <div className="grid lg:grid-cols-[1fr_270px]">
            <div className="p-6 sm:p-8">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#b9e7ce] bg-[#e7f7ef] px-3 py-1.5 text-xs font-bold text-[#087443]">
                <CheckCircle size={14} />
                ASSESSMENT COMPLETED
              </div>

              <h2 className="mt-5 text-2xl font-bold tracking-tight text-[#12203a] sm:text-3xl">
                Understanding result
              </h2>

              <p className="mt-3 max-w-2xl whitespace-pre-wrap break-words text-sm leading-7 text-[#5b6678]">
                {summary ||
                  "Your answers have been evaluated against the available project evidence. Review the individual results below."}
              </p>

              <div className="mt-6 flex flex-wrap gap-3">
                <div className="inline-flex items-center gap-2 rounded-xl border border-[#e0e5ec] bg-[#f8fafb] px-3.5 py-2.5">
                  <BarChart3 size={16} className="text-[#0a8f6c]" />
                  <span className="text-sm font-semibold text-[#12203a]">
                    Evidence-based evaluation
                  </span>
                </div>

                <div className="inline-flex items-center gap-2 rounded-xl border border-[#e0e5ec] bg-[#f8fafb] px-3.5 py-2.5">
                  <FileText size={16} className="text-[#0a8f6c]" />
                  <span className="text-sm font-semibold text-[#12203a]">
                    {results.length || questions.length} questions
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-col items-center justify-center border-t border-[#e5e9ef] bg-[#f8fafb] px-6 py-7 lg:border-l lg:border-t-0">
              <ScoreRing score={score} color={scoreColor} />

              <p className="mt-4 text-xs font-bold uppercase tracking-[0.15em] text-[#8a95a6]">
                Overall score
              </p>

              <span
                className="mt-2 rounded-full px-3 py-1 text-xs font-bold"
                style={{
                  color: scoreColor,
                  background:
                    scoreColor === "#0a8f6c"
                      ? "#e7f7ef"
                      : scoreColor === "#b77a34"
                        ? "#fff5df"
                        : scoreColor === "#c44545"
                          ? "#fff0f0"
                          : "#f1f3f5",
                }}
              >
                {level}
              </span>

              <p className="mt-3 max-w-[220px] text-center text-xs leading-5 text-[#8a95a6]">
                This score represents demonstrated understanding. It is not a
                contribution percentage.
              </p>
            </div>
          </div>
        </section>

        <section>
          <div className="mb-4">
            <h2 className="text-lg font-bold text-[#12203a]">
              Performance breakdown
            </h2>
            <p className="mt-1 text-sm leading-6 text-[#5b6678]">
              See how the individual questions were classified by the
              evaluator.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <BreakdownCard
              label="Good understanding"
              count={goodCount}
              total={results.length}
              color="#0a8f6c"
              background="#e7f7ef"
              icon={CheckCircle}
            />

            <BreakdownCard
              label="Partial understanding"
              count={partialCount}
              total={results.length}
              color="#966315"
              background="#fff5df"
              icon={AlertCircle}
            />

            <BreakdownCard
              label="Insufficient evidence"
              count={insufficientCount}
              total={results.length}
              color="#b42332"
              background="#fff0f0"
              icon={XCircle}
            />
          </div>
        </section>

        {advice && (
          <section className="rounded-2xl border border-[#cdd5df] bg-white p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#fff5df] text-[#966315]">
                <Lightbulb size={20} />
              </div>

              <div className="min-w-0 flex-1">
                <h2 className="text-base font-bold text-[#12203a]">
                  Advice
                </h2>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-[#5b6678]">
                  {Array.isArray(advice) ? advice.join("\n") : advice}
                </p>
              </div>
            </div>
          </section>
        )}

        {(strengths.length > 0 || improvements.length > 0) && (
          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {strengths.length > 0 && (
              <FeedbackList
                title="Strengths"
                description="What your answers demonstrated"
                items={strengths}
                type="strength"
              />
            )}

            {improvements.length > 0 && (
              <FeedbackList
                title="Areas to improve"
                description="Where more explanation or evidence is needed"
                items={improvements}
                type="improvement"
              />
            )}
          </section>
        )}

        <section>
          <div className="mb-4 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
            <div>
              <h2 className="text-xl font-bold text-[#12203a]">
                Question results
              </h2>
              <p className="mt-1 text-sm leading-6 text-[#5b6678]">
                Expand a question to inspect its feedback, reference answer,
                and supporting GitHub evidence.
              </p>
            </div>

            <span className="self-start rounded-lg border border-[#e0e5ec] bg-white px-3 py-1.5 text-xs font-semibold text-[#5b6678]">
              {results.length} evaluated
            </span>
          </div>

          {results.length === 0 ? (
            <div className="rounded-2xl border border-[#cdd5df] bg-white p-7 text-center">
              <MessageSquareText
                size={25}
                className="mx-auto mb-3 text-[#8a95a6]"
              />
              <p className="font-semibold text-[#12203a]">
                Detailed question results are unavailable
              </p>
              <p className="mt-1 text-sm leading-6 text-[#5b6678]">
                The evaluation response did not include individual question
                results.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {results.map((result, index) => {
                const resultId = String(
                  getFirstValue(
                    result?.question_id,
                    result?.questionId,
                    result?.id,
                    `q${index + 1}`
                  )
                );

                const matchingIndex = questions.findIndex(
                  (question, questionIndex) =>
                    getQuestionId(question, questionIndex) === resultId
                );

                const matchedQuestion =
                  matchingIndex >= 0 ? questions[matchingIndex] : null;

                const questionText = getFirstValue(
                  result?.question_text,
                  typeof result?.question === "string"
                    ? result.question
                    : null,
                  result?.prompt,
                  matchedQuestion
                    ? getQuestionText(matchedQuestion)
                    : null,
                  `Question ${index + 1}`
                );

                const answerKey = matchedQuestion
                  ? getQuestionId(matchedQuestion, matchingIndex)
                  : resultId;

                const userAnswer = getFirstValue(
                  result?.user_answer,
                  result?.answer,
                  result?.response,
                  answers[answerKey],
                  ""
                );

                return (
                  <QuestionResultCard
                    key={`${resultId}-${index}`}
                    index={index}
                    result={result}
                    questionText={questionText}
                    userAnswer={getAnswerText(userAnswer)}
                  />
                );
              })}
            </div>
          )}
        </section>

        <div className="flex flex-col gap-3 border-t border-[#dce1e8] pt-6 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#cdd5df] bg-white px-4 py-3 text-sm font-semibold text-[#5b6678] transition hover:bg-[#f1f3f5]"
          >
            <RotateCcw size={16} />
            Review answers
          </button>

          <button
            type="button"
            onClick={() =>
              navigate(`/project/${projectId}/member/${memberId}`)
            }
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#12203a] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#203654]"
          >
            Back to Member Evidence
            <ArrowRight size={16} />
          </button>
        </div>
      </main>
    </PageShell>
  );
}


function ScoreRing({ score, color }) {
  const safeScore = score === null ? 0 : score;
  const circumference = 2 * Math.PI * 49;

  return (
    <div className="relative flex h-36 w-36 items-center justify-center">
      <svg
        viewBox="0 0 120 120"
        className="-rotate-90"
        width="144"
        height="144"
        aria-label={
          score === null
            ? "Overall score unavailable"
            : `Overall score ${score} out of 100`
        }
        role="img"
      >
        <circle
          cx="60"
          cy="60"
          r="49"
          fill="none"
          stroke="#e5e9ef"
          strokeWidth="8"
        />

        <circle
          cx="60"
          cy="60"
          r="49"
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${(safeScore / 100) * circumference} ${circumference}`}
          className="transition-all duration-700"
        />
      </svg>

      <div className="absolute text-center">
        <div className="flex items-baseline justify-center gap-0.5">
          <span className="text-4xl font-bold tracking-tight text-[#12203a]">
            {score === null ? "—" : score}
          </span>
          <span className="text-sm font-semibold text-[#8a95a6]">/100</span>
        </div>

        <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-[#8a95a6]">
          Score
        </p>
      </div>
    </div>
  );
}

function BreakdownCard({
  label,
  count,
  total,
  color,
  background,
  icon: Icon,
}) {
  const percentage = total > 0 ? Math.round((count / total) * 100) : 0;

  return (
    <div className="rounded-2xl border border-[#cdd5df] bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl"
          style={{ color, background }}
        >
          <Icon size={19} />
        </div>

        <span
          className="rounded-lg px-2.5 py-1 text-xs font-bold"
          style={{ color, background }}
        >
          {percentage}%
        </span>
      </div>

      <p className="mt-5 text-3xl font-bold tracking-tight text-[#12203a]">
        {count}
        <span className="ml-1.5 text-sm font-medium text-[#8a95a6]">
          / {total}
        </span>
      </p>

      <p className="mt-1 text-sm font-semibold text-[#5b6678]">{label}</p>

      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[#edf0f4]">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${percentage}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}


function FeedbackList({ title, description, items, type }) {
  const isStrength = type === "strength";
  const color = isStrength ? "#087443" : "#966315";
  const background = isStrength ? "#e7f7ef" : "#fff5df";
  const Icon = isStrength ? Trophy : Lightbulb;

  return (
    <section className="rounded-2xl border border-[#cdd5df] bg-white p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{ color, background }}
        >
          <Icon size={19} />
        </div>

        <div className="min-w-0">
          <h3 className="font-bold text-[#12203a]">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-[#8a95a6]">
            {description}
          </p>
        </div>
      </div>

      <ul className="mt-5 space-y-3">
        {items.map((item, index) => {
          const value =
            typeof item === "string"
              ? item
              : getFirstValue(
                  item?.description,
                  item?.text,
                  item?.message,
                  item?.title
                );

          if (!value) return null;

          return (
            <li
              key={`${value}-${index}`}
              className="flex items-start gap-2.5 text-sm leading-6 text-[#5b6678]"
            >
              <span
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: color }}
              />
              <span className="min-w-0 break-words">{value}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function QuestionResultCard({
  index,
  result,
  questionText,
  userAnswer,
}) {
  const [expanded, setExpanded] = useState(index === 0);

  const score = getResultScore(result);
  const status = getResultStatus(result);
  const statusStyle = getStatusStyle(status);
  const StatusIcon = statusStyle.icon;

  const feedback = getFeedback(result);
  const reference = getReferenceAnswer(result);
  const evidenceItems = getEvidenceItems(result);

  return (
    <article className="overflow-hidden rounded-2xl border border-[#cdd5df] bg-white transition hover:border-[#b8c5d4]">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 p-4 text-left sm:gap-4 sm:p-5"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f1f3f5] text-sm font-bold text-[#5b6678]">
          {String(index + 1).padStart(2, "0")}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#8a95a6]">
            Question {index + 1}
          </p>

          <h3 className="mt-1 break-words text-sm font-bold leading-6 text-[#12203a] sm:text-base">
            {questionText}
          </h3>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold"
              style={{
                color: statusStyle.color,
                background: statusStyle.background,
                borderColor: statusStyle.border,
              }}
            >
              <StatusIcon size={13} />
              {readableStatus(status)}
            </span>

            {evidenceItems.length > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#dce1e8] bg-[#f8fafb] px-2.5 py-1 text-xs font-medium text-[#5b6678]">
                <FileText size={12} />
                {evidenceItems.length} evidence{" "}
                {evidenceItems.length === 1 ? "item" : "items"}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <span className="text-lg font-bold text-[#12203a]">
            {score === null ? "—" : score}
            <span className="ml-0.5 text-xs font-medium text-[#8a95a6]">
              /100
            </span>
          </span>

          {expanded ? (
            <ChevronUp size={18} className="text-[#8a95a6]" />
          ) : (
            <ChevronDown size={18} className="text-[#8a95a6]" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="space-y-5 border-t border-[#e5e9ef] p-4 sm:p-5">
          {score !== null && (
            <div>
              <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                <span className="font-semibold text-[#5b6678]">
                  Question score
                </span>
                <span className="font-bold text-[#12203a]">
                  {score}/100
                </span>
              </div>

              <div className="h-2 overflow-hidden rounded-full bg-[#edf0f4]">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${score}%`,
                    backgroundColor:
                      score >= 80
                        ? "#0a8f6c"
                        : score >= 50
                          ? "#b77a34"
                          : "#c44545",
                  }}
                />
              </div>
            </div>
          )}

          {feedback && (
            <DetailSection
              title="Evaluation feedback"
              icon={MessageSquareText}
            >
              <p className="whitespace-pre-wrap break-words text-sm leading-7 text-[#5b6678]">
                {feedback}
              </p>
            </DetailSection>
          )}

          <DetailSection title="Your answer" icon={FileText}>
            <div className="whitespace-pre-wrap break-words rounded-xl border border-[#e0e5ec] bg-[#f8fafb] p-4 text-sm leading-7 text-[#5b6678]">
              {userAnswer || "No answer provided."}
            </div>
          </DetailSection>

          {reference && (
            <DetailSection title="Reference answer" icon={Target}>
              <div className="whitespace-pre-wrap break-words rounded-xl border border-[#b9e7ce] bg-[#f0faf5] p-4 text-sm leading-7 text-[#365f4d]">
                {reference}
              </div>
            </DetailSection>
          )}

          {evidenceItems.length > 0 && (
            <DetailSection
              title="Supporting GitHub evidence"
              icon={GitCommit}
            >
              <div className="space-y-2">
                {evidenceItems.map((item, itemIndex) => (
                  <EvidenceItem
                    key={`${item.type}-${item.value}-${itemIndex}`}
                    type={item.type}
                    value={item.value}
                  />
                ))}
              </div>
            </DetailSection>
          )}

          {!feedback &&
            !reference &&
            evidenceItems.length === 0 &&
            !userAnswer && (
              <p className="text-sm leading-6 text-[#8a95a6]">
                No additional feedback, reference answer, or evidence details
                were returned for this question.
              </p>
            )}
        </div>
      )}
    </article>
  );
}


function DetailSection({ title, icon: Icon, children }) {
  return (
    <section className="min-w-0">
      <h4 className="mb-2.5 flex items-center gap-2 text-sm font-bold text-[#12203a]">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#f1f3f5] text-[#5b6678]">
          <Icon size={14} />
        </span>
        {title}
      </h4>

      <div className="min-w-0">{children}</div>
    </section>
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
    <div
      role="alert"
      className="mb-6 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-700"
    >
      <AlertCircle size={17} className="mt-0.5 shrink-0" />
      <span className="min-w-0 break-words">{message}</span>
    </div>
  );
}
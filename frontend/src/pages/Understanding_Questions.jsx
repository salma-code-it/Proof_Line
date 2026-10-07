import React, { useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import { evaluateUnderstanding } from "../api";
import {
  ArrowLeft,
  FileText,
  GitCommit,
  GitPullRequest,
  CheckCircle,
  XCircle,
  AlertCircle,
} from "lucide-react";

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

  const currentQuestion = questions[currentIndex];

  const answeredCount = useMemo(
    () =>
      questions.filter(
        (question) =>
          String(answers[question.id] || "").trim()
            .length > 0
      ).length,
    [answers, questions]
  );

  if (!sessionId || !questions.length) {
    return (
      <PageShell projectId={projectId}>
        <main className="max-w-2xl mx-auto px-5 sm:px-8 py-16">
          <div className="bg-white border border-[#cdd5df] rounded-xl p-8 text-center">
            <h1 className="text-xl font-bold text-[#12203a]">
              No active understanding session
            </h1>
            <p className="mt-2 text-sm text-[#5b6678]">
              Questions are created in the Tasks & Matching page and
              are kept in this page's current session.
            </p>
            <button
              onClick={() =>
                navigate(
                  `/project/${projectId}/understanding/tasks?member=${memberId}`
                )
              }
              className="mt-6 px-5 py-3 rounded-md bg-[#12203a] text-white text-sm font-semibold"
            >
              Return to Understanding Tasks
            </button>
          </div>
        </main>
      </PageShell>
    );
  }

  async function submitEvaluation() {
    const incomplete = questions.find(
      (question) =>
        !String(answers[question.id] || "").trim()
    );

    if (incomplete) {
      setError(
        `Please answer question ${questions.indexOf(incomplete) + 1} before submitting.`
      );
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const result = await evaluateUnderstanding(
        projectId,
        memberId,
        sessionId,
        answers
      );

      setEvaluation(result);
    } catch (err) {
      setError(
        err.message || "Understanding evaluation failed."
      );
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
      />
    );
  }

  const progress =
    ((currentIndex + 1) / questions.length) * 100;

  return (
    <PageShell projectId={projectId}>
      <header className="bg-white border-b border-[#cdd5df]">
        <div className="max-w-4xl mx-auto px-5 sm:px-8 h-20 flex items-center justify-between gap-5">
          <div className="flex items-center gap-4">
            <button
              onClick={() =>
                navigate(
                  `/project/${projectId}/member/${memberId}`
                )
              }
              className="text-[#5b6678] hover:text-[#12203a]"
            >
              <ArrowLeft size={20} />
            </button>

            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-[#0a8f6c]">
                Proof of Understanding
              </p>
              <h1 className="text-lg font-bold text-[#12203a]">
                Evidence-grounded questions
              </h1>
            </div>
          </div>

          <span className="text-sm font-mono text-[#5b6678]">
            {review
              ? "Review"
              : `Question ${currentIndex + 1} / ${questions.length}`}
          </span>
        </div>
      </header>

      <div className="h-1 bg-[#cdd5df]">
        <div
          className="h-full bg-[#0a8f6c] transition-all"
          style={{
            width: review ? "100%" : `${progress}%`,
          }}
        />
      </div>

      <main className="max-w-3xl mx-auto px-5 sm:px-8 py-10">
        {error && <ErrorBox message={error} />}

        {!review ? (
          <QuestionView
            question={currentQuestion}
            answer={answers[currentQuestion.id] || ""}
            onAnswer={(value) =>
              setAnswers((previous) => ({
                ...previous,
                [currentQuestion.id]: value,
              }))
            }
            index={currentIndex}
          />
        ) : (
          <ReviewView
            questions={questions}
            answers={answers}
          />
        )}

        <div className="mt-8 flex items-center justify-between gap-4">
          <button
            onClick={() => {
              setError("");
              if (review) {
                setReview(false);
                setCurrentIndex(questions.length - 1);
              } else {
                setCurrentIndex((index) =>
                  Math.max(0, index - 1)
                );
              }
            }}
            disabled={currentIndex === 0 && !review}
            className="px-4 py-2.5 rounded-md border border-[#cdd5df] text-sm font-semibold text-[#12203a] disabled:opacity-40"
          >
            Previous
          </button>

          {!review && currentIndex < questions.length - 1 && (
            <button
              onClick={() => {
                setError("");
                if (
                  !String(
                    answers[currentQuestion.id] || ""
                  ).trim()
                ) {
                  setError("Answer the current question before continuing.");
                  return;
                }
                setCurrentIndex((index) => index + 1);
              }}
              className="px-5 py-2.5 rounded-md bg-[#12203a] text-white text-sm font-semibold"
            >
              Next
            </button>
          )}

          {!review && currentIndex === questions.length - 1 && (
            <button
              onClick={() => {
                setError("");
                if (
                  !String(
                    answers[currentQuestion.id] || ""
                  ).trim()
                ) {
                  setError("Answer the current question before continuing.");
                  return;
                }
                setReview(true);
              }}
              className="px-5 py-2.5 rounded-md bg-[#12203a] text-white text-sm font-semibold"
            >
              Review Answers
            </button>
          )}

          {review && (
            <button
              onClick={submitEvaluation}
              disabled={submitting}
              className="px-5 py-2.5 rounded-md bg-[#12203a] text-white text-sm font-semibold disabled:opacity-50"
            >
              {submitting
                ? "Evaluating..."
                : `Submit ${answeredCount}/${questions.length} Answers`}
            </button>
          )}
        </div>
      </main>
    </PageShell>
  );
}

function QuestionView({
  question,
  answer,
  onAnswer,
  index,
}) {
  const evidence = question?.evidence || {};

  return (
    <div className="space-y-6">
      <section className="bg-white rounded-xl border border-[#cdd5df] p-7">
        <p className="text-xs font-bold uppercase tracking-wider text-[#0a8f6c]">
          Question {index + 1}
        </p>

        <h2 className="mt-3 text-xl font-bold leading-relaxed text-[#12203a]">
          {question?.question ||
            question?.prompt ||
            "Explain the work represented by this evidence."}
        </h2>
      </section>

      <EvidenceContext evidence={evidence} />

      <section>
        <label className="block text-sm font-bold text-[#12203a] mb-2">
          Your Answer
        </label>

        <textarea
          value={answer}
          onChange={(event) =>
            onAnswer(event.target.value)
          }
          placeholder="Explain your reasoning based on the evidence above..."
          className="w-full min-h-[230px] rounded-xl border border-[#cdd5df] bg-white p-5 text-sm text-[#12203a] outline-none resize-y focus:ring-2 focus:ring-[#0a8f6c]/30 focus:border-[#0a8f6c]"
        />

        <p className="mt-2 text-xs text-[#8a95a6]">
          Base your answer on the repository evidence shown above.
        </p>
      </section>
    </div>
  );
}

function EvidenceContext({ evidence }) {
  const files = evidence.files || [];
  const commits = evidence.commit_shas || [];
  const prs = evidence.pr_numbers || [];

  if (
    !evidence.task &&
    !files.length &&
    !commits.length &&
    !prs.length
  ) {
    return (
      <section className="rounded-xl border border-dashed border-[#cdd5df] bg-[#f1f3f5] p-5">
        <p className="text-xs font-bold uppercase tracking-wider text-[#5b6678]">
          Evidence context
        </p>
        <p className="mt-2 text-sm text-[#8a95a6]">
          The question was generated from the member's project evidence.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-[#cdd5df] bg-[#f1f3f5] p-5">
      <p className="text-xs font-bold uppercase tracking-wider text-[#5b6678]">
        This question is based on
      </p>

      <div className="mt-4 space-y-2">
        {evidence.task && (
          <EvidenceRow
            icon={<FileText size={14} />}
            value={`Task: ${evidence.task}`}
          />
        )}

        {files.map((file) => (
          <EvidenceRow
            key={`file-${file}`}
            icon={<FileText size={14} />}
            value={file}
            mono
          />
        ))}

        {commits.map((sha) => (
          <EvidenceRow
            key={`commit-${sha}`}
            icon={<GitCommit size={14} />}
            value={String(sha).slice(0, 12)}
            mono
          />
        ))}

        {prs.map((number) => (
          <EvidenceRow
            key={`pr-${number}`}
            icon={<GitPullRequest size={14} />}
            value={`PR #${number}`}
          />
        ))}
      </div>
    </section>
  );
}

function EvidenceRow({ icon, value, mono = false }) {
  return (
    <div className="flex items-center gap-2 text-sm text-[#12203a]">
      <span className="text-[#0a8f6c]">{icon}</span>
      <span className={mono ? "font-mono text-xs" : ""}>
        {value}
      </span>
    </div>
  );
}

function ReviewView({ questions, answers }) {
  return (
    <section className="bg-white rounded-xl border border-[#cdd5df] p-7">
      <p className="text-xs font-bold uppercase tracking-wider text-[#0a8f6c]">
        Final review
      </p>

      <h2 className="mt-2 text-xl font-bold text-[#12203a]">
        Review your answers
      </h2>

      <div className="mt-6 space-y-3">
        {questions.map((question, index) => {
          const answered = Boolean(
            String(answers[question.id] || "").trim()
          );

          return (
            <div
              key={question.id || index}
              className="flex items-center gap-3 rounded-lg border border-[#cdd5df] p-4"
            >
              {answered ? (
                <CheckCircle
                  size={17}
                  className="text-[#0a8f6c]"
                />
              ) : (
                <XCircle
                  size={17}
                  className="text-[#8a95a6]"
                />
              )}

              <div>
                <p className="text-sm font-semibold text-[#12203a]">
                  Question {index + 1}
                </p>
                <p className="text-xs text-[#5b6678] mt-1">
                  {answered ? "Answered" : "Not answered"}
                </p>
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
}) {
  const score =
    evaluation.overall_score ??
    evaluation.score ??
    null;

  const level =
    evaluation.overall_level ??
    evaluation.level ??
    null;

  const results =
    evaluation.question_results ||
    evaluation.results ||
    [];

  return (
    <PageShell projectId={projectId}>
      <header className="bg-white border-b border-[#cdd5df]">
        <div className="max-w-4xl mx-auto px-5 sm:px-8 h-20 flex items-center gap-4">
          <button
            onClick={() =>
              window.history.back()
            }
            className="text-[#5b6678] hover:text-[#12203a]"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-[#0a8f6c]">
              Proof of Understanding
            </p>
            <h1 className="text-lg font-bold text-[#12203a]">
              Evaluation Result
            </h1>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-5 sm:px-8 py-10 space-y-6">
        <section className="rounded-xl bg-[#12203a] p-8 text-white">
          <p className="text-xs font-bold uppercase tracking-wider text-[#7fe0c0]">
            Understanding result
          </p>

          <div className="mt-3 flex flex-wrap items-end gap-4">
            <span className="text-5xl font-bold">
              {score ?? "—"}
            </span>
            {score !== null && (
              <span className="pb-2 text-[#b8c2d3]">
                / 100
              </span>
            )}
          </div>

          {level && (
            <p className="mt-2 text-lg font-semibold">
              {level}
            </p>
          )}

          <p className="mt-4 text-sm leading-relaxed text-[#b8c2d3]">
            This score represents demonstrated understanding. It is
            not a contribution percentage.
          </p>
        </section>

        <section className="bg-white rounded-xl border border-[#cdd5df] p-7">
          <h2 className="text-lg font-bold text-[#12203a]">
            Question Results
          </h2>

          {results.length === 0 ? (
            <p className="mt-4 text-sm text-[#8a95a6]">
              The evaluation response did not include per-question results.
            </p>
          ) : (
            <div className="mt-5 divide-y divide-[#cdd5df]">
              {results.map((result, index) => (
                <div key={result.id || index} className="py-5">
                  <div className="flex items-center justify-between gap-4">
                    <p className="font-semibold text-[#12203a]">
                      Question {index + 1}
                    </p>
                    {result.score != null && (
                      <span className="font-bold text-[#12203a]">
                        {result.score}
                      </span>
                    )}
                  </div>

                  {result.evaluation && (
                    <p className="mt-1 text-xs font-bold uppercase text-[#0a8f6c]">
                      {result.evaluation}
                    </p>
                  )}

                  {result.feedback && (
                    <p className="mt-3 text-sm leading-relaxed text-[#5b6678]">
                      {result.feedback}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <button
          onClick={() =>
            (window.location.href = `/project/${projectId}/member/${memberId}`)
          }
          className="w-full rounded-md bg-[#12203a] py-3 text-sm font-semibold text-white"
        >
          Back to Member Evidence
        </button>
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

function ErrorBox({ message }) {
  return (
    <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex gap-3">
      <AlertCircle size={17} className="shrink-0" />
      {message}
    </div>
  );
}

import { useState } from 'react';

const steps = [
  { t: 'Connect GitHub', d: 'Pull requests, commits, reviews, issues and changed files are collected from the repository.' },
  { t: 'Structure the evidence', d: 'Raw events become evidence chains, work areas and a project timeline.' },
  { t: 'Match tasks', d: 'Professor tasks are matched to observable work. Without tasks, ProofLine drafts candidates and labels them as generated.' },
  { t: 'Verify understanding', d: 'Questions come from real commits and files. Each answer shows what was strong and what was missing.' },
];

const levels = [
  { k: 'Observed', src: 'Read directly from GitHub', ex: 'PR #12 was opened by Salma and merged on Aug 12.' },
  { k: 'Derived', src: 'Calculated from observations', ex: 'PR #12 received a review and was revised afterwards.' },
  { k: 'Interpreted', src: 'Explained in plain language, with limits', ex: 'The PR shows an observable review-and-revision cycle. It does not prove who wrote each line.' },
];

export default function HowItWorks() {
  const [i, setI] = useState(0);
  const l = levels[i];

  return (
    <section id="how-it-works" className="scroll-mt-16 px-4 py-20 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <h2 className="max-w-2xl text-3xl font-bold tracking-tight text-[#12203a] sm:text-4xl">From repository to review in four steps.</h2>

        <ol className="mt-12 grid gap-8 md:grid-cols-4 md:gap-6">
          {steps.map((s, n) => (
            <li key={s.t} className="border-l-2 border-[#12203a] pl-5 md:border-l-0 md:border-t-2 md:pl-0 md:pt-5">
              <p className="text-sm font-semibold text-[#0a8f6c]">Step {n + 1}</p>
              <h3 className="mt-1 text-lg font-bold text-[#12203a]">{s.t}</h3>
              <p className="mt-2 text-[#5b6678]">{s.d}</p>
            </li>
          ))}
        </ol>

        <div className="mt-16 rounded-lg bg-[#12203a] p-6 text-white sm:p-10">
          <h3 className="text-2xl font-bold">Every statement says how much we know.</h3>
          <p className="mt-2 max-w-xl text-[#b8c2d3]">The LLM explains the evidence. It is never the source of truth.</p>

          <div className="mt-8 grid grid-cols-3 gap-1 rounded-md bg-white/10 p-1" role="tablist">
            {levels.map((x, n) => (
              <button
                key={x.k}
                role="tab"
                aria-selected={i === n}
                onClick={() => setI(n)}
                className={`rounded px-2 py-2.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                  i === n ? 'bg-white text-[#12203a]' : 'text-[#b8c2d3] hover:text-white'
                }`}
              >
                {x.k}
              </button>
            ))}
          </div>

          <div key={i} className="pl-fade mt-6 grid gap-4 md:grid-cols-[220px_1fr]">
            <p className="text-sm text-[#7fe0c0]">{l.src}</p>
            <p className="text-lg leading-relaxed">{l.ex}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
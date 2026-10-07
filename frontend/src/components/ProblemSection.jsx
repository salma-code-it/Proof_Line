import { useState } from 'react';
import { ChevronRight } from 'lucide-react';

const problems = [
  { q: 'Who actually worked?', gh: 'Commits listed by author, with no context.', pf: 'Evidence built from PRs, commits, reviews, issues and changed files.', chain: ['PR', 'Commits', 'Reviews', 'Files'], level: 3 },
  { q: 'How did the work evolve?', gh: 'Chronological events, but no project story.', pf: 'Phases, milestones, gaps and progression drawn from activity.', chain: ['Events', 'Phases', 'Milestones', 'Story'] },
  { q: 'What did each member work on?', gh: 'File history is fragmented across commits.', pf: 'Observable work areas associated with each member, without claiming exact ownership.', chain: ['Files', 'Work areas', 'Member'] },
  { q: 'Did someone only make many tiny commits?', gh: 'Raw commit count can be misleading.', pf: 'The pull request is the main unit of work. Commits are supporting evidence.', chain: ['Commits', 'Grouped by PR', 'Weighted'] },
  { q: 'Was there collaboration?', gh: 'Reviews and comments live apart from the implementation.', pf: 'Connects PR, review, revision and merge into one chain.', chain: ['PR', 'Review', 'Revision', 'Merge'] },
  { q: 'Did a member respond to feedback?', gh: 'You must open each PR and read its history.', pf: 'Detects a review followed by a revision.', chain: ['Review', 'Revision'] },
  { q: 'Were members active at different periods?', gh: 'Hard to see across hundreds of events.', pf: 'Activity windows, gaps and timing patterns for each member.', chain: ['Events', 'Windows', 'Gaps'] },
  { q: 'When did the project really progress?', gh: 'Activity is noisy.', pf: 'Meaningful milestones and phases are detected and shown.', chain: ['Activity', 'Milestones', 'Phases'] },
  { q: 'Are tasks represented in repository work?', gh: 'The professor compares the assignment with GitHub by hand.', pf: 'Configured tasks are matched to observable repository evidence.', chain: ['Task', 'Files and PRs', 'Match'], level: 2 },
  { q: 'What if tasks were never entered?', gh: 'No structured task information exists.', pf: 'An LLM drafts task candidates from the evidence and labels them as generated.', chain: ['Work areas', 'LLM', 'Generated candidates'] },
  { q: 'How strong is the evidence?', gh: 'Raw numbers do not tell the whole story.', pf: 'LOW, MEDIUM or HIGH, based on several kinds of evidence together.', chain: ['Commits', 'PRs', 'Reviews', 'Level'], level: 2 },
  { q: 'Can we prove an exact contribution percentage?', gh: 'Usually impossible from GitHub alone.', pf: 'No invented percentages. ProofLine explains the evidence and its limits.', chain: ['Evidence', 'Limits', 'No score'] },
  { q: 'What happened during inactivity?', gh: 'A gap can be mistaken for no work.', pf: 'Shows "no observable GitHub activity", never "no work".', chain: ['Gap', 'Observable only'] },
  { q: 'How can a professor understand the project quickly?', gh: 'Inspect the repository manually.', pf: 'One summarized evidence report with traceable links.', chain: ['Evidence', 'Timeline', 'Report'], level: 3 },
];

const LEVEL_NAMES = ['', 'LOW', 'MEDIUM', 'HIGH'];

function Meter({ level }) {
  return (
    <div className="flex items-center gap-3" aria-label={`Evidence level ${LEVEL_NAMES[level]}`}>
      <div className="flex gap-1">
        {[1, 2, 3].map((i) => (
          <span key={i} className={`h-2 w-8 rounded-sm ${i <= level ? 'bg-[#0a8f6c]' : 'bg-[#cdd5df]'}`} />
        ))}
      </div>
      <span className="text-sm font-semibold text-[#12203a]">{LEVEL_NAMES[level]}</span>
    </div>
  );
}

function CoreDemo() {
  const [mode, setMode] = useState('raw');
  const tabs = [
    { id: 'raw', label: 'Raw counts' },
    { id: 'evidence', label: 'ProofLine evidence' },
  ];
  const evidence = {
    A: { items: ['1 pull request', '10 commits in backend files', 'Activity across 6 days'], level: 2 },
    B: { items: ['2 pull requests', '5 reviews given to peers', '2 revisions after review', 'Testing and docs areas'], level: 3 },
  };

  return (
    <div className="rounded-lg border border-[#cdd5df] bg-[#f1f3f5] p-5 sm:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-xl font-bold text-[#12203a]">Same number, different work</h3>
        <div className="inline-flex rounded-md bg-white p-1 ring-1 ring-[#cdd5df]" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={mode === t.id}
              onClick={() => setMode(t.id)}
              className={`rounded px-4 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0a8f6c] ${
                mode === t.id ? 'bg-[#12203a] text-white' : 'text-[#5b6678] hover:text-[#12203a]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div key={mode} className="mt-8 grid gap-8 md:grid-cols-2">
        {['A', 'B'].map((s) => (
          <div key={s}>
            <p className="font-semibold text-[#12203a]">Student {s}</p>
            <p className="mb-3 text-sm text-[#5b6678]">
              {s === 'A' ? '10 commits, 1 PR' : '3 commits, 2 PRs, 5 reviews, 2 revisions'}
            </p>
            {mode === 'raw' ? (
              <div className="pl-fade">
                <div className="h-3 w-full rounded-sm bg-[#cdd5df]">
                  <div className="pl-grow h-3 w-full rounded-sm bg-[#8a95a6]" />
                </div>
                <p className="mt-3 text-3xl font-bold text-[#12203a]">10 <span className="text-base font-medium text-[#5b6678]">contributions, 50%</span></p>
              </div>
            ) : (
              <div className="pl-fade">
                <ul className="mb-4 space-y-1.5 text-sm text-[#12203a]">
                  {evidence[s].items.map((it) => (
                    <li key={it} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#0a8f6c]" />{it}</li>
                  ))}
                </ul>
                <Meter level={evidence[s].level} />
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="mt-8 border-t border-[#cdd5df] pt-4 text-sm text-[#5b6678]">
        {mode === 'raw'
          ? 'A naive system scores both students equally. That is misleading.'
          : 'ProofLine shows why each level was reached, so the professor can check it.'}
      </p>
    </div>
  );
}

export default function Problems() {
  const [sel, setSel] = useState(0);
  const p = problems[sel];

  return (
    <section id="problems" className="scroll-mt-16 bg-white px-4 py-20 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <h2 className="max-w-2xl text-3xl font-bold tracking-tight text-[#12203a] sm:text-4xl">
          GitHub activity is not the same as contribution.
        </h2>
        <p className="mt-4 max-w-2xl text-lg text-[#5b6678]">
          GitHub stores the evidence. It does not explain it. Here is what changes when a professor opens ProofLine instead.
        </p>

        <div className="mt-10"><CoreDemo /></div>

        <h3 className="mb-6 mt-16 text-xl font-bold text-[#12203a]">Pick a question a professor asks</h3>
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <ul role="tablist" aria-orientation="vertical" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 lg:mx-0 lg:max-h-[480px] lg:flex-col lg:gap-0 lg:overflow-y-auto lg:px-0 lg:pb-0">
            {problems.map((it, i) => (
              <li key={it.q} className="shrink-0 lg:shrink">
                <button
                  role="tab"
                  aria-selected={sel === i}
                  onClick={() => setSel(i)}
                  className={`w-full whitespace-nowrap rounded-md border px-4 py-3 text-left text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0a8f6c] lg:whitespace-normal lg:rounded-none lg:border-0 lg:border-l-2 ${
                    sel === i
                      ? 'border-[#12203a] bg-[#f1f3f5] text-[#12203a] lg:border-[#0a8f6c]'
                      : 'border-[#cdd5df] text-[#5b6678] hover:text-[#12203a] lg:border-[#cdd5df]'
                  }`}
                >
                  {it.q}
                </button>
              </li>
            ))}
          </ul>

          <div key={sel} role="tabpanel" className="pl-fade rounded-lg border border-[#cdd5df] p-6 sm:p-8">
            <h4 className="text-2xl font-bold text-[#12203a]">{p.q}</h4>
            <div className="mt-6 grid gap-6 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-semibold text-[#5b6678]">What GitHub gives you</p>
                <p className="text-[#5b6678]">{p.gh}</p>
              </div>
              <div className="border-t border-[#cdd5df] pt-6 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
                <p className="mb-2 text-sm font-semibold text-[#0a8f6c]">What ProofLine shows</p>
                <p className="font-medium text-[#12203a]">{p.pf}</p>
              </div>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-y-2">
              {p.chain.map((c, i) => (
                <span key={c} className="pl-fade flex items-center" style={{ animationDelay: `${i * 120}ms` }}>
                  <span className={`rounded-md px-3 py-1.5 text-sm font-semibold ${i === p.chain.length - 1 ? 'bg-[#12203a] text-white' : 'bg-[#f1f3f5] text-[#12203a]'}`}>{c}</span>
                  {i < p.chain.length - 1 && <ChevronRight className="mx-1 h-4 w-4 text-[#8a95a6]" />}
                </span>
              ))}
            </div>

            {p.level && (
              <div className="mt-8 border-t border-[#cdd5df] pt-6">
                <p className="mb-2 text-sm text-[#5b6678]">Example evidence level</p>
                <Meter level={p.level} />
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
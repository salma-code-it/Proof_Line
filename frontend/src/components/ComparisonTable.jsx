import { Minus } from 'lucide-react';

const rows = [
  { f: 'Primary goal', gh: 'Build software', gc: 'Manage assignments', pl: 'Analyze team evidence' },
  { f: 'Contribution insight', gh: 'Raw commits and PRs', gc: 'Submission status', pl: 'Observable evidence chains' },
  { f: 'Collaboration', gh: null, gc: null, pl: 'Review, then revision, then merge' },
  { f: 'Task matching', gh: null, gc: 'Manual', pl: 'Matched to repository evidence' },
  { f: 'Understanding check', gh: null, gc: null, pl: 'Questions from real code changes' },
  { f: 'Honesty about limits', gh: 'No interpretation', gc: 'Limited context', pl: 'States limits, no invented percentages' },
];

function Cell({ label, value, dark = false }) {
  return (
    <div className={`px-5 py-4 ${dark ? 'bg-[#12203a] text-white' : 'text-[#5b6678]'}`}>
      <span className={`mb-1 block text-xs md:hidden ${dark ? 'text-[#7fe0c0]' : 'text-[#8a95a6]'}`}>{label}</span>
      {value ? (
        <span className={dark ? 'font-medium' : ''}>{value}</span>
      ) : (
        <span className="inline-flex items-center gap-1 text-[#8a95a6]"><Minus className="h-4 w-4" /><span className="sr-only">Not available</span></span>
      )}
    </div>
  );
}

export default function ComparisonTable() {
  const grid = 'md:grid md:grid-cols-[1.1fr_1fr_1fr_1.3fr]';
  return (
    <section id="comparison" className="scroll-mt-16 bg-white px-4 py-20 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <h2 className="max-w-2xl text-3xl font-bold tracking-tight text-[#12203a] sm:text-4xl">We don't replace GitHub. We interpret it.</h2>
        <p className="mt-4 max-w-2xl text-lg text-[#5b6678]">
          GitHub Classroom answers where the assignment is. ProofLine answers what observable evidence shows about how the team worked on it.
        </p>

        <div className="mt-10 overflow-hidden rounded-lg border border-[#cdd5df]">
          <div className={`hidden bg-[#f1f3f5] text-sm font-semibold text-[#12203a] ${grid}`}>
            <div className="px-5 py-4">Feature</div>
            <div className="px-5 py-4">GitHub</div>
            <div className="px-5 py-4">GitHub Classroom</div>
            <div className="bg-[#12203a] px-5 py-4 text-[#7fe0c0]">ProofLine</div>
          </div>
          {rows.map((r) => (
            <div key={r.f} className={`border-t border-[#cdd5df] first:border-t-0 md:border-t ${grid}`}>
              <div className="bg-[#f1f3f5] px-5 py-3 font-semibold text-[#12203a] md:bg-transparent md:py-4">{r.f}</div>
              <Cell label="GitHub" value={r.gh} />
              <Cell label="GitHub Classroom" value={r.gc} />
              <Cell label="ProofLine" value={r.pl} dark />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
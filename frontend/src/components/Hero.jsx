import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, RotateCcw } from 'lucide-react';

const chain = [
  { label: 'GitHub', title: 'Commit a91c82e', detail: 'Add JWT authentication · backend/security.py' },
  { label: 'Evidence', title: 'Pull request #12', detail: '4 files changed · merged' },
  { label: 'Collaboration', title: 'Review, then revision', detail: 'Feedback on Aug 11, follow-up commit pushed' },
  { label: 'Task', title: 'Authentication', detail: 'Observable activity associated with this task' },
  { label: 'Understanding', title: 'Why did you modify security.py?', detail: 'Question 2 of 5 in the professor review' },
];

export default function Hero() {
  const [n, setN] = useState(1);
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setN(chain.length);
      return undefined;
    }
    setN(1);
    const id = setInterval(() => {
      setN((v) => {
        if (v >= chain.length) {
          clearInterval(id);
          return v;
        }
        return v + 1;
      });
    }, 850);
    return () => clearInterval(id);
  }, [run]);

  return (
    <section className="px-4 pb-20 pt-28 sm:px-6 lg:pt-36">
      <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <h1 className="text-4xl font-bold leading-[1.05] tracking-tight text-[#12203a] sm:text-5xl lg:text-6xl">
            <span className="block text-[#8a95a6] line-through decoration-2">Don't just prove who coded.</span>
            <span className="mt-2 block">Prove who understood.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-[#5b6678]">
            ProofLine turns GitHub activity into evidence a professor can follow, then checks that each student
            understands the work they shipped.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              to="/project/demo"
              className="inline-flex items-center justify-center gap-2 rounded-md bg-[#12203a] px-6 py-3 font-semibold text-white transition-colors hover:bg-[#1d3158] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0a8f6c] focus-visible:ring-offset-2"
            >
              Analyze a project <ArrowRight className="h-4 w-4" />
            </Link>
            <a href="#problems" className="px-2 py-3 text-center font-semibold text-[#12203a] underline decoration-[#0a8f6c] decoration-2 underline-offset-4">
              See what it solves
            </a>
          </div>
          <p className="mt-6 text-sm text-[#5b6678]">Evidence, not scores. ProofLine never invents contribution percentages.</p>
        </div>

        <div className="lg:col-span-5">
          <div className="rounded-lg border border-[#cdd5df] bg-white p-6 sm:p-8">
            <div className="mb-6 flex items-center justify-between">
              <p className="text-sm font-semibold text-[#12203a]">One member, traced end to end</p>
              <button
                type="button"
                onClick={() => setRun(run + 1)}
                className="flex items-center gap-1 rounded text-sm text-[#5b6678] hover:text-[#12203a] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0a8f6c]"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Replay
              </button>
            </div>
            <ol>
              {chain.map((s, i) => {
                const lit = i < n;
                const last = i === chain.length - 1;
                return (
                  <li key={s.label} className="relative pb-7 pl-10 last:pb-0">
                    {!last && (
                      <span className="absolute bottom-0 left-[11px] top-7 w-px bg-[#cdd5df]">
                        <span className={`block w-full bg-[#0a8f6c] transition-all duration-700 ease-out ${i < n - 1 ? 'h-full' : 'h-0'}`} />
                      </span>
                    )}
                    <span
                      className={`absolute left-0 top-1 grid h-6 w-6 place-items-center rounded-full border-2 transition-colors duration-500 ${
                        lit ? 'border-[#0a8f6c] bg-[#0a8f6c]' : 'border-[#cdd5df] bg-white'
                      }`}
                    >
                      <span className="h-2 w-2 rounded-full bg-white" />
                    </span>
                    <div className={`transition-opacity duration-500 ${lit ? 'opacity-100' : 'opacity-40'}`}>
                      <p className="text-xs text-[#5b6678]">{s.label}</p>
                      <p className="font-semibold text-[#12203a]">{s.title}</p>
                      <p className="text-sm text-[#5b6678]">{s.detail}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
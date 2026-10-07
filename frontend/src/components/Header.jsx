import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X } from 'lucide-react';

const links = [
  { href: '#problems', label: 'Problems solved' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#comparison', label: 'Compare' },
];

export default function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-[#cdd5df] bg-[#f1f3f5]/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2 text-xl font-bold tracking-tight text-[#12203a]" onClick={() => setOpen(false)}>
          <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M2 12h20" stroke="#12203a" strokeWidth="2" strokeLinecap="round" />
            <circle cx="15" cy="12" r="4" fill="#0a8f6c" />
          </svg>
          ProofLine
        </Link>

        <nav className="hidden items-center gap-8 md:flex" aria-label="Main">
          {links.map((l) => (
            <a key={l.href} href={l.href} className="text-sm font-medium text-[#5b6678] transition-colors hover:text-[#12203a]">
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            to="/project" 
            className="rounded-md bg-[#12203a] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1d3158] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0a8f6c] focus-visible:ring-offset-2"
          >
            Analyze a project
          </Link>
          <button
            type="button"
            className="rounded-md p-2 text-[#12203a] md:hidden"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open && (
        <nav className="border-t border-[#cdd5df] bg-[#f1f3f5] px-4 py-3 md:hidden" aria-label="Mobile">
          {links.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="block py-3 text-base font-medium text-[#12203a]">
              {l.label}
            </a>
          ))}
        </nav>
      )}
    </header>
  );
}
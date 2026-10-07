import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="border-t border-[#cdd5df] bg-[#f1f3f5] px-4 py-10 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div>
          <Link to="/" className="text-lg font-bold text-[#12203a]">ProofLine</Link>
          <p className="mt-1 text-sm text-[#5b6678]">Evidence-based evaluation for student team projects.</p>
        </div>
        <nav className="flex gap-6 text-sm text-[#5b6678]" aria-label="Footer">
          <a href="#" className="hover:text-[#12203a]">Privacy</a>
          <a href="#" className="hover:text-[#12203a]">Terms</a>
          <a href="#" className="hover:text-[#12203a]">Contact</a>
        </nav>
      </div>
      <p className="mx-auto mt-8 max-w-6xl text-sm text-[#8a95a6]">© 2026 ProofLine</p>
    </footer>
  );
}
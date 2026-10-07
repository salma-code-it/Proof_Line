import React from "react";
import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  GitBranch,
  Sparkles,
  HelpCircle,
  ArrowLeft,
} from "lucide-react";

export default function Sidebar({ projectId }) {
  const location = useLocation();
  const base = projectId ? `/project/${projectId}` : "";

  const isExact = (path) => location.pathname === path;
  const starts = (path) => location.pathname.startsWith(path);

  return (
    <aside className="w-64 shrink-0 bg-white border-r border-[#cdd5df] flex flex-col min-h-screen sticky top-0">
      <div className="h-16 flex items-center px-6 border-b border-[#cdd5df]">
        <Link
          to="/"
          className="flex items-center gap-2"
          aria-label="ProofLine home"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <line
              x1="4"
              y1="12"
              x2="20"
              y2="12"
              stroke="#12203a"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <circle cx="12" cy="12" r="4" fill="#0a8f6c" />
          </svg>
          <span className="font-bold text-lg text-[#12203a] tracking-tight">
            ProofLine
          </span>
        </Link>
      </div>

      <nav className="flex-1 py-6 px-3 overflow-y-auto">
        {projectId ? (
          <>
            <Link
              to="/"
              className="flex items-center gap-3 px-3 py-2 mb-5 text-sm font-medium text-[#5b6678] hover:text-[#12203a] hover:bg-[#f1f3f5] rounded-md"
            >
              <ArrowLeft size={16} />
              All Projects
            </Link>

            <div className="px-3 mb-2 text-[11px] font-bold text-[#8a95a6] uppercase tracking-wider">
              Project
            </div>

            <NavItem
              to={base}
              icon={<LayoutDashboard size={18} />}
              label="Dashboard"
              active={isExact(base)}
            />

            <NavItem
              to={`${base}/members`}
              icon={<Users size={18} />}
              label="Members"
              active={
                isExact(`${base}/members`) ||
                starts(`${base}/member/`)
              }
            />

            <NavItem
              to={`${base}/timeline`}
              icon={<GitBranch size={18} />}
              label="Timeline"
              active={starts(`${base}/timeline`)}
            />

            <div className="px-3 mt-8 mb-2 text-[11px] font-bold text-[#8a95a6] uppercase tracking-wider">
              Understanding
            </div>

            <NavItem
              to={`${base}/understanding/tasks`}
              icon={<Sparkles size={18} />}
              label="Tasks & Matching"
              active={starts(`${base}/understanding/tasks`)}
            />

            <NavItem
              to={`${base}/understanding/questions`}
              icon={<HelpCircle size={18} />}
              label="Questions"
              active={starts(`${base}/understanding/questions`)}
              disabled
            />
          </>
        ) : (
          <div className="px-3 text-sm text-[#5b6678] leading-relaxed">
            Select or create a project to begin.
          </div>
        )}
      </nav>

      <div className="p-4 border-t border-[#cdd5df]">
        <p className="text-xs text-[#8a95a6] leading-relaxed">
          Evidence-based evaluation.
          <br />
          No invented scores.
        </p>
      </div>
    </aside>
  );
}

function NavItem({ to, icon, label, active, disabled = false }) {
  return (
    <Link
      to={disabled ? "#" : to}
      onClick={(event) => {
        if (disabled) event.preventDefault();
      }}
      aria-disabled={disabled}
      className={[
        "relative flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
        active
          ? "bg-[#12203a] text-white"
          : "text-[#5b6678] hover:bg-[#f1f3f5] hover:text-[#12203a]",
        disabled ? "opacity-45 cursor-not-allowed pointer-events-none" : "",
      ].join(" ")}
    >
      {active && (
        <span className="absolute left-0 w-1 h-6 bg-[#0a8f6c] rounded-r-full" />
      )}
      <span className={active ? "text-[#7fe0c0]" : ""}>
        {icon}
      </span>
      <span>{label}</span>
    </Link>
  );
}

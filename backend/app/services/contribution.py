from __future__ import annotations

import math
from collections import Counter
from typing import Any


def _safe_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _log_scale(n: int | float, base: float = 10.0) -> float:
    n = max(0.0, float(n))
    if n <= 0:
        return 0.0
    return math.log1p(n) / math.log(base)


def _member_branches(details: dict[str, Any]) -> list[str]:
    branches: list[str] = []
    seen: set[str] = set()
    for pr in details.get("pull_requests") or []:
        if not isinstance(pr, dict):
            continue
        name = pr.get("branch") or pr.get("branch_name")
        if isinstance(name, str) and name.strip():
            key = name.strip().lower()
            if key not in seen:
                seen.add(key)
                branches.append(name.strip())
    return branches


def _commit_file_stats(details: dict[str, Any]) -> dict[str, Any]:
    commits = details.get("commits") or []
    if not isinstance(commits, list):
        commits = []

    per_commit: list[dict[str, Any]] = []
    total_files = 0
    for c in commits:
        if not isinstance(c, dict):
            continue
        files = c.get("files") or []
        n = len(files) if isinstance(files, list) else 0
        total_files += n
        per_commit.append(
            {
                "sha": (c.get("sha") or "")[:12] or None,
                "message": (c.get("message") or "")[:120] or None,
                "files_changed": n,
                "additions": _safe_int(c.get("additions")),
                "deletions": _safe_int(c.get("deletions")),
            }
        )

    count = len(per_commit)
    return {
        "commit_count": count,
        "total_files_across_commits": total_files,
        "avg_files_per_commit": round(total_files / count, 2) if count else 0.0,
        "max_files_in_one_commit": max((r["files_changed"] for r in per_commit), default=0),
        "commits": per_commit,
    }


def _raw_points(member: dict[str, Any]) -> dict[str, float]:
    """
    Weighted observable signals. Weights are fixed and transparent.
    Tune only these constants if you want a different balance.
    """
    activity = member.get("activity") or {}
    code = member.get("code_activity") or {}
    files = member.get("file_activity") or {}
    totals = member.get("totals") or {}
    details = member.get("details") or {}

    branches = _member_branches(details)
    commit_stats = _commit_file_stats(details)

    # --- component scores (points) ---
    commits = _safe_int(activity.get("commits"))
    code_commits = _safe_int(code.get("commits"))
    prs = _safe_int(activity.get("pull_requests"))
    merged = _safe_int(activity.get("merged_pull_requests"))
    reviews = _safe_int(activity.get("reviews"))
    review_comments = _safe_int(activity.get("review_comments"))
    issues = _safe_int(activity.get("issues"))
    ci_runs = _safe_int(activity.get("ci_runs"))
    active_days = _safe_int(activity.get("active_days") or totals.get("active_days"))

    code_files = _safe_int(files.get("code"))
    model_files = _safe_int(files.get("model"))
    doc_files = _safe_int(files.get("documentation"))
    config_files = _safe_int(files.get("configuration"))
    data_files = _safe_int(files.get("data"))
    other_files = _safe_int(files.get("other"))
    changed_files = _safe_int(totals.get("changed_files_count"))

    additions = _safe_int(totals.get("additions") or code.get("additions"))
    deletions = _safe_int(totals.get("deletions") or code.get("deletions"))

    # Fixed weights (observable activity only — not ownership)
    points = {
        "commits": commits * 4.0 + code_commits * 2.0,
        "pull_requests": prs * 8.0 + merged * 12.0,
        "reviews": reviews * 10.0 + review_comments * 3.0,
        "issues_ci": issues * 3.0 + ci_runs * 2.0,
        "active_days": active_days * 5.0,
        "branches": len(branches) * 6.0,
        "files_code": code_files * 3.0,
        "files_model": model_files * 4.0,
        "files_docs": doc_files * 1.5,
        "files_config": config_files * 1.5,
        "files_data": data_files * 2.0,
        "files_other": other_files * 0.5,
        "changed_files": min(changed_files, 200) * 0.4,  # soft cap
        "lines": _log_scale(additions) * 25.0 + _log_scale(deletions) * 10.0,
        "avg_files_per_commit": commit_stats["avg_files_per_commit"] * 2.0,
    }

    # Evidence-status boost (qualitative label already computed by EvidenceEngine)
    status = str(member.get("evidence_status") or "").upper()
    status_boost = {"HIGH": 1.15, "MEDIUM": 1.05, "LOW": 1.0}.get(status, 1.0)

    total_raw = sum(points.values()) * status_boost
    return {
        "components": points,
        "status_boost": status_boost,
        "raw_total": round(total_raw, 2),
        "branch_count": len(branches),
        "branches": branches,
        "commit_file_stats": commit_stats,
    }


def calculate_member_contributions(
    member_analysis: list[dict[str, Any]],
) -> dict[str, Any]:
    if not isinstance(member_analysis, list) or not member_analysis:
        return {
            "metric": "observable_activity_weight",
            "disclaimer": (
                "Relative share of observable GitHub activity only. "
                "Not a percentage of real-world contribution or understanding."
            ),
            "members": [],
            "team_raw_total": 0.0,
        }

    scored: list[dict[str, Any]] = []
    for m in member_analysis:
        if not isinstance(m, dict):
            continue
        raw = _raw_points(m)
        scored.append(
            {
                "member_id": m.get("member_id"),
                "member_number": m.get("member_number"),
                "display_name": m.get("display_name"),
                "github_username": m.get("github_username"),
                "evidence_status": m.get("evidence_status"),
                "activity_snapshot": {
                    "commits": _safe_int((m.get("activity") or {}).get("commits")),
                    "pull_requests": _safe_int(
                        (m.get("activity") or {}).get("pull_requests")
                    ),
                    "merged_pull_requests": _safe_int(
                        (m.get("activity") or {}).get("merged_pull_requests")
                    ),
                    "reviews": _safe_int((m.get("activity") or {}).get("reviews")),
                    "active_days": _safe_int(
                        (m.get("activity") or {}).get("active_days")
                    ),
                    "changed_files_count": _safe_int(
                        (m.get("totals") or {}).get("changed_files_count")
                    ),
                    "additions": _safe_int((m.get("totals") or {}).get("additions")),
                    "deletions": _safe_int((m.get("totals") or {}).get("deletions")),
                    "branch_count": raw["branch_count"],
                    "branches": raw["branches"],
                    "avg_files_per_commit": raw["commit_file_stats"][
                        "avg_files_per_commit"
                    ],
                    "max_files_in_one_commit": raw["commit_file_stats"][
                        "max_files_in_one_commit"
                    ],
                },
                "components": {k: round(v, 2) for k, v in raw["components"].items()},
                "status_boost": raw["status_boost"],
                "raw_total": raw["raw_total"],
                "commit_file_details": raw["commit_file_stats"]["commits"][:30],
            }
        )

    team_raw = sum(s["raw_total"] for s in scored) or 1.0

    for s in scored:
        share = (s["raw_total"] / team_raw) * 100.0
        s["observable_activity_weight"] = round(share, 1)  # relative % of team activity
        # Optional absolute 0–100 scale for UI charts (capped)
        s["activity_score_0_100"] = min(100, round(s["raw_total"] / 5.0, 1))

    scored.sort(key=lambda x: x["observable_activity_weight"], reverse=True)

    return {
        "metric": "observable_activity_weight",
        "disclaimer": (
            "Values are relative shares of observable GitHub activity "
            "(commits, PRs, merges, reviews, files by kind, branches, "
            "active days, log-scaled line changes). "
            "They are not a measure of intellectual ownership or understanding. "
            "Understanding is evaluated only via the Proof of Understanding flow."
        ),
        "formula_notes": {
            "commits": "4 pts each + 2 pts per code-commit",
            "pull_requests": "8 pts created + 12 pts merged",
            "reviews": "10 pts review + 3 pts review comment",
            "files": "code×3, model×4, docs×1.5, config×1.5, data×2, other×0.5",
            "lines": "log10(1+additions)×25 + log10(1+deletions)×10",
            "branches": "6 pts per unique PR branch",
            "status_boost": "HIGH ×1.15, MEDIUM ×1.05, LOW ×1.0",
            "relative": "weight = member_raw / team_raw × 100",
        },
        "team_raw_total": round(team_raw, 2),
        "members": scored,
    }
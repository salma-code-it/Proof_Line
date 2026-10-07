from __future__ import annotations

import fnmatch
import json
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any

from app.models import Event, Member, Project


  
# CONSTANTS

# Event types the timeline understands.
ACTIVITY_TYPES = {
    "COMMIT",
    "PR_CREATED",
    "PR_MERGED",
    "PR_COMMIT",
    "REVIEW",
    "REVIEW_COMMENT",
    "ISSUE_CREATED",
    "ISSUE_COMMENT",
    "CI_RUN",
    "BRANCH_CREATED",
}

# Event types that belong to one PR lifecycle.
PR_TYPES = {
    "PR_CREATED",
    "PR_MERGED",
    "PR_COMMIT",
    "REVIEW",
    "REVIEW_COMMENT",
}

# Event type -> daily counter field.
TYPE_TO_FIELD = {
    "COMMIT": "commits",
    "PR_COMMIT": "commits",
    "PR_CREATED": "pull_requests",
    "PR_MERGED": "merges",
    "REVIEW": "reviews",
    "REVIEW_COMMENT": "review_comments",
    "ISSUE_CREATED": "issues",
    "ISSUE_COMMENT": "issue_comments",
    "CI_RUN": "ci_runs",
    "BRANCH_CREATED": "branches",
}

# Daily counter field -> broad activity category.
FIELD_TO_CATEGORY = {
    "commits": "code",
    "branches": "code",
    "pull_requests": "pull_requests",
    "merges": "pull_requests",
    "reviews": "collaboration",
    "review_comments": "collaboration",
    "issue_comments": "collaboration",
    "issues": "issues",
    "ci_runs": "ci",
}

DAILY_FIELDS = (
    "commits",
    "pull_requests",
    "merges",
    "reviews",
    "review_comments",
    "issues",
    "issue_comments",
    "ci_runs",
    "branches",
)

# Number of INACTIVE days needed before a gap is reported.
PROJECT_GAP_DAYS = 3
MEMBER_GAP_DAYS = 5

# Pattern detection only makes sense with enough data / duration.
MIN_EVENTS_FOR_PATTERN = 5
MIN_SPAN_FOR_PATTERN = 7
LATE_SHARE_THRESHOLD = 0.6
CONCENTRATION_SHARE_THRESHOLD = 0.4

MAX_PR_TIMELINES = 150
MAX_PR_STEPS = 15
MAX_PARALLEL_DAYS = 30
MAX_DAILY_FILL_DAYS = 400


  
# TIMELINE SERVICE
class TimelineService:
    """
    Rules:
        - A PR is ONE unit. Its commits/reviews/merge describe its
          progression, they are not separate contributions.
        - A PR_COMMIT that already exists as a COMMIT is not counted twice.
        - No productivity score, no contribution percentage.
        - No raw GitHub metadata is exposed.
        - Inactivity on GitHub never proves that no work was done.
    """

    def __init__(self, project: Project) -> None:
        self.project = project
        self.members: list[Member] = list(project.members)
        self.events: list[Event] = list(project.events)
        self.tasks = list(project.tasks)

        self._member_by_id = {m.id: m for m in self.members}
        self._member_by_login = {
            m.github_username.lower(): m
            for m in self.members
            if m.github_username
        }

        self._items: list[dict[str, Any]] = []
        self._activity: list[dict[str, Any]] = []
        self._sha_to_pr: dict[str, int] = {}

        self._prepare()

      
    # PUBLIC API
    def get_timeline(self, limit: int = 200) -> dict[str, Any]:
        activity = self._activity
        first_date, last_date = self._project_window()

        project_gaps = self._gaps(
            sorted({i["date"] for i in activity}),
            PROJECT_GAP_DAYS,
        )

        member_windows = self._member_windows(first_date, last_date)
        pr_timelines = self._pull_request_timelines()
        daily = self._daily_activity(activity)

        return {
            "project_id": self.project.id,
            "summary": self._summary(project_gaps),
            "milestones": self._milestones(project_gaps),
            "phases": self._phases(),
            "activity_gaps": [
                {**gap, "scope": "project"} for gap in project_gaps
            ],
            "daily_activity": daily,
            "member_windows": member_windows,
            "pull_request_timelines": pr_timelines,
            "task_timelines": self._task_timelines(),
            "parallel_activity": self._parallel_activity(),
            "observations": self._observations(
                project_gaps,
                member_windows,
                pr_timelines,
            ),
            "events": self._compact_events(activity, limit),
            "limitations": self._limitations(),
        }

    def get_member_timeline(
        self,
        member_id: int,
        limit: int = 200,
    ) -> dict[str, Any]:
        member = self._member_by_id.get(member_id)

        if member is None:
            return {
                "project_id": self.project.id,
                "member": None,
                "window": None,
                "daily_activity": [],
                "pull_requests": [],
                "tasks": [],
                "events": [],
                "limitations": self._limitations(),
            }

        first_date, last_date = self._project_window()

        own = [
            i for i in self._activity
            if i["member"] is not None and i["member"].id == member_id
        ]

        windows = self._member_windows(first_date, last_date)
        window = next(
            (w for w in windows if w["member_id"] == member_id),
            None,
        )

        name = member.display_name
        own_prs = [
            pr for pr in self._pull_request_timelines()
            if pr["author_member_id"] == member_id
            or name in pr["reviewers"]
        ]

        own_tasks = [
            {
                "task_id": t["task_id"],
                "name": t["name"],
                "first_activity": t["first_activity"],
                "last_activity": t["last_activity"],
                "status": t["status"],
            }
            for t in self._task_timelines()
            if any(c["member"] == name for c in t["contributors"])
        ]

        return {
            "project_id": self.project.id,
            "member": {
                "id": member.id,
                "member_number": member.member_number,
                "display_name": member.display_name,
                "github_username": member.github_username,
                "github_contributions": member.github_contributions,
            },
            "window": window,
            "daily_activity": self._daily_activity(own),
            "pull_requests": own_prs,
            "tasks": own_tasks,
            "events": self._compact_events(own, limit),
            "limitations": self._limitations(),
        }

      
    # PREPARATION (single pass, everything cached)
    def _prepare(self) -> None:
        raw: list[dict[str, Any]] = []
        commit_shas: set[str] = set()

        for event in self.events:
            etype = (event.event_type or "").upper()

            if etype not in ACTIVITY_TYPES or event.timestamp is None:
                continue

            meta = self._metadata(event)
            member = self._resolve_member(event, meta)
            login = self._login(meta, member)
            files = self._files(meta)
            sha = meta.get("sha") if isinstance(meta.get("sha"), str) else None

            if etype == "COMMIT" and sha:
                commit_shas.add(sha)

            ts = self._utc(event.timestamp)

            raw.append(
                {
                    "id": event.id,
                    "type": etype,
                    "ts": ts,
                    "date": ts.date(),
                    "member": member,
                    "login": login,
                    "pr": self._pr_number(etype, meta),
                    "issue": meta.get("issue_number"),
                    "state": meta.get("state"),
                    "sha": sha,
                    "label": self._label(etype, event, meta),
                    "files": files,
                    "areas": {self._work_area(f) for f in files},
                    "dup": False,
                }
            )

        raw.sort(key=lambda i: i["ts"])

        # A PR commit that is also a repository COMMIT is the same
        # commit. Count it once.
        for item in raw:
            if item["type"] == "PR_COMMIT":
                if item["sha"] and item["pr"] is not None:
                    self._sha_to_pr[item["sha"]] = item["pr"]
                if item["sha"] and item["sha"] in commit_shas:
                    item["dup"] = True

        self._items = raw
        self._activity = [i for i in raw if not i["dup"]]

    @staticmethod
    def _metadata(event: Event) -> dict[str, Any]:
        data = event.metadata_json

        if isinstance(data, dict):
            return data

        if isinstance(data, str):
            try:
                value = json.loads(data)
                return value if isinstance(value, dict) else {}
            except (TypeError, json.JSONDecodeError):
                return {}

        return {}

    def _resolve_member(
        self,
        event: Event,
        meta: dict[str, Any],
    ) -> Member | None:
        if event.member_id is not None:
            member = self._member_by_id.get(event.member_id)
            if member:
                return member

        for key in ("github_username", "login", "username", "user"):
            value = meta.get(key)
            if isinstance(value, str) and value.strip():
                member = self._member_by_login.get(value.strip().lower())
                if member:
                    return member

        return None

    @staticmethod
    def _login(
        meta: dict[str, Any],
        member: Member | None,
    ) -> str | None:
        for key in ("github_username", "login", "username", "user"):
            value = meta.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()

        return member.github_username if member else None

    @staticmethod
    def _pr_number(etype: str, meta: dict[str, Any]) -> int | None:
        if etype not in PR_TYPES:
            return None

        for key in ("pr_number", "number", "pull_number"):
            value = meta.get(key)
            if value is None:
                continue
            try:
                return int(value)
            except (TypeError, ValueError):
                return None

        return None

    @staticmethod
    def _files(meta: dict[str, Any]) -> list[str]:
        values = meta.get("files")

        if not isinstance(values, list):
            return []

        result: list[str] = []

        for value in values:
            if isinstance(value, str):
                path = value
            elif isinstance(value, dict):
                path = value.get("filename") or value.get("path") or ""
            else:
                continue

            path = str(path).replace("\\", "/").strip().lstrip("./")

            if path:
                result.append(path)

        return list(dict.fromkeys(result))

    @staticmethod
    def _label(etype: str, event: Event, meta: dict[str, Any]) -> str | None:
        text = (
            meta.get("title")
            or meta.get("message")
            or event.artifact
            or ""
        )

        if not isinstance(text, str):
            return None

        first_line = text.strip().splitlines()[0] if text.strip() else ""
        first_line = " ".join(first_line.split())

        if not first_line:
            return None

        return first_line if len(first_line) <= 120 else first_line[:117] + "..."

    @staticmethod
    def _utc(value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    @staticmethod
    def _work_area(path: str) -> str:
        parts = [p for p in path.split("/") if p]

        if len(parts) >= 3:
            return "/".join(parts[:2])

        if len(parts) == 2:
            return parts[0]

        return "(root)"

    @staticmethod
    def _iso(value: datetime | date | None) -> str | None:
        return value.isoformat() if value else None

    @staticmethod
    def _hours(start: datetime | None, end: datetime | None) -> float | None:
        if not start or not end:
            return None
        return round((end - start).total_seconds() / 3600, 1)

    @staticmethod
    def _actor(item: dict[str, Any]) -> str | None:
        member = item["member"]
        return member.display_name if member else item["login"]

      
    # PROJECT WINDOW / SUMMARY
      

    def _project_window(self) -> tuple[date | None, date | None]:
        if not self._activity:
            return None, None
        return self._activity[0]["date"], self._activity[-1]["date"]

    def _summary(self, project_gaps: list[dict[str, Any]]) -> dict[str, Any]:
        activity = self._activity

        if not activity:
            return {
                "first_activity": None,
                "last_activity": None,
                "active_days": 0,
                "activity_span_days": 0,
                "longest_activity_gap_days": 0,
                "total_activity_events": 0,
                "unattributed_events": 0,
                "members_with_activity": 0,
                "members_without_activity": len(self.members),
            }

        active_member_ids = {
            i["member"].id for i in activity if i["member"] is not None
        }

        first_date, last_date = self._project_window()

        return {
            "first_activity": activity[0]["ts"].isoformat(),
            "last_activity": activity[-1]["ts"].isoformat(),
            "active_days": len({i["date"] for i in activity}),
            "activity_span_days": (last_date - first_date).days + 1,
            "longest_activity_gap_days": max(
                (g["days"] for g in project_gaps),
                default=0,
            ),
            "total_activity_events": len(activity),
            "unattributed_events": sum(
                1 for i in activity if i["member"] is None
            ),
            "members_with_activity": len(active_member_ids),
            "members_without_activity": max(
                len(self.members) - len(active_member_ids),
                0,
            ),
        }

      
    # GAPS
      

    @staticmethod
    def _gaps(
        dates: list[date],
        min_inactive_days: int,
    ) -> list[dict[str, Any]]:
        gaps = []

        for previous, current in zip(dates, dates[1:]):
            inactive = (current - previous).days - 1

            if inactive >= min_inactive_days:
                gaps.append(
                    {
                        "start": previous.isoformat(),
                        "end": current.isoformat(),
                        "days": inactive,
                    }
                )

        return gaps

      
    # MILESTONES
      

    def _milestones(
        self,
        project_gaps: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        if not self._activity:
            return []

        result: list[dict[str, Any]] = []

        def first_of(types: set[str]) -> dict[str, Any] | None:
            return next(
                (i for i in self._activity if i["type"] in types),
                None,
            )

        def add(kind: str, item: dict[str, Any], description: str) -> None:
            entry = {
                "type": kind,
                "timestamp": item["ts"].isoformat(),
                "description": description,
            }

            actor = self._actor(item)
            if actor:
                entry["actor"] = actor
            if item["pr"] is not None:
                entry["pr_number"] = item["pr"]

            result.append(entry)

        first = self._activity[0]
        add("FIRST_ACTIVITY", first, "First observable repository activity.")

        for kind, types, text in (
            ("FIRST_PULL_REQUEST", {"PR_CREATED"}, "First pull request created."),
            ("FIRST_REVIEW", {"REVIEW", "REVIEW_COMMENT"}, "First review activity."),
            ("FIRST_MERGE", {"PR_MERGED"}, "First pull request merged."),
            ("FIRST_CI_RUN", {"CI_RUN"}, "First CI/CD workflow run."),
        ):
            item = first_of(types)
            if item:
                add(kind, item, text)

        last = self._activity[-1]
        add("LAST_ACTIVITY", last, "Last observable repository activity.")

        if project_gaps:
            longest = max(project_gaps, key=lambda g: g["days"])
            result.append(
                {
                    "type": "LONGEST_GAP",
                    "timestamp": longest["start"],
                    "end": longest["end"],
                    "days": longest["days"],
                    "description": (
                        "Longest period without observable "
                        "repository activity."
                    ),
                }
            )

        result.sort(key=lambda m: m["timestamp"])
        return result

      
    # PHASES
      

    def _phases(self) -> list[dict[str, Any]]:
        items = self._activity

        if not items:
            return []

        first, last = items[0]["ts"], items[-1]["ts"]
        span_days = (last.date() - first.date()).days + 1

        if span_days < 3 or len(items) < 6:
            groups = [("SINGLE_PHASE", items)]
        else:
            total = (last - first).total_seconds() or 1.0
            buckets: list[list[dict[str, Any]]] = [[], [], []]

            for item in items:
                ratio = (item["ts"] - first).total_seconds() / total
                buckets[min(2, int(ratio * 3))].append(item)

            names = ("EARLY_PHASE", "MIDDLE_PHASE", "LATE_PHASE")
            groups = [
                (name, bucket)
                for name, bucket in zip(names, buckets)
                if bucket
            ]

        phases = []

        for name, bucket in groups:
            mix = self._category_mix(bucket)
            areas = Counter(
                area for i in bucket for area in i["areas"]
            )
            members = sorted(
                {i["member"].display_name for i in bucket if i["member"]}
            )

            phases.append(
                {
                    "name": name,
                    "start": bucket[0]["ts"].isoformat(),
                    "end": bucket[-1]["ts"].isoformat(),
                    "events": len(bucket),
                    "main_activity": (
                        max(mix, key=mix.get) if mix else None
                    ),
                    "activity_mix": mix,
                    "members": members,
                    "top_areas": [a for a, _ in areas.most_common(3)],
                }
            )

        return phases

    @staticmethod
    def _category_mix(items: list[dict[str, Any]]) -> dict[str, int]:
        counter: Counter[str] = Counter()

        for item in items:
            field = TYPE_TO_FIELD.get(item["type"])
            category = FIELD_TO_CATEGORY.get(field or "")
            if category:
                counter[category] += 1

        return dict(counter.most_common())

      
    # DAILY ACTIVITY (graph-ready)
      

    def _daily_activity(
        self,
        items: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        if not items:
            return []

        rows: dict[date, dict[str, Any]] = {}

        for item in items:
            day = item["date"]
            row = rows.get(day)

            if row is None:
                row = {
                    "date": day.isoformat(),
                    "events": 0,
                    **{field: 0 for field in DAILY_FIELDS},
                    "members": set(),
                    "by_member": Counter(),
                }
                rows[day] = row

            row["events"] += 1

            field = TYPE_TO_FIELD.get(item["type"])
            if field:
                row[field] += 1

            member = item["member"]
            if member is not None:
                row["members"].add(member.id)
                row["by_member"][member.member_number] += 1

        first_day = min(rows)
        last_day = max(rows)

        # Fill empty days so a chart shows real silence.
        days: list[date]
        if (last_day - first_day).days + 1 <= MAX_DAILY_FILL_DAYS:
            days = [
                first_day + timedelta(days=n)
                for n in range((last_day - first_day).days + 1)
            ]
        else:
            days = sorted(rows)

        result = []

        for day in days:
            row = rows.get(day)

            if row is None:
                result.append(
                    {
                        "date": day.isoformat(),
                        "events": 0,
                        **{field: 0 for field in DAILY_FIELDS},
                        "members": 0,
                        "by_member": {},
                    }
                )
                continue

            result.append(
                {
                    **{
                        k: v
                        for k, v in row.items()
                        if k not in {"members", "by_member"}
                    },
                    "members": len(row["members"]),
                    "by_member": {
                        str(number): count
                        for number, count in sorted(row["by_member"].items())
                    },
                }
            )

        return result

      
    # MEMBER WINDOWS
      

    def _member_windows(
        self,
        project_first: date | None,
        project_last: date | None,
    ) -> list[dict[str, Any]]:
        by_member: dict[int, list[dict[str, Any]]] = defaultdict(list)

        for item in self._activity:
            if item["member"] is not None:
                by_member[item["member"].id].append(item)

        span = (
            (project_last - project_first).days + 1
            if project_first and project_last
            else 0
        )

        windows = []

        for member in sorted(self.members, key=lambda m: m.member_number):
            items = by_member.get(member.id, [])

            base = {
                "member_id": member.id,
                "member_number": member.member_number,
                "member": member.display_name,
                "github_username": member.github_username,
            }

            if not items:
                windows.append(
                    {
                        **base,
                        "first_activity": None,
                        "last_activity": None,
                        "active_days": 0,
                        "activity_span_days": 0,
                        "inactive_gaps": [],
                        "relative_window": None,
                        "activity_pattern": "NO_ACTIVITY",
                        "activity": {field: 0 for field in DAILY_FIELDS},
                    }
                )
                continue

            per_day = Counter(i["date"] for i in items)
            dates = sorted(per_day)

            activity = {field: 0 for field in DAILY_FIELDS}
            for item in items:
                field = TYPE_TO_FIELD.get(item["type"])
                if field:
                    activity[field] += 1

            relative = None
            if project_first and span > 1:
                relative = {
                    "start_percent": round(
                        (dates[0] - project_first).days / (span - 1) * 100
                    ),
                    "end_percent": round(
                        (dates[-1] - project_first).days / (span - 1) * 100
                    ),
                }

            windows.append(
                {
                    **base,
                    "first_activity": items[0]["ts"].isoformat(),
                    "last_activity": items[-1]["ts"].isoformat(),
                    "active_days": len(dates),
                    "activity_span_days": (dates[-1] - dates[0]).days + 1,
                    "inactive_gaps": self._gaps(dates, MEMBER_GAP_DAYS),
                    "relative_window": relative,
                    "activity_pattern": self._activity_pattern(
                        per_day,
                        project_first,
                        span,
                    ),
                    "activity": activity,
                }
            )

        return windows

    @staticmethod
    def _activity_pattern(
        per_day: Counter,
        project_first: date | None,
        span: int,
    ) -> str:
        total = sum(per_day.values())

        if total == 0:
            return "NO_ACTIVITY"

        if total < MIN_EVENTS_FOR_PATTERN:
            return "SPARSE"

        if project_first is None or span < MIN_SPAN_FOR_PATTERN:
            return "DISTRIBUTED"

        # Share of activity in the final 20% of the project window.
        late_cut = project_first + timedelta(days=int(span * 0.8))
        late_share = sum(
            count for day, count in per_day.items() if day >= late_cut
        ) / total

        if late_share >= LATE_SHARE_THRESHOLD:
            return "LATE_ACTIVITY"

        # Best share of activity inside any 2 consecutive days.
        dates = sorted(per_day)
        best = 0
        right = 0
        running = 0

        for left in range(len(dates)):
            while (
                right < len(dates)
                and (dates[right] - dates[left]).days <= 1
            ):
                running += per_day[dates[right]]
                right += 1

            best = max(best, running)
            running -= per_day[dates[left]]

        if best / total >= CONCENTRATION_SHARE_THRESHOLD:
            return "CONCENTRATED_ACTIVITY"

        return "DISTRIBUTED"

      
    # PULL REQUEST PROGRESSION
      

    def _pull_request_timelines(self) -> list[dict[str, Any]]:
        groups: dict[int, list[dict[str, Any]]] = defaultdict(list)

        for item in self._items:
            if item["pr"] is not None and item["type"] in PR_TYPES:
                groups[item["pr"]].append(item)

        result = []

        for number, items in groups.items():
            items.sort(key=lambda i: i["ts"])

            created = next(
                (i for i in items if i["type"] == "PR_CREATED"),
                None,
            )
            merged = next(
                (i for i in items if i["type"] == "PR_MERGED"),
                None,
            )

            commits = [i for i in items if i["type"] == "PR_COMMIT"]

            author_login = (
                created["login"].lower()
                if created and created["login"]
                else None
            )

            # Reviews written by the PR author do not count as review.
            reviews = [
                i for i in items
                if i["type"] in {"REVIEW", "REVIEW_COMMENT"}
                and not (
                    author_login
                    and i["login"]
                    and i["login"].lower() == author_login
                )
            ]

            created_at = created["ts"] if created else items[0]["ts"]
            first_review = reviews[0]["ts"] if reviews else None
            merged_at = merged["ts"] if merged else None

            revised = bool(
                first_review
                and any(c["ts"] > first_review for c in commits)
            )

            reviewers = sorted(
                {
                    name
                    for name in (self._actor(i) for i in reviews)
                    if name
                }
            )

            author_member = created["member"] if created else None

            result.append(
                {
                    "pr_number": number,
                    "title": created["label"] if created else None,
                    "author": self._actor(created) if created else None,
                    "author_member_id": (
                        author_member.id if author_member else None
                    ),
                    "created_at": created_at.isoformat(),
                    "first_review_at": self._iso(first_review),
                    "merged_at": self._iso(merged_at),
                    "status": "MERGED" if merged else "NOT_MERGED",
                    "pr_commits": len(commits),
                    "reviews": sum(
                        1 for i in reviews if i["type"] == "REVIEW"
                    ),
                    "review_comments": sum(
                        1 for i in reviews if i["type"] == "REVIEW_COMMENT"
                    ),
                    "reviewers": reviewers,
                    "revised_after_review": revised,
                    "hours_to_first_review": self._hours(
                        created_at, first_review
                    ),
                    "hours_to_merge": self._hours(created_at, merged_at),
                    "steps": self._pr_steps(items),
                }
            )

        result.sort(key=lambda p: p["created_at"], reverse=True)
        return result[:MAX_PR_TIMELINES]

    def _pr_steps(self, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Collapse consecutive identical (actor, action) into one step."""
        steps: list[dict[str, Any]] = []

        for item in items:
            if item["type"] == "PR_CREATED":
                action = "created"
            elif item["type"] == "PR_COMMIT":
                action = "commit"
            elif item["type"] == "REVIEW":
                state = (item.get("state") or "reviewed").lower()
                action = f"review:{state}"
            elif item["type"] == "REVIEW_COMMENT":
                action = "review_comment"
            elif item["type"] == "PR_MERGED":
                action = "merged"
            else:
                continue

            actor = self._actor(item)

            if (
                steps
                and steps[-1]["actor"] == actor
                and steps[-1]["action"] == action
            ):
                steps[-1]["count"] += 1
                continue

            steps.append(
                {
                    "timestamp": item["ts"].isoformat(),
                    "actor": actor,
                    "action": action,
                    "count": 1,
                    "state": item.get("state"),
                }
            )

        if len(steps) > MAX_PR_STEPS:
            head = steps[: MAX_PR_STEPS // 2]
            tail = steps[-(MAX_PR_STEPS - len(head)):]
            return head + tail

        return steps
      
    # TASK TIMELINE
      

    def _task_timelines(self) -> list[dict[str, Any]]:
        if not self.tasks:
            return []

        merged_prs = {
            i["pr"] for i in self._items
            if i["type"] == "PR_MERGED" and i["pr"] is not None
        }

        reviews_by_pr: Counter[int] = Counter(
            i["pr"] for i in self._items
            if i["type"] == "REVIEW" and i["pr"] is not None
        )

        # Work units: a PR (once) or a commit that is not part of a PR.
        units = []

        for item in self._activity:
            if not item["files"]:
                continue

            if item["type"] == "PR_CREATED" and item["pr"] is not None:
                units.append(item)
            elif item["type"] == "PR_COMMIT":
                # Only count if not already counted as a repository COMMIT
                if item["sha"] and item["sha"] in self._sha_to_pr:
                    continue
                units.append(item)

            elif item["type"] == "COMMIT":
                if item["sha"] and item["sha"] in self._sha_to_pr:
                    continue
                units.append(item)

        result = []

        for task in self.tasks:
            patterns = self._parse_patterns(task.file_patterns)

            matched_units = [
                u for u in units
                if patterns
                and any(self._matches(f, patterns) for f in u["files"])
            ]

            prs = {u["pr"] for u in matched_units if u["type"] == "PR_CREATED"}
            commits = [u for u in matched_units if u["type"] == "COMMIT"]
            merged = prs & merged_prs

            contributors: Counter[str] = Counter()
            for unit in matched_units:
                name = self._actor(unit)
                if name:
                    contributors[name] += 1

            dates = sorted({u["date"] for u in matched_units})

            if not matched_units:
                status = "NO_OBSERVABLE_ACTIVITY"
            elif merged:
                status = "MERGED_WORK_OBSERVED"
            else:
                status = "ACTIVITY_OBSERVED"

            result.append(
                {
                    "task_id": task.id,
                    "name": task.name,
                    "source": getattr(task, "source", "manual"),
                    "first_activity": (
                        min(u["ts"] for u in matched_units).isoformat()
                        if matched_units else None
                    ),
                    "last_activity": (
                        max(u["ts"] for u in matched_units).isoformat()
                        if matched_units else None
                    ),
                    "active_days": len(dates),
                    "pull_requests": len(prs),
                    "merged_pull_requests": len(merged),
                    "standalone_commits": len(commits),
                    "reviews_on_pull_requests": sum(
                        reviews_by_pr[p] for p in prs
                    ),
                    "contributors": [
                        {"member": name, "work_units": count}
                        for name, count in contributors.most_common()
                    ],
                    "status": status,
                }
            )

        return result

    @staticmethod
    def _parse_patterns(raw: Any) -> list[str]:
        if raw is None:
            return []

        if isinstance(raw, str):
            raw = raw.strip()
            if not raw:
                return []
            try:
                raw = json.loads(raw)
            except (TypeError, json.JSONDecodeError):
                return [p.strip() for p in raw.split(",") if p.strip()]

        if isinstance(raw, list):
            return [str(p).strip() for p in raw if str(p).strip()]

        return []

    @staticmethod
    def _matches(path: str, patterns: list[str]) -> bool:
        normalized = path.replace("\\", "/").strip().lstrip("./")

        for pattern in patterns:
            pat = pattern.replace("\\", "/").strip().lstrip("./")

            if not pat:
                continue

            if fnmatch.fnmatch(normalized, pat):
                return True

            if pat.endswith("/*") and normalized.startswith(pat[:-1]):
                return True

        return False

      
    # PARALLEL ACTIVITY
      

    def _parallel_activity(self) -> list[dict[str, Any]]:
        per_day: dict[date, dict[str, set[str]]] = defaultdict(
            lambda: defaultdict(set)
        )

        for item in self._activity:
            if not item["areas"] or item["member"] is None:
                continue

            if item["type"] == "PR_CREATED":
                pass
            elif item["type"] == "COMMIT":
                if item["sha"] and item["sha"] in self._sha_to_pr:
                    continue
            else:
                continue

            per_day[item["date"]][item["member"].display_name].update(
                item["areas"]
            )

        result = []

        for day in sorted(per_day):
            members = per_day[day]
            all_areas = set().union(*members.values())

            if len(members) < 2 or len(all_areas) < 2:
                continue

            result.append(
                {
                    "date": day.isoformat(),
                    "members": len(members),
                    "areas": len(all_areas),
                    "work": {
                        name: sorted(areas)[:3]
                        for name, areas in sorted(members.items())
                    },
                }
            )

        return result[-MAX_PARALLEL_DAYS:]

      
    # OBSERVATIONS (never accusations)
      

    def _observations(
        self,
        project_gaps: list[dict[str, Any]],
        member_windows: list[dict[str, Any]],
        pr_timelines: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        observations: list[dict[str, Any]] = []

        def add(kind: str, description: str, **extra: Any) -> None:
            observations.append(
                {
                    "type": kind,
                    "severity": "INFO",
                    "description": description,
                    **extra,
                }
            )

        if project_gaps:
            longest = max(project_gaps, key=lambda g: g["days"])
            if longest["days"] >= 7:
                add(
                    "LONG_PROJECT_GAP",
                    (
                        f"No observable repository activity was recorded "
                        f"for {longest['days']} days."
                    ),
                    start=longest["start"],
                    end=longest["end"],
                )

        for window in member_windows:
            name = window["member"]
            pattern = window["activity_pattern"]

            if pattern == "NO_ACTIVITY":
                add(
                    "NO_OBSERVABLE_ACTIVITY",
                    (
                        f"No GitHub activity was attributed to {name}. "
                        "Work outside GitHub is not visible."
                    ),
                    member=name,
                )
            elif pattern == "SPARSE":
                add(
                    "SPARSE_ACTIVITY",
                    (
                        f"Only a small amount of observable activity "
                        f"was attributed to {name}."
                    ),
                    member=name,
                )
            elif pattern == "LATE_ACTIVITY":
                add(
                    "LATE_ACTIVITY",
                    (
                        f"Most of {name}'s observable activity occurred "
                        "in the final part of the project window."
                    ),
                    member=name,
                )
            elif pattern == "CONCENTRATED_ACTIVITY":
                add(
                    "CONCENTRATED_ACTIVITY",
                    (
                        f"A large share of {name}'s observable activity "
                        "occurred within a two-day period."
                    ),
                    member=name,
                )

            for gap in window["inactive_gaps"]:
                if gap["days"] >= 10:
                    add(
                        "LONG_MEMBER_GAP",
                        (
                            f"No observable activity was attributed to "
                            f"{name} for {gap['days']} days."
                        ),
                        member=name,
                        start=gap["start"],
                        end=gap["end"],
                    )

        merged_without_review = [
            p["pr_number"] for p in pr_timelines
            if p["status"] == "MERGED"
            and p["reviews"] == 0
            and p["review_comments"] == 0
        ]

        if merged_without_review:
            add(
                "MERGED_WITHOUT_OBSERVED_REVIEW",
                (
                    f"{len(merged_without_review)} merged pull request(s) "
                    "had no review by another account in the collected data."
                ),
                pr_numbers=merged_without_review[:10],
            )

        revised = [
            p["pr_number"] for p in pr_timelines if p["revised_after_review"]
        ]

        if revised:
            add(
                "REVIEW_FOLLOWED_BY_REVISION",
                (
                    f"{len(revised)} pull request(s) received new commits "
                    "after review activity."
                ),
                pr_numbers=revised[:10],
            )

        return observations

      
    # COMPACT EVENTS
      

    def _compact_events(
        self,
        items: list[dict[str, Any]],
        limit: int,
    ) -> list[dict[str, Any]]:
        if limit <= 0:
            return []

        selected = items[-limit:]

        result = []

        for item in selected:
            member = item["member"]

            entry: dict[str, Any] = {
                "timestamp": item["ts"].isoformat(),
                "type": item["type"],
                "member_number": member.member_number if member else None,
                "actor": self._actor(item),
            }

            if item["pr"] is not None:
                entry["pr_number"] = item["pr"]
            if item["issue"] is not None:
                entry["issue_number"] = item["issue"]
            if item["label"]:
                entry["label"] = item["label"]

            result.append(entry)

        return result

      
    # LIMITATIONS
      

    @staticmethod
    def _limitations() -> list[str]:
        return [
            "The timeline reflects observable GitHub activity only.",
            "Absence of GitHub activity does not prove that no work was performed.",
            "Timestamps are commit, pull request, review or workflow times, and may differ from when the work was actually done.",
            "Phases are equal time slices of the observed activity window, not declared project milestones.",
            "Activity patterns are observations to investigate, not conclusions about effort or behavior.",
            "A pull request is counted once; its commits, reviews and merge describe its progression.",
            "Only declared project members receive member attribution.",
        ]
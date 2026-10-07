from __future__ import annotations

import fnmatch
import json
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import PurePosixPath
from typing import Any

from app.models import Event, Member, Project, Task


   
# FILE CLASSIFICATION
CODE_EXTENSIONS = {
    ".py", ".pyw",
    ".js", ".jsx",
    ".ts", ".tsx",
    ".java", ".kt", ".kts",
    ".c", ".h", ".cc", ".cpp", ".cxx", ".hpp",
    ".cs",
    ".go",
    ".rs",
    ".rb",
    ".php",
    ".swift", ".m", ".mm",
    ".scala",
    ".r",
    ".sql",
    ".sh", ".bash", ".zsh", ".fish",
    ".pl",
    ".lua",
    ".dart",
    ".ex", ".exs",
    ".erl", ".hrl",
    ".clj", ".cljs",
    ".groovy",
    ".vue",
    ".svelte",
    ".html", ".htm",
    ".css", ".scss", ".sass", ".less",
    ".ipynb",
}


DOCUMENTATION_EXTENSIONS = {
    ".md",
    ".mdx",
    ".txt",
    ".rst",
    ".adoc",
    ".asciidoc",
    ".tex",
    ".pdf",
    ".doc",
    ".docx",
    ".odt",
    ".rtf",
}


CONFIG_EXTENSIONS = {
    ".json",
    ".yaml",
    ".yml",
    ".toml",
    ".ini",
    ".cfg",
    ".conf",
    ".xml",
    ".properties",
    ".env",
}


# Machine-learning / deep-learning model artifacts.
MODEL_EXTENSIONS = {
    ".pkl",
    ".pickle",
    ".joblib",
    ".pt",
    ".pth",
    ".ckpt",
    ".onnx",
    ".h5",
    ".hdf5",
    ".keras",
    ".safetensors",
    ".tflite",
    ".pb",
}


DATA_EXTENSIONS = {
    ".csv",
    ".tsv",
    ".parquet",
    ".feather",
    ".arrow",
    ".npy",
    ".npz",
    ".mat",
    ".avro",
    ".orc",
    ".jsonl",
}


DEPENDENCY_EXTENSIONS = {
    ".lock",
}


INFRA_BASENAMES = {
    "dockerfile",
    "docker-compose.yml",
    "docker-compose.yaml",
    "makefile",
    "jenkinsfile",
    "procfile",
}


CONFIG_BASENAMES = {
    ".env",
    ".env.example",
    ".env.local",
    ".env.production",
    ".env.development",
    "requirements.txt",
    "requirements-dev.txt",
    "pyproject.toml",
    "poetry.lock",
    "package.json",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "composer.json",
    "composer.lock",
    "cargo.toml",
    "cargo.lock",
    "go.mod",
    "go.sum",
}


DOCUMENTATION_BASENAMES = {
    "readme",
    "readme.txt",
    "license",
    "license.txt",
    "changelog",
    "contributing",
    "authors",
}


IGNORED_BASENAMES = {".ds_store"}

ASSET_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".svg",
    ".ico",
    ".webp",
    ".mp3",
    ".wav",
    ".mp4",
    ".mov",
    ".avi",
    ".woff",
    ".woff2",
    ".ttf",
    ".otf",
}


FILE_KIND_ORDER = (
    "code",
    "documentation",
    "configuration",
    "model",
    "data",
    "dependency",
    "asset",
    "other",
)


   
# EVIDENCE ENGINE
class EvidenceEngine:
    def __init__(self, project: Project):
        self.project = project
        self.members = list(project.members)
        self.events = list(project.events)
        self.tasks = list(project.tasks)

        # Fast member lookup
        self._members_by_id = {
            member.id: member
            for member in self.members
        }

        self._members_by_username = {
            member.github_username.lower(): member
            for member in self.members
            if member.github_username
        }

          
        # Cache event metadata once.
        # Avoid json.loads() hundreds of times.
        self._metadata: dict[int, dict[str, Any]] = {
            event.id: self._load_metadata(event)
            for event in self.events
        }

          
        # Cache event files once.
        self._files: dict[int, list[str]] = {
            event.id: self._extract_event_files(event)
            for event in self.events
        }

          
        # Cache event member resolution.
        self._event_members: dict[int, Member | None] = {
            event.id: self._resolve_member(event)
            for event in self.events
        }

          
        # Cache event PR numbers.
        self._event_pr_numbers: dict[int, int | None] = {
            event.id: self._extract_event_number(event)
            for event in self.events
        }

          
        # Cache task patterns.
        self._task_patterns: dict[int, list[str]] = {
            task.id: self._parse_patterns(task.file_patterns)
            for task in self.tasks
        }

          
        # Group events by PR.
        # This is important because PR is the main evidence unit.
        self._events_by_pr: dict[int, list[Event]] = defaultdict(list)

        for event in self.events:
            pr_number = self._event_pr_numbers.get(event.id)

            if pr_number is not None:
                self._events_by_pr[pr_number].append(event)

      
    # PUBLIC API
    def analyze(self) -> dict[str, Any]:
        member_analysis = self._analyze_members()

        if self.tasks:
            task_analysis = self._analyze_configured_tasks()
        else:
            task_analysis = self._discover_work_areas()

        evidence_chains = self._build_evidence_chains()

        return {
            "project": {
                "id": self.project.id,
                "name": self.project.name,
                "repository": (
                    f"{self.project.owner}/{self.project.repo}"
                ),
            },

            "project_id": self.project.id,
            "project_name": self.project.name,

            "repository": (f"{self.project.owner}/{self.project.repo}"),

            "total_members": len(self.members),

            "github_contributors_detected": (self._github_contributors_detected()),

            "members_with_github_activity": sum(
                1
                for item in member_analysis
                if item["total_events"] > 0
            ),

            "members_without_github_activity": sum(
                1
                for item in member_analysis
                if item["total_events"] == 0
            ),

            "total_events": len(self.events),

            "member_analysis": member_analysis,

            "task_analysis": task_analysis,

            "evidence_chains": evidence_chains,

            "evidence_graph": self._build_evidence_graph(evidence_chains),

            "patterns": self._detect_patterns(),

            "limitations": self._build_limitations(),
        } 
    
    # BASIC HELPERS
    @staticmethod
    def _load_metadata(event: Event) -> dict[str, Any]:
        data = event.metadata_json
        if isinstance(data, dict):
            return data

        if isinstance(data, str):
            try:
                value = json.loads(data)

                if isinstance(value, dict):
                    return value

            except (
                TypeError,
                json.JSONDecodeError,
            ):
                pass

        return {}

    def _event_metadata(self,event: Event) -> dict[str, Any]:
        return self._metadata.get(event.id, {})

    @staticmethod
    def _safe_int(value: Any) -> int:
        try:
            return int(value or 0)
        except (
            TypeError,
            ValueError,
        ):
            return 0

    @staticmethod
    def _compact_text(value: Any,limit: int = 300,) -> str | None:
        if not isinstance(value, str):
            return None

        text = " ".join(value.split()).strip()

        if not text:
            return None

        if len(text) <= limit:
            return text

        return text[: limit - 3] + "..."

    @staticmethod
    def _normalize_path(path: str) -> str:
        return (
            path.replace("\\", "/")
            .strip()
            .lstrip("./")
        )

      
    # MEMBER RESOLUTION
    def _resolve_member(self,event: Event) -> Member | None:

        if event.member_id is not None:
            member = self._members_by_id.get(
                event.member_id
            )

            if member:
                return member

        login = self._event_login(event)

        if not login:
            return None

        return self._members_by_username.get(
            login.lower()
        )

    def _member_for_event(self,event: Event) -> Member | None:
        return self._event_members.get(event.id)

    def _event_login(self,event: Event) -> str | None:

        metadata = self._event_metadata(event)

        for key in (
            "github_username",
            "login",
            "username",
        ):
            value = metadata.get(key)

            if isinstance(value, str) and value.strip():
                return value.strip()

        return None

      
    # FILE EXTRACTION
    def _extract_event_files(
        self,
        event: Event,
    ) -> list[str]:

        metadata = self._load_metadata(event)

        for key in (
            "files",
            "changed_files",
            "file_paths",
            "paths",
        ):
            values = metadata.get(key)

            if not isinstance(values, list):
                continue

            result: list[str] = []

            for value in values:

                if isinstance(value, str):
                    path = self._normalize_path(value)

                    if path:
                        result.append(path)

                elif isinstance(value, dict):
                    path = (
                        value.get("filename")
                        or value.get("path")
                    )

                    if path:
                        normalized = self._normalize_path(
                            str(path)
                        )

                        if normalized:
                            result.append(normalized)

            return list(dict.fromkeys(result))

        return []

    def _event_files(
        self,
        event: Event,
    ) -> list[str]:
        return self._files.get(event.id, [])

      
    # FILE CLASSIFICATION
    @classmethod
    def _file_kind(
        cls,
        path: str,
    ) -> str:

        normalized = cls._normalize_path(path)

        if not normalized:
            return "other"

        lower = normalized.lower()

        name = PurePosixPath(lower).name

        # Ignored system files

        if name in IGNORED_BASENAMES:
            return "other"
        # Documentation
        if name in DOCUMENTATION_BASENAMES:
            return "documentation"
        # Configuration / dependencies

        if name in CONFIG_BASENAMES:
            return "configuration"

        # GitHub / CI configuration


        if lower.startswith(".github/"):
            return "configuration"

        # Infrastructure files
        if name in INFRA_BASENAMES:
            return "configuration"

        # Extensions
        suffix = PurePosixPath(name).suffix

        if suffix in DOCUMENTATION_EXTENSIONS:
            return "documentation"

        if suffix in MODEL_EXTENSIONS:
            return "model"

        if suffix in DATA_EXTENSIONS:
            return "data"

        if suffix in DEPENDENCY_EXTENSIONS:
            return "dependency"

        if suffix in CONFIG_EXTENSIONS:
            return "configuration"

        if suffix in CODE_EXTENSIONS:
            return "code"

        if suffix in ASSET_EXTENSIONS:
            return "asset"

        return "other"

    @classmethod
    def _file_counts(
        cls,
        files: list[str],
    ) -> dict[str, int]:

        counts = {
            kind: 0
            for kind in FILE_KIND_ORDER
        }

        for path in files:
            kind = cls._file_kind(path)
            counts[kind] += 1

        return counts

      
    # EVENT NUMBER / PR HELPERS
    def _extract_event_number(
        self,
        event: Event,
    ) -> int | None:

        metadata = self._load_metadata(event)

        for key in (
            "number",
            "pr_number",
            "pull_number",
        ):
            value = metadata.get(key)

            if value is None:
                continue

            try:
                return int(value)
            except (
                TypeError,
                ValueError,
            ):
                return None

        return None

    @staticmethod
    def _event_type(
        event: Event,
    ) -> str:
        return event.event_type.upper()

      
    # CONTRIBUTORS
    def _github_contributors_detected(self) -> int:

        active_members = set()

        for event in self.events:
            member = self._member_for_event(event)

            if member:
                active_members.add(member.id)

        return len(active_members)

      
    # MEMBER ANALYSIS
    def _analyze_members(self) -> list[dict[str, Any]]:

        data: dict[int, dict[str, Any]] = {
            member.id: {
                "events": [],
                "commits": [],
                "prs": {},
                "reviews": [],
                "comments": [],
                "issues": [],
                "ci_runs": [],

                "files": set(),
                "files_by_kind": {
                    kind: set()
                    for kind in FILE_KIND_ORDER
                },

                "additions": 0,
                "deletions": 0,
                "active_dates": set(),
            }
            for member in self.members
        }

          
        # Single pass through events
          

        for event in self.events:

            member = self._member_for_event(event)

            if not member:
                continue

            if member.id not in data:
                continue

            row = data[member.id]

            row["events"].append(event)

            if event.timestamp:
                row["active_dates"].add(
                    event.timestamp.date().isoformat()
                )

            metadata = self._event_metadata(event)
            files = self._event_files(event)
            event_type = self._event_type(event)

              
            # Files
              

            for path in files:

                row["files"].add(path)

                kind = self._file_kind(path)

                row["files_by_kind"][kind].add(path)

              
            # COMMIT
              

            if event_type == "COMMIT":

                additions = self._safe_int(
                    metadata.get("additions")
                )

                deletions = self._safe_int(
                    metadata.get("deletions")
                )

                row["additions"] += additions
                row["deletions"] += deletions

                counts = self._file_counts(files)

                row["commits"].append(
                    {
                        "sha": metadata.get("sha"),

                        "message": (
                            self._compact_text(
                                metadata.get("message")
                                or event.artifact,
                                250,
                            )
                        ),

                        "date": (
                            event.timestamp.isoformat()
                            if event.timestamp
                            else None
                        ),

                        "url": metadata.get("url"),

                        "files": files[:50],

                        "file_kinds": counts,

                        "additions": additions,

                        "deletions": deletions,
                    }
                )

              
            # PR CREATED
              

            elif event_type == "PR_CREATED":

                number = self._event_pr_numbers.get(
                    event.id
                )

                if number is not None:

                    row["prs"].setdefault(
                        number,
                        {
                            "number": number,
                            "title": (
                                self._compact_text(
                                    metadata.get("title")
                                    or event.artifact,
                                    250,
                                )
                            ),
                            "branch": metadata.get(
                                "branch_name"
                            ),
                            "base_branch": metadata.get(
                                "base_branch"
                            ),
                            "url": metadata.get("url"),
                            "state": metadata.get("state"),
                            "merged": bool(
                                metadata.get("merged")
                            ),
                            "files": files[:50],
                            "additions": self._safe_int(
                                metadata.get(
                                    "additions"
                                )
                            ),
                            "deletions": self._safe_int(
                                metadata.get(
                                    "deletions"
                                )
                            ),
                            "created_at": (
                                event.timestamp.isoformat()
                                if event.timestamp
                                else None
                            ),
                        },
                    )

              
            # PR MERGED
              

            elif event_type == "PR_MERGED":

                number = self._event_pr_numbers.get(
                    event.id
                )

                if number is not None:

                    current = row["prs"].setdefault(
                        number,
                        {
                            "number": number,
                            "title": (
                                self._compact_text(
                                    metadata.get("title")
                                    or event.artifact,
                                    250,
                                )
                            ),
                            "files": files[:50],
                        },
                    )

                    current["merged"] = True

                    current["merged_at"] = (
                        event.timestamp.isoformat()
                        if event.timestamp
                        else None
                    )

              
            # REVIEW
              

            elif event_type == "REVIEW":

                row["reviews"].append(
                    {
                        "pr_number": metadata.get(
                            "pr_number"
                        ),
                        "state": metadata.get("state"),
                        "body": self._compact_text(
                            event.artifact,
                            300,
                        ),
                        "date": (
                            event.timestamp.isoformat()
                            if event.timestamp
                            else None
                        ),
                        "url": metadata.get("url"),
                    }
                )

              
            # REVIEW COMMENT
              

            elif event_type == "REVIEW_COMMENT":

                row["comments"].append(
                    {
                        "pr_number": metadata.get(
                            "pr_number"
                        ),
                        "path": metadata.get("path"),
                        "body": self._compact_text(
                            event.artifact,
                            250,
                        ),
                        "date": (
                            event.timestamp.isoformat()
                            if event.timestamp
                            else None
                        ),
                        "url": metadata.get("url"),
                    }
                )

              
            # ISSUE
              

            elif event_type == "ISSUE_CREATED":

                row["issues"].append(
                    {
                        "issue_number": metadata.get(
                            "issue_number"
                        ),
                        "title": self._compact_text(
                            metadata.get("title")
                            or event.artifact,
                            250,
                        ),
                        "state": metadata.get("state"),
                        "url": metadata.get("url"),
                        "date": (
                            event.timestamp.isoformat()
                            if event.timestamp
                            else None
                        ),
                    }
                )

              
            # CI
              

            elif event_type == "CI_RUN":

                row["ci_runs"].append(
                    {
                        "id": metadata.get("run_id"),
                        "name": metadata.get("name"),
                        "status": metadata.get("status"),
                        "conclusion": metadata.get(
                            "conclusion"
                        ),
                        "branch": metadata.get("branch"),
                        "event": metadata.get("event"),
                        "date": (
                            event.timestamp.isoformat()
                            if event.timestamp
                            else None
                        ),
                        "url": metadata.get("url"),
                    }
                )

        # ====================================================
        # BUILD RESULT
        # ====================================================

        results = []

        for member in self.members:

            row = data[member.id]

            code_commits = sum(
                1
                for commit in row["commits"]
                if commit["file_kinds"]["code"] > 0
            )

            pr_count = len(row["prs"])

            merged_count = sum(
                1
                for pr in row["prs"].values()
                if pr.get("merged")
            )

            review_count = len(row["reviews"])
            comment_count = len(row["comments"])

            model_files = row["files_by_kind"]["model"]
            code_files = row["files_by_kind"]["code"]
            documentation_files = row[
                "files_by_kind"
            ]["documentation"]

            configuration_files = row[
                "files_by_kind"
            ]["configuration"]

            data_files = row["files_by_kind"]["data"]

            dependency_files = row[
                "files_by_kind"
            ]["dependency"]

            active_days = len(
                row["active_dates"]
            )

            evidence_status = self._evidence_status(
                row=row,
                code_commits=code_commits,
                pr_count=pr_count,
                merged_count=merged_count,
                review_count=review_count,
                comment_count=comment_count,
            )

            results.append(
                {
                    "member_id": member.id,
                    "member_number": member.member_number,
                    "display_name": member.display_name,
                    "github_username": member.github_username,

                    "total_events": len(
                        row["events"]
                    ),

                    "evidence_status": evidence_status,

                    "activity": {
                        "commits": len(
                            row["commits"]
                        ),
                        "pull_requests": pr_count,
                        "merged_pull_requests": (
                            merged_count
                        ),
                        "reviews": review_count,
                        "review_comments": (
                            comment_count
                        ),
                        "issues": len(
                            row["issues"]
                        ),
                        "ci_runs": len(
                            row["ci_runs"]
                        ),
                        "active_days": active_days,
                    },

                    "code_activity": {
                        "commits": code_commits,
                        "additions": sum(
                            self._safe_int(
                                commit["additions"]
                            )
                            for commit in row["commits"]
                            if commit["file_kinds"][
                                "code"
                            ] > 0
                        ),
                        "deletions": sum(
                            self._safe_int(
                                commit["deletions"]
                            )
                            for commit in row["commits"]
                            if commit["file_kinds"][
                                "code"
                            ] > 0
                        ),
                    },

                    "file_activity": {
                        "code": len(code_files),
                        "documentation": len(
                            documentation_files
                        ),
                        "configuration": len(
                            configuration_files
                        ),
                        "model": len(
                            model_files
                        ),
                        "data": len(
                            data_files
                        ),
                        "dependency": len(
                            dependency_files
                        ),
                        "other": len(
                            row["files_by_kind"]["other"]
                        ),
                    },

                    "totals": {
                        "additions": row["additions"],
                        "deletions": row["deletions"],
                        "changed_files_count": len(
                            row["files"]
                        ),
                        "active_days": active_days,
                    },

                    "details": {
                        "commits": row["commits"],
                        "pull_requests": list(
                            row["prs"].values()
                        ),
                        "reviews": row["reviews"],
                        "review_comments": row[
                            "comments"
                        ],
                        "issues": row["issues"],
                        "ci_runs": row["ci_runs"],

                        "files": {
                            kind: sorted(
                                row["files_by_kind"][
                                    kind
                                ]
                            )
                            for kind in FILE_KIND_ORDER
                            if row["files_by_kind"][kind]
                        },
                    },
                }
            )

        return results

      
    # QUALITATIVE EVIDENCE STATUS
    @staticmethod
    def _evidence_status(
        *,
        row: dict[str, Any],
        code_commits: int,
        pr_count: int,
        merged_count: int,
        review_count: int,
        comment_count: int,
    ) -> str:
        """
        Qualitative evidence only.

        HIGH:
            Strong direct repository evidence plus corroboration.
        MEDIUM:
            Meaningful direct repository evidence, but less
            corroboration.
        LOW:
            Observable activity exists, but evidence is limited
            or indirect.

        This is NOT a percentage and NOT a contribution score.
        """

        if not row["events"]:
            return "LOW"

        has_files = bool(row["files"])
        direct_work = bool(pr_count or code_commits)
        outcome = bool(merged_count)
        active_days = len(row["active_dates"])

        # Weighted collaboration: reviews are stronger signals than comments,
        # but multiple detailed comments also demonstrate meaningful engagement.
        weighted_collaboration = (
            review_count >= 2
            or comment_count >= 3
            or (review_count >= 1 and comment_count >= 2)
        )

        has_meaningful_direct_activity = direct_work and has_files

        # Strongest observable combination:
        # direct work + files + finalization/collaboration + sustained activity.
        if (
            has_meaningful_direct_activity
            and (outcome or weighted_collaboration)
            and (active_days >= 2 or pr_count >= 2 or outcome)
        ):
            return "HIGH"

        # Meaningful direct work without strong corroboration.
        if has_meaningful_direct_activity:
            return "MEDIUM"

        # Reviews/comments/issues/CI without clear direct implementation evidence.
        if weighted_collaboration or row["issues"] or row["ci_runs"]:
            return "LOW"

        if row["files"]:
            return "LOW"

        return "LOW"

      
    # EVENT COUNTS
    @staticmethod
    def _event_counts(
        events: list[Event],
    ) -> dict[str, int]:

        counts: dict[str, int] = defaultdict(int)

        for event in events:
            counts[
                event.event_type.upper()
            ] += 1

        return dict(counts)

      
    # CONFIGURED TASK ANALYSIS
    def _analyze_configured_tasks(self) -> list[dict[str, Any]]:
        results = []

        for task in self.tasks:
            patterns = self._task_patterns.get(task.id, [])

            # PRs are primary evidence units.
            pr_units: dict[int, dict[str, Any]] = {}
            standalone_events = []

            for event in self.events:
                event_type = self._event_type(event)
                files = self._event_files(event)

                matched = [
                    path
                    for path in files
                    if self._file_matches_patterns(path, patterns)
                ]

                if not matched:
                    continue

                pr_number = self._event_pr_numbers.get(event.id)
                member = self._member_for_event(event)

                if pr_number is not None:
                    unit = pr_units.setdefault(
                        pr_number,
                        {
                            "pr_number": pr_number,
                            "events": set(),
                            "files": set(),
                            "members": set(),
                            "event_types": set(),
                            "first_timestamp": None,
                        },
                    )

                    unit["events"].add(event.id)
                    unit["files"].update(matched)
                    unit["event_types"].add(event_type)

                    if member:
                        unit["members"].add(member.display_name)

                    if event.timestamp:
                        current = unit["first_timestamp"]
                        if current is None or event.timestamp < current:
                            unit["first_timestamp"] = event.timestamp

                else:
                    standalone_events.append(
                        {
                            "event": event,
                            "matched": matched,
                            "member": member,
                        }
                    )

            # Contributors are based on unique evidence units, not raw event count.
            contributors = defaultdict(
                lambda: {
                    "evidence_units": set(),
                    "matched_files": set(),
                    "event_types": set(),
                }
            )

            evidence = []

            for number, unit in sorted(pr_units.items()):
                for member_name in unit["members"]:
                    row = contributors[member_name]
                    row["evidence_units"].add(f"PR:{number}")
                    row["matched_files"].update(unit["files"])
                    row["event_types"].update(unit["event_types"])

                evidence.append(
                    {
                        "type": "PULL_REQUEST",
                        "pr_number": number,
                        "matched_files": sorted(unit["files"]),
                        "event_types": sorted(unit["event_types"]),
                        "members": sorted(unit["members"]),
                        "timestamp": (
                            unit["first_timestamp"].isoformat()
                            if unit["first_timestamp"]
                            else None
                        ),
                    }
                )

            # Standalone commit/file evidence (includes PR_COMMITS outside PR context)
            for item in standalone_events:
                event = item["event"]
                member = item["member"]
                matched = item["matched"]

                member_name = (
                    member.display_name
                    if member
                    else self._event_login(event)
                )

                if member_name:
                    row = contributors[member_name]
                    unit_id = event.source_id or f"EVENT:{event.id}"
                    row["evidence_units"].add(f"EVENT:{unit_id}")
                    row["matched_files"].update(matched)
                    row["event_types"].add(event.event_type)

                evidence.append(
                    {
                        "type": event.event_type.upper(),
                        "event_id": event.id,
                        "source_id": event.source_id,
                        "member": member_name,
                        "matched_files": matched,
                        "timestamp": (
                            event.timestamp.isoformat()
                            if event.timestamp
                            else None
                        ),
                    }
                )

            results.append(
                {
                    "task_id": task.id,
                    "name": task.name,
                    "description": task.description,
                    "file_patterns": patterns,
                    "evidence_units": len(evidence),
                    "contributors": {
                        name: {
                            "evidence_units": len(row["evidence_units"]),
                            "matched_files": sorted(row["matched_files"]),
                            "event_types": sorted(row["event_types"]),
                        }
                        for name, row in contributors.items()
                    },
                    "evidence": evidence,
                    "source": "user_defined_task",
                }
            )

        return results

      
    # AUTOMATIC WORK-AREA DISCOVERY
    def _discover_work_areas(self) -> list[dict[str, Any]]:

        areas = defaultdict(
            lambda: {
                "evidence_units": set(),
                "files": set(),
                "members": set(),
            }
        )

        for event in self.events:

            member = self._member_for_event(
                event
            )

            files = self._event_files(
                event
            )

            if not files:
                continue

            # PR = one work unit.
            pr_number = self._event_pr_numbers.get(
                event.id
            )

            if pr_number is not None:
                unit_id = f"PR:{pr_number}"
            else:
                unit_id = (
                    event.source_id
                    or f"EVENT:{event.id}"
                )

            for path in files:

                area = self._work_area_from_file(
                    path
                )

                areas[area][
                    "evidence_units"
                ].add(unit_id)

                areas[area]["files"].add(
                    path
                )

                if member:
                    areas[area]["members"].add(
                        member.display_name
                    )

        return [
            {
                "name": area,

                "evidence_units": len(
                    row["evidence_units"]
                ),

                "files": sorted(
                    row["files"]
                )[:50],

                "contributors": sorted(
                    row["members"]
                ),

                "source": (
                    "automatically_discovered"
                ),
            }

            for area, row
            in sorted(
                areas.items()
            )

            if row["evidence_units"]
        ]

    @staticmethod
    def _work_area_from_file(path: str) -> str:

        parts = [
            part
            for part in path.replace(
                "\\",
                "/",
            )
            .strip("/")
            .split("/")
            if part
        ]

        if not parts:
            return "(root)"

        if len(parts) >= 2:
            return "/".join(parts[:2])

        return "(root)"

      
    # PR EVIDENCE CHAINS
    def _build_evidence_chains(self) -> list[dict[str, Any]]:

        chains = []
        for pr_number, events in sorted(self._events_by_pr.items()):
            created = next(
                (
                    event
                    for event in events
                    if self._event_type(event)
                    == "PR_CREATED"
                ),
                None,
            )

            # Without PR_CREATED we do not know enough
            # to construct a reliable PR work unit.
            if not created:
                continue

            author = self._member_for_event(
                created
            )

            if not author:
                continue

            metadata = self._event_metadata(
                created
            )

              
            # Prefer PR_CREATED file list.
            # If unavailable, combine PR-related files.
            files = self._event_files(
                created
            )

            if not files:
                file_set = set()

                for event in events:
                    file_set.update(
                        self._event_files(event)
                    )

                files = sorted(file_set)

            reviews = [
                event
                for event in events
                if self._event_type(event)
                == "REVIEW"
            ]

            review_comments = [
                event
                for event in events
                if self._event_type(event)
                == "REVIEW_COMMENT"
            ]

            pr_commits = [
                event
                for event in events
                if self._event_type(event)
                == "PR_COMMIT"
            ]

            merged = any(
                self._event_type(event)
                == "PR_MERGED"
                for event in events
            )

            task_links = self._tasks_for_files(
                files
            )

            review_revisions = (
                self._review_revisions(
                    events
                )
            )

            reviewers = self._reviewers_for_events(
                reviews + review_comments
            )

              
            # Evidence quality
            if (
                files
                and merged
                and (
                    reviews
                    or review_comments
                    or pr_commits
                    or task_links
                )
            ):
                confidence = "HIGH"

            elif (
                files
                and (
                    merged
                    or reviews
                    or review_comments
                    or task_links
                    or pr_commits
                )
            ):
                confidence = "MEDIUM"

            else:
                confidence = "LOW"

            chains.append(
                {
                    "type": "PULL_REQUEST_CHAIN",

                    "pr_number": pr_number,

                    "author": author.display_name,

                    "github_username": (
                        author.github_username
                    ),

                    "title": (
                        self._compact_text(
                            metadata.get("title")
                            or created.artifact,
                            250,
                        )
                    ),

                    "branch": metadata.get(
                        "branch_name"
                    ),

                    "base_branch": metadata.get(
                        "base_branch"
                    ),

                    "files": files[:100],

                    "file_kinds": self._file_counts(
                        files
                    ),

                    "tasks": task_links,

                    "review_count": len(
                        reviews
                    ),

                    "review_comment_count": len(
                        review_comments
                    ),

                    "reviewers": reviewers,

                    "pr_commit_count": len(
                        pr_commits
                    ),

                    "review_to_revision": (
                        review_revisions
                    ),

                    "merged": merged,

                    "confidence": confidence,

                    "observable_signals": {
                        "pull_request": True,
                        "files": bool(files),
                        "task_match": bool(
                            task_links
                        ),
                        "reviews": bool(
                            reviews
                            or review_comments
                        ),
                        "commits": bool(
                            pr_commits
                        ),
                        "merged": merged,
                        "review_to_revision": bool(
                            review_revisions
                        ),
                    },
                }
            )

        return chains

      
    # REVIEW -> REVISION
    def _review_revisions(self,events: list[Event],) -> list[dict[str, Any]]:

        reviews = sorted(
            [
                event
                for event in events
                if (
                    self._event_type(event)
                    == "REVIEW"
                    and event.timestamp
                )
            ],
            key=lambda event: (
                event.timestamp
                or datetime.min
            ),
        )

        commits = sorted(
            [
                event
                for event in events
                if (
                    self._event_type(event)
                    == "PR_COMMIT"
                    and event.timestamp
                )
            ],
            key=lambda event: (
                event.timestamp
                or datetime.min
            ),
        )

        result = []

        for review in reviews:

            later = next(
                (
                    commit
                    for commit in commits
                    if (
                        commit.timestamp
                        and review.timestamp
                        and commit.timestamp
                        > review.timestamp
                    )
                ),
                None,
            )

            if not later:
                continue

            reviewer = self._member_for_event(
                review
            )

            result.append(
                {
                    "review_event_id": review.id,

                    "reviewer": (
                        reviewer.display_name
                        if reviewer
                        else self._event_login(
                            review
                        )
                    ),

                    "review_timestamp": (
                        review.timestamp.isoformat()
                    ),

                    "subsequent_commit_event_id": (
                        later.id
                    ),

                    "commit_timestamp": (
                        later.timestamp.isoformat()
                    ),

                    "signal": (
                        "A subsequent PR commit "
                        "was observed after review "
                        "activity on the same PR."
                    ),
                }
            )

        return result

      
    # TASK <-> FILES
    def _tasks_for_files(self,files: list[str]) -> list[dict[str, Any]]:

        if not self.tasks or not files:
            return []

        result = []

        for task in self.tasks:

            patterns = self._task_patterns.get(
                task.id,
                [],
            )

            if not patterns:
                continue

            matched = [
                path
                for path in files
                if self._file_matches_patterns(
                    path,
                    patterns,
                )
            ]

            if matched:

                result.append(
                    {
                        "task_id": task.id,
                        "name": task.name,
                        "matched_files": matched[:50],
                    }
                )

        return result

      
    # REVIEWERS
    def _reviewers_for_events(
        self,
        events: list[Event],
    ) -> list[str]:

        names = set()

        for event in events:

            member = self._member_for_event(
                event
            )

            if member:
                names.add(
                    member.display_name
                )
                continue

            login = self._event_login(
                event
            )

            if login:
                names.add(login)

        return sorted(names)

      
    # EVIDENCE GRAPH
      

    def _build_evidence_graph(
        self,
        chains: list[dict[str, Any]],
    ) -> dict[str, Any]:

        nodes = []
        edges = []
        seen_nodes = set()
        seen_edges = set()

        def add_node(
            node_id: str,
            kind: str,
            label: str,
            **extra: Any,
        ) -> None:

            if node_id in seen_nodes:
                return

            seen_nodes.add(node_id)

            nodes.append(
                {
                    "id": node_id,
                    "type": kind,
                    "label": label,
                    **extra,
                }
            )

        def add_edge(
            source: str,
            target: str,
            edge_type: str,
            **extra: Any,
        ) -> None:

            key = (
                source,
                target,
                edge_type,
            )

            if key in seen_edges:
                return

            seen_edges.add(key)

            edges.append(
                {
                    "source": source,
                    "target": target,
                    "type": edge_type,
                    **extra,
                }
            )

          
        # Members
          

        for member in self.members:

            add_node(
                f"member:{member.id}",
                "member",
                member.display_name,
                member_number=member.member_number,
                github_username=member.github_username,
            )

          
        # PR chains
          

        for chain in chains:

            pr_id = (
                f"pr:{chain['pr_number']}"
            )

            add_node(
                pr_id,
                "pull_request",
                f"PR #{chain['pr_number']}",
                merged=chain["merged"],
                confidence=chain["confidence"],
            )

            author = next(
                (
                    member
                    for member in self.members
                    if (
                        member.display_name
                        == chain["author"]
                        and member.github_username
                        == chain[
                            "github_username"
                        ]
                    )
                ),
                None,
            )

            if author:

                add_edge(
                    f"member:{author.id}",
                    pr_id,
                    "AUTHORED",
                )

              
            # Files
              

            for path in chain["files"]:

                file_id = f"file:{path}"

                add_node(
                    file_id,
                    "file",
                    path,
                    file_kind=self._file_kind(
                        path
                    ),
                )

                add_edge(
                    pr_id,
                    file_id,
                    "CHANGED",
                )

              
            # Tasks
              

            for task in chain["tasks"]:

                task_id = (
                    f"task:{task['task_id']}"
                )

                add_node(
                    task_id,
                    "task",
                    task["name"],
                )

                add_edge(
                    pr_id,
                    task_id,
                    "MATCHES_TASK",
                    matched_files=task[
                        "matched_files"
                    ],
                )

              
            # Reviewers
              

            for reviewer in chain["reviewers"]:

                reviewer_member = next(
                    (
                        member
                        for member in self.members
                        if (
                            member.display_name
                            == reviewer
                            or (
                                member.github_username
                                and member.github_username
                                == reviewer
                            )
                        )
                    ),
                    None,
                )

                if reviewer_member:

                    add_edge(
                        f"member:{reviewer_member.id}",
                        pr_id,
                        "REVIEWED",
                    )

        return {
            "nodes": nodes,
            "edges": edges,
            "node_count": len(nodes),
            "edge_count": len(edges),
        }

      
    # PATTERN DETECTION
      

    def _detect_patterns(self) -> list[dict[str, Any]]:

        patterns = []

        for member in self.members:

            member_events = [
                event
                for event in self.events
                if (
                    self._member_for_event(event)
                    and self._member_for_event(
                        event
                    ).id
                    == member.id
                )
            ]

            if not member_events:
                continue

            member_events.sort(
                key=lambda event: (
                    event.timestamp
                    or datetime.min
                )
            )

              
            # Activity concentration
              

            timestamps = [
                event.timestamp
                for event in member_events
                if event.timestamp
            ]

            concentrated = self._find_concentrated_activity(
                timestamps
            )

            if concentrated:

                patterns.append(
                    {
                        "type": (
                            "CONCENTRATED_ACTIVITY"
                        ),
                        "member": member.display_name,
                        "severity": "INFO",
                        "description": (
                            "Several observable GitHub "
                            "events occurred within a "
                            "short time window."
                        ),
                        "event_count": (
                            concentrated[
                                "event_count"
                            ]
                        ),
                        "window_minutes": 60,
                    }
                )

              
            # PR-based analysis
              

            member_pr_numbers = {
                self._event_pr_numbers.get(
                    event.id
                )
                for event in member_events
                if (
                    self._event_type(event)
                    in {
                        "PR_CREATED",
                        "PR_MERGED",
                    }
                )
            }

            member_pr_numbers.discard(None)

              
            # Documentation-focused
              

            code_files = {
                path
                for event in member_events
                for path in self._event_files(
                    event
                )
                if self._file_kind(path)
                == "code"
            }

            documentation_files = {
                path
                for event in member_events
                for path in self._event_files(
                    event
                )
                if self._file_kind(path)
                == "documentation"
            }

            model_files = {
                path
                for event in member_events
                for path in self._event_files(
                    event
                )
                if self._file_kind(path)
                == "model"
            }

            configuration_files = {
                path
                for event in member_events
                for path in self._event_files(
                    event
                )
                if self._file_kind(path)
                == "configuration"
            }

              
            # ML model activity
              

            if model_files:

                patterns.append(
                    {
                        "type": "MODEL_ARTIFACT_ACTIVITY",
                        "member": member.display_name,
                        "severity": "INFO",
                        "description": (
                            "Observable repository activity "
                            "included machine-learning or "
                            "model artifact files."
                        ),
                        "files": sorted(
                            model_files
                        )[:20],
                    }
                )

              
            # Configuration activity
              

            if configuration_files:

                patterns.append(
                    {
                        "type": "CONFIGURATION_ACTIVITY",
                        "member": member.display_name,
                        "severity": "INFO",
                        "description": (
                            "Observable repository activity "
                            "included configuration or "
                            "environment files."
                        ),
                        "files": sorted(
                            configuration_files
                        )[:20],
                    }
                )

              
            # Documentation-focused
              

            if (
                documentation_files
                and len(documentation_files)
                >= max(
                    len(code_files),
                    1,
                )
            ):

                patterns.append(
                    {
                        "type": (
                            "DOCUMENTATION_FOCUSED"
                        ),
                        "member": member.display_name,
                        "severity": "INFO",
                        "description": (
                            "Observable activity was "
                            "primarily associated with "
                            "documentation files."
                        ),
                    }
                )

              
            # Collaborative review
              

            review_count = sum(
                1
                for event in member_events
                if self._event_type(event)
                in {
                    "REVIEW",
                    "REVIEW_COMMENT",
                }
            )

            if review_count >= 2 and code_files:

                patterns.append(
                    {
                        "type": (
                            "COLLABORATIVE_REVIEW"
                        ),
                        "member": member.display_name,
                        "severity": "INFO",
                        "description": (
                            "The member has observable "
                            "review activity alongside "
                            "direct repository changes."
                        ),
                    }
                )

              
            # Review -> revision
              

            if member_pr_numbers:

                response_detected = False

                for pr_number in member_pr_numbers:

                    pr_events = (
                        self._events_by_pr.get(
                            pr_number,
                            [],
                        )
                    )

                    review_times = [
                        event.timestamp
                        for event in pr_events
                        if (
                            self._event_type(
                                event
                            )
                            == "REVIEW"
                            and event.timestamp
                        )
                    ]

                    if not review_times:
                        continue

                    for event in pr_events:

                        if (
                            self._event_type(
                                event
                            )
                            != "PR_COMMIT"
                            or not event.timestamp
                        ):
                            continue

                        if any(
                            review_time
                            < event.timestamp
                            for review_time
                            in review_times
                        ):
                            response_detected = True
                            break

                    if response_detected:
                        break

                if response_detected:

                    patterns.append(
                        {
                            "type": "REVIEW_RESPONSE",
                            "member": member.display_name,
                            "severity": "INFO",
                            "description": (
                                "A subsequent pull-request "
                                "commit was observed after "
                                "review activity on the same "
                                "pull request."
                            ),
                        }
                    )

        return patterns

    @staticmethod
    def _find_concentrated_activity(timestamps: list[datetime]) -> dict[str, int] | None:

        if len(timestamps) < 5:
            return None

        timestamps = sorted(timestamps)

        left = 0

        for right in range(
            len(timestamps)
        ):

            while (
                timestamps[right]
                - timestamps[left]
                > timedelta(hours=1)
            ):
                left += 1

            count = right - left + 1

            if count >= 5:
                return {
                    "event_count": count,
                    "window_minutes": 60,
                }

        return None

      
    # LIMITATIONS
      

    def _build_limitations(self) -> list[str]:

        limitations = [
            (
                "GitHub activity represents observable "
                "repository evidence only."
            ),
            (
                "Work performed outside GitHub is not visible."
            ),
            (
                "Evidence status is qualitative and must not "
                "be interpreted as a percentage of real-world work."
            ),
            (
                "A changed file demonstrates observable "
                "repository activity but does not prove complete "
                "intellectual ownership of that file."
            ),
            (
                "Only declared project members receive member "
                "attribution."
            ),
            (
                "Unknown GitHub actors may exist in repository "
                "activity but are not counted as project members."
            ),
            (
                "Task matching uses declared file patterns when "
                "tasks are manually configured."
            ),
            (
                "Automatically discovered work areas are inferred "
                "from repository file paths."
            ),
            (
                "Model files such as PKL/PT/PTH/ONNX identify "
                "observable model artifacts, but do not prove "
                "who trained or designed the model."
            ),
        ]

        if not self.tasks:

            limitations.append(
                (
                    "No user-defined tasks were configured, so "
                    "work areas were automatically discovered "
                    "from changed repository files."
                )
            )

        return limitations

      
    # PATTERN PARSING
    @staticmethod
    def _parse_patterns(raw: Any) -> list[str]:

        if raw is None:
            return []

        if isinstance(raw, list):

            return [
                str(value).strip()
                for value in raw
                if str(value).strip()
            ]

        if isinstance(raw, str):

            raw = raw.strip()

            if not raw:
                return []

            try:

                value = json.loads(raw)

                if isinstance(value, list):

                    return [
                        str(item).strip()
                        for item in value
                        if str(item).strip()
                    ]

            except (
                TypeError,
                json.JSONDecodeError,
            ):
                pass

            return [
                value.strip()
                for value in raw.split(",")
                if value.strip()
            ]

        return []

      
    # FILE PATTERN MATCHING
      

    @staticmethod
    def _file_matches_patterns(
        file_path: str,
        patterns: list[str],
    ) -> bool:

        normalized = (
            file_path
            .replace("\\", "/")
            .strip()
            .lstrip("./")
        )

        if not normalized:
            return False

        for pattern in patterns:

            normalized_pattern = (
                pattern
                .replace("\\", "/")
                .strip()
                .lstrip("./")
            )

            if not normalized_pattern:
                continue

            # Exact / glob match
            if fnmatch.fnmatch(
                normalized,
                normalized_pattern,
            ):
                return True
            if normalized_pattern.endswith("/*"):

                prefix = normalized_pattern[:-1]

                if normalized.startswith(prefix):
                    return True

        return False
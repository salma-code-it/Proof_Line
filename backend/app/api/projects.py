from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AnalysisResult, Event, Member, Project, Task
from app.schemas import AnalyzeResponse, ProjectCreate
from app.services.evidence import EvidenceEngine
from app.services.github import GitHubAPIError, GitHubService
from app.services.timeline import TimelineService

from app.services.contribution import calculate_member_contributions
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects",tags=["Projects"])

ANALYSIS_DIR = Path("analysis_results")


MAX_PRS_ANALYZED = 150
COMMIT_DETAIL_LIMIT = 500
PR_CONCURRENCY = 4
ISSUE_COMMENT_ISSUE_LIMIT = 40
ISSUE_CONCURRENCY = 4
CI_RUN_LIMIT = 150
MAX_FILES_PER_EVENT = 300
MAX_MEMBERS_FROM_CONTRIBUTORS = 30

# Only collect GitHub activity from this recent window (large repos).
LOOKBACK_DAYS = 90

# Projects currently being analyzed.
_RUNNING: set[int] = set()


def _dt_to_iso(value: datetime) -> str:
    """Format a timezone-aware datetime as GitHub ISO-8601 UTC."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.strftime("%Y-%m-%dT%H:%M:%SZ")


def _in_window(value: Any, since: datetime) -> bool:
    """True if timestamp string/datetime is at or after ``since``."""
    if isinstance(value, datetime):
        ts = value
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        else:
            ts = ts.astimezone(timezone.utc)
        return ts >= since

    parsed = _ts(value)
    if parsed is None:
        return False
    return parsed >= since


def _window_anchor(repository: dict[str, Any]) -> datetime:
    """
    End of the 3-month window.

    Prefer the repository's last push/update so student projects that
    finished a few months ago still produce evidence. Fall back to now.
    """
    for key in ("pushed_at", "updated_at"):
        ts = _ts(repository.get(key))
        if ts is not None:
            return ts
    return _utc_now()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _ts(value: Any) -> datetime | None:
    if not value or not isinstance(value, str):
        return None

    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)

    return parsed.astimezone(timezone.utc)


def _int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _login(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()

    return None


def _first_line(value: Any, limit: int = 300) -> str:
    if not isinstance(value, str):
        return ""

    text = value.strip().splitlines()[0] if value.strip() else ""
    text = " ".join(text.split())

    if len(text) <= limit:
        return text

    return text[: limit - 3] + "..."


def _clean(data: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in data.items()
        if value is not None
    }


def _patterns(value: Any) -> list[str]:
    if isinstance(value, str):
        try:
            decoded = json.loads(value)

            if isinstance(decoded, list):
                value = decoded
            else:
                value = value.split(",")

        except (TypeError, json.JSONDecodeError):
            value = value.split(",")

    if not isinstance(value, list):
        return []

    result: list[str] = []

    for item in value:
        text = str(item).strip().replace("\\", "/")

        if text and text not in result:
            result.append(text)

    return result


def _member_map(project: Project) -> dict[str, Member]:
    return {
        member.github_username.strip().lower(): member
        for member in project.members
        if member.github_username
        and member.github_username.strip()
    }


def _get_project_or_404(db: Session,project_id: int) -> Project:
    project = (
        db.query(Project)
        .filter(Project.id == project_id)
        .first()
    )

    if not project:
        raise HTTPException(
            status_code=404,
            detail="Project not found.",
        )

    return project


def _latest_analysis(db: Session,project_id: int) -> AnalysisResult | None:
    return (
        db.query(AnalysisResult)
        .filter(AnalysisResult.project_id == project_id)
        .order_by(AnalysisResult.id.desc())
        .first()
    )


def _task_dicts(project: Project) -> list[dict[str, Any]]:
    return [
        {
            "id": task.id,
            "name": task.name,
            "description": task.description,
            "file_patterns": _patterns(task.file_patterns),
            "source": task.source,
        }
        for task in project.tasks
    ]


def _project_response(
    project: Project,
    latest: AnalysisResult | None = None,
) -> dict[str, Any]:
    github_contributors = []

    for member in project.members:
        if not member.github_username:
            continue

        github_contributors.append(
            {
                "id": member.id,
                "member_number": member.member_number,
                "github_username": member.github_username,
                "display_name": member.display_name or member.github_username,
                "profile_url": f"https://github.com/{member.github_username}",
                "contributions": member.github_contributions or 0,
            }
        )

    response: dict[str, Any] = {
        "id": project.id,
        "name": project.name,
        "repo_url": project.repo_url,
        "owner": project.owner,
        "repo": project.repo,
        "github_contributors": github_contributors,
        "total_github_contributors": len(github_contributors),
        "tasks": _task_dicts(project),
    }

    if latest is not None:
        response["latest_analysis_id"] = latest.id
        response["latest_analysis_created_at"] = latest.created_at

    return response
 
# ANALYSIS FILE EXPORT
def _analysis_file_path(project_id: int,analysis_id: int) -> Path:
    return (
        ANALYSIS_DIR
        / f"project_{project_id}"
        / f"analysis_{analysis_id}.json"
    )


def _write_analysis_file(path: Path,analysis: dict[str, Any],) -> None:
    try:
        path.parent.mkdir(parents=True,exist_ok=True,)
        temporary = path.with_suffix(".json.tmp")

        temporary.write_text(
            json.dumps(
                analysis,
                indent=2,
                ensure_ascii=False,
                default=str,
            ),
            encoding="utf-8",
        )

        temporary.replace(path)

    except OSError as error:
        logger.warning(
            "Could not write analysis file %s: %s",
            path,
            error,
        )


 
# EVENT SINK
 
class _EventSink:
    def __init__(self,project: Project,member_map: dict[str, Member]):
        self.project_id = project.id
        self.member_map = member_map
        self.rows: list[dict[str, Any]] = []
        self.files: set[str] = set()
        self.skipped = 0

    def add(
        self,
        *,
        login: str | None,
        event_type: str,
        timestamp: datetime | None,
        source_id: str,
        artifact: str,
        metadata: dict[str, Any],
        keep_unattributed: bool = False,
    ) -> None:
        member = (
            self.member_map.get(login.lower())
            if login
            else None
        )

        if timestamp is None:
            self.skipped += 1
            return

        if member is None and not keep_unattributed:
            self.skipped += 1
            return

        self.rows.append(
            {
                "project_id": self.project_id,
                "member_id": (
                    member.id
                    if member
                    else None
                ),
                "event_type": event_type,
                "timestamp": timestamp,
                "source_id": source_id[:255],
                "artifact": (artifact or "")[:500],
                "metadata_json": _clean(
                    {
                        "github_username": login,
                        **metadata,
                    }
                ),
            }
        )

# GITHUB COLLECTION HELPERS
async def _safe(
    coro,
    warnings: list[str],
    label: str,
    default: Any,
):
    """
    Run an optional GitHub call.
    Errors are converted into warnings instead of stopping
    the complete analysis.
    """

    try:
        return await coro

    except GitHubAPIError as error:
        message = f"{label}: {error}"

        if (message not in warnings and len(warnings) < 15):
            warnings.append(message)

        return default


async def _pr_bundle(
    github: GitHubService,
    project: Project,
    pr: dict[str, Any],
    semaphore: asyncio.Semaphore,
    warnings: list[str],
) -> dict[str, Any]:

    number = pr["number"]
    owner = project.owner
    repo = project.repo

    async with semaphore:
        files, reviews, comments, commits = await asyncio.gather(
            _safe(
                github.get_pull_request_files(
                    owner,
                    repo,
                    number,
                ),
                warnings,
                f"PR #{number} files",
                [],
            ),
            _safe(
                github.get_reviews(
                    owner,
                    repo,
                    number,
                ),
                warnings,
                f"PR #{number} reviews",
                [],
            ),
            _safe(
                github.get_review_comments(
                    owner,
                    repo,
                    number,
                ),
                warnings,
                f"PR #{number} review comments",
                [],
            ),
            _safe(
                github.get_pull_request_commits(
                    owner,
                    repo,
                    number,
                ),
                warnings,
                f"PR #{number} commits",
                [],
            ),
        )

    return {
        "pr": pr,
        "files": files,
        "reviews": reviews,
        "comments": comments,
        "commits": commits,
    }


def _add_pull_request_events(sink: _EventSink,bundle: dict[str, Any]) -> None:

    pr = bundle["pr"]
    number = pr["number"]
    title = pr.get("title") or ""
    author = _login(
        (pr.get("user") or {}).get("login")
    )

    branch = (
        pr.get("head") or {}
    ).get("ref")

    paths = [
        item["filename"]
        for item in bundle["files"]
        if item.get("filename")
    ][:MAX_FILES_PER_EVENT]

    sink.files.update(paths)

    merged_at = _ts(
        pr.get("merged_at")
    )

    # One PR remains one work unit.
    sink.add(
        login=author,
        event_type="PR_CREATED",
        timestamp=_ts(
            pr.get("created_at")
        ),
        source_id=f"pr-{number}",
        artifact=title,
        keep_unattributed=True,
        metadata={
            "pr_number": number,
            "title": title,
            "url": pr.get("html_url"),
            "state": pr.get("state"),
            "merged": merged_at is not None,
            "branch_name": branch,
            "base_branch": (pr.get("base") or {}).get("ref"),
            "files": paths,
            "additions": sum(
                _int(item.get("additions"))
                for item in bundle["files"]
            ),
            "deletions": sum(
                _int(item.get("deletions"))
                for item in bundle["files"]
            ),
            "changed_file_count": len(paths),
        },
    )

    if merged_at:
        sink.add(
            login=author,
            event_type="PR_MERGED",
            timestamp=merged_at,
            source_id=f"merge-{number}",
            artifact=title,
            keep_unattributed=True,
            metadata={
                "pr_number": number,
            },
        )

    for review in bundle["reviews"]:
        state = review.get("state")

        sink.add(
            login=_login(
                review.get("user")
            ),
            event_type="REVIEW",
            timestamp=_ts(
                review.get("submitted_at")
            ),
            source_id=(
                f"review-{number}-{review.get('id')}"
            ),
            artifact=(
                f"{state or 'Review'} "
                f"on PR #{number}"
            ),
            metadata={
                "pr_number": number,
                "state": state,
                "url": review.get("html_url"),
            },
        )

    for comment in bundle["comments"]:
        path = comment.get("path")

        sink.add(
            login=_login(
                comment.get("user")
            ),
            event_type="REVIEW_COMMENT",
            timestamp=_ts(
                comment.get("created_at")
            ),
            source_id=(
                f"review-comment-{number}-"
                f"{comment.get('id')}"
            ),
            artifact=(
                f"Comment on {path}"
                if path
                else "Review comment"
            ),
            metadata={
                "pr_number": number,
                "path": path,
                "line": (
                    comment.get("line")
                    or comment.get("original_line")
                ),
                "url": comment.get("html_url"),
            },
        )

    for commit in bundle["commits"]:
        author_data = commit.get("author") or {}
        committer_data = commit.get("committer") or {}
        sha = commit.get("sha")
        login = _login(
            author_data.get("login")
        ) or _login(
            committer_data.get("login")
        )
        timestamp = _ts(
            author_data.get("date")
        ) or _ts(
            committer_data.get("date")
        )

        sink.add(
            login=login,
            event_type="PR_COMMIT",
            timestamp=timestamp,
            source_id=(
                f"pr-commit-{number}-{sha}"
            ),
            artifact=_first_line(
                commit.get("message")
            ),
            keep_unattributed=True,
            metadata={
                "pr_number": number,
                "sha": sha,
                "branch_name": branch,
                "message": (
                    commit.get("message") or ""
                )[:300],
            },
        )


def _add_commit_events(
    sink: _EventSink,
    raw_commits: list[dict[str, Any]],
    enriched: dict[str, dict[str, Any]],
    login_by_sha: dict[str, str | None],
    branch_by_sha: dict[str, str],
    default_branch: str | None,
) -> int:

    detailed = 0
    for raw in raw_commits:
        sha = raw.get("sha")

        if not sha:
            continue

        compact = (
            enriched.get(sha)
            or GitHubService._compact_commit(raw)
        )

        has_details = "files" in compact

        files = [
            item["filename"]
            for item in (
                compact.get("files") or []
            )
            if (
                isinstance(item, dict)
                and item.get("filename")
            )
        ][:MAX_FILES_PER_EVENT]

        stats = compact.get("stats") or {}
        author_data = compact.get("author") or {}
        committer_data = (
            compact.get("committer") or {}
        )

        sink.files.update(files)

        if has_details and files:
            detailed += 1

        commit_login = login_by_sha.get(sha) or _login(
            author_data.get("login")
        ) or _login(
            committer_data.get("login")
        )

        sink.add(
            login=commit_login,
            event_type="COMMIT",
            timestamp=_ts(
                author_data.get("date")
                or committer_data.get("date")
            ),
            source_id=sha,
            artifact=_first_line(
                compact.get("message")
            ),
            keep_unattributed=True,
            metadata={
                "sha": sha,
                "message": (
                    compact.get("message") or ""
                )[:300],
                "url": compact.get("html_url"),
                "branch_name": (
                    branch_by_sha.get(sha)
                    or default_branch
                ),
                "files": files,
                "additions": _int(
                    stats.get("additions")
                ),
                "deletions": _int(
                    stats.get("deletions")
                ),
                "changed_file_count": len(files),
                "details_collected": has_details,
            },
        )

    return detailed


async def _add_issue_events(
    sink: _EventSink,
    github: GitHubService,
    project: Project,
    issues: list[dict[str, Any]],
    warnings: list[str],
) -> None:
    for issue in issues:
        number = issue.get("number")

        if not number:
            continue

        sink.add(
            login=_login(
                issue.get("user")
            ),
            event_type="ISSUE_CREATED",
            timestamp=_ts(
                issue.get("created_at")
            ),
            source_id=f"issue-{number}",
            artifact=(
                issue.get("title") or ""
            ),
            metadata={
                "issue_number": number,
                "title": issue.get("title"),
                "state": issue.get("state"),
                "url": issue.get("html_url"),
                "labels": (
                    issue.get("labels")
                    or None
                ),
            },
        )

    commented = [
        issue
        for issue in issues
        if (
            issue.get("number")
            and issue.get("comments")
        )
    ][:ISSUE_COMMENT_ISSUE_LIMIT]

    if not commented:
        return

    semaphore = asyncio.Semaphore(
        ISSUE_CONCURRENCY
    )

    async def fetch(
        issue: dict[str, Any],
    ) -> tuple[int, list[dict[str, Any]]]:

        async with semaphore:
            comments = await _safe(
                github.get_issue_comments(
                    project.owner,
                    project.repo,
                    issue["number"],
                ),
                warnings,
                (
                    f"issue #{issue['number']} "
                    "comments"
                ),
                [],
            )

        return issue["number"], comments

    results = await asyncio.gather(
        *(fetch(issue) for issue in commented)
    )

    for number, comments in results:
        for comment in comments:
            sink.add(
                login=_login(
                    comment.get("user")
                ),
                event_type="ISSUE_COMMENT",
                timestamp=_ts(
                    comment.get("created_at")
                ),
                source_id=(
                    f"issue-comment-{number}-"
                    f"{comment.get('id')}"
                ),
                artifact=(
                    f"Comment on issue #{number}"
                ),
                metadata={
                    "issue_number": number,
                    "url": comment.get("html_url"),
                },
            )


def _add_ci_events(sink: _EventSink,runs: list[dict[str, Any]]) -> None:

    for run in runs[:CI_RUN_LIMIT]:
        sink.add(
            login=_login(
                run.get("actor")
            ),
            event_type="CI_RUN",
            timestamp=_ts(
                run.get("updated_at")
                or run.get("created_at")
            ),
            source_id=f"ci-{run.get('id')}",
            artifact=(
                run.get("name")
                or "GitHub Actions run"
            ),
            metadata={
                "run_id": run.get("id"),
                "name": run.get("name"),
                "status": run.get("status"),
                "conclusion": run.get("conclusion"),
                "branch": run.get("branch"),
                "event": run.get("event"),
                "url": run.get("html_url"),
            },
        )


def _add_branch_events(sink: _EventSink,repository_events: list[dict[str, Any]]) -> None:

    for event in repository_events:
        if (
            event.get("type") != "CreateEvent"
            or event.get("ref_type") != "branch"
            or not event.get("ref")
        ):
            continue

        sink.add(
            login=_login(
                event.get("actor")
            ),
            event_type="BRANCH_CREATED",
            timestamp=_ts(
                event.get("created_at")
            ),
            source_id=(
                f"branch-created-{event.get('id')}"
            ),
            artifact=event["ref"],
            metadata={
                "branch_name": event["ref"],
            },
        )


 
# CREATE PROJECT
@router.post("")
async def create_project(payload: ProjectCreate,db: Session = Depends(get_db)):
    github = GitHubService()

    try:
        owner, repo = github.parse_repo_url(payload.repo_url)

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        ) from error

    try:
        contributors = await github.get_contributors(owner,repo,)
        contributors = contributors[:MAX_MEMBERS_FROM_CONTRIBUTORS]

    except GitHubAPIError as error:
        raise HTTPException(
            status_code=502,
            detail=(
                "Failed to fetch GitHub contributors: "
                f"{error}"
            ),
        ) from error


    contributions = {
        c["github_username"].lower(): _int(c.get("contributions"))
        for c in contributors
        if c.get("github_username")
    }


    project = Project(
        name=payload.name.strip(),
        repo_url=payload.repo_url.strip(),
        owner=owner,
        repo=repo,
    )

    db.add(project)
    db.flush()

    seen_usernames: set[str] = set()
    member_number = 1

    for contributor in contributors:
        username = _login(contributor.get("github_username"))

        if not username:
            continue

        username_key = username.lower()

        if username_key in seen_usernames:
            continue

        seen_usernames.add(username_key)

        db.add(
            Member(
                project_id=project.id,
                member_number=member_number,
                display_name=username,
                github_username=username,
                github_contributions=(
                    contributions.get(username_key)
                ),
            )
        )

        member_number += 1

    seen_tasks: set[str] = set()

    for task_data in payload.tasks:
        name = task_data.name.strip()

        if not name:
            continue

        task_key = name.lower()

        if task_key in seen_tasks:
            continue

        seen_tasks.add(task_key)

        db.add(
            Task(
                project_id=project.id,
                name=name,
                description=task_data.description,
                file_patterns=_patterns(
                    task_data.file_patterns
                ),
                source="manual",
            )
        )

    try:
        db.commit()
        db.refresh(project)

    except Exception as error:
        db.rollback()

        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to create project: {error}"
            ),
        ) from error

    return _project_response(project)


 
# GET PROJECT
@router.get("/{project_id}")
def get_project(project_id: int,db: Session = Depends(get_db),):
    project = _get_project_or_404(db,project_id)

    return _project_response(
        project,
        latest=_latest_analysis(
            db,
            project_id,
        ),
    )


 


@router.post("/{project_id}/analyze",response_model=AnalyzeResponse)
async def analyze_project(project_id: int,db: Session = Depends(get_db),):
    project = _get_project_or_404(db,project_id,)

    if project_id in _RUNNING:
        raise HTTPException(
            status_code=409,
            detail=(
                "An analysis is already running "
                "for this project."
            ),
        )

    _RUNNING.add(project_id)

    try:
        return await _run_analysis(
            db,
            project,
        )

    finally:
        _RUNNING.discard(project_id)


async def _run_analysis(db: Session,project: Project) -> dict[str, Any]:

    github = GitHubService()

    warnings: list[str] = []

    owner = project.owner
    repo = project.repo

    member_map = _member_map(project)

    # ------------------------------------------------------------------
    # 1. Repository metadata first (needed to anchor the 3-month window)
    # ------------------------------------------------------------------
    try:
        repository = await github.get_repository(owner, repo)
    except GitHubAPIError as error:
        raise HTTPException(
            status_code=502,
            detail=f"GitHub collection failed: {error}",
        ) from error

    # Window = 3 months ending at the repo's last push (not "today").
    # Student projects that finished last semester still get full evidence.
    window_end = _window_anchor(repository)
    since_dt = window_end - timedelta(days=LOOKBACK_DAYS)
    since_iso = _dt_to_iso(since_dt)
    window_end_iso = _dt_to_iso(window_end)

    # ------------------------------------------------------------------
    # 2. Collect commits / PRs / issues / events / CI
    # ------------------------------------------------------------------
    results = await asyncio.gather(
        github.get_commits(
            owner,
            repo,
            since=since_iso,
        ),
        github.get_pull_requests(
            owner,
            repo,
        ),
        _safe(
            github.get_repository_events(
                owner,
                repo,
            ),
            warnings,
            "events",
            [],
        ),
        _safe(
            github.get_issues(
                owner,
                repo,
                since=since_iso,
            ),
            warnings,
            "issues",
            [],
        ),
        _safe(
            github.get_workflow_runs(
                owner,
                repo,
            ),
            warnings,
            "workflow runs",
            [],
        ),
        return_exceptions=True,
    )

    # Commits and PRs are required.
    for required in results[:2]:
        if isinstance(required, GitHubAPIError):
            raise HTTPException(
                status_code=502,
                detail=f"GitHub collection failed: {required}",
            ) from required
        if isinstance(required, Exception):
            raise HTTPException(
                status_code=500,
                detail=f"Internal error during collection: {required}",
            ) from required

    raw_commits = results[0]
    pull_requests_all = results[1]

    # Fallback: if the windowed commit query is empty, collect page-capped
    # commits without a date filter so student repos still get evidence.
    window_fallback_used = False
    if not raw_commits:
        try:
            raw_commits = await github.get_commits(owner, repo)
            window_fallback_used = True
            warnings.append(
                "No commits in the 3-month window relative to the "
                "repository last push; fell back to recent page-capped commits."
            )
        except GitHubAPIError as error:
            warnings.append(f"commit fallback: {error}")
            raw_commits = []

    repository_events = (
        results[2]
        if not isinstance(results[2], Exception)
        else []
    )

    issues = (
        results[3]
        if not isinstance(results[3], Exception)
        else []
    )

    workflow_runs_all = (
        results[4]
        if not isinstance(results[4], Exception)
        else []
    )

    # PRs active inside the window (created / updated / merged).
    pull_requests = [
        pr
        for pr in pull_requests_all
        if pr.get("number")
        and (
            _in_window(pr.get("created_at"), since_dt)
            or _in_window(pr.get("updated_at"), since_dt)
            or _in_window(pr.get("merged_at"), since_dt)
        )
    ]

    # Fallback: keep page-capped PRs if the window filtered everything out.
    if not pull_requests and pull_requests_all:
        pull_requests = [
            pr for pr in pull_requests_all if pr.get("number")
        ]
        window_fallback_used = True
        warnings.append(
            "No pull requests inside the 3-month window; "
            "using the recent page-capped PR list instead."
        )

    repository_events = [
        ev
        for ev in repository_events
        if _in_window(ev.get("created_at"), since_dt)
    ] or repository_events

    workflow_runs = [
        run
        for run in workflow_runs_all
        if (
            _in_window(run.get("updated_at"), since_dt)
            or _in_window(run.get("created_at"), since_dt)
        )
    ] or workflow_runs_all

    # 3. PULL REQUESTS (deep analysis)
    analyzed_prs = pull_requests[:MAX_PRS_ANALYZED]

    semaphore = asyncio.Semaphore(
        PR_CONCURRENCY
    )

    bundles = await asyncio.gather(
        *(
            _pr_bundle(
                github,
                project,
                pr,
                semaphore,
                warnings,
            )
            for pr in analyzed_prs
        )
    )

      
    # 3. COMMIT -> BRANCH
    branch_by_sha: dict[str, str] = {}

    for bundle in bundles:
        branch = (
            bundle["pr"].get("head") or {}
        ).get("ref")

        if not branch:
            continue

        for commit in bundle["commits"]:
            sha = commit.get("sha")

            if sha:
                branch_by_sha.setdefault(
                    sha,
                    branch,
                )

      
    # 4. COMMIT DETAILS
    login_by_sha: dict[str, str | None] = {}
    for c in raw_commits:
        sha = c.get("sha")
        if not sha:
            continue
        login = _login(
            (c.get("author") or {}).get("login")
        ) or _login(
            (c.get("committer") or {}).get("login")
        )
        login_by_sha[sha] = login

    candidates = [
        c
        for c in raw_commits
        if (
            login_by_sha.get(c.get("sha"))
            or ""
        ).lower() in member_map
    ][:COMMIT_DETAIL_LIMIT]

    enriched_list = (
        await github.get_commit_details(
            owner,
            repo,
            candidates,
        )
        if candidates
        else []
    )

    enriched = {
        c["sha"]: c
        for c in enriched_list
        if c.get("sha")
    }

      
    # 5. NORMALIZE INTO EVENTS
    sink = _EventSink(
        project,
        member_map,
    )

    sink.add(
        login=None,
        event_type="REPOSITORY",
        timestamp=(
            _ts(repository.get("updated_at"))
            or _utc_now()
        ),
        source_id=(
            f"repository-{owner}/{repo}"
        ),
        artifact=(
            repository.get("full_name")
            or f"{owner}/{repo}"
        ),
        keep_unattributed=True,
        metadata={
            "full_name": repository.get(
                "full_name"
            ),
            "description": repository.get(
                "description"
            ),
            "default_branch": repository.get(
                "default_branch"
            ),
            "language": repository.get(
                "language"
            ),
            "private": repository.get(
                "private"
            ),
            "url": repository.get(
                "html_url"
            ),
        },
    )

    detailed_commits = _add_commit_events(
        sink,
        raw_commits,
        enriched,
        login_by_sha,
        branch_by_sha,
        repository.get("default_branch"),
    )

    for bundle in bundles:
        _add_pull_request_events(
            sink,
            bundle,
        )

    _add_branch_events(
        sink,
        repository_events,
    )

    await _add_issue_events(
        sink,
        github,
        project,
        issues,
        warnings,
    )

    _add_ci_events(
        sink,
        workflow_runs,
    )

      
    # 6. SAVE EVENTS
    try:
        db.query(Event).filter(
            Event.project_id == project.id
        ).delete(
            synchronize_session=False
        )

        if sink.rows:
            db.bulk_insert_mappings(
                Event,
                sink.rows,
            )

        db.commit()

    except Exception as error:
        db.rollback()

        raise HTTPException(
            status_code=500,
            detail=(
                "Database error while saving "
                f"events: {error}"
            ),
        ) from error

      
    # 7. PROCESS DETERMINISTIC EVIDENCE
    db.expire_all()

    project = _get_project_or_404(
        db,
        project.id,
    )

    evidence = EvidenceEngine(project).analyze()

    timeline = TimelineService(project).get_timeline(limit=200)

      
    # 8. BUILD DETERMINISTIC ANALYSIS JSON
    analysis: dict[str, Any] = dict(evidence)

    analysis["timeline"] = timeline

    analysis["tasks"] = _task_dicts(project)

    analysis["collection"] = {
        "window_days": LOOKBACK_DAYS,
        "window_since": since_iso,
        "window_end": window_end_iso,
        "window_anchor": "repository_last_push",
        "window_fallback_used": window_fallback_used,
        "commits_collected": len(
            raw_commits
        ),
        "commits_with_file_details": (
            detailed_commits
        ),
        "pull_requests_collected": len(
            pull_requests
        ),
        "pull_requests_listed_total": len(
            pull_requests_all
        ),
        "pull_requests_analyzed": len(
            analyzed_prs
        ),
        "issues_collected": len(
            issues
        ),
        "workflow_runs_collected": len(
            workflow_runs
        ),
        "events_stored": len(
            sink.rows
        ),
        "events_skipped": sink.skipped,

        "known_files": sorted(
            sink.files
        ),

        "warnings": warnings,
    }

    analysis["repository"] = {
        "owner": owner,
        "repo": repo,
        "name": repository.get(
            "full_name"
        ),
        "description": repository.get(
            "description"
        ),
        "language": repository.get(
            "language"
        ),
        "default_branch": repository.get(
            "default_branch"
        ),
        "url": repository.get(
            "html_url"
        ),
    }

    analysis["llm"] = {
        "status": "not_run",
        "message": (
            "LLM processing is handled by "
            "the /llm API."
        ),
    }

    analysis["generated_at"] = (
        _utc_now().isoformat()
    )

      
    # 9. GUARANTEE JSON-SAFE CONTENT
    analysis = json.loads(
        json.dumps(
            analysis,
            default=str,
        )
    )

      
    # 10. STORE DATABASE + JSON FILE   
    try:
        record = AnalysisResult(
            project_id=project.id,
            analysis_json={},
        )

        db.add(record)
        db.flush()

        file_path = _analysis_file_path(
            project.id,
            record.id,
        )

        analysis["storage"] = {
            "database": True,
            "analysis_id": record.id,
            "file": str(file_path),
        }

        record.analysis_json = analysis

        db.commit()

    except Exception as error:
        db.rollback()

        raise HTTPException(
            status_code=500,
            detail=(
                "Failed to save analysis: "
                f"{error}"
            ),
        ) from error

    _write_analysis_file(
        file_path,
        analysis,
    )

    return analysis


 
# STORED ANALYSIS
@router.get("/{project_id}/analysis",response_model=AnalyzeResponse,)
def get_latest_analysis(project_id: int,db: Session = Depends(get_db)):
    _get_project_or_404(db,project_id)
    record = _latest_analysis(db,project_id)

    if record is None:
        raise HTTPException(
            status_code=404,
            detail=(
                "This project has not been "
                "analyzed yet."
            ),
        )

    return record.analysis_json


@router.get("/{project_id}/analyses")
def list_analyses(project_id: int,db: Session = Depends(get_db),):
    _get_project_or_404(
        db,
        project_id,
    )

    records = (
        db.query(
            AnalysisResult.id,
            AnalysisResult.created_at,
        )
        .filter(
            AnalysisResult.project_id
            == project_id
        )
        .order_by(
            AnalysisResult.id.desc()
        )
        .all()
    )

    return [
        {
            "id": row.id,
            "created_at": row.created_at,
        }
        for row in records
    ]


@router.get("/{project_id}/members/{member_id}")
def get_member(
    project_id: int,
    member_id: int,
    db: Session = Depends(get_db),
):
    _get_project_or_404(db, project_id)

    member = (
        db.query(Member)
        .filter(
            Member.id == member_id,
            Member.project_id == project_id,
        )
        .first()
    )

    if not member:
        raise HTTPException(
            status_code=404,
            detail="Member not found in this project.",
        )

    return {
        "id": member.id,
        "project_id": member.project_id,
        "member_number": member.member_number,
        "github_username": member.github_username,
        "display_name": (
            member.display_name
            or member.github_username
        ),
        "profile_url": (
            f"https://github.com/{member.github_username}"
            if member.github_username
            else None
        ),
        "contributions": (
            member.github_contributions or 0
        ),
    }
# EVIDENCE GRAPH
@router.get(
    "/{project_id}/evidence-graph"
)
def get_evidence_graph(
    project_id: int,
    db: Session = Depends(get_db),
):
    project = _get_project_or_404(
        db,
        project_id,
    )

    record = _latest_analysis(
        db,
        project_id,
    )

    if (
        record
        and "evidence_graph"
        in record.analysis_json
    ):
        return record.analysis_json[
            "evidence_graph"
        ]

    return EvidenceEngine(
        project
    ).analyze()["evidence_graph"]


 
# TASK EVIDENCE

@router.get(
    "/{project_id}/tasks/{task_id}/evidence"
)
def get_task_evidence(
    project_id: int,
    task_id: int,
    db: Session = Depends(get_db),
):
    project = _get_project_or_404(
        db,
        project_id,
    )

    task = (
        db.query(Task)
        .filter(
            Task.id == task_id,
            Task.project_id == project_id,
        )
        .first()
    )

    if not task:
        raise HTTPException(
            status_code=404,
            detail=(
                "Task not found in this project."
            ),
        )

    record = _latest_analysis(
        db,
        project_id,
    )

    analysis = (
        record.analysis_json
        if record
        else EvidenceEngine(
            project
        ).analyze()
    )

    def find(
        items: list[dict[str, Any]],
        key: str,
    ) -> dict[str, Any] | None:

        return next(
            (
                item
                for item in items
                if item.get(key)
                == task_id
            ),
            None,
        )

    return {
        "project_id": project.id,
        "task": {
            "id": task.id,
            "name": task.name,
            "description": task.description,
            "file_patterns": _patterns(
                task.file_patterns
            ),
            "source": task.source,
        },
        "evidence": find(
            analysis.get(
                "task_analysis",
                [],
            ),
            "task_id",
        ),
        "matching": (
            find(
                (
                    analysis.get(
                        "task_member_matching"
                    )
                    or {}
                ).get(
                    "tasks",
                    [],
                ),
                "task_id",
            )
        ),
        "timeline": find(
            (
                analysis.get(
                    "timeline"
                )
                or {}
            ).get(
                "task_timelines",
                [],
            ),
            "task_id",
        ),
        "from_stored_analysis": (
            record is not None
        ),
    }


 
# TIMELINE
@router.get(
    "/{project_id}/timeline"
)
def get_timeline(
    project_id: int,
    limit: int = 200,
    db: Session = Depends(get_db),
):
    project = _get_project_or_404(
        db,
        project_id,
    )

    return TimelineService(
        project
    ).get_timeline(
        limit=max(
            1,
            min(limit, 1000),
        )
    )


 
# MEMBER TIMELINE
 


@router.get(
    "/{project_id}/members/{member_id}/timeline"
)
def get_member_timeline(
    project_id: int,
    member_id: int,
    limit: int = 200,
    db: Session = Depends(get_db),
):
    project = _get_project_or_404(
        db,
        project_id,
    )

    member = (
        db.query(Member)
        .filter(
            Member.id == member_id,
            Member.project_id == project_id,
        )
        .first()
    )

    if not member:
        raise HTTPException(
            status_code=404,
            detail="Member not found in this project.",
        )

    return TimelineService(
        project
    ).get_member_timeline(
        member_id,
        limit=max(
            1,
            min(limit, 1000),
        ),
    )

# Route for Contribution 
@router.get("/{project_id}/contributions")
def get_contributions(project_id: int, db: Session = Depends(get_db)):
    project = _get_project_or_404(db, project_id)
    record = _latest_analysis(db, project_id)
    if record is None:
        raise HTTPException(404, "Project not analyzed yet.")
    analysis = record.analysis_json or {}
    members = analysis.get("member_analysis") or []
    return calculate_member_contributions(members)
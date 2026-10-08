from __future__ import annotations

from pathlib import Path
from typing import Any

import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    AnalysisResult,
    Member,
    Project,
    Task,
    UnderstandingSession,
    utc_now,
)
from app.services.llm import LLMAPIError, LLMService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/llm", tags=["LLM"])

ANALYSIS_DIR = Path("llm_analysis")
ANALYSIS_DIR.mkdir(parents=True, exist_ok=True)


class UnderstandingAnswers(BaseModel):
    answers: dict[str, str]



def _get_project_or_404(db: Session, project_id: int) -> Project:
    project = db.query(Project).filter(Project.id == project_id).first()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    return project


def _latest_analysis(db: Session, project_id: int) -> AnalysisResult | None:
    return (
        db.query(AnalysisResult)
        .filter(AnalysisResult.project_id == project_id)
        .order_by(AnalysisResult.id.desc())
        .first()
    )


def _get_analysis_or_404(db: Session, project_id: int) -> AnalysisResult:
    record = _latest_analysis(db, project_id)
    if record is None:
        raise HTTPException(
            status_code=404,
            detail=(
                "This project has not been analyzed yet. "
                "Run POST /projects/{project_id}/analyze first."
            ),
        )
    return record


def _patterns(value: Any) -> list[str]:
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
            value = decoded if isinstance(decoded, list) else value.split(",")
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


def _analysis_file_path(project_id: int, analysis_id: int) -> Path:
    return ANALYSIS_DIR / f"project_{project_id}" / f"analysis_{analysis_id}.json"


def _write_analysis_file(path: Path, analysis: dict[str, Any]) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".json.tmp")
        temporary.write_text(
            json.dumps(analysis, indent=2, ensure_ascii=False, default=str),
            encoding="utf-8",
        )
        temporary.replace(path)
    except OSError as error:
        logger.warning("Could not write LLM analysis file %s: %s", path, error)


def _save_analysis(
    db: Session,
    record: AnalysisResult,
    analysis: dict[str, Any],
) -> None:
    cleaned = json.loads(json.dumps(analysis, ensure_ascii=False, default=str))
    record.analysis_json = cleaned
    try:
        db.commit()
        db.refresh(record)
    except Exception as error:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to save LLM analysis: {error}",
        ) from error
    _write_analysis_file(
        _analysis_file_path(record.project_id, record.id),
        cleaned,
    )


 
# Evidence extraction from stored analysis JSON
def _known_files(analysis: dict[str, Any]) -> list[str]:
    collection = analysis.get("collection") or {}
    files = collection.get("known_files", [])
    if not isinstance(files, list):
        return []
    result: list[str] = []
    for file in files:
        if not isinstance(file, str):
            continue
        normalized = file.strip().replace("\\", "/")
        if normalized and normalized not in result:
            result.append(normalized)
    return sorted(result)


def _member_name(member: dict[str, Any]) -> str:
    return (
        member.get("display_name")
        or member.get("github_username")
        or member.get("member")
        or "Unknown"
    )


def _extract_commit_evidence(analysis: dict[str, Any]) -> list[dict[str, Any]]:
    """Pull commits from member_analysis.details (where the pipeline stores them)."""
    member_analysis = analysis.get("member_analysis", [])
    if not isinstance(member_analysis, list):
        return []

    commits: list[dict[str, Any]] = []
    seen: set[str] = set()

    for member in member_analysis:
        if not isinstance(member, dict):
            continue
        member_id = member.get("member_id")
        name = _member_name(member)
        details = member.get("details") or {}
        for commit in details.get("commits") or []:
            if not isinstance(commit, dict):
                continue
            sha = str(commit.get("sha") or "").strip()
            key = sha or json.dumps(commit, sort_keys=True, default=str)
            if key in seen:
                continue
            seen.add(key)
            files = commit.get("files") or []
            normalized_files = [
                str(f).replace("\\", "/")
                for f in files
                if isinstance(f, str)
            ]
            commits.append(
                {
                    "sha": sha,
                    "message": commit.get("message") or "",
                    "branch_name": commit.get("branch_name") or commit.get("branch"),
                    "date": commit.get("date"),
                    "url": commit.get("url"),
                    "files": normalized_files,
                    "changed_file_count": commit.get("changed_file_count")
                    or len(normalized_files),
                    "additions": commit.get("additions"),
                    "deletions": commit.get("deletions"),
                    "file_kinds": commit.get("file_kinds"),
                    "member_id": member_id,
                    "member": name,
                }
            )
    return commits


def _extract_pull_request_evidence(
    analysis: dict[str, Any],
) -> list[dict[str, Any]]:
    member_analysis = analysis.get("member_analysis", [])
    if not isinstance(member_analysis, list):
        return []

    pull_requests: list[dict[str, Any]] = []
    seen: set[str] = set()

    for member in member_analysis:
        if not isinstance(member, dict):
            continue
        member_id = member.get("member_id")
        name = _member_name(member)
        details = member.get("details") or {}
        for pr in details.get("pull_requests") or []:
            if not isinstance(pr, dict):
                continue
            number = pr.get("number")
            key = (
                f"pr-{number}"
                if number is not None
                else json.dumps(pr, sort_keys=True, default=str)
            )
            if key in seen:
                continue
            seen.add(key)
            files = pr.get("files") or []
            normalized_files: list[str] = []
            for file in files:
                if isinstance(file, str):
                    normalized_files.append(file.replace("\\", "/"))
                elif isinstance(file, dict):
                    fn = file.get("filename") or file.get("path")
                    if isinstance(fn, str):
                        normalized_files.append(fn.replace("\\", "/"))
            pull_requests.append(
                {
                    "number": number,
                    "title": pr.get("title") or "",
                    "body": pr.get("body") or "",
                    "state": pr.get("state"),
                    "merged": bool(pr.get("merged")),
                    "files": normalized_files,
                    "changed_file_count": pr.get("changed_file_count")
                    or len(normalized_files),
                    "additions": pr.get("additions"),
                    "deletions": pr.get("deletions"),
                    "branch": pr.get("branch") or pr.get("head_ref"),
                    "member_id": member_id,
                    "member": name,
                }
            )
    return pull_requests


def _expand_to_known_files(
    patterns: list[str],
    known_files: list[str],
    max_files: int = 12,
) -> list[str]:
    import fnmatch

    known_set = set(known_files)
    exact: list[str] = []
    for pattern in patterns:
        path = str(pattern).strip().replace("\\", "/")
        if not path:
            continue
        if path in known_set and path not in exact:
            exact.append(path)

    if exact:
        return exact[:max_files]

    expanded: list[str] = []
    for pattern in patterns:
        pat = str(pattern).strip().replace("\\", "/")
        if not pat:
            continue
        for path in known_files:
            if path in expanded:
                continue
            if fnmatch.fnmatch(path, pat):
                expanded.append(path)
            elif pat.endswith("/*") and path.startswith(pat[:-1]):
                expanded.append(path)
            elif pat.endswith("/") and path.startswith(pat):
                expanded.append(path)
            if len(expanded) >= max_files:
                break
        if len(expanded) >= max_files:
            break
    return expanded[:max_files]


def _build_llm_context(
    project: Project,
    analysis: dict[str, Any],
) -> tuple[dict[str, Any], list[str], list[dict[str, Any]], list[dict[str, Any]]]:
    repository = analysis.get("repository") or {}
    files = _known_files(analysis)
    commits = _extract_commit_evidence(analysis)
    pull_requests = _extract_pull_request_evidence(analysis)

    member_names: list[str] = []
    for member in analysis.get("member_analysis") or []:
        if not isinstance(member, dict):
            continue
        name = _member_name(member)
        if name and name not in member_names:
            member_names.append(name)

    commit_messages = [
        str(c.get("message"))
        for c in commits
        if c.get("message")
    ]
    pr_titles = [
        str(pr.get("title"))
        for pr in pull_requests
        if pr.get("title")
    ]

    # Prefer the enriched signature if the service supports it.
    try:
        context = LLMService.build_repo_context(
            repository={
                "full_name": repository.get("full_name")
                or repository.get("name"),
                "description": repository.get("description"),
                "language": repository.get("language"),
                "owner": repository.get("owner"),
                "repo": repository.get("repo"),
                "default_branch": repository.get("default_branch"),
                "url": repository.get("url"),
            },
            files=files,
            pr_titles=pr_titles,
            commit_messages=commit_messages,
            members=member_names,
            commits=commits,
            pull_requests=pull_requests,
        )
    except TypeError:
        # Older service signature without commits=/pull_requests=
        context = LLMService.build_repo_context(
            repository={
                "full_name": repository.get("full_name")
                or repository.get("name"),
                "description": repository.get("description"),
                "language": repository.get("language"),
            },
            files=files,
            pr_titles=pr_titles,
            commit_messages=commit_messages,
            members=member_names,
        )
        context["commits"] = [
            {
                "sha": c.get("sha"),
                "message": c.get("message"),
                "files": c.get("files") or [],
                "member": c.get("member"),
            }
            for c in commits[:60]
        ]
        context["pull_requests"] = [
            {
                "number": pr.get("number"),
                "title": pr.get("title"),
                "files": pr.get("files") or [],
                "merged": pr.get("merged"),
                "member": pr.get("member"),
            }
            for pr in pull_requests[:40]
        ]
        context["known_files"] = files

    return context, files, commits, pull_requests


def _evidence_payload(analysis: dict[str, Any]) -> dict[str, Any]:
    return {
        "repository": analysis.get("repository", {}),
        "collection": analysis.get("collection", {}),
        "summary": analysis.get("summary", {}),
        "member_analysis": analysis.get("member_analysis", []),
        "task_analysis": analysis.get("task_analysis", []),
        "evidence_graph": analysis.get("evidence_graph", {}),
        "tasks": analysis.get("tasks", []),
        "timeline": analysis.get("timeline", {}),
        "commits": _extract_commit_evidence(analysis),
        "pull_requests": _extract_pull_request_evidence(analysis),
    }


 
# Routes
@router.post("/projects/{project_id}/tasks/generate")
async def generate_tasks(
    project_id: int,
    regenerate: bool = True,
    db: Session = Depends(get_db),
):
    project = _get_project_or_404(db, project_id)
    record = _get_analysis_or_404(db, project_id)
    analysis = record.analysis_json or {}

    context, known_files, commits, pull_requests = _build_llm_context(
        project, analysis
    )

    if not known_files:
        raise HTTPException(
            status_code=400,
            detail="No changed files were found in the stored analysis.",
        )

    if not commits and not pull_requests:
        logger.warning(
            "Project %s: no commits/PRs extracted from member_analysis; "
            "task generation will rely on file paths only.",
            project_id,
        )

    service = LLMService()

    try:
        generated = await service.generate_tasks(context, known_files)
    except LLMAPIError as error:
        raise HTTPException(
            status_code=502,
            detail=f"LLM task generation failed: {error}",
        ) from error

    if not isinstance(generated, list):
        raise HTTPException(
            status_code=502,
            detail="LLM returned an invalid task list.",
        )

    if regenerate:
        db.query(Task).filter(
            Task.project_id == project.id,
            Task.source != "manual",
        ).delete(synchronize_session=False)
        db.commit()
        db.expire_all()
        project = _get_project_or_404(db, project_id)

    existing_names = {
        task.name.strip().lower()
        for task in project.tasks
        if task.name
    }

    created_tasks: list[dict[str, Any]] = []

    for item in generated:
        if not isinstance(item, dict):
            continue

        name = str(item.get("name") or "").strip()
        if not name:
            continue

        key = name.lower()
        if key in existing_names:
            continue

        # Prefer exact evidence_files from the LLM, then file_patterns.
        evidence_files = _patterns(item.get("evidence_files"))
        raw_patterns = _patterns(item.get("file_patterns"))
        combined = evidence_files + [
            p for p in raw_patterns if p not in evidence_files
        ]

        # Always resolve to concrete known files (never store bare "area/*").
        file_patterns = _expand_to_known_files(combined, known_files, max_files=12)
        if not file_patterns:
            continue

        description = str(item.get("description") or "").strip()

        # Attach supporting commit/PR refs into description for the UI when
        # the model returned them (kept in description so Task schema stays stable).
        commit_shas = [
            str(s).strip()
            for s in (item.get("commit_shas") or [])
            if str(s).strip()
        ][:8]
        pr_numbers = []
        for n in item.get("pr_numbers") or []:
            try:
                pr_numbers.append(int(n))
            except (TypeError, ValueError):
                continue
        pr_numbers = pr_numbers[:8]

        extra_bits = []
        if commit_shas:
            extra_bits.append("Commits: " + ", ".join(s[:12] for s in commit_shas))
        if pr_numbers:
            extra_bits.append(
                "PRs: " + ", ".join(f"#{n}" for n in pr_numbers)
            )
        if extra_bits and description:
            description = description + "\n\n" + " · ".join(extra_bits)

        task = Task(
            project_id=project.id,
            name=name[:255],
            description=description,
            file_patterns=file_patterns,
            source="llm",
        )
        db.add(task)
        db.flush()

        created_tasks.append(
            {
                "id": task.id,
                "name": task.name,
                "description": task.description,
                "file_patterns": file_patterns,
                "evidence_files": evidence_files[:12],
                "commit_shas": commit_shas,
                "pr_numbers": pr_numbers,
                "source": task.source,
            }
        )
        existing_names.add(key)

    try:
        db.commit()
    except Exception as error:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to save generated tasks: {error}",
        ) from error

    db.expire_all()
    project = _get_project_or_404(db, project_id)
    all_tasks = _task_dicts(project)

    analysis["tasks"] = all_tasks
    analysis["llm"] = {
        **(analysis.get("llm") or {}),
        "task_generation": {
            "status": "llm",
            "generated": len(created_tasks),
            "commits_used": len(commits),
            "pull_requests_used": len(pull_requests),
            "known_files": len(known_files),
        },
    }
    _save_analysis(db, record, analysis)

    return {
        "project_id": project_id,
        "status": "llm",
        "model": getattr(service, "model", None),
        "generated": len(created_tasks),
        "tasks": created_tasks,
        "all_tasks": all_tasks,
        "context_stats": {
            "commits": len(commits),
            "pull_requests": len(pull_requests),
            "known_files": len(known_files),
        },
    }


@router.post("/projects/{project_id}/tasks/match")
async def match_members_to_tasks(
    project_id: int,
    db: Session = Depends(get_db),
):
    project = _get_project_or_404(db, project_id)
    record = _get_analysis_or_404(db, project_id)
    analysis = record.analysis_json or {}
    tasks = _task_dicts(project)

    if not tasks:
        raise HTTPException(
            status_code=400,
            detail="No tasks exist for this project. Generate tasks first.",
        )

    evidence = _evidence_payload(analysis)
    service = LLMService()

    try:
        matching = await service.match_members_to_tasks(evidence, tasks)
    except LLMAPIError as error:
        raise HTTPException(
            status_code=502,
            detail=f"LLM task matching failed: {error}",
        ) from error

    if not isinstance(matching, dict):
        raise HTTPException(
            status_code=502,
            detail="LLM returned an invalid task matching result.",
        )

    analysis["task_member_matching"] = matching
    analysis["llm"] = {
        **(analysis.get("llm") or {}),
        "task_matching": {"status": matching.get("status", "llm")},
    }
    _save_analysis(db, record, analysis)

    return {
        "project_id": project_id,
        "status": matching.get("status", "llm"),
        "model": matching.get("model", getattr(service, "model", None)),
        "members": matching.get("members", []),
        "tasks": matching.get("tasks", []),
        "matching": matching,
    }


@router.post("/projects/{project_id}/explain")
async def generate_explanation(
    project_id: int,
    db: Session = Depends(get_db),
):
    project = _get_project_or_404(db, project_id)
    record = _get_analysis_or_404(db, project_id)
    analysis = record.analysis_json or {}
    tasks = _task_dicts(project)

    if not tasks:
        raise HTTPException(
            status_code=400,
            detail="No tasks exist for this project. Generate tasks first.",
        )

    matching = analysis.get("task_member_matching") or {}
    service = LLMService()

    if not matching.get("members") and not matching.get("tasks"):
        evidence = _evidence_payload(analysis)
        try:
            matching = await service.match_members_to_tasks(evidence, tasks)
        except LLMAPIError as error:
            raise HTTPException(
                status_code=502,
                detail=f"LLM task matching failed: {error}",
            ) from error
        analysis["task_member_matching"] = matching

    evidence = _evidence_payload(analysis)
    timeline = analysis.get("timeline", {})
    repository = analysis.get("repository", {})
    repo_info = {
        "owner": repository.get("owner"),
        "repo": repository.get("repo"),
        "full_name": repository.get("full_name"),
        "name": repository.get("name"),
        "language": repository.get("language"),
        "description": repository.get("description"),
        "default_branch": repository.get("default_branch"),
        "url": repository.get("url"),
    }

    try:
        explanation = await service.explain_project(
            evidence,
            timeline,
            matching,
            repo_info=repo_info,
        )
    except TypeError:
        # Older signature without repo_info
        try:
            explanation = await service.explain_project(
                evidence, timeline, matching
            )
        except LLMAPIError as error:
            raise HTTPException(
                status_code=502,
                detail=f"LLM final explanation failed: {error}",
            ) from error
    except LLMAPIError as error:
        raise HTTPException(
            status_code=502,
            detail=f"LLM final explanation failed: {error}",
        ) from error

    analysis["llm_analysis"] = explanation
    analysis["llm"] = {
        **(analysis.get("llm") or {}),
        "final_explanation": {"status": "llm"},
    }
    _save_analysis(db, record, analysis)

    return {
        "project_id": project_id,
        "status": "llm",
        "model": (
            explanation.get("model", getattr(service, "model", None))
            if isinstance(explanation, dict)
            else getattr(service, "model", None)
        ),
        "explanation": explanation,
    }


@router.post("/projects/{project_id}/run")
async def run_llm_pipeline(
    project_id: int,
    regenerate_tasks: bool = True,
    db: Session = Depends(get_db),
):
    # Reuse generate + match + explain
    gen = await generate_tasks(
        project_id=project_id,
        regenerate=regenerate_tasks,
        db=db,
    )
    match = await match_members_to_tasks(project_id=project_id, db=db)
    explanation = await generate_explanation(project_id=project_id, db=db)
    return {
        "project_id": project_id,
        "status": "completed",
        "tasks": gen.get("all_tasks", []),
        "task_member_matching": match.get("matching", {}),
        "llm_analysis": explanation.get("explanation"),
    }


@router.post(
    "/projects/{project_id}/members/{member_id}/understanding/questions"
)
async def create_understanding_questions(
    project_id: int,
    member_id: int,
    db: Session = Depends(get_db),
):
    project = _get_project_or_404(db, project_id)
    member = (
        db.query(Member)
        .filter(Member.id == member_id, Member.project_id == project_id)
        .first()
    )
    if member is None:
        raise HTTPException(status_code=404, detail="Member not found.")

    record = _get_analysis_or_404(db, project_id)
    analysis = record.analysis_json or {}
    tasks = analysis.get("tasks") or _task_dicts(project)
    matches = analysis.get("task_member_matching") or {
        "members": [],
        "tasks": [],
    }

    member_input = {
        "member_id": member.id,
        "display_name": member.display_name or member.github_username,
        "github_username": member.github_username,
    }

    service = LLMService()
    try:
        result = await service.generate_understanding_questions(
            member=member_input,
            evidence=analysis,
            tasks=tasks,
            matches_=matches,
        )
    except LLMAPIError as error:
        raise HTTPException(
            status_code=502,
            detail=f"LLM question generation failed: {error}",
        ) from error

    questions = result.get("questions", [])
    if not isinstance(questions, list) or not questions:
        raise HTTPException(
            status_code=502,
            detail="LLM returned no understanding questions.",
        )

    session = UnderstandingSession(
        project_id=project_id,
        member_id=member_id,
        status="QUESTIONS_GENERATED",
        questions_json={"questions": questions},
        answers_json={},
    )
    db.add(session)
    try:
        db.commit()
        db.refresh(session)
    except Exception as error:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create understanding session: {error}",
        ) from error

    return {
        "session_id": session.id,
        "project_id": project_id,
        "member_id": member_id,
        "member": result.get("member", member_input),
        "questions": questions,
        "status": session.status,
        "model": result.get("model", getattr(service, "model", None)),
    }


@router.post(
    "/projects/{project_id}/members/{member_id}/understanding/{session_id}/evaluate"
)
async def evaluate_understanding(
    project_id: int,
    member_id: int,
    session_id: int,
    payload: UnderstandingAnswers,
    db: Session = Depends(get_db),
):
    _get_project_or_404(db, project_id)

    member = (
        db.query(Member)
        .filter(Member.id == member_id, Member.project_id == project_id)
        .first()
    )
    if member is None:
        raise HTTPException(status_code=404, detail="Member not found.")

    session = (
        db.query(UnderstandingSession)
        .filter(
            UnderstandingSession.id == session_id,
            UnderstandingSession.project_id == project_id,
            UnderstandingSession.member_id == member_id,
        )
        .first()
    )
    if session is None:
        raise HTTPException(
            status_code=404, detail="Understanding session not found."
        )
    if session.status == "EVALUATED":
        raise HTTPException(
            status_code=409,
            detail="This understanding session has already been evaluated.",
        )

    record = _get_analysis_or_404(db, project_id)
    analysis = record.analysis_json or {}
    questions_data = session.questions_json or {}
    questions = questions_data.get("questions", [])
    if not questions:
        raise HTTPException(
            status_code=400, detail="This session contains no questions."
        )

    clean_answers: dict[str, str] = {}
    for question in questions:
        if not isinstance(question, dict):
            continue
        question_id = str(question.get("id") or "").strip()
        if not question_id:
            continue
        answer = payload.answers.get(question_id, "")
        clean_answers[question_id] = str(answer or "").strip()[:5000]

    member_input = {
        "member_id": member.id,
        "display_name": member.display_name or member.github_username,
        "github_username": member.github_username,
    }

    service = LLMService()
    try:
        evaluation = await service.evaluate_understanding_answers(
            member=member_input,
            questions=questions,
            answers=clean_answers,
            evidence=analysis,
        )
    except LLMAPIError as error:
        raise HTTPException(
            status_code=502,
            detail=f"LLM understanding evaluation failed: {error}",
        ) from error

    try:
        score = int(evaluation.get("overall_score", 0))
    except (TypeError, ValueError):
        score = 0
    score = max(0, min(100, score))

    session.answers_json = clean_answers
    session.evaluation_json = evaluation
    session.understanding_score = score
    session.status = "EVALUATED"
    session.completed_at = utc_now()

    try:
        db.commit()
        db.refresh(session)
    except Exception as error:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to save understanding evaluation: {error}",
        ) from error

    return {
        "session_id": session.id,
        "project_id": project_id,
        "member_id": member_id,
        "member": evaluation.get("member", member_input),
        "status": session.status,
        "understanding_score": score,
        "overall_score": score,
        "understanding_level": evaluation.get("overall_level"),
        "overall_level": evaluation.get("overall_level"),
        "overall_summary": evaluation.get("overall_summary"),
        "questions": evaluation.get("questions", []),
        "strengths": evaluation.get("strengths", []),
        "areas_to_improve": evaluation.get("areas_to_improve", []),
        "advice": evaluation.get("advice", ""),
        "model": evaluation.get("model", getattr(service, "model", None)),
    }
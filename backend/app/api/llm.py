from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pathlib import Path
import json
import logging
from typing import Any

from app.database import get_db
from app.models import (AnalysisResult,Member,Project,Task,UnderstandingSession,utc_now)
from app.services.llm import (LLMAPIError,LLMService)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/llm",tags=["LLM"])

ANALYSIS_DIR = Path("llm_analysis")
ANALYSIS_DIR.mkdir(parents=True, exist_ok=True)


 
# HELPERS
def _get_project_or_404(db: Session, project_id: int) -> Project:
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")
    return project


def _latest_analysis(db: Session, project_id: int) -> AnalysisResult | None:
    return (
        db.query(AnalysisResult)
        .filter(AnalysisResult.project_id == project_id)
        .order_by(AnalysisResult.id.desc())
        .first()
    )


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


def _get_analysis_or_404(db: Session, project_id: int) -> AnalysisResult:
    record = _latest_analysis(db, project_id)
    if record is None:
        raise HTTPException(
            status_code=404,
            detail="This project has not been analyzed yet. Run POST /projects/{project_id}/analyze first.",
        )
    return record


def _repository_context(analysis: dict[str, Any]) -> dict[str, Any]:
    repository = analysis.get("repository") or {}
    collection = analysis.get("collection") or {}
    return {
        "owner": repository.get("owner"),
        "repo": repository.get("repo"),
        "name": repository.get("name"),
        "description": repository.get("description"),
        "language": repository.get("language"),
        "default_branch": repository.get("default_branch"),
        "url": repository.get("url"),
        "known_files": collection.get("known_files", []),
        "commits_collected": collection.get("commits_collected", 0),
        "pull_requests_collected": collection.get("pull_requests_collected", 0),
        "issues_collected": collection.get("issues_collected", 0),
        "workflow_runs_collected": collection.get("workflow_runs_collected", 0),
    }


def _known_files(analysis: dict[str, Any]) -> list[str]:
    collection = analysis.get("collection") or {}
    files = collection.get("known_files", [])
    if not isinstance(files, list):
        return []
    result: list[str] = []
    for file in files:
        if not isinstance(file, str):
            continue
        file = file.strip().replace("\\", "/")
        if file and file not in result:
            result.append(file)
    return sorted(result)


def _save_analysis(db: Session, record: AnalysisResult, analysis: dict[str, Any]) -> None:
    analysis = json.loads(json.dumps(analysis, default=str))
    record.analysis_json = analysis
    try:
        db.commit()
        db.refresh(record)
    except Exception as error:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to save LLM analysis: {error}") from error
    path = _analysis_file_path(record.project_id, record.id)
    _write_analysis_file(path, analysis)


 
# 1. GENERATE TASKS
 
@router.post("/{project_id}/tasks")
async def generate_tasks(project_id: int,regenerate: bool = False,db: Session = Depends(get_db)):
    """
    Generate project tasks using the LLM.
    IMPORTANT: No GitHub calls. Reads deterministic JSON only.
    Generates DETAILED descriptions (3-5 sentences) explaining WHAT, WHY, and HOW.
    """
    project = _get_project_or_404(db, project_id)
    record = _get_analysis_or_404(db, project_id)
    analysis = record.analysis_json or {}
    known_files = _known_files(analysis)

    if not known_files:
        raise HTTPException(status_code=400, detail="No changed files were found in the stored analysis.")

    repository = _repository_context(analysis)
    pr_titles: list[str] = []
    commit_messages: list[str] = []

    member_analysis = analysis.get("member_analysis", [])
    if isinstance(member_analysis, list):
        for member in member_analysis:
            if not isinstance(member, dict):
                continue
            details = member.get("details") or {}
            pull_requests = details.get("pull_requests", [])
            if isinstance(pull_requests, list):
                for pr in pull_requests:
                    if isinstance(pr, dict) and isinstance(pr.get("title"), str) and pr["title"].strip():
                        pr_titles.append(pr["title"].strip())
            commits = details.get("commits", [])
            if isinstance(commits, list):
                for commit in commits:
                    if isinstance(commit, dict) and isinstance(commit.get("message"), str) and commit["message"].strip():
                        commit_messages.append(commit["message"].strip())

    context = LLMService.build_repo_context(
        repository=repository,
        files=known_files,
        pr_titles=pr_titles[:100],
        commit_messages=commit_messages[:100],
        members=[member.display_name for member in project.members],
    )

    llm = LLMService()
    try:
        generated = await llm.generate_tasks(context, known_files)
    except LLMAPIError as error:
        raise HTTPException(status_code=502, detail=f"LLM task generation failed: {error}") from error

    if not isinstance(generated, list):
        raise HTTPException(status_code=502, detail="LLM returned an invalid task list.")

    if regenerate:
        db.query(Task).filter(Task.project_id == project.id, Task.source != "manual").delete(synchronize_session=False)

    existing_names = {task.name.strip().lower() for task in project.tasks if task.name}
    created_tasks: list[dict[str, Any]] = []

    for item in generated:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        key = name.lower()
        if key in existing_names and not regenerate:
            continue
        file_patterns = _patterns(item.get("file_patterns"))
        if not file_patterns:
            continue
        task = Task(
            project_id=project.id,
            name=name[:255],
            description=item.get("description"),
            file_patterns=file_patterns,
            source="llm",
        )
        db.add(task)
        db.flush()
        created_tasks.append({
            "id": task.id, "name": task.name, "description": task.description,
            "file_patterns": file_patterns, "source": task.source,
        })
        existing_names.add(key)

    try:
        db.commit()
    except Exception as error:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to save generated tasks: {error}") from error

    db.expire_all()
    project = _get_project_or_404(db, project_id)
    analysis["tasks"] = _task_dicts(project)
    analysis["llm"] = {**(analysis.get("llm") or {}), "task_generation": {"status": "llm", "generated": len(created_tasks)}}
    _save_analysis(db, record, analysis)

    return {
        "project_id": project_id, "status": "llm", "generated": len(created_tasks),
        "tasks": created_tasks, "all_tasks": _task_dicts(project),
    }


 
# 2. MATCH MEMBERS TO TASKS
@router.post("/{project_id}/match")
async def match_members_to_tasks(project_id: int, db: Session = Depends(get_db)):
    """Match members to tasks using deterministic evidence plus LLM judgment."""
    project = _get_project_or_404(db, project_id)
    record = _get_analysis_or_404(db, project_id)
    analysis = record.analysis_json or {}
    tasks = _task_dicts(project)

    if not tasks:
        raise HTTPException(status_code=400, detail="No tasks exist for this project. Generate tasks first.")

    evidence = {
        "member_analysis": analysis.get("member_analysis", []),
        "task_analysis": analysis.get("task_analysis", []),
        "evidence_graph": analysis.get("evidence_graph", {}),
        "summary": analysis.get("summary", {}),
    }

    llm = LLMService()
    try:
        matching = await llm.match_members_to_tasks(evidence, tasks)
    except LLMAPIError as error:
        raise HTTPException(status_code=502, detail=f"LLM task matching failed: {error}") from error

    analysis["task_member_matching"] = matching
    analysis["llm"] = {**(analysis.get("llm") or {}), "task_matching": {"status": matching.get("status", "unknown")}}
    _save_analysis(db, record, analysis)

    return {"project_id": project_id, "status": matching.get("status", "unknown"), "matching": matching}


 
# 3. FINAL EXPLANATION
@router.post("/{project_id}/explanation")
async def generate_explanation(project_id: int, db: Session = Depends(get_db)):
    """Generate final project explanation using only saved JSON evidence."""
    _get_project_or_404(db, project_id)
    record = _get_analysis_or_404(db, project_id)
    analysis = record.analysis_json or {}

    evidence = {
        "member_analysis": analysis.get("member_analysis", []),
        "task_analysis": analysis.get("task_analysis", []),
        "evidence_graph": analysis.get("evidence_graph", {}),
        "summary": analysis.get("summary", {}),
    }
    timeline = analysis.get("timeline", {})
    matching = analysis.get("task_member_matching", {})
    repository = analysis.get("repository", {})
    repo_info = {"language": repository.get("language"), "description": repository.get("description")}

    llm = LLMService()
    try:
        explanation = await llm.explain_project(evidence, timeline, matching, repo_info=repo_info)
    except LLMAPIError as error:
        raise HTTPException(status_code=502, detail=f"LLM final explanation failed: {error}") from error

    analysis["llm_analysis"] = explanation
    analysis["llm"] = {**(analysis.get("llm") or {}), "final_explanation": {"status": "llm"}}
    _save_analysis(db, record, analysis)

    return {"project_id": project_id, "status": "llm", "explanation": explanation}


 
# OPTIONAL: RUN ALL THREE LLM STEPS
@router.post("/{project_id}/run")
async def run_llm_pipeline(project_id: int, regenerate_tasks: bool = False, db: Session = Depends(get_db)):
    """Execute complete LLM pipeline: Tasks → Matching → Explanation. No GitHub calls."""
    project = _get_project_or_404(db, project_id)
    record = _get_analysis_or_404(db, project_id)
    analysis = record.analysis_json or {}
    known_files = _known_files(analysis)

    if not known_files:
        raise HTTPException(status_code=400, detail="No known files exist in the stored analysis.")

    repository = _repository_context(analysis)
    llm = LLMService()
    pr_titles: list[str] = []
    commit_messages: list[str] = []

    member_analysis = analysis.get("member_analysis", [])
    if isinstance(member_analysis, list):
        for member_data in member_analysis:
            if not isinstance(member_data, dict):
                continue
            details = member_data.get("details") or {}
            for pr in details.get("pull_requests", []):
                if isinstance(pr, dict) and isinstance(pr.get("title"), str) and pr["title"].strip():
                    pr_titles.append(pr["title"].strip())
            for commit in details.get("commits", []):
                if isinstance(commit, dict) and isinstance(commit.get("message"), str) and commit["message"].strip():
                    commit_messages.append(commit["message"].strip())

    context = LLMService.build_repo_context(
        repository=repository, files=known_files,
        pr_titles=pr_titles[:100], commit_messages=commit_messages[:100],
        members=[member.display_name for member in project.members],
    )

    # STEP 1 — TASK GENERATION
    try:
        generated = await llm.generate_tasks(context, known_files)
    except LLMAPIError as error:
        raise HTTPException(status_code=502, detail=f"LLM task generation failed: {error}") from error

    if not isinstance(generated, list):
        raise HTTPException(status_code=502, detail="LLM returned invalid generated tasks.")

    if regenerate_tasks:
        db.query(Task).filter(Task.project_id == project.id, Task.source != "manual").delete(synchronize_session=False)

    existing_names = {task.name.strip().lower() for task in project.tasks if task.name}
    for item in generated:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        file_patterns = _patterns(item.get("file_patterns"))
        if not file_patterns:
            continue
        key = name.lower()
        if key in existing_names:
            continue
        db.add(Task(project_id=project.id, name=name[:255], description=item.get("description"), file_patterns=file_patterns, source="llm"))
        existing_names.add(key)

    try:
        db.commit()
    except Exception as error:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to save generated tasks: {error}") from error

    db.expire_all()
    project = _get_project_or_404(db, project_id)
    tasks = _task_dicts(project)

    # STEP 2 — MATCH
    evidence = {
        "member_analysis": analysis.get("member_analysis", []),
        "task_analysis": analysis.get("task_analysis", []),
        "evidence_graph": analysis.get("evidence_graph", {}),
        "summary": analysis.get("summary", {}),
    }
    try:
        matching = await llm.match_members_to_tasks(evidence, tasks)
    except LLMAPIError as error:
        raise HTTPException(status_code=502, detail=f"LLM task matching failed: {error}") from error

    # STEP 3 — EXPLANATION
    timeline = analysis.get("timeline", {})
    repo_info = {"language": repository.get("language"), "description": repository.get("description")}
    try:
        explanation = await llm.explain_project(evidence, timeline, matching, repo_info=repo_info)
    except LLMAPIError as error:
        raise HTTPException(status_code=502, detail=f"LLM final explanation failed: {error}") from error

    # SAVE EVERYTHING
    analysis["tasks"] = tasks
    analysis["task_member_matching"] = matching
    analysis["llm_analysis"] = explanation
    analysis["llm"] = {
        "status": "completed",
        "task_generation": {"status": "llm", "generated": len(generated)},
        "task_matching": {"status": matching.get("status", "unknown")},
        "final_explanation": {"status": "llm"},
    }
    _save_analysis(db, record, analysis)

    return {
        "project_id": project_id, "status": "completed",
        "tasks": tasks, "task_member_matching": matching, "llm_analysis": explanation,
    }


 
# PROOF OF UNDERSTANDING - QUESTIONS
@router.post("/projects/{project_id}/members/{member_id}/understanding/questions")
async def create_understanding_questions(project_id: int, member_id: int, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")

    member = db.query(Member).filter(Member.id == member_id, Member.project_id == project_id).first()
    if member is None:
        raise HTTPException(status_code=404, detail="Member not found.")

    analysis_row = (
        db.query(AnalysisResult)
        .filter(AnalysisResult.project_id == project_id)
        .order_by(AnalysisResult.created_at.desc())
        .first()
    )
    if analysis_row is None:
        raise HTTPException(status_code=404, detail="No analysis exists for this project. Run project analysis first.")

    analysis = analysis_row.analysis_json or {}
    tasks = analysis.get("tasks") or []
    matches = analysis.get("task_member_matching") or {"members": [], "tasks": []}

    member_input = {
        "member_id": member.id,
        "display_name": member.display_name,
        "github_username": member.github_username,
    }

    service = LLMService()
    try:
        result = await service.generate_understanding_questions(
            member=member_input, evidence=analysis, tasks=tasks, matches_=matches
        )
    except LLMAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    session = UnderstandingSession(
        project_id=project_id,
        member_id=member_id,
        status="QUESTIONS_GENERATED",
        questions_json={"questions": result["questions"]},
        answers_json={},
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    return {
        "session_id": session.id, "project_id": project_id, "member_id": member_id,
        "member": result.get("member"), "questions": result["questions"],
        "status": session.status, "model": result.get("model"),
    }


 
# PROOF OF UNDERSTANDING - EVALUATION + ADVICE
@router.post("/projects/{project_id}/members/{member_id}/understanding/{session_id}/evaluate")
async def evaluate_understanding(
    project_id: int, member_id: int, session_id: int, answers: dict[str, str], db: Session = Depends(get_db)
):
    """
    Evaluate answers against evidence and provide SPECIFIC ARCHITECTURAL/METHODOLOGICAL ADVICE.
    Advice is grounded in actual code changes and understanding gaps, never generic.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")

    member = db.query(Member).filter(Member.id == member_id, Member.project_id == project_id).first()
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
        raise HTTPException(status_code=404, detail="Understanding session not found.")
    if session.status == "EVALUATED":
        raise HTTPException(status_code=409, detail="This understanding session has already been evaluated.")

    analysis_row = (
        db.query(AnalysisResult)
        .filter(AnalysisResult.project_id == project_id)
        .order_by(AnalysisResult.created_at.desc())
        .first()
    )
    if analysis_row is None:
        raise HTTPException(status_code=404, detail="No analysis exists for this project.")

    analysis = analysis_row.analysis_json or {}
    questions_data = session.questions_json or {}
    questions = questions_data.get("questions") or []

    if not questions:
        raise HTTPException(status_code=400, detail="This session contains no questions.")
    if not isinstance(answers, dict):
        raise HTTPException(status_code=422, detail="Answers must be a JSON object.")

    clean_answers: dict[str, str] = {}
    for question in questions:
        question_id = str(question.get("id") or "").strip()
        if not question_id:
            continue
        answer = answers.get(question_id, "")
        if not isinstance(answer, str):
            answer = str(answer)
        clean_answers[question_id] = answer.strip()[:5000]

    member_input = {
        "member_id": member.id,
        "display_name": member.display_name,
        "github_username": member.github_username,
    }

    service = LLMService()
    try:
        evaluation = await service.evaluate_understanding_answers(
            member=member_input, questions=questions, answers=clean_answers, evidence=analysis
        )
    except LLMAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    session.answers_json = clean_answers
    session.evaluation_json = evaluation
    session.understanding_score = int(evaluation.get("overall_score", 0))
    session.status = "EVALUATED"
    session.completed_at = utc_now()
    db.commit()
    db.refresh(session)

    return {
        "session_id": session.id, "project_id": project_id, "member_id": member_id,
        "member": evaluation.get("member"), "status": session.status,
        "understanding_score": session.understanding_score,
        "understanding_level": evaluation.get("overall_level"),
        "overall_summary": evaluation.get("overall_summary"),
        "questions": evaluation.get("questions", []),
        "strengths": evaluation.get("strengths", []),
        "areas_to_improve": evaluation.get("areas_to_improve", []),
        "advice": evaluation.get("advice", ""),  # NEW FIELD: Evidence-based architectural/methodological advice
    }
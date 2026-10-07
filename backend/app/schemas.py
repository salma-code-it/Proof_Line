from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field, ConfigDict, RootModel

class MemberCreate(BaseModel):
    display_name: str = Field(min_length=1, max_length=255)
    github_username: str | None = Field(default=None, max_length=255)

class MemberResponse(BaseModel):
    id: int
    member_number: int
    display_name: str
    github_username: str | None = None
    # GitHub's own observable contribution count. # # This is NOT a GroupProof contribution percentage.
    github_contributions: int | None = None

    model_config = ConfigDict(
        from_attributes=True
    )
class TaskCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    file_patterns: list[str] = Field(default_factory=list)

class TaskResponse(BaseModel):
    id: int
    project_id: int
    name: str
    description: str | None=None
    file_patterns: list[str]=Field(default_factory=list)
    # manual / llm / auto
    source: str 
    model_config = ConfigDict(from_attributes=True)

class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    repo_url: str = Field(min_length=1, max_length=500)
    tasks: list[TaskCreate] = Field(default_factory=list)

class ProjectResponse(BaseModel):
    id: int
    name: str
    repo_url: str
    owner: str
    repo: str
    created_at: datetime

    model_config = ConfigDict(
        from_attributes=True
    )
class EventResponse(BaseModel):
    id: int
    event_type: str
    timestamp: datetime
    source_id: str
    artifact: str | None = None
    metadata: dict[str, Any] | None = None
    model_config = {"from_attributes": True}

class AnalyzeResponse(RootModel[dict[str, Any]]):
    pass

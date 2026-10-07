from __future__ import annotations
import asyncio
from typing import Any
from urllib.parse import urlparse
import httpx
from app.config import settings


class GitHubAPIError(Exception):
    """Raised when the GitHub API cannot provide requested data."""


class GitHubService:

   # Configuration
    MAX_ITEMS_PER_PAGE = 100
    MAX_COMMIT_PAGES = 10
    MAX_PR_PAGES = 10
    MAX_FILE_PAGES = 5
    MAX_REVIEW_PAGES = 5
    MAX_EVENT_PAGES = 3
    MAX_ISSUE_PAGES = 5
    MAX_ISSUE_COMMENT_PAGES = 3
    MAX_PR_COMMIT_PAGES = 5
    MAX_WORKFLOW_PAGES = 5
    
    MAX_CONCURRENT_REQUESTS = 8

    def __init__(self) -> None:
        self.base_url = settings.github_api_url.rstrip("/")

        self.headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "GroupProof/1.0",
        }

        if settings.github_token:
            self.headers["Authorization"] = (f"Bearer {settings.github_token}")

    
    async def _get(self,endpoint: str,params: dict[str, Any] | None = None) -> Any:

        url = f"{self.base_url}{endpoint}"
        timeout = httpx.Timeout(
            connect=15.0,
            read=45.0,
            write=30.0,
            pool=30.0,
        )

        last_error: Exception | None = None

        for attempt in range(3):
            try:
                async with httpx.AsyncClient(
                    timeout=timeout,
                    headers=self.headers,
                ) as client:

                    response = await client.get(url,params=params)
                
                # Rate limit handling
            
                if response.status_code == 403:
                    try:
                        body = response.json()
                        message = body.get("message","GitHub API request was forbidden.",)
                    except Exception:
                        message = response.text

                    raise GitHubAPIError(f"GitHub API error 403: {message}")

                
                # Not found
                if response.status_code == 404:
                    try:
                        body = response.json()
                        message = body.get("message","GitHub resource was not found.",)
                    except Exception:
                        message = response.text

                    raise GitHubAPIError(f"GitHub API error 404: {message}")

                
                # Other HTTP errors
                if response.status_code >= 400:
                    try:
                        body = response.json()
                        message = body.get("message",response.text,)
                    except Exception:
                        message = response.text

                    raise GitHubAPIError(
                        f"GitHub API error "
                        f"{response.status_code}: {message}"
                    )

                
                # Successful response
                return response.json()

            except GitHubAPIError:
                raise

            except (
                httpx.ReadTimeout,
                httpx.ConnectTimeout,
                httpx.WriteTimeout,
                httpx.PoolTimeout,
                httpx.RequestError,
            ) as error:

                last_error = error

                if attempt < 2:
                    # 1s -> 2s
                    await asyncio.sleep(2**attempt)

        raise GitHubAPIError(
            "GitHub API request failed after 3 attempts: "
            f"{endpoint}: {last_error}"
        )

    async def _get_pages(
        self,
        endpoint: str,
        max_pages: int,
        params: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        """
        Fetch paginated GitHub list endpoints.
        """

        result: list[dict[str, Any]] = []

        base_params = dict(params or {})

        for page in range(1, max_pages + 1):

            data = await self._get(
                endpoint,
                {
                    **base_params,
                    "per_page": self.MAX_ITEMS_PER_PAGE,
                    "page": page,
                },
            )

            if not isinstance(data, list):
                break

            if not data:
                break

            result.extend(
                item
                for item in data
                if isinstance(item, dict)
            )

            if len(data) < self.MAX_ITEMS_PER_PAGE:
                break

        return result

     
    # Repository URL
    @staticmethod
    def parse_repo_url(repo_url: str,) -> tuple[str, str]:
        """
        Extract owner/repository from a GitHub URL.
        """

        value = repo_url.strip().strip("\"'")

        if not value:
            raise ValueError(
                "GitHub repository URL cannot be empty."
            )

        if not value.startswith(("http://", "https://")):
            value = "https://" + value

        parsed = urlparse(value)

        if parsed.netloc.lower() not in {"github.com","www.github.com",}:
            raise ValueError(
                "URL must point to github.com."
            )

        parts = [
            part
            for part in parsed.path.split("/")
            if part
        ]

        if len(parts) < 2:
            raise ValueError("Invalid GitHub repository URL.")

        owner = parts[0]
        repo = parts[1].removesuffix(".git")

        if not owner or not repo:
            raise ValueError("Invalid GitHub repository URL.")

        return owner, repo

    # Repository
    async def get_repository(self,owner: str,repo: str,) -> dict[str, Any]:
        data = await self._get(f"/repos/{owner}/{repo}")

        return (
            data
            if isinstance(data, dict)
            else {}
        )

     
    # Contributors
    async def get_contributors(self,owner: str,repo: str) -> list[dict[str, Any]]:
        data = await self._get_pages(f"/repos/{owner}/{repo}/contributors",10)

        contributors: list[dict[str, Any]] = []

        for item in data:

            login = item.get("login")

            if not login:
                continue

            contributors.append(
                {
                    "github_username": login,
                    "profile_url": item.get("html_url"),
                    "contributions": item.get("contributions",0),
                }
            )

        return contributors

     
    # COMMITS
    async def get_commits(self,owner: str,repo: str,) -> list[dict[str, Any]]:

        return await self._get_pages(f"/repos/{owner}/{repo}/commits",self.MAX_COMMIT_PAGES,)

    async def get_commit(self,owner: str,repo: str,sha: str) -> dict[str, Any]:
        """
        This endpoint can provide:
            - commit message
            - author
            - committer
            - timestamp
            - stats
            - changed files
        """

        if not sha:
            return {}

        data = await self._get(f"/repos/{owner}/{repo}/commits/{sha}")

        return (
            data
            if isinstance(data, dict)
            else {}
        )

    async def get_commit_details(self,owner: str,repo: str,commits: list[dict[str, Any]]) -> list[dict[str, Any]]:
        semaphore = asyncio.Semaphore(self.MAX_CONCURRENT_REQUESTS)

        async def enrich(commit: dict[str, Any]) -> dict[str, Any]:
            sha = commit.get("sha")

            if not sha:
                return self._compact_commit(commit)

            async with semaphore:
                try:
                    details = await self.get_commit(owner,repo,sha)
                except GitHubAPIError:
                    return self._compact_commit(commit)

            compact = self._compact_commit(commit)

            compact["stats"] = (details.get("stats")or {})

            compact["files"] = [
                self._compact_commit_file(file)
                for file in (details.get("files")or [])
                if isinstance(file, dict)
            ]

            # Useful author/committer information
            commit_data = (details.get("commit") or {})

            if isinstance(commit_data, dict):

                author_data = (
                    commit_data.get("author")
                    or {}
                )

                committer_data = (
                    commit_data.get("committer")
                    or {}
                )

                compact["author"] = {
                    "name": author_data.get(
                        "name"
                    ),
                    "email": author_data.get(
                        "email"
                    ),
                    "date": author_data.get(
                        "date"
                    ),
                }

                compact["committer"] = {
                    "name": committer_data.get(
                        "name"
                    ),
                    "email": committer_data.get(
                        "email"
                    ),
                    "date": committer_data.get(
                        "date"
                    ),
                }

                message = (
                    commit_data.get(
                        "message"
                    )
                )

                if message:
                    compact["message"] = message

            return compact

        return await asyncio.gather(
            *(
                enrich(commit)
                for commit in commits
            )
        )

    @staticmethod
    def _compact_commit(commit: dict[str, Any],) -> dict[str, Any]:
        commit_data = (
            commit.get("commit")
            or {}
        )

        author_data = (
            commit_data.get("author")
            or {}
        )

        committer_data = (
            commit_data.get("committer")
            or {}
        )

        author_user = (
            commit.get("author")
            or {}
        )

        committer_user = (
            commit.get("committer")
            or {}
        )

        return {
            "sha": commit.get("sha"),
            "html_url": commit.get(
                "html_url"
            ),
            "message": commit_data.get(
                "message"
            ),
            "author": {
                "login": author_user.get(
                    "login"
                ),
                "name": author_data.get(
                    "name"
                ),
                "email": author_data.get(
                    "email"
                ),
                "date": author_data.get(
                    "date"
                ),
            },
            "committer": {
                "login": committer_user.get(
                    "login"
                ),
                "name": committer_data.get(
                    "name"
                ),
                "email": committer_data.get(
                    "email"
                ),
                "date": committer_data.get(
                    "date"
                ),
            },
        }

    @staticmethod
    def _compact_commit_file(file: dict[str, Any]) -> dict[str, Any]:
        return {
            "filename": file.get(
                "filename"
            ),
            "status": file.get(
                "status"
            ),
            "additions": file.get(
                "additions",
                0,
            ),
            "deletions": file.get(
                "deletions",
                0,
            ),
            "changes": file.get(
                "changes",
                0,
            ),
        }

     
    # PULL REQUESTS  
    async def get_pull_requests(self,owner: str,repo: str) -> list[dict[str, Any]]:

        return await self._get_pages(f"/repos/{owner}/{repo}/pulls",self.MAX_PR_PAGES,
            {
                "state": "all",
                "sort": "updated",
                "direction": "desc",
            },
        )

    async def get_pull_request_files(
        self, owner: str, repo: str, pull_number: int
    ) -> list[dict[str, Any]]:
        data = await self._get_pages(
            f"/repos/{owner}/{repo}/pulls/{pull_number}/files",
            self.MAX_FILE_PAGES,
        )

        # ✅ ADD THIS: Apply compaction before returning
        return [self._compact_pr_file(file) for file in data]

    @staticmethod
    def _compact_pr_file(file: dict[str, Any]) -> dict[str, Any]:
        return {
            "filename": file.get(
                "filename"
            ),
            "status": file.get(
                "status"
            ),
            "additions": file.get(
                "additions",
                0,
            ),
            "deletions": file.get(
                "deletions",
                0,
            ),
            "changes": file.get(
                "changes",
                0,
            ),
        }

    async def get_pull_request_commits(
        self,
        owner: str,
        repo: str,
        pull_number: int,
    ) -> list[dict[str, Any]]:

        data = await self._get_pages(
            (
                f"/repos/{owner}/{repo}"
                f"/pulls/{pull_number}/commits"
            ),
            self.MAX_PR_COMMIT_PAGES,
        )

        return [
            self._compact_commit(commit)
            for commit in data
        ]

     
    # PR REVIEWS
    async def get_reviews(
        self,
        owner: str,
        repo: str,
        pull_number: int,
    ) -> list[dict[str, Any]]:

        data = await self._get_pages(
            (
                f"/repos/{owner}/{repo}"
                f"/pulls/{pull_number}/reviews"
            ),
            self.MAX_REVIEW_PAGES,
        )

        return [
            self._compact_review(review)
            for review in data
        ]

    @staticmethod
    def _compact_review(review: dict[str, Any]) -> dict[str, Any]:

        user = (
            review.get("user")
            or {}
        )

        return {
            "id": review.get("id"),
            "user": user.get("login"),
            "state": review.get(
                "state"
            ),
            "submitted_at": review.get(
                "submitted_at"
            ),
            "html_url": review.get(
                "html_url"
            ),
        }

     
    # REVIEW COMMENTS
    async def get_review_comments(
        self,
        owner: str,
        repo: str,
        pull_number: int,
    ) -> list[dict[str, Any]]:
        data = await self._get_pages(
            (
                f"/repos/{owner}/{repo}"
                f"/pulls/{pull_number}/comments"
            ),
            self.MAX_REVIEW_PAGES,
        )

        return [
            self._compact_review_comment(
                comment
            )
            for comment in data
        ]

    @staticmethod
    def _compact_review_comment(comment: dict[str, Any],) -> dict[str, Any]:

        user = (
            comment.get("user")
            or {}
        )

        return {
            "id": comment.get("id"),
            "user": user.get("login"),
            "created_at": comment.get(
                "created_at"
            ),
            "updated_at": comment.get(
                "updated_at"
            ),
            "path": comment.get(
                "path"
            ),
            "line": comment.get(
                "line"
            ),
            "original_line": comment.get(
                "original_line"
            ),
            "html_url": comment.get(
                "html_url"
            ),
        }

     
    # REPOSITORY EVENTS
    async def get_repository_events(
        self,
        owner: str,
        repo: str,
    ) -> list[dict[str, Any]]:
        """
        Collect recent public repository events.

        Useful mainly for:
            - branch creation
            - repository activity timeline
        """

        data = await self._get_pages(
            f"/repos/{owner}/{repo}/events",
            self.MAX_EVENT_PAGES,
        )

        return [
            self._compact_repository_event(
                event
            )
            for event in data
        ]

    @staticmethod
    def _compact_repository_event(event: dict[str, Any]) -> dict[str, Any]:

        actor = (
            event.get("actor")
            or {}
        )

        payload = (
            event.get("payload")
            or {}
        )

        compact = {
            "id": event.get("id"),
            "type": event.get(
                "type"
            ),
            "created_at": event.get(
                "created_at"
            ),
            "actor": actor.get(
                "login"
            ),
        }

        event_type = event.get("type")

        # Branch/tag creation
        if event_type == "CreateEvent":

            compact["ref_type"] = payload.get(
                "ref_type"
            )

            compact["ref"] = payload.get(
                "ref"
            )

        # Branch deletion
        elif event_type == "DeleteEvent":

            compact["ref_type"] = payload.get(
                "ref_type"
            )

            compact["ref"] = payload.get(
                "ref"
            )

        return compact

     
    # ISSUES
    async def get_issues(
        self,
        owner: str,
        repo: str,
    ) -> list[dict[str, Any]]:
        data = await self._get_pages(
            f"/repos/{owner}/{repo}/issues",
            self.MAX_ISSUE_PAGES,
            {
                "state": "all",
                "sort": "updated",
                "direction": "desc",
            },
        )

        issues: list[dict[str, Any]] = []

        for item in data:

            # GitHub issues containing pull_request
            # represent PRs and should not be counted again as issues.
            if item.get("pull_request"):
                continue

            issues.append(
                self._compact_issue(item)
            )

        return issues

    @staticmethod
    def _compact_issue(issue: dict[str, Any],) -> dict[str, Any]:
        user = (
            issue.get("user")
            or {}
        )

        labels = []

        for label in (issue.get("labels") or []):
            if isinstance(label, dict):
                name = label.get("name")

                if name:
                    labels.append(name)

        return {
            "number": issue.get(
                "number"
            ),
            "title": issue.get(
                "title"
            ),
            "state": issue.get(
                "state"
            ),
            "user": user.get(
                "login"
            ),
            "created_at": issue.get(
                "created_at"
            ),
            "updated_at": issue.get(
                "updated_at"
            ),
            "closed_at": issue.get(
                "closed_at"
            ),
            "comments": issue.get(
                "comments",
                0,
            ),
            "labels": labels,
            "html_url": issue.get(
                "html_url"
            ),
        }

    async def get_issue_comments(
        self,
        owner: str,
        repo: str,
        issue_number: int,
    ) -> list[dict[str, Any]]:

        data = await self._get_pages(
            (
                f"/repos/{owner}/{repo}"
                f"/issues/{issue_number}/comments"
            ),
            self.MAX_ISSUE_COMMENT_PAGES,
        )

        return [
            self._compact_issue_comment(
                comment
            )
            for comment in data
        ]

    @staticmethod
    def _compact_issue_comment(
        comment: dict[str, Any],
    ) -> dict[str, Any]:

        user = (
            comment.get("user")
            or {}
        )

        return {
            "id": comment.get("id"),
            "user": user.get(
                "login"
            ),
            "created_at": comment.get(
                "created_at"
            ),
            "updated_at": comment.get(
                "updated_at"
            ),
            "html_url": comment.get(
                "html_url"
            ),
        }

     
    # CI/CD
    async def get_workflow_runs(
        self,
        owner: str,
        repo: str,
    ) -> list[dict[str, Any]]:
        """
        Collect GitHub Actions workflow runs.
        This is the CI/CD evidence source.
        """

        result: list[dict[str, Any]] = []

        endpoint = (
            f"/repos/{owner}/{repo}"
            "/actions/runs"
        )

        for page in range(
            1,
            self.MAX_WORKFLOW_PAGES + 1,
        ):

            data = await self._get(
                endpoint,
                {
                    "per_page": self.MAX_ITEMS_PER_PAGE,
                    "page": page,
                },
            )

            if not isinstance(data, dict):
                break

            runs = data.get(
                "workflow_runs"
            ) or []

            if not isinstance(
                runs,
                list,
            ):
                break

            if not runs:
                break

            for run in runs:

                if not isinstance(
                    run,
                    dict,
                ):
                    continue

                compact = (
                    self._compact_workflow_run(
                        run
                    )
                )

                result.append(compact)

            if len(runs) < self.MAX_ITEMS_PER_PAGE:
                break

        return result

    @staticmethod
    def _compact_workflow_run(run: dict[str, Any]) -> dict[str, Any]:
        actor = (
            run.get("actor")
            or {}
        )

        workflow = (
            run.get("workflow")
            or {}
        )

        return {
            "id": run.get(
                "id"
            ),
            "name": run.get(
                "name"
            ),
            "workflow_id": run.get(
                "workflow_id"
            ),
            "workflow_name": workflow.get(
                "name"
            ),
            "status": run.get(
                "status"
            ),
            "conclusion": run.get(
                "conclusion"
            ),
            "branch": run.get(
                "head_branch"
            ),
            "commit_sha": run.get(
                "head_sha"
            ),
            "actor": actor.get(
                "login"
            ),
            "event": run.get(
                "event"
            ),
            "created_at": run.get(
                "created_at"
            ),
            "updated_at": run.get(
                "updated_at"
            ),
            "run_number": run.get(
                "run_number"
            ),
            "html_url": run.get(
                "html_url"
            ),
        }




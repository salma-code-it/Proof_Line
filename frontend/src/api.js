import axios from "axios";

const rawBaseUrl = import.meta.env.VITE_API_URL || "http://localhost:8000";
const baseURL = rawBaseUrl.replace(/\/+$/, "");

const apiClient = axios.create({
  baseURL,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
  timeout: 600000,
});

function normalizeApiError(error) {
  if (axios.isAxiosError(error)) {
    if (error.response) {
      const status = error.response.status;
      const detail = error.response.data?.detail;

      if (typeof detail === "string") {
        return new Error(
          `Backend error ${status}: ${detail}`
        );
      }

      if (Array.isArray(detail)) {
        const messages = detail
          .map((item) => item?.msg)
          .filter(Boolean);

        return new Error(
          messages.length
            ? `Backend error ${status}: ${messages.join(", ")}`
            : `Backend returned HTTP ${status}.`
        );
      }

      if (typeof error.response.data?.message === "string") {
        return new Error(
          `Backend error ${status}: ${error.response.data.message}`
        );
      }

      return new Error(
        `Backend returned HTTP ${status} for ${error.config?.method?.toUpperCase() || "REQUEST"} ${error.config?.url || ""}.`
      );
    }

    if (error.request) {
      return new Error(
        `Cannot reach the backend at ${baseURL}. ` +
        `Request: ${error.config?.method?.toUpperCase() || "REQUEST"} ${error.config?.url || ""}. ` +
        "Check that FastAPI is running and that VITE_API_URL points to the correct API."
      );
    }
  }

  return new Error(error?.message || "An unexpected error occurred.");
}

async function request(callback) {
  try {
    const response = await callback();
    return response.data;
  } catch (error) {
    throw normalizeApiError(error);
  }
}

export async function createProject(projectData) {
  return request(() => apiClient.post("/projects", projectData));
}

export async function getProject(projectId) {
  return request(() => apiClient.get(`/projects/${projectId}`));
}

export async function analyzeProject(projectId) {
  return request(() => apiClient.post(`/projects/${projectId}/analyze`));
}

export async function getMember(projectId, memberId) {
  return request(() =>
    apiClient.get(`/projects/${projectId}/members/${memberId}`)
  );
}

export function findMember(project, memberId) {
  const members = project?.github_contributors || [];

  return (
    members.find(
      (member) => Number(member.id) === Number(memberId)
    ) || null
  );
}

export async function getLatestAnalysis(projectId) {
  return request(() =>
    apiClient.get(`/projects/${projectId}/analysis`)
  );
}

export async function getAnalyses(projectId) {
  return request(() =>
    apiClient.get(`/projects/${projectId}/analyses`)
  );
}

export async function getEvidenceGraph(projectId) {
  return request(() =>
    apiClient.get(`/projects/${projectId}/evidence-graph`)
  );
}

export async function getTaskEvidence(projectId, taskId) {
  return request(() =>
    apiClient.get(
      `/projects/${projectId}/tasks/${taskId}/evidence`
    )
  );
}

export async function getTimeline(projectId, limit = 200) {
  return request(() =>
    apiClient.get(`/projects/${projectId}/timeline`, {
      params: { limit },
    })
  );
}

export async function getMemberTimeline(
  projectId,
  memberId,
  limit = 200
) {
  return request(() =>
    apiClient.get(
      `/projects/${projectId}/members/${memberId}/timeline`,
      {
        params: { limit },
      }
    )
  );
}

// LLM 
export async function generateTasks(projectId) {
  return request(() =>
    apiClient.post(`/llm/projects/${projectId}/tasks/generate`)
  );
}

export async function matchTasksToMembers(projectId) {
  return request(() =>
    apiClient.post(`/llm/projects/${projectId}/tasks/match`)
  );
}

export async function explainProject(projectId) {
  return request(() =>
    apiClient.post(`/llm/projects/${projectId}/explain`)
  );
}

export async function generateUnderstandingQuestions(
  projectId,
  memberId
) {
  return request(() =>
    apiClient.post(
      `/llm/projects/${projectId}/members/${memberId}/understanding/questions`
    )
  );
}

export async function evaluateUnderstanding(
  projectId,
  memberId,
  sessionId,
  answers
) {
  return request(() =>
    apiClient.post(
      `/llm/projects/${projectId}/members/${memberId}/understanding/${sessionId}/evaluate`,
      { answers }
    )
  );
}

export async function getDashboardData(projectId) {
  const [project, analysis] = await Promise.all([
    getProject(projectId),
    getLatestAnalysis(projectId),
  ]);

  const [timelineResult, graphResult] =
    await Promise.allSettled([
      getTimeline(projectId),
      getEvidenceGraph(projectId),
    ]);

  return {
    project,
    analysis,
    timeline:
      timelineResult.status === "fulfilled"
        ? timelineResult.value
        : { events: [] },
    evidenceGraph:
      graphResult.status === "fulfilled"
        ? graphResult.value
        : null,
    optionalErrors: {
      timeline:
        timelineResult.status === "rejected"
          ? timelineResult.reason?.message
          : null,
      evidenceGraph:
        graphResult.status === "rejected"
          ? graphResult.reason?.message
          : null,
    },
  };
}

export async function getMemberData(projectId, memberId) {
  const [project, member, analysis, timeline] =
    await Promise.all([
      getProject(projectId),
      getMember(projectId, memberId),
      getLatestAnalysis(projectId),
      getMemberTimeline(projectId, memberId),
    ]);

  return {
    project,
    member,
    analysis,
    timeline,
  };
}

export async function getContributionAnalysis(projectId) {
  return request(() =>
    apiClient.get(`/projects/${projectId}/contributions`)
  );
}

export function getApiBaseUrl() {
  return baseURL;
}

const api = {
  createProject,
  getProject,
  analyzeProject,
  getMember,
  findMember,
  getLatestAnalysis,
  getAnalyses,
  getEvidenceGraph,
  getTaskEvidence,
  getTimeline,
  getMemberTimeline,
  generateTasks,
  matchTasksToMembers,
  explainProject,
  generateUnderstandingQuestions,
  evaluateUnderstanding,
  getDashboardData,
  getMemberData,
  getApiBaseUrl,
  getContributionAnalysis,
};

export default api;

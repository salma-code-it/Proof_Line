1. Architecture

Here is the complete architecture I'd use.

```
                    ┌──────────────┐
                    │   React UI   │
                    └──────┬───────┘
                           │
                           │ REST
                           ▼
                    ┌──────────────┐
                    │   FastAPI    │
                    │    API       │
                    └──────┬───────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
   GitHub Service    Evidence Engine   Report Service
          │                │                │
          │                │                │
          ▼                ▼                ▼
      GitHub API      Contribution      PDF/JSON
                          Engine
                           │
                           ▼
                     LLM Service
                           │
                           ▼
                    Explanations
```
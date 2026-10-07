from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict
BASE_DIR = Path(__file__).resolve().parent.parent
class Settings(BaseSettings):
    app_name: str = "ProofLine"
    database_url: str = f"sqlite:///{BASE_DIR / 'proofline.db'}"
    github_api_url: str = "https://api.github.com"
    github_token: str = ""
    openrouter_api_key: str = ""
    openrouter_model: str = "openai/gpt-4o-mini"
    openrouter_api_url: str = "https://openrouter.ai/api/v1"
    openrouter_referer: str = "http://localhost:3000"
    openrouter_title: str = "Proofline"
    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", env_file_encoding="utf-8", extra="ignore")
settings = Settings()

from pydantic import Field,SecretStr
from pydantic_settings import BaseSettings,SettingsConfigDict

class Settings(BaseSettings):
    model_config=SettingsConfigDict(env_prefix='MODERATION_',extra='ignore')
    database_path: str='/data/moderation.sqlite3'
    root_path: str=''
    allowed_origins: str=''
    llm_base_url: str='http://localhost:11434/v1'
    llm_model: str='qwen3.8:27b-mom-128k'
    llm_api_key: SecretStr=SecretStr('EMPTY')
    timeout_seconds: int=Field(default=100,ge=10,le=180)
    embedding_url: str=''
    embedding_model: str='BAAI/bge-m3'
    embedding_max_chars: int=6000
    similar_threshold: float=Field(default=0.94,ge=0.9,le=1)
    max_candidates: int=Field(default=3,ge=1,le=5)
    max_knowledge_scan: int=Field(default=2000,ge=1,le=10000)
    rate_per_minute: int=Field(default=6,ge=1,le=60)
    # Only explicitly selected tenants delegate base predictions to NarasiAhli.
    # Existing tenants retain their prior provider unless opted in.
    narasiahli_tenants: str=''
    narasiahli_api_base_url: str=''
    narasiahli_api_key: SecretStr=SecretStr('')
settings=Settings()

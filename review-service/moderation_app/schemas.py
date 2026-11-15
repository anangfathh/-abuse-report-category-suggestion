"""Strict, provider-independent contract for text policy triage."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator

class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)

class ClassificationRequest(StrictModel):
    platform: Literal['x'] = 'x'
    content: str = Field(min_length=1, max_length=8000)
    context: str = Field(default='', max_length=3000)

    @field_validator('content')
    @classmethod
    def not_blank(cls, value):
        if not value.strip():
            raise ValueError('content must not be blank')
        return value

class ModelFinding(StrictModel):
    rule_id: str = Field(min_length=3, max_length=100)
    assessment: Literal['violation', 'needs_review']
    evidence: list[str] = Field(min_length=1, max_length=3)
    rationale: str = Field(min_length=5, max_length=1200)

    @field_validator('evidence')
    @classmethod
    def bound_quotes(cls, value):
        if any(not x.strip() or len(x) > 400 for x in value):
            raise ValueError('Evidence must contain short non-empty exact quotes')
        return value

class ModelDecision(StrictModel):
    assessment: Literal['violation', 'no_violation', 'needs_review']
    explanation: str = Field(min_length=5, max_length=1600)
    findings: list[ModelFinding] = Field(default_factory=list, max_length=8)
    missing_context: list[str] = Field(default_factory=list, max_length=8)

    @field_validator('missing_context')
    @classmethod
    def bound_context(cls, value):
        if any(not x.strip() or len(x) > 300 for x in value):
            raise ValueError('Invalid missing context')
        return value

class Submission(ClassificationRequest):
    context_key: str = Field(default='',max_length=200)
    external_reference_id: str | None = Field(default=None,max_length=200)

class HumanDecision(StrictModel):
    expected_revision: int = Field(ge=1)
    pelanggaran: bool
    rule_ids: list[str] = Field(default_factory=list,max_length=8)
    rationale: str = Field(min_length=5,max_length=2000)
    verification_notes: str = Field(default='',max_length=3000)
    evidence_basis: Literal['text_only','external_evidence'] = 'external_evidence'
    reuse: Literal['none','exact','similar'] = 'exact'
    valid_for_hours: int = Field(default=24,ge=1,le=2160)

class RevokeRequest(StrictModel):
    reason: str = Field(min_length=5,max_length=1000)

class Equivalence(StrictModel):
    safe_to_reuse: bool
    same_intent: bool
    same_polarity: bool
    same_target_context: bool
    no_missing_facts: bool
    evidence: list[str] = Field(max_length=3)
    rationale: str = Field(min_length=5,max_length=1000)

from pydantic import BaseModel, Field


class SemanticStage(BaseModel):
    name: str = Field(..., min_length=1)
    objective: str = Field(..., min_length=1)
    evidence: list[str] = Field(default_factory=list)
    source_event_ids: list[str] = Field(default_factory=list)


class SessionSemanticAnalysis(BaseModel):
    inferred_goal: str = Field(..., min_length=1)
    desired_outcome: str = Field(..., min_length=1)
    applications: list[str] = Field(default_factory=list)
    artifacts: list[str] = Field(default_factory=list)
    stages: list[SemanticStage] = Field(..., min_length=1)
    uncertainties: list[str] = Field(default_factory=list)

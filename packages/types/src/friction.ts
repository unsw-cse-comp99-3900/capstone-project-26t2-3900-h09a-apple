export type FrictionAnalysisStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface FrictionEmployeeStepScore {
  employee_id: string;
  employee_email: string | null;
  completion_id: string;
  step_number: number;
  duration_ms: number;
  expected_duration_ms: number;
  retry_count: number;
  path_deviation_count: number;
  score: number;
  is_outlier: boolean;
}

export interface FrictionEmployeeSummary {
  employee_id: string;
  employee_email: string | null;
  average_score: number;
  highest_friction_step: number;
}

export interface FrictionStepAggregate {
  step_number: number;
  step_title: string | null;
  average_score: number;
  min_score: number;
  max_score: number;
  best_employee_id: string | null;
  best_employee_email: string | null;
  worst_employee_id: string | null;
  worst_employee_email: string | null;
  sample_size: number;
}

export interface FrictionAnalysisResponse {
  analysis_id: string;
  sop_id: string;
  status: FrictionAnalysisStatus;
  overall_score: number | null;
  highest_friction_step: number | null;
  employee_count: number;
  algorithm_version: string;
  error_message: string | null;
  triggered_at: string;
  started_at: string | null;
  completed_at: string | null;
  steps: FrictionStepAggregate[];
  employees: FrictionEmployeeSummary[];
  employee_step_scores: FrictionEmployeeStepScore[];
}

export interface FrictionAnalysisUpdate {
  event: 'friction_analysis.updated';
  analysis_id: string;
  sop_id: string;
  status: FrictionAnalysisStatus;
  overall_score: number | null;
  highest_friction_step: number | null;
  employee_count: number;
  completed_at: string | null;
}

export interface FrictionStepChartPoint {
  step_number: number;
  step_title: string | null;
  average_score: number;
  variance_flag: boolean;
}

export interface FrictionWorkflowSummary {
  workflow_id: string;
  title: string;
  status: FrictionAnalysisStatus | null;
  overall_score: number | null;
  session_count: number;
  high_variance: boolean;
  highest_friction_step: number | null;
  insight_teaser: string | null;
  insight_status: string;
  steps: FrictionStepChartPoint[];
}

export interface FrictionWorkflowListResponse {
  workflows: FrictionWorkflowSummary[];
}

export interface WorkflowInsightSummaryResponse {
  workflow_id: string;
  status: string;
  summary: string | null;
  teaser: string | null;
}

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
  instruction?: string | null;
  average_score: number;
  variance_flag: boolean;
}

export interface ClusterStepTiming {
  step_number: number;
  mean_duration_ms: number;
}

export interface ClusterTimingsCluster {
  cluster_id: number;
  member_count: number;
  steps: ClusterStepTiming[];
}

export interface WorkflowClusterTimingsResponse {
  workflow_id: string;
  workflow_name: string;
  best_cluster_id: number | null;
  clusters: ClusterTimingsCluster[];
  workflow_average: ClusterStepTiming[];
}

export interface ClusterSessionAssignment {
  session_id: string;
  sop_id: string;
  cluster_id: number;
  distance_to_centroid: number;
  is_high_variance: boolean;
}

export interface StepVarianceItem {
  step_number: number;
  semantic_variance: number;
}

/** Response from POST /api/v1/workflows/{workflow_name}/cluster (H09AAPPLE-36). */
export interface WorkflowClusterResponse {
  workflow_id: string;
  workflow_name: string;
  run_id: string;
  chosen_k: number;
  chosen_silhouette: number;
  silhouette_scores: Record<string, number>;
  high_variance_threshold: number;
  session_count: number;
  assignments: ClusterSessionAssignment[];
  step_variance: StepVarianceItem[];
  elapsed_ms: number;
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

export interface FrictionRecalculateResponse {
  workflow_id: string;
  analysis_id: string;
  status: string;
  overall_score: number | null;
  employee_count: number;
}

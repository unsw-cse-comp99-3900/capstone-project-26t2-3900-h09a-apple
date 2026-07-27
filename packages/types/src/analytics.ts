/** Request body for POST /api/v1/analytics/kmeans. */
export interface KmeansAnalysisRequest {
  workflow_id: string;
  k: number;
  min_sessions: number;
}

export interface KmeansCluster {
  cluster_id: number;
  size: number;
  centroid_values: Record<string, number>;
  member_session_ids: string[];
  member_employee_ids: string[];
  characteristics: string[];
}

export interface KmeansAssignment {
  session_id: string;
  employee_id: string;
  cluster_id: number;
  distance_to_center: number;
}

export interface KmeansOutlier {
  session_id: string;
  employee_id: string;
  cluster_id: number;
  distance_to_center: number;
  threshold: number;
  deviating_feature: string;
  feature_value: number;
  centroid_value: number;
  deviation: number;
  reason: string;
}

export interface KmeansAnalysisMetadata {
  session_count: number;
  feature_count: number;
  feature_names: string[];
  algorithm_version: string;
  computed_at: string;
  computation_time_ms: number;
  cached: boolean;
}

/** Response returned by the K-means analytics GET and POST endpoints. */
export interface KmeansAnalysisResponse {
  workflow_id: string;
  k: number;
  clusters: KmeansCluster[];
  assignments: KmeansAssignment[];
  outliers: KmeansOutlier[];
  silhouette_score: number | null;
  metadata: KmeansAnalysisMetadata;
}

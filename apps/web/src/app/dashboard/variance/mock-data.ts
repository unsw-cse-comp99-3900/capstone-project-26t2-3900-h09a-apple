/**
 * Stub variance payload for Manager market-test UI (H09AAPPLE-37+).
 *
 * Shaped like an early tenant that already ran H09AAPPLE-35 embeddings +
 * H09AAPPLE-36 clustering, plus walkthrough step_timings (H09AAPPLE-30).
 * Not wired to the API yet; keep this small and internally consistent.
 *
 * Semantic high-variance uses the same 0.25 cosine-distance threshold as
 * `HIGH_VARIANCE_THRESHOLD` in `apps/api/app/workflow_clustering.py`.
 */

export type WorkflowListItem = {
  id: string;
  title: string;
  aggregate_friction: number;
  session_count: number;
  high_variance: boolean;
  insight_teaser: string | null;
};

export type StepFriction = {
  step_number: number;
  friction_score: number;
  mean_time_ms: number;
  stddev: number;
  variance_flag: boolean;
  semantic_divergence: number;
  feedback_count: number;
  instruction: string;
};

export type PathCluster = {
  cluster_id: string;
  label: string;
  mean_time_per_step: number[];
};

export type WorkflowDetail = {
  id: string;
  title: string;
  aggregate_friction: number;
  session_count: number;
  path_count: number;
  high_variance: boolean;
  insight_summary: [string, string, string];
  steps: StepFriction[];
  clusters: PathCluster[];
  workflow_average: number[];
  best_cluster_id: string;
};

/** Matches apps/api workflow clustering. */
const SEMANTIC_HIGH_VARIANCE = 0.25;

/** Timing friction: mean * (1 + cv), then min-max scaled within the workflow. */
function rawFriction(meanMs: number, stddev: number): number {
  const cv = meanMs > 0 ? stddev / meanMs : 0;
  return meanMs * (1 + cv);
}

function scaleTo100(raw: number, minRaw: number, maxRaw: number): number {
  if (maxRaw <= minRaw) {
    return Math.round(Math.min(100, Math.max(0, raw > 0 ? 50 : 0)));
  }
  return Math.round(Math.min(100, Math.max(0, ((raw - minRaw) / (maxRaw - minRaw)) * 100)));
}

function buildSteps(
  rows: Array<{
    instruction: string;
    mean_time_ms: number;
    stddev: number;
    semantic_divergence: number;
    feedback_count: number;
  }>,
): StepFriction[] {
  const raws = rows.map((row) => rawFriction(row.mean_time_ms, row.stddev));
  const minRaw = Math.min(...raws);
  const maxRaw = Math.max(...raws);
  return rows.map((row, index) => {
    const friction_score = scaleTo100(raws[index]!, minRaw, maxRaw);
    return {
      step_number: index + 1,
      friction_score,
      mean_time_ms: row.mean_time_ms,
      stddev: row.stddev,
      variance_flag: row.semantic_divergence > SEMANTIC_HIGH_VARIANCE,
      semantic_divergence: row.semantic_divergence,
      feedback_count: row.feedback_count,
      instruction: row.instruction,
    };
  });
}

/**
 * Weighted workflow average from cluster means (session counts).
 * Keeps path chart + "best vs average" consistent with cluster lines.
 */
function weightedAverage(clusters: PathCluster[], sessionWeights: number[]): number[] {
  const stepCount = clusters[0]?.mean_time_per_step.length ?? 0;
  const total = sessionWeights.reduce((sum, n) => sum + n, 0) || 1;
  return Array.from({ length: stepCount }, (_, stepIndex) => {
    const sum = clusters.reduce((acc, cluster, clusterIndex) => {
      const weight = sessionWeights[clusterIndex] ?? 0;
      return acc + (cluster.mean_time_per_step[stepIndex] ?? 0) * weight;
    }, 0);
    return Math.round(sum / total);
  });
}

function aggregateFriction(steps: StepFriction[]): number {
  if (steps.length === 0) {
    return 0;
  }
  return Math.round(steps.reduce((sum, step) => sum + step.friction_score, 0) / steps.length);
}

function highestFrictionStep(steps: StepFriction[]): StepFriction {
  return steps.reduce((best, step) => (step.friction_score > best.friction_score ? step : best));
}

function buildDetail(input: {
  id: string;
  title: string;
  session_count: number;
  steps: StepFriction[];
  clusters: PathCluster[];
  session_weights: number[];
  best_cluster_id: string;
  insight_summary: [string, string, string];
}): WorkflowDetail {
  const workflow_average = weightedAverage(input.clusters, input.session_weights);
  return {
    id: input.id,
    title: input.title,
    aggregate_friction: aggregateFriction(input.steps),
    session_count: input.session_count,
    path_count: input.clusters.length,
    high_variance: input.steps.some((step) => step.variance_flag),
    insight_summary: input.insight_summary,
    steps: input.steps,
    clusters: input.clusters,
    workflow_average,
    best_cluster_id: input.best_cluster_id,
  };
}

// --- Early-tenant sample: 2 workflows, 5 + 3 published sessions (k=2) ---

const refundSteps = buildSteps([
  {
    instruction: 'Open the Orders queue from the left sidebar.',
    mean_time_ms: 3840,
    stddev: 620,
    semantic_divergence: 0.09,
    feedback_count: 0,
  },
  {
    instruction: 'Search for the order by customer email.',
    mean_time_ms: 11250,
    stddev: 4860,
    semantic_divergence: 0.37,
    feedback_count: 3,
  },
  {
    instruction: 'Select the matching order in the results table.',
    mean_time_ms: 2910,
    stddev: 410,
    semantic_divergence: 0.07,
    feedback_count: 0,
  },
  {
    instruction: 'Click Refund and choose Full refund.',
    mean_time_ms: 14120,
    stddev: 6720,
    semantic_divergence: 0.48,
    feedback_count: 5,
  },
  {
    instruction: 'Confirm the refund and wait for the success toast.',
    mean_time_ms: 5180,
    stddev: 1340,
    semantic_divergence: 0.16,
    feedback_count: 1,
  },
]);

const refundClusters: PathCluster[] = [
  {
    cluster_id: '0',
    label: 'Cluster 0 · guided (3 sessions)',
    mean_time_per_step: [3520, 7840, 2680, 9620, 4460],
  },
  {
    cluster_id: '1',
    label: 'Cluster 1 · explore-heavy (2 sessions)',
    mean_time_per_step: [4320, 16360, 3260, 20870, 6260],
  },
];

const passwordSteps = buildSteps([
  {
    instruction: 'Open Admin and open the employee profile.',
    mean_time_ms: 4120,
    stddev: 880,
    semantic_divergence: 0.11,
    feedback_count: 0,
  },
  {
    instruction: 'Click Reset password and complete identity checks.',
    mean_time_ms: 9870,
    stddev: 3120,
    semantic_divergence: 0.29,
    feedback_count: 2,
  },
  {
    instruction: 'Send the reset link on the approved channel.',
    mean_time_ms: 6340,
    stddev: 1510,
    semantic_divergence: 0.18,
    feedback_count: 1,
  },
]);

const passwordClusters: PathCluster[] = [
  {
    cluster_id: '0',
    label: 'Cluster 0 · known identity (2 sessions)',
    mean_time_per_step: [3680, 7420, 5210],
  },
  {
    cluster_id: '1',
    label: 'Cluster 1 · manual verify (1 session)',
    mean_time_per_step: [5000, 14770, 8600],
  },
];

function clipInstruction(text: string, max = 42): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

const refundHigh = highestFrictionStep(refundSteps);
const passwordHigh = highestFrictionStep(passwordSteps);

export const WORKFLOW_DETAILS: Record<string, WorkflowDetail> = {
  'wf-refund': buildDetail({
    id: 'wf-refund',
    title: 'Process a customer refund',
    session_count: 5,
    steps: refundSteps,
    clusters: refundClusters,
    session_weights: [3, 2],
    best_cluster_id: '0',
    insight_summary: [
      `Step ${refundHigh.step_number} ("${clipInstruction(refundHigh.instruction)}") is the timing bottleneck (${refundHigh.friction_score}/100).`,
      'Cluster 1 sits past the 0.25 semantic threshold on search and refund choice: same SOP, different click paths.',
      'Defaulting Full refund and a short note template would pull explore-heavy sessions toward Cluster 0.',
    ],
  }),
  'wf-password': buildDetail({
    id: 'wf-password',
    title: 'Reset an employee password',
    session_count: 3,
    steps: passwordSteps,
    clusters: passwordClusters,
    session_weights: [2, 1],
    best_cluster_id: '0',
    insight_summary: [
      `Step ${passwordHigh.step_number} drives most delay (${passwordHigh.friction_score}/100 friction).`,
      'Only one session needed manual identity verify; it alone crossed the high-variance threshold on that step.',
      'Surface the approved reset channel earlier so Cluster 1 does not reappear as volume grows.',
    ],
  }),
};

export const WORKFLOW_LIST: WorkflowListItem[] = Object.values(WORKFLOW_DETAILS)
  .map((detail) => {
    const teasers: Record<string, string | null> = {
      'wf-refund':
        'Search + refund choice diverge past the 0.25 semantic threshold (2 of 5 sessions).',
      // Still "generating"; useful for the empty-insight UI state with tiny seed data.
      'wf-password': null,
    };
    return {
      id: detail.id,
      title: detail.title,
      aggregate_friction: detail.aggregate_friction,
      session_count: detail.session_count,
      high_variance: detail.high_variance,
      insight_teaser: teasers[detail.id] ?? null,
    };
  })
  .sort((a, b) => b.aggregate_friction - a.aggregate_friction);

export function getWorkflowDetail(id: string): WorkflowDetail | null {
  return WORKFLOW_DETAILS[id] ?? null;
}

export function listSummary(list: WorkflowListItem[]) {
  const sessions = list.reduce((sum, item) => sum + item.session_count, 0);
  const avg =
    list.length === 0
      ? 0
      : Math.round(list.reduce((sum, item) => sum + item.aggregate_friction, 0) / list.length);
  const high = list.filter((item) => item.high_variance).length;
  return {
    workflowsTracked: list.length,
    sessionsAnalysed: sessions,
    avgFriction: avg,
    highVarianceWorkflows: high,
  };
}

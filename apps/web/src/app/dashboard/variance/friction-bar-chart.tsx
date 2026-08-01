'use client';

import type { FrictionStepChartPoint } from '@h09a/types';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type FrictionBarChartProps = {
  steps: FrictionStepChartPoint[];
  height?: number;
};

export function FrictionBarChart({ steps, height = 140 }: FrictionBarChartProps) {
  const data = steps.map((step) => ({
    key: `S${step.step_number}`,
    label: step.step_title?.trim() || `Step ${step.step_number}`,
    score: Number(step.average_score.toFixed(1)),
    variance: step.variance_flag,
  }));

  if (data.length === 0) {
    return <p style={{ margin: 0, color: '#64748b', fontSize: '0.88rem' }}>No step scores yet</p>;
  }

  return (
    <div style={{ width: '100%', height }} aria-label="Step friction bar chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
          <XAxis dataKey="key" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} />
          <YAxis
            domain={[0, 100]}
            width={28}
            tick={{ fontSize: 11, fill: '#64748b' }}
            axisLine={false}
          />
          <Tooltip
            formatter={(value: number) => [`${value}`, 'Friction']}
            labelFormatter={(_, payload) => {
              const point = payload?.[0]?.payload as { label?: string } | undefined;
              return point?.label ?? '';
            }}
          />
          <Bar dataKey="score" radius={[6, 6, 0, 0]}>
            {data.map((entry) => (
              <Cell key={entry.key} fill={entry.variance ? '#c2410c' : '#756eff'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

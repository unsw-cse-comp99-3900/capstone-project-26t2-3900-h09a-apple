-- Demo seed for H09AAPPLE-38 variance dashboard local testing.
-- Safe to re-run: deletes previous rows tagged with client_session_id / titles below.

BEGIN;

WITH doomed_sessions AS (
  SELECT id FROM sessions
  WHERE client_session_id IN (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3'
  )
)
DELETE FROM sops WHERE session_id IN (SELECT id FROM doomed_sessions);

DELETE FROM sessions
WHERE client_session_id IN (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3'
);

-- Resolve demo users in the default tenant.
CREATE TEMP TABLE demo_users AS
SELECT
  (SELECT id FROM users WHERE email = 'gyemployee@qq.com') AS employee_id,
  (SELECT id FROM users WHERE email = 'gyreviewer@qq.com') AS reviewer_id,
  (SELECT id FROM users WHERE email = 'gymanager@qq.com') AS manager_id,
  '22222222-2222-2222-2222-222222222222'::uuid AS tenant_id;

-- Three capture sessions (required FK for SOPs).
INSERT INTO sessions (
  id, client_session_id, tenant_id, recorded_by, workflow_name, status,
  started_at, stopped_at, event_count
)
SELECT
  gen_random_uuid(),
  sid,
  tenant_id,
  manager_id,
  name,
  'processed',
  now() - interval '3 days',
  now() - interval '3 days' + interval '20 minutes',
  12
FROM demo_users
CROSS JOIN (
  VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'::uuid, 'Expense claim'),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2'::uuid, 'New hire onboarding'),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3'::uuid, 'Vendor onboarding')
) AS w(sid, name);

-- Published SOPs with step metadata used by friction charts / insight teasers.
WITH sess AS (
  SELECT id, workflow_name, tenant_id
  FROM sessions
  WHERE client_session_id IN (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3'
  )
)
INSERT INTO sops (
  id, session_id, title, version, status, steps, warnings,
  generated_at, gen_duration_ms, tenant_id, generation_mode, published_at, embedding_status
)
SELECT
  gen_random_uuid(),
  s.id,
  s.workflow_name,
  1,
  'published',
  CASE s.workflow_name
    WHEN 'Expense claim' THEN $json$
      [
        {"order":1,"title":"Open expense form","instruction":"Click New Expense.","css_selector":"[data-testid='new-expense']","estimated_duration_seconds":20},
        {"order":2,"title":"Attach receipt","instruction":"Upload the receipt image.","css_selector":"input[type='file']","estimated_duration_seconds":45},
        {"order":3,"title":"Submit for approval","instruction":"Click Submit.","css_selector":"button[type='submit']","estimated_duration_seconds":15}
      ]
    $json$::jsonb
    WHEN 'New hire onboarding' THEN $json$
      [
        {"order":1,"title":"Create account","instruction":"Fill the new-hire form.","css_selector":"#hire-form","estimated_duration_seconds":60},
        {"order":2,"title":"Assign equipment","instruction":"Select laptop and badge.","css_selector":"[data-testid='equipment']","estimated_duration_seconds":40},
        {"order":3,"title":"Send welcome email","instruction":"Click Send welcome.","css_selector":"[aria-label='Send welcome']","estimated_duration_seconds":20},
        {"order":4,"title":"Confirm checklist","instruction":"Mark onboarding complete.","css_selector":"[data-testid='complete']","estimated_duration_seconds":25}
      ]
    $json$::jsonb
    ELSE $json$
      [
        {"order":1,"title":"Enter vendor details","instruction":"Fill legal name and tax ID.","css_selector":"#vendor-form","estimated_duration_seconds":50},
        {"order":2,"title":"Upload contract","instruction":"Attach the signed PDF.","css_selector":"input[type='file']","estimated_duration_seconds":35}
      ]
    $json$::jsonb
  END,
  '[]'::jsonb,
  now() - interval '2 days',
  1200,
  s.tenant_id,
  'fallback',
  now() - interval '2 days',
  'complete'
FROM sess s;

-- Walkthrough completions (needed for friction employee-step FK).
WITH demo AS (SELECT * FROM demo_users),
sop_rows AS (
  SELECT id, title, tenant_id FROM sops
  WHERE title IN ('Expense claim', 'New hire onboarding', 'Vendor onboarding')
)
INSERT INTO walkthrough_completions (
  id, tenant_id, sop_id, employee_id, completed_at, duration_seconds, step_sequence, user_role
)
SELECT
  gen_random_uuid(),
  d.tenant_id,
  s.id,
  u.employee_id,
  now() - (offs || ' hours')::interval,
  180 + offs * 10,
  '[]'::jsonb,
  'EMPLOYEE'
FROM demo d
CROSS JOIN sop_rows s
CROSS JOIN LATERAL (
  VALUES
    (d.employee_id),
    (d.reviewer_id)
) AS u(employee_id)
CROSS JOIN LATERAL (
  VALUES (1), (5)
) AS t(offs);

-- Completed friction analyses with ranked scores for the dashboard list.
WITH demo AS (SELECT * FROM demo_users),
sop_rows AS (
  SELECT id, title FROM sops
  WHERE title IN ('Expense claim', 'New hire onboarding', 'Vendor onboarding')
),
inserted_analysis AS (
  INSERT INTO friction_analysis (
    id, tenant_id, sop_id, status, overall_score, highest_friction_step,
    employee_count, algorithm_version, triggered_at, started_at, completed_at
  )
  SELECT
    gen_random_uuid(),
    d.tenant_id,
    s.id,
    'completed',
    CASE s.title
      WHEN 'Expense claim' THEN 86.50
      WHEN 'New hire onboarding' THEN 61.00
      ELSE 34.25
    END,
    CASE s.title
      WHEN 'Expense claim' THEN 2
      WHEN 'New hire onboarding' THEN 3
      ELSE 1
    END,
    2,
    'friction-v1',
    now() - interval '1 day',
    now() - interval '1 day' + interval '1 minute',
    now() - interval '1 day' + interval '2 minutes'
  FROM demo d
  CROSS JOIN sop_rows s
  RETURNING id, sop_id
)
INSERT INTO friction_step_aggregates (
  analysis_id, step_number, average_score, min_score, max_score,
  best_employee_id, worst_employee_id, sample_size
)
SELECT
  a.id,
  step_number,
  average_score,
  min_score,
  max_score,
  d.employee_id,
  d.reviewer_id,
  2
FROM inserted_analysis a
JOIN sops s ON s.id = a.sop_id
CROSS JOIN demo d
CROSS JOIN LATERAL (
  SELECT * FROM (
    VALUES
      -- Expense claim (high friction, step 2 flagged later)
      ('Expense claim', 1, 55.00, 40.00, 70.00),
      ('Expense claim', 2, 94.00, 88.00, 100.00),
      ('Expense claim', 3, 72.00, 60.00, 84.00),
      -- Onboarding (medium)
      ('New hire onboarding', 1, 40.00, 30.00, 50.00),
      ('New hire onboarding', 2, 58.00, 45.00, 70.00),
      ('New hire onboarding', 3, 78.00, 65.00, 90.00),
      ('New hire onboarding', 4, 48.00, 35.00, 60.00),
      -- Vendor (low)
      ('Vendor onboarding', 1, 38.00, 30.00, 46.00),
      ('Vendor onboarding', 2, 30.00, 22.00, 38.00)
  ) AS v(title, step_number, average_score, min_score, max_score)
) steps
WHERE steps.title = s.title;

-- Per-employee step scores; mark one outlier on Expense claim step 2 for HIGH VARIANCE.
WITH demo AS (SELECT * FROM demo_users),
analysis AS (
  SELECT fa.id AS analysis_id, fa.sop_id, s.title
  FROM friction_analysis fa
  JOIN sops s ON s.id = fa.sop_id
  WHERE s.title IN ('Expense claim', 'New hire onboarding', 'Vendor onboarding')
    AND fa.status = 'completed'
),
completions AS (
  SELECT DISTINCT ON (wc.sop_id, wc.employee_id)
    wc.id AS completion_id, wc.sop_id, wc.employee_id
  FROM walkthrough_completions wc
  JOIN sops s ON s.id = wc.sop_id
  WHERE s.title IN ('Expense claim', 'New hire onboarding', 'Vendor onboarding')
  ORDER BY wc.sop_id, wc.employee_id, wc.completed_at DESC
)
INSERT INTO friction_employee_step_scores (
  analysis_id, employee_id, completion_id, step_number,
  duration_ms, expected_duration_ms, retry_count, path_deviation_count, score, is_outlier
)
SELECT
  a.analysis_id,
  c.employee_id,
  c.completion_id,
  step_number,
  duration_ms,
  expected_duration_ms,
  retry_count,
  path_deviation_count,
  score,
  is_outlier
FROM analysis a
JOIN completions c ON c.sop_id = a.sop_id
CROSS JOIN LATERAL (
  SELECT * FROM (
    VALUES
      ('Expense claim', 1, 25000, 20000, 0, 0, 52.00, false),
      ('Expense claim', 2, 120000, 45000, 3, 2, 96.00, true),
      ('Expense claim', 3, 22000, 15000, 1, 0, 70.00, false),
      ('New hire onboarding', 1, 70000, 60000, 0, 0, 42.00, false),
      ('New hire onboarding', 2, 50000, 40000, 1, 0, 60.00, false),
      ('New hire onboarding', 3, 90000, 20000, 2, 1, 80.00, false),
      ('New hire onboarding', 4, 30000, 25000, 0, 0, 50.00, false),
      ('Vendor onboarding', 1, 40000, 50000, 0, 0, 36.00, false),
      ('Vendor onboarding', 2, 28000, 35000, 0, 0, 28.00, false)
  ) AS v(title, step_number, duration_ms, expected_duration_ms, retry_count, path_deviation_count, score, is_outlier)
) scores
WHERE scores.title = a.title
  -- Only flag outlier on the employee user to keep one HIGH VARIANCE workflow.
  AND (scores.is_outlier = false OR c.employee_id = (SELECT employee_id FROM demo));

COMMIT;

-- Quick verification
SELECT s.title, fa.status, fa.overall_score, fa.employee_count, fa.highest_friction_step
FROM sops s
JOIN friction_analysis fa ON fa.sop_id = s.id
WHERE s.title IN ('Expense claim', 'New hire onboarding', 'Vendor onboarding')
ORDER BY fa.overall_score DESC;

SELECT s.title, fsa.step_number, fsa.average_score,
       EXISTS (
         SELECT 1 FROM friction_employee_step_scores fes
         WHERE fes.analysis_id = fsa.analysis_id
           AND fes.step_number = fsa.step_number
           AND fes.is_outlier
       ) AS has_outlier
FROM friction_step_aggregates fsa
JOIN friction_analysis fa ON fa.id = fsa.analysis_id
JOIN sops s ON s.id = fa.sop_id
WHERE s.title IN ('Expense claim', 'New hire onboarding', 'Vendor onboarding')
ORDER BY s.title, fsa.step_number;

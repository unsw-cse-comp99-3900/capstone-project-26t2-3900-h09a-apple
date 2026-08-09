# AWS ECS continuous deployment

The `deploy-api` job in `.github/workflows/ci.yml` deploys the API after every
successful push to `main`. It builds an immutable image tagged with the Git
commit SHA, pushes it to ECR, runs Alembic as a one-off ECS task, updates the
service, waits for the rollout, and verifies the health endpoint.

## One-time AWS OIDC setup

Create an IAM OIDC identity provider if the account does not already have one:

- Provider URL: `https://token.actions.githubusercontent.com`
- Audience: `sts.amazonaws.com`

Create an IAM role named `GitHubActionsWorkTraceDeploy` with this trust policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::611651385140:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:unsw-cse-comp99-3900/capstone-project-26t2-3900-h09a-apple:environment:production"
        }
      }
    }
  ]
}
```

Attach this permissions policy to the role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EcrAuthentication",
      "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken",
      "Resource": "*"
    },
    {
      "Sid": "PushApiImages",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:BatchGetImage",
        "ecr:CompleteLayerUpload",
        "ecr:GetDownloadUrlForLayer",
        "ecr:InitiateLayerUpload",
        "ecr:PutImage",
        "ecr:UploadLayerPart"
      ],
      "Resource": "arn:aws:ecr:ap-southeast-2:611651385140:repository/worktrace-api"
    },
    {
      "Sid": "DeployApiService",
      "Effect": "Allow",
      "Action": [
        "ecs:DescribeServices",
        "ecs:DescribeTaskDefinition",
        "ecs:DescribeTasks",
        "ecs:RegisterTaskDefinition",
        "ecs:RunTask",
        "ecs:UpdateService"
      ],
      "Resource": "*"
    },
    {
      "Sid": "PassTaskExecutionRole",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "arn:aws:iam::611651385140:role/ecsTaskExecutionRole"
    },
    {
      "Sid": "ReadMigrationLogs",
      "Effect": "Allow",
      "Action": "logs:GetLogEvents",
      "Resource": "arn:aws:logs:ap-southeast-2:611651385140:log-group:/ecs/worktrace-api:*"
    }
  ]
}
```

## One-time GitHub setup

In the repository, open `Settings`, `Environments`, and `production`. Add an
environment secret named `AWS_DEPLOY_ROLE_ARN` with this value:

```text
arn:aws:iam::611651385140:role/GitHubActionsWorkTraceDeploy
```

Required reviewers on the `production` environment make deployment
approval-based instead of fully automatic. Remove that rule only if unattended
production deployment is intended.

## Deployment behavior

The workflow deliberately does not cancel an in-progress `main` workflow. A
newer main push waits rather than interrupting a database migration or ECS
rollout. Pull requests run tests only and never receive AWS credentials.

If migration fails, the ECS service remains on the previous task definition.
If service deployment fails, ECS retains its normal deployment rollback and
circuit-breaker behavior configured on the service.

# Auth Email Runbook

## Overview

WorkTrace uses transactional email for password reset. Local and CI environments use the mock email sender by default. Staging and production should use AWS SES.

Password reset emails contain both HTML and plain-text bodies. Reset links are single-use and expire after 30 minutes. Completing a reset revokes the user's existing refresh tokens.

Google-linked users can also use forgot password to set a password for their WorkTrace account.

## Required Environment Variables

Local and CI:

```env
APP_ENV=local
WEB_BASE_URL=http://localhost:3000
EMAIL_PROVIDER=mock
```

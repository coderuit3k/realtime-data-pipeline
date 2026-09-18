# Infra bootstrap

## Step 0 -- create a local-dev IAM user (one-time, via the AWS Console)

Nothing in this repo can create your *first* AWS identity -- that needs your
account's root login once. After this, you never use root again.

1. Sign in to the [AWS Console](https://console.aws.amazon.com/) with your
   root account (email + password used to create the AWS account).
2. Go to **IAM -> Policies -> Create policy**, switch to the **JSON** tab, and
   paste the contents of [`local-dev-policy.json`](local-dev-policy.json).
   Name it e.g. `data-pipeline-local-dev`. (It's broad-but-service-scoped --
   covers every service this project touches, not `AdministratorAccess`.)
3. Go to **IAM -> Users -> Create user**, name it e.g. `data-pipeline-local-dev`,
   skip console access (this user is CLI/Terraform-only), and attach the
   policy you just created.
4. Open the new user -> **Security credentials** tab -> **Create access key**
   -> use case **Command Line Interface (CLI)** -> create, then download the
   `.csv`. This is the only time the secret key is shown.
5. On your machine (**not** in this chat -- never paste secret keys into a
   chat with an AI):
   ```bash
   aws configure
   # AWS Access Key ID: <from the csv>
   # AWS Secret Access Key: <from the csv>
   # Default region: us-east-1
   # Default output format: json
   ```
6. Verify:
   ```bash
   aws sts get-caller-identity
   ```
   should print that user's ARN.
7. (Optional, recommended) Turn on MFA on the root account and lock its
   access keys away -- you now do everything through this IAM user instead.

Once this works, `terraform apply` in `infra-bootstrap/` and `infra/` uses
these same local credentials.

## GitHub OIDC deploy role

Creates the IAM OIDC provider + role that `.github/workflows/deploy.yml` assumes
to reach AWS -- no long-lived AWS access keys stored in GitHub.

Applied **once, manually, with your own AWS credentials** (the IAM user from
Step 0) -- not by CI itself (CI needs this role to exist before it can run, so
it can't create it).

```bash
cd infra-bootstrap
terraform init
terraform apply -var="github_org=<your-github-username-or-org>" -var="github_repo=<repo-name>"
```

Take the `role_arn` output and set it as a repo secret:

```bash
gh secret set AWS_DEPLOY_ROLE_ARN --body "<role_arn output>"
```

Also set the `AWS_REGION` repo/environment **variable** (Settings -> Secrets and
variables -> Actions -> Variables) if you're not using `us-east-1`, and create a
`production` environment (Settings -> Environments) with a required reviewer so
every `terraform apply` in `deploy.yml` needs a manual approval.

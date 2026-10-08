#!/usr/bin/env bash
set -euo pipefail

script_dir="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
cd "$script_dir"

private_plan_dir="$(mktemp -d)"
cleanup() {
  rm -f -- "$private_plan_dir/plan.json" "$private_plan_dir/reviewed.tfplan"
  rmdir -- "$private_plan_dir"
}
trap cleanup EXIT

terraform plan -input=false -var-file=main.tfvars -out="$private_plan_dir/reviewed.tfplan"
terraform show -json "$private_plan_dir/reviewed.tfplan" > "$private_plan_dir/plan.json"
"$script_dir/../node_modules/.bin/agent-tool" dependencies check-terraform-plan "$private_plan_dir/plan.json"
terraform show "$private_plan_dir/reviewed.tfplan"

printf 'After reviewing the plan, type APPLY to continue: '
IFS= read -r approval
if [[ "$approval" != APPLY ]]; then
  echo 'Terraform apply held.' >&2
  exit 1
fi

terraform apply "$private_plan_dir/reviewed.tfplan"

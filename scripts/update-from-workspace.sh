#!/usr/bin/env bash
set -euo pipefail

fail() { printf '%s\n' "$*" >&2; exit 1; }
[[ $# == 2 ]] || fail "Usage: bash update-from-workspace.sh SOURCE DESTINATION"
source=$(realpath -e -- "$1")
destination=$(realpath -e -- "$2")
[[ -d "$source/.git" && ! -L "$source/.git" && -d "$destination" ]] || fail "Expected a standalone source repository and an existing destination."
[[ "$source" != "$destination" && "$destination" != "$source/"* && "$source" != "$destination/"* ]] || fail "Source and destination must be separate directories."
reference=$(realpath -m -- "$source/../hapi_original")
[[ "$destination" != "$reference" && "$destination" != "$reference/"* && "$destination" != /workspace/hapi_original && "$destination" != /workspace/hapi_original/* ]] || fail "The reference project is read-only."
[[ "$(git -C "$source" rev-parse --show-toplevel)" == "$source" ]] || fail "Source must be the repository root."
[[ "$(git -C "$source" rev-parse --is-shallow-repository)" == false ]] || fail "Complete the source Git history before copying it."
[[ ! -s "$source/.git/objects/info/alternates" && ! -e "$source/.git/index.lock" ]] || fail "Source Git must be self-contained and unlocked."
status=$(git -C "$source" status --porcelain)
[[ -z "$status" ]] || fail "Commit source changes before updating the destination."
revision=$(git -C "$source" rev-parse HEAD)
[[ ! -e "$destination/.git" || ( -d "$destination/.git" && ! -L "$destination/.git" ) ]] || fail "Destination Git must be a directory."
for file in Dockerfile docker-compose.yml; do
    [[ -f "$source/$file" && -f "$destination/$file" ]] || fail "Missing required file: $file"
done
mapfile -d '' -t files < <(git -C "$source" ls-files -z)
(( ${#files[@]} > 0 )) || fail "No tracked source files."
for file in "${files[@]}"; do
    case "$file" in
        .env.example|*/.env.example) ;;
        data/*|.tools/*|.git/*|node_modules/*|*/node_modules/*|dist/*|*/dist/*|dist-exe/*|*/dist-exe/*|.env|.env.*|*/.env|*/.env.*)
            fail "Runtime or secret file is tracked: $file" ;;
    esac
    [[ -f "$source/$file" || -L "$source/$file" ]] || fail "Missing source file: $file"
    # Existing directory symlinks must not redirect writes outside the target.
    IFS=/ read -r -a parts <<< "$file"
    parent="$destination"
    for (( i=0; i<${#parts[@]}-1; i++ )); do
        parent="$parent/${parts[i]}"
        [[ ! -L "$parent" ]] || fail "Destination parent is a symlink: $parent"
    done
done

umask 077
staging=$(mktemp -d "$(dirname "$destination")/.hapi-git-next.XXXXXX")
trap 'rm -rf -- "$staging"' EXIT
cp -a -- "$source/.git" "$staging/git"
[[ "$(git --git-dir="$staging/git" rev-parse HEAD)" == "$revision" && "$(git -C "$source" rev-parse HEAD)" == "$revision" ]] || fail "Source history changed during preparation."

cd "$destination"
docker compose config --quiet
docker compose down
(
    cd "$source"
    cp -a --parents --remove-destination -- "${files[@]}" "$destination/"
)
if [[ -d "$destination/.git" ]]; then
    backup=$(mktemp -d "$(dirname "$destination")/.hapi-git-backup.XXXXXX")
    mv -- "$destination/.git" "$backup/git"
    printf 'Previous destination Git retained at: %s/git\n' "$backup"
fi
mv -- "$staging/git" "$destination/.git"
docker compose up -d --build
printf 'Updated to source commit %s\n' "$revision"

#!/bin/bash
# Pure helpers for Lalia blue-green release deployments and rollback.

select_inactive_slot() {
  local conf_path="$1"
  local active_port="3101"
  if [ -f "$conf_path" ]; then
    local parsed
    parsed="$(grep -Eo '127\.0\.0\.1:(3101|3102)' "$conf_path" 2>/dev/null | head -n1 | cut -d: -f2 || true)"
    if [ "$parsed" = "3101" ] || [ "$parsed" = "3102" ]; then
      active_port="$parsed"
    fi
  fi

  if [ "$active_port" = "3101" ]; then
    echo "green 3102 lalia-backend-green 3101 lalia-backend-blue"
  else
    echo "blue 3101 lalia-backend-blue 3102 lalia-backend-green"
  fi
}

write_upstream_conf() {
  local conf_path="$1"
  local port="$2"
  local dir_path
  dir_path="$(dirname "$conf_path")"
  mkdir -p "$dir_path"
  local tmp_file="${conf_path}.tmp.$$"
  cat >"$tmp_file" <<EOF
upstream lalia_backend {
    server 127.0.0.1:${port};
    keepalive 32;
}
EOF
  mv -f "$tmp_file" "$conf_path"
}

wait_for_slot_health() {
  local port="$1"
  local max_attempts="${2:-60}"
  local sleep_sec="${3:-1}"
  local required_consecutive="${4:-3}"
  local host="${5:-127.0.0.1}"

  local consecutive=0
  local attempt=1
  while [ "$attempt" -le "$max_attempts" ]; do
    local c1 c2 c3
    c1="$(curl --connect-timeout 2 --max-time 5 -sS -o /dev/null -w '%{http_code}' "http://${host}:${port}/api/health" 2>/dev/null || true)"
    c2="$(curl --connect-timeout 2 --max-time 5 -sS -o /dev/null -w '%{http_code}' "http://${host}:${port}/api/v2/health" 2>/dev/null || true)"
    c3="$(curl --connect-timeout 2 --max-time 5 -sS -o /dev/null -w '%{http_code}' "http://${host}:${port}/api/v2/support/health" 2>/dev/null || true)"
    [ -z "$c1" ] && c1="000"
    [ -z "$c2" ] && c2="000"
    [ -z "$c3" ] && c3="000"
    if [ "$c1" = "200" ] && [ "$c2" = "200" ] && [ "$c3" = "200" ]; then
      consecutive=$((consecutive + 1))
      if [ "$consecutive" -ge "$required_consecutive" ]; then
        return 0
      fi
    else
      consecutive=0
    fi
    sleep "$sleep_sec"
    attempt=$((attempt + 1))
  done

  echo "Health gate failed for ${host}:${port} after ${max_attempts} attempts (last: /api/health=${c1:-000}, /api/v2/health=${c2:-000}, /api/v2/support/health=${c3:-000})" >&2
  return 1
}

atomic_swap_symlink() {
  local target_dir="$1"
  local link_path="$2"
  local tmp_link="${link_path}.tmp.$$"
  ln -sfn "$target_dir" "$tmp_link"
  if [ "$(uname -s)" = "Linux" ]; then
    mv -Tf "$tmp_link" "$link_path"
  else
    rm -f "$tmp_link"
    ln -sfn "$target_dir" "$link_path"
  fi
}

carry_forward_hashed_assets() {
  local releases_dir="$1"
  local new_frontend_dir="$2"
  local legacy_frontend_dir="${3:-}"
  local max_prev_releases="${4:-4}"

  local new_assets="${new_frontend_dir}/assets"
  mkdir -p "$new_assets"
  local self_release_dir
  self_release_dir="$(cd -P "$(dirname "$(dirname "$new_frontend_dir")")" 2>/dev/null && pwd -P || true)"

  if [ -d "$releases_dir" ]; then
    local carried=0
    while IFS= read -r rel_name; do
      [ -z "$rel_name" ] && continue
      local rel_path="${releases_dir}/${rel_name}"
      [ -d "$rel_path" ] || continue
      local rel_real
      rel_real="$(cd -P "$rel_path" 2>/dev/null && pwd -P || true)"
      [ "$rel_real" = "$self_release_dir" ] && continue

      local prev_frontend="${rel_path}/livekit-app/frontend"
      local prev_assets="${prev_frontend}/assets"
      if [ -d "$prev_assets" ]; then
        if [ -f "${prev_frontend}/.own-assets-manifest" ]; then
          while IFS= read -r fname; do
            [ -z "$fname" ] && continue
            if [ -f "${prev_assets}/${fname}" ] && [ ! -e "${new_assets}/${fname}" ]; then
              cp -p "${prev_assets}/${fname}" "${new_assets}/${fname}" 2>/dev/null || true
            fi
          done < "${prev_frontend}/.own-assets-manifest"
        else
          rsync -a --ignore-existing "${prev_assets}/" "${new_assets}/" >/dev/null 2>&1 || true
        fi
        carried=$((carried + 1))
        if [ "$carried" -ge "$max_prev_releases" ]; then
          break
        fi
      fi
    done < <(ls -1 "$releases_dir" 2>/dev/null | LC_ALL=C sort -r)
  fi

  if [ -n "$legacy_frontend_dir" ] && [ -d "${legacy_frontend_dir}/assets" ]; then
    local legacy_real
    legacy_real="$(cd -P "$(dirname "$(dirname "$legacy_frontend_dir")")" 2>/dev/null && pwd -P || true)"
    if [ "$legacy_real" != "$self_release_dir" ]; then
      rsync -a --ignore-existing "${legacy_frontend_dir}/assets/" "${new_assets}/" >/dev/null 2>&1 || true
    fi
  fi
}

prune_old_releases() {
  local releases_dir="$1"
  local current_link="$2"
  local keep_count="${3:-5}"

  [ -d "$releases_dir" ] || return 0
  local current_real=""
  if [ -L "$current_link" ] || [ -d "$current_link" ]; then
    current_real="$(cd -P "$current_link" 2>/dev/null && pwd -P || true)"
  fi

  local idx=0
  while IFS= read -r rel_name; do
    [ -z "$rel_name" ] && continue
    local rel_path="${releases_dir}/${rel_name}"
    [ -d "$rel_path" ] || continue
    idx=$((idx + 1))
    if [ "$idx" -le "$keep_count" ]; then
      continue
    fi
    local rel_real
    rel_real="$(cd -P "$rel_path" 2>/dev/null && pwd -P || true)"
    if [ -n "$current_real" ] && [ "$rel_real" = "$current_real" ]; then
      continue
    fi
    rm -rf "$rel_path"
  done < <(ls -1 "$releases_dir" 2>/dev/null | LC_ALL=C sort -r)
}

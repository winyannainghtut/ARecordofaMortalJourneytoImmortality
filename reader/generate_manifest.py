from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT_PATH = Path(__file__).resolve().parent / "manifest.json"

SOURCE_ORDER = ["eng-episodes", "burmese-episodes"]


def main() -> None:
  check_only = parse_args()
  payload = build_manifest_payload()

  if check_only:
    check_manifest(payload)
    return

  OUTPUT_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
  print(f"Manifest written: {OUTPUT_PATH}")
  print(f"Sources indexed: {', '.join(payload['sources']) or '(none)'}")
  print(f"Episodes indexed: {payload['totalEntries']}")


def parse_args() -> bool:
  args = sys.argv[1:]
  if args == ["--check"]:
    return True
  if not args:
    return False
  raise SystemExit("Usage: python reader/generate_manifest.py [--check]")


def build_manifest_payload() -> dict:
  sources = discover_sources()
  if not sources:
    raise SystemExit(
      "No source directories found. Expected eng-episodes/ or burmese-episodes/ at the repo root."
    )

  entries = []

  for source_rank, source in enumerate(sources):
    source_dir = source["directory"]
    source_label = source["label"]

    for markdown_file in source_dir.rglob("*.md"):
      relative_to_source = markdown_file.relative_to(source_dir)
      relative_to_root = markdown_file.relative_to(ROOT).as_posix()
      episode_number = extract_episode_number(markdown_file.stem)
      group = relative_to_source.parts[0] if len(relative_to_source.parts) > 1 else ""

      entries.append(
        {
          "id": relative_to_root,
          "sourceLabel": source_label,
          "path": relative_to_root,
          "group": group,
          "title": build_title(markdown_file.stem),
          "episode": episode_number,
          "_sourceRank": source_rank,
          "_episodeRank": episode_number if episode_number is not None else 10**12,
          "_pathRank": relative_to_source.as_posix().lower(),
        }
      )

  if not entries:
    raise SystemExit(
      "No markdown episodes found in the discovered source directories. Nothing to index."
    )

  entries.sort(key=lambda item: (item["_sourceRank"], item["_episodeRank"], item["_pathRank"]))

  for entry in entries:
    entry.pop("_sourceRank", None)
    entry.pop("_episodeRank", None)
    entry.pop("_pathRank", None)

  return {
    "generatedAt": datetime.now(timezone.utc).isoformat(),
    "totalEntries": len(entries),
    "sources": [item["label"] for item in sources],
    "entries": entries,
  }


def check_manifest(expected: dict) -> None:
  if not OUTPUT_PATH.exists():
    raise SystemExit(f"Manifest is missing: {OUTPUT_PATH}")

  try:
    current = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
  except json.JSONDecodeError as exc:
    raise SystemExit(f"Manifest is not valid JSON: {exc}") from exc

  current_comparable = comparable_manifest(current)
  expected_comparable = comparable_manifest(expected)
  if current_comparable == expected_comparable:
    print(f"Manifest is up to date: {OUTPUT_PATH}")
    return

  current_count = current.get("totalEntries", "unknown") if isinstance(current, dict) else "unknown"
  expected_count = expected["totalEntries"]
  raise SystemExit(
    "Manifest is stale. "
    f"Expected {expected_count} indexed episodes, found {current_count}. "
    "Run `python reader/generate_manifest.py`."
  )


def comparable_manifest(payload: dict) -> dict:
  if not isinstance(payload, dict):
    return {}
  return {
    "totalEntries": payload.get("totalEntries"),
    "sources": payload.get("sources"),
    "entries": payload.get("entries"),
  }


def discover_sources() -> list[dict[str, Path | str]]:
  discovered = []
  label_map = {
    "eng-episodes": "English",
    "burmese-episodes": "Burmese",
  }

  for canonical in SOURCE_ORDER:
    source_dir = pick_source_dir(canonical)
    if source_dir is not None:
      discovered.append({"label": label_map.get(canonical, canonical), "directory": source_dir})

  return discovered


def pick_source_dir(canonical_name: str) -> Path | None:
  for child in ROOT.iterdir():
    if child.is_dir() and child.name.lower() == canonical_name.lower():
      return child

  return None


def extract_episode_number(stem: str) -> int | None:
  match = re.search(r"(\d+)", stem)
  return int(match.group(1)) if match else None


def build_title(stem: str) -> str:
  normalized = stem.removesuffix("_eng")
  episode = extract_episode_number(normalized)

  if episode is not None and re.fullmatch(r"\d+", normalized):
    return f"Episode {episode}"

  clean = re.sub(r"[_-]+", " ", normalized).strip()
  return clean.title() if clean else stem


if __name__ == "__main__":
  main()

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT_PATH = Path(__file__).resolve().parent / "manifest.json"

SOURCE_ORDER = ["Eng", "Episodes"]


def main() -> None:
  sources = discover_sources()
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

  entries.sort(key=lambda item: (item["_sourceRank"], item["_episodeRank"], item["_pathRank"]))

  for entry in entries:
    entry.pop("_sourceRank", None)
    entry.pop("_episodeRank", None)
    entry.pop("_pathRank", None)

  payload = {
    "generatedAt": datetime.now(timezone.utc).isoformat(),
    "totalEntries": len(entries),
    "sources": [item["label"] for item in sources],
    "entries": entries,
  }

  OUTPUT_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
  print(f"Manifest written: {OUTPUT_PATH}")
  print(f"Sources indexed: {', '.join(payload['sources']) or '(none)'}")
  print(f"Chapters indexed: {payload['totalEntries']}")


def discover_sources() -> list[dict[str, Path | str]]:
  discovered = []

  for label in SOURCE_ORDER:
    source_dir = pick_source_dir(label)
    if source_dir is not None:
      discovered.append({"label": label, "directory": source_dir})

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

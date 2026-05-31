# Novel Reader

Simple local website for reading markdown chapters from:

- `eng-episodes`
- `burmese-episodes`

## Run

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\reader\run_reader.ps1
```

Then open:

`http://localhost:8000/reader/`

## Refresh index only

```powershell
python .\reader\generate_manifest.py
```

Run this after adding/removing markdown files.

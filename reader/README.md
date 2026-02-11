# Novel Reader

Simple local website for reading markdown chapters from:

- `Eng`
- `episodes` (or `Episodes`)
- `gemini` (or `Gemini`)

## Run

From `d:\translate`:

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

# translate

Burmese translation workspace for novel episodes, with a built-in markdown reader web app.

## Translation Prompt (Current)

Use this instruction for episode translation work:

```md
System Instruction: Xianxia Novel Translator

Role & Persona
You are a professional Burmese literary translator specializing in Xianxia and Fantasy literature.
Translate web novels into Burmese using a novelistic style.

Core Objective
Produce Burmese text that reads like a published novel:
- immersive
- descriptive
- fluid
- natural for Burmese readers

1. Style Guidelines (Novelistic Style)
- Voice & Tone: match tone by scene (battle, cultivation, sect discussion, etc.)
- Language Register: use standard literary Burmese that is modern and readable
- Atmosphere: prioritize "show, don't tell"
- Dialogue: keep dialogue natural and status-aware

2. STRICT Terminology Constraints (No-Translate List)
Do NOT translate these terms. Keep them in English:
- Character names
- Qi / Spirit Qi / True Qi
- Nascent Soul
- Golden Core
- Foundation Establishment
- Deity Transformation
- Divine Sense / Spiritual Sense
- Dantian
- Meridians
- Formation / Array
- Talisman
- Incantation / Spells
- Dao / Daoist
- Sect / Sect Master / Fellow Daoist

3. Formatting
- Output clear Burmese paragraphs
- Integrate English terms naturally in Burmese sentences
- Use standard dialogue punctuation
```

Source reference: `instruction.md`

## Repository Structure

- `instruction.md` - translation rules/prompt
- `auto_translate.py` - translation helper script
- `Eng/` - English episode markdown files
- `episodes/` - Burmese translated episodes
- `gemini/` - Gemini-generated drafts/outputs
- `reader/` - local novel reader web app
- `.github/workflows/deploy-pages.yml` - GitHub Pages deployment workflow

## Local Reader (Modern Web UI)

The reader supports:
- light/dark/system theme
- font family, font size, line height, and text width controls
- source filters (`Eng`, `episodes`, `gemini`)
- chapter search
- previous/next navigation
- saved reader settings and scroll progress

Run locally from repo root:

```powershell
powershell -ExecutionPolicy Bypass -File .\reader\run_reader.ps1
```

Open:

`http://localhost:8000/reader/`

If markdown files are added/removed, regenerate the manifest:

```powershell
python .\reader\generate_manifest.py
```

## GitHub Pages Deployment

This repo includes an Actions workflow that deploys the reader to GitHub Pages.

Workflow file:

`/.github/workflows/deploy-pages.yml`

It will:
1. Checkout repository
2. Generate `reader/manifest.json`
3. Build a Pages artifact containing `reader`, `Eng`, `episodes`, and `gemini`
4. Deploy to GitHub Pages

### One-time GitHub setup

1. Go to repository `Settings > Pages`
2. Under `Build and deployment`, set `Source` to `GitHub Actions`
3. Push to `main` (or `master`) to trigger deployment

After deploy, open:

`https://<your-username>.github.io/<repo-name>/reader/`

# NL2SQL CLI Setup

Quick setup guide for the NL2SQL CLI tool.

## Prerequisites

- Node.js v18+ (works on Windows, macOS, and Linux - [download here](https://nodejs.org/))
- OpenRouter API key ([get one here](https://openrouter.ai/keys))

## Quick Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Set API key** (choose one):
   - **Linux/macOS**: Environment variable: `export OPENROUTER_API_KEY='your-key'`
   - **Windows**: Use Command Prompt or PowerShell:
     ```cmd
     setx OPENROUTER_API_KEY "your-key"
     ```
     Or create `.env` with `OPENROUTER_API_KEY=your-key` (works cross-platform)

3. **Build and link**:
   ```bash
   npm run build
   # On Windows, npm link handles executables automatically (no need for chmod)
   npm link
   ```

4. **Test**:
   ```bash
   nl2sql chat
   ```

## Development

- Run `npm run dev` for development (cross-platform)
- Use `npm run format` to format code with Prettier (cross-platform)

## Common Issues

- **"command not found: nl2sql"**: On Windows, use Git Bash for Unix-like commands, or run via `npm start` if linked
- **"API key not found"**: Check with `echo %OPENROUTER_API_KEY%` (Windows) or `echo $OPENROUTER_API_KEY` (Linux/macOS)
- **"No models directory"**: Run from a project with `models/` folder (cross-platform)

For more help, see [README.md](README.md).

# NL2SQL CLI

A command-line tool that converts natural language queries into SQL. It analyzes Sequelize models to understand your database schema and generates accurate queries from plain English input.

## Features

- **AI-Powered**: Uses Qwen 3 for intelligent SQL generation
- **Schema-Aware**: Parses Sequelize models to extract table structures and relationships
- **Interactive Chat**: Command-line interface with conversation history
- **Multi-Command**: Built-in commands for schema inspection, model details, and more

## Installation

Install globally via NPM:

```bash
npm install -g nl2sql-cli
```

## Setup

1. Get an OpenRouter API key from [openrouter.ai/keys](https://openrouter.ai/keys)
2. Set your API key:
   ```bash
   export OPENROUTER_API_KEY='your-key-here'
   ```
   Or create a `.env` file with `OPENROUTER_API_KEY=your-key-here`

## Usage

Navigate to a project with Sequelize models and run:

```bash
nl2sql chat
```

### Commands

- `/help` - Show commands
- `/schema` - Display schema
- `/models` - List models
- `/history` - View history
- `/clear` - Clear chat
- `/model <name>` - Switch AI model
- `/exit` - Quit

### Example Queries

- Show all users
- Find users created recently
- Get top products by sales
- List orders with customer details
- Count active users

## Development

- Requires Node.js 18+
- Run `npm run dev` for development
- Use `npm run format` to format code with Prettier
- Build with `npm run build`

## How It Works

1. Analyzes Sequelize models in `models/` directory
2. Extracts schema (tables, columns, associations)
3. Sends natural language + schema to Qwen 3
4. Returns executable SQL queries

## Support

Open an issue on GitHub for questions or problems.

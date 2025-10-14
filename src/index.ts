#!/usr/bin/env node

import { Command } from 'commander';
import { runChat } from './cli/chat';
import { createWatchableSchema } from './models/analyzer';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
  const program = new Command();

  program
    .name('nl2sql')
    .description('CLI tool to convert natural language to SQL using Qwen 3 via OpenRouter')
    .version('1.0.0');

  program
    .command('chat')
    .description('Start interactive chat session')
    .option('-p, --path <path>', 'Path to the models directory', process.cwd())
    .action(async (options) => {
      try {
        console.log('🔍 Analyzing Sequelize models...\n');

        // Create a watchable schema that can be updated when files change
        const watchableSchema = await createWatchableSchema(options.path);

        // Start the chat interface with schema context
        await runChat(watchableSchema);
      } catch (error) {
        console.error('❌ Error:', error instanceof Error ? error.message : 'An unknown error occurred');
        process.exit(1);
      }
    });

  // Default to chat command if no command specified
  if (process.argv.length === 2) {
    process.argv.push('chat');
  }

  await program.parseAsync(process.argv);
}

export async function run() {
  return main().catch(console.error);
}

if (require.main === module) {
  run();
}

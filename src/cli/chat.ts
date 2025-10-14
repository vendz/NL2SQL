import * as readline from 'readline';
import chalk from 'chalk';
import { OpenRouterClient, ChatMessage } from '../llm/openrouter';
import { WatchableSchema } from '../models/analyzer';

export async function runChat(watchableSchema: WatchableSchema): Promise<void> {
  console.log(chalk.green('✅ Found'), `${watchableSchema.models.length} model(s):`);
  watchableSchema.models.forEach(model => {
    console.log(chalk.cyan(`   - ${model.name} (${model.tableName})`));
  });
  console.log();

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error(chalk.red('❌ Error: OPENROUTER_API_KEY environment variable not found.'));
    console.log('\nPlease set your OpenRouter API key:');
    console.log(chalk.yellow('  export OPENROUTER_API_KEY=your_api_key_here'));
    console.log('\nGet your API key at: https://openrouter.ai/keys');
    process.exit(1);
  }

  let llm: OpenRouterClient;
  try {
    llm = new OpenRouterClient(apiKey);
  } catch (error) {
    console.error(chalk.red('❌ Error initializing OpenRouter client:'), error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }

  const chatHistory: ChatMessage[] = [];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.blue('\n> '),
    terminal: true
  });

  console.log(chalk.yellow('Welcome to NL2SQL CLI! 🚀'));
  console.log(chalk.gray('Type your natural language query or use commands like /help, /schema, /exit\n'));

  displayHelp();

  // Start watching for file changes
  watchableSchema.startWatching();

  rl.prompt();

  rl.on('line', async (input) => {
    const userInput = input.trim();

    if (!userInput) {
      rl.prompt();
      return;
    }

    if (userInput === '/exit' || userInput === '/quit') {
      console.log(chalk.yellow('\n👋 Goodbye!'));
      watchableSchema.stopWatching();
      process.exit(0);
    } else if (userInput === '/help') {
      displayHelp();
    } else if (userInput === '/schema') {
      displaySchema(watchableSchema);
    } else if (userInput === '/models') {
      displayModels(watchableSchema);
    } else if (userInput === '/clear') {
      chatHistory.length = 0;
      console.log(chalk.green('✅ Chat history cleared.\n'));
    } else if (userInput === '/history') {
      displayHistory(chatHistory);
    } else if (userInput === '/reload') {
      console.log(chalk.blue('🔄 Reloading schema...'));
      try {
        await watchableSchema.reload();
        console.log(chalk.green('✅ Schema reloaded successfully!\n'));
      } catch (error) {
        console.log(chalk.red('❌ Failed to reload schema\n'));
      }
    } else if (userInput.startsWith('/model ')) {
      const modelName = userInput.substring(7).trim();
      try {
        llm.setModel(modelName);
        console.log(chalk.green(`✅ Model changed to: ${modelName}\n`));
      } catch (error) {
        console.log(chalk.red('❌ Error changing model:'), error instanceof Error ? error.message : 'Unknown error');
      }
    } else if (userInput.startsWith('/')) {
      console.log(chalk.red(`❌ Unknown command: ${userInput}`));
      console.log(chalk.gray('Type /help for available commands.\n'));
    } else {
      await handleQuery(userInput, llm, watchableSchema, chatHistory);
    }
    
    rl.prompt();
  });

  rl.on('close', () => {
    console.log(chalk.yellow('\n👋 Goodbye!'));
    watchableSchema.stopWatching();
    process.exit(0);
  });

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    console.log(chalk.yellow('\n\n👋 Goodbye!'));
    watchableSchema.stopWatching();
    process.exit(0);
  });
}

async function handleQuery(
  query: string, 
  llm: OpenRouterClient, 
  watchableSchema: WatchableSchema, 
  chatHistory: ChatMessage[]
): Promise<void> {
  try {
    process.stdout.write(chalk.blue('🤔 Thinking... '));
    
    const response = await llm.generateSQL(query, watchableSchema.schema, chatHistory);
    
    // Clear the "Thinking..." line
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    
    console.log(chalk.green('✅ Generated SQL:\n'));
    console.log(chalk.cyan('─'.repeat(60)));
    console.log(chalk.white(response));
    console.log(chalk.cyan('─'.repeat(60)));
    
    // Add to chat history
    chatHistory.push(
      { role: 'user', content: query },
      { role: 'assistant', content: response }
    );

    // Keep history manageable (last 10 exchanges)
    if (chatHistory.length > 20) {
      chatHistory.splice(0, chatHistory.length - 20);
    }
  } catch (error) {
    // Clear the "Thinking..." line
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    
    console.log(chalk.red('❌ Error:'), error instanceof Error ? error.message : 'Failed to generate SQL');
  }
}

function displayHelp(): void {
  console.log(chalk.yellow('📚 Available commands:'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log(chalk.cyan('  /help     ') + chalk.gray('- Show this help message'));
  console.log(chalk.cyan('  /schema   ') + chalk.gray('- Show the database schema'));
  console.log(chalk.cyan('  /models   ') + chalk.gray('- List all available models with details'));
  console.log(chalk.cyan('  /history  ') + chalk.gray('- Show chat history'));
  console.log(chalk.cyan('  /clear    ') + chalk.gray('- Clear the chat history'));
  console.log(chalk.cyan('  /reload   ') + chalk.gray('- Reload the schema from model files'));
  console.log(chalk.cyan('  /model    ') + chalk.gray('- Change the AI model (e.g., /model qwen/qwen-2-7b-instruct)'));
  console.log(chalk.cyan('  /exit     ') + chalk.gray('- Exit the application'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log();
}

function displaySchema(watchableSchema: WatchableSchema): void {
  console.log(chalk.yellow('\n📋 Database Schema:'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log(watchableSchema.schema);
  console.log(chalk.gray('─'.repeat(60)));
}

function displayModels(watchableSchema: WatchableSchema): void {
  console.log(chalk.yellow('\n📦 Available Models:'));
  console.log(chalk.gray('─'.repeat(60)));
  
  watchableSchema.models.forEach((model: any) => {
    console.log(chalk.cyan(`\n${model.name}`) + chalk.gray(` (table: ${model.tableName})`));
    
    console.log(chalk.white('  Columns:'));
    model.columns.forEach((col: any) => {
      const badges: string[] = [];
      if (col.primaryKey) badges.push(chalk.yellow('PK'));
      if (col.allowNull === false) badges.push(chalk.red('NOT NULL'));
      if (col.unique) badges.push(chalk.blue('UNIQUE'));
      
      const badgeStr = badges.length > 0 ? ' ' + badges.join(' ') : '';
      console.log(`    ${chalk.green(col.name)}: ${chalk.gray(col.type)}${badgeStr}`);
    });
    
    if (model.associations.length > 0) {
      console.log(chalk.white('  Associations:'));
      model.associations.forEach((assoc: any) => {
        const details: string[] = [];
        if (assoc.foreignKey) details.push(`FK: ${assoc.foreignKey}`);
        if (assoc.as) details.push(`as: ${assoc.as}`);
        const detailStr = details.length > 0 ? chalk.gray(` (${details.join(', ')})`) : '';
        console.log(`    ${chalk.magenta(assoc.type)} → ${chalk.cyan(assoc.target)}${detailStr}`);
      });
    }
  });
  
  console.log(chalk.gray('\n' + '─'.repeat(60)));
}

function displayHistory(chatHistory: ChatMessage[]): void {
  if (chatHistory.length === 0) {
    console.log(chalk.yellow('\n📜 Chat history is empty.\n'));
    return;
  }

  console.log(chalk.yellow('\n📜 Chat History:'));
  console.log(chalk.gray('─'.repeat(60)));
  
  chatHistory.forEach((msg, index) => {
    if (msg.role === 'user') {
      console.log(chalk.blue(`\n[${Math.floor(index / 2) + 1}] You:`));
      console.log(chalk.white(msg.content));
    } else {
      console.log(chalk.green('\nAssistant:'));
      console.log(chalk.gray(msg.content));
    }
  });
  
  console.log(chalk.gray('\n' + '─'.repeat(60)));
}

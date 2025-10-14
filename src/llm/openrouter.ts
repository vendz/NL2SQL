import OpenAI from 'openai';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export class OpenRouterClient {
  private client: OpenAI;
  private model: string = 'qwen/qwen-2.5-72b-instruct';

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error(
        'OpenRouter API key is required. Please set OPENROUTER_API_KEY environment variable.'
      );
    }

    this.client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: apiKey,
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/nl2sql-cli',
        'X-Title': 'NL2SQL CLI',
      },
    });
  }

  async generateSQL(
    naturalLanguage: string,
    schema: string,
    chatHistory: ChatMessage[] = []
  ): Promise<string> {
    try {
      const systemPrompt = this.buildSystemPrompt(schema);

      const messages: Array<{
        role: 'system' | 'user' | 'assistant';
        content: string;
      }> = [
        { role: 'system', content: systemPrompt },
        ...chatHistory,
        { role: 'user', content: naturalLanguage },
      ];

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages,
        temperature: 0, // Even stricter than 0.1
        max_tokens: 2000,
      });

      const content = response.choices[0]?.message?.content?.trim();

      if (!content) {
        return 'No response from the model';
      }

      return this.cleanSQLResponse(content);
    } catch (error: any) {
      if (error?.status === 401) {
        throw new Error(
          'Invalid API key. Please check your OPENROUTER_API_KEY.'
        );
      } else if (error?.status === 429) {
        throw new Error('Rate limit exceeded. Please try again later.');
      } else if (error?.message) {
        throw new Error(`API Error: ${error.message}`);
      }
      throw new Error('Failed to generate SQL. Please try again.');
    }
  }

  private buildSystemPrompt(schema: string): string {
    return `You are an expert SQL query generator. Your task is to convert natural language questions into valid SQL queries.

Database Schema:
${schema}

CRITICAL RULES:
1. ONLY use columns, tables, and values that EXPLICITLY exist in the schema above
2. For ENUM columns, ONLY use the exact values listed in "ALLOWED VALUES"
3. If a query asks for data that doesn't exist in the schema (e.g., a status value not in the ENUM), you MUST respond with:
   "❌ Cannot generate query: The requested value '[value]' does not exist in the schema. Available values for [column] are: [list values]"
4. Do NOT invent or assume column values, statuses, or relationships
5. If unsure whether a value exists, explain what IS available instead of guessing

Instructions:
1. Generate clean, efficient SQL queries based on the schema provided
2. Use proper SQL syntax and best practices
3. Include appropriate JOINs when querying related tables
4. Use meaningful aliases for tables when needed
5. Add comments for complex queries
6. Output ONLY the SQL query without markdown formatting, explanations, or code blocks (unless explaining why a query cannot be generated)
7. For questions about the schema itself, provide a helpful text response instead of SQL

Examples:
✅ "Show me all users" → SELECT * FROM users;
✅ "Find active admin users" → SELECT * FROM admin_users WHERE status = 'STATUS_ACTIVE';
❌ "Find banned admin users" → ❌ Cannot generate query: 'STATUS_BANNED' does not exist. Available status values are: STATUS_ACTIVE, STATUS_INACTIVE
✅ "Get user names and their order counts" → SELECT u.name, COUNT(o.id) as order_count FROM users u LEFT JOIN orders o ON u.id = o.user_id GROUP BY u.id, u.name;`;
  }

  private cleanSQLResponse(response: string): string {
    // Remove markdown code blocks
    let cleaned = response.replace(/```sql\n?/gi, '').replace(/```\n?/g, '');

    // Remove leading/trailing whitespace
    cleaned = cleaned.trim();

    return cleaned;
  }

  /**
   * Set a custom model (useful for testing different Qwen versions)
   */
  setModel(model: string): void {
    this.model = model;
  }

  /**
   * Get the current model being used
   */
  getModel(): string {
    return this.model;
  }
}

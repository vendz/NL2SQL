import { pipeline, env } from '@xenova/transformers';
import { ModelInfo } from '../models/analyzer';

env.allowLocalModels = false;

export class VectorSearch {
  private embedder: any;
  private modelEmbeddings: Map<string, number[]> = new Map();
  private models: ModelInfo[] = [];
  private initialized = false;

  async initialize(models: ModelInfo[]): Promise<void> {
    if (this.initialized && this.models.length === models.length) {
      return;
    }

    console.log('🚀 Initializing vector search...');

    if (!this.embedder) {
      this.embedder = await pipeline(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2'
      );
    }

    this.models = models;
    this.modelEmbeddings.clear();

    console.log(`📊 Computing embeddings for ${models.length} models...`);
    for (const model of models) {
      const text = this.modelToSearchableText(model);
      const embedding = await this.embed(text);
      this.modelEmbeddings.set(model.name, embedding);
    }

    this.initialized = true;
    console.log('✅ Vector search ready!\n');
  }

  /**
   * Convert model to searchable text - UNIVERSAL approach
   * Just present ALL available information, let embeddings figure it out
   */
  private modelToSearchableText(model: ModelInfo): string {
    const parts: string[] = [];

    // 1. Model/Table names (all variations)
    parts.push(`Model name: ${model.name}`);
    parts.push(`Table name: ${model.tableName}`);

    // 2. Description/Comments (if provided by developer)
    if (model.description) {
      parts.push(`Description: ${model.description}`);
    }

    // 3. ALL column information
    parts.push('Columns:');
    model.columns.forEach((c) => {
      const columnParts = [c.name];

      if (c.type) columnParts.push(c.type);
      if (c.primaryKey) columnParts.push('primary key');
      if (c.allowNull === false) columnParts.push('required');
      if (c.unique) columnParts.push('unique');
      if (c.defaultValue) columnParts.push(`default ${c.defaultValue}`);
      if (c.enumValues?.length) {
        columnParts.push(`possible values: ${c.enumValues.join(' ')}`);
      }
      if (c.references) {
        columnParts.push(`references ${c.references.model}`);
      }

      parts.push(columnParts.join(' '));
    });

    // 4. Relationships (structural information)
    if (model.associations.length > 0) {
      parts.push('Relationships:');
      model.associations.forEach((a) => {
        const assocParts = [a.type, a.target];
        if (a.foreignKey) assocParts.push(`foreign key ${a.foreignKey}`);
        if (a.as) assocParts.push(`alias ${a.as}`);
        parts.push(assocParts.join(' '));
      });
    }

    return parts.join('. ');
  }

  private async embed(text: string): Promise<number[]> {
    const output = await this.embedder(text, {
      pooling: 'mean',
      normalize: true,
    });
    return Array.from(output.data);
  }

  async findRelevant(
    query: string,
    topK: number = 5,
    threshold: number = 0.25
  ): Promise<ModelInfo[]> {
    if (!this.initialized) {
      throw new Error('VectorSearch not initialized');
    }

    const queryEmbedding = await this.embed(query);

    const scores = Array.from(this.modelEmbeddings.entries()).map(
      ([name, embedding]) => ({
        name,
        score: this.cosineSimilarity(queryEmbedding, embedding),
      })
    );

    const topResults = scores
      .sort((a, b) => b.score - a.score)
      .filter((s) => s.score >= threshold)
      .slice(0, topK);

    return topResults
      .map((r) => this.models.find((m) => m.name === r.name)!)
      .filter(Boolean);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    return a.reduce((sum, val, i) => sum + val * b[i], 0);
  }

  async getScores(
    query: string
  ): Promise<Array<{ name: string; score: number }>> {
    const queryEmbedding = await this.embed(query);

    return Array.from(this.modelEmbeddings.entries())
      .map(([name, embedding]) => ({
        name,
        score: this.cosineSimilarity(queryEmbedding, embedding),
      }))
      .sort((a, b) => b.score - a.score);
  }

  getModelEmbeddingText(modelName: string): string | null {
    const model = this.models.find((m) => m.name === modelName);
    return model ? this.modelToSearchableText(model) : null;
  }
}

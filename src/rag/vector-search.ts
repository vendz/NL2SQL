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
      const text = this.modelToText(model);
      const embedding = await this.embed(text);
      this.modelEmbeddings.set(model.name, embedding);
    }

    this.initialized = true;
    console.log('✅ Vector search ready!\n');
  }

  private modelToText(model: ModelInfo): string {
    const parts = [
      `Table ${model.name} (${model.tableName})`,
      'Columns:',
      ...model.columns.map((c) => {
        const constraints = [];
        if (c.primaryKey) constraints.push('PRIMARY KEY');
        if (c.enumValues?.length)
          constraints.push(`VALUES: ${c.enumValues.join(', ')}`);
        return `${c.name} ${c.type} ${constraints.join(' ')}`;
      }),
    ];

    if (model.associations.length > 0) {
      parts.push('Relationships:');
      model.associations.forEach((a) => {
        parts.push(`${a.type} with ${a.target}`);
      });
    }

    return parts.join(' ');
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
}

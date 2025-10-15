import { ModelInfo } from '../models/analyzer';
import { VectorSearch } from './vector-search';

export class HybridRetrieval {
  constructor(
    private vectorSearch: VectorSearch,
    private allModels: ModelInfo[]
  ) {}

  /**
   * Find relevant models using multiple strategies
   */
  async findRelevant(
    query: string,
    options: {
      topK?: number;
      threshold?: number;
      includeRelated?: boolean;
    } = {}
  ): Promise<ModelInfo[]> {
    const { topK = 5, threshold = 0.25, includeRelated = true } = options;

    // Strategy 1: Vector similarity
    const vectorResults = await this.vectorSearch.findRelevant(
      query,
      topK,
      threshold
    );
    const selectedModels = new Set<string>(vectorResults.map((m) => m.name));

    // Strategy 2: Keyword matching in model/table/column names (universal)
    const keywords = this.extractKeywords(query);
    const keywordMatches = this.findByKeywords(keywords);
    keywordMatches.forEach((m) => selectedModels.add(m.name));

    // Strategy 3: Include related models via foreign keys (universal structural signal)
    if (includeRelated && selectedModels.size > 0) {
      const relatedModels = this.findRelatedModels(Array.from(selectedModels));
      relatedModels.forEach((m) => selectedModels.add(m));
    }

    // Return in order of relevance
    return this.allModels.filter((m) => selectedModels.has(m.name));
  }

  /**
   * Extract meaningful keywords from query (universal)
   */
  private extractKeywords(query: string): string[] {
    const words = query
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2);

    // Filter out common SQL/query words
    const stopWords = new Set([
      'show',
      'get',
      'find',
      'list',
      'all',
      'from',
      'where',
      'select',
      'the',
      'and',
      'with',
      'for',
      'that',
      'have',
    ]);

    return words.filter((w) => !stopWords.has(w));
  }

  /**
   * Find models by exact keyword matches (universal)
   */
  private findByKeywords(keywords: string[]): ModelInfo[] {
    if (keywords.length === 0) return [];

    return this.allModels.filter((model) => {
      const searchableText = [
        model.name.toLowerCase(),
        model.tableName.toLowerCase(),
        ...model.columns.map((c) => c.name.toLowerCase()),
        ...(model.description || '').toLowerCase().split(/\s+/),
      ].join(' ');

      return keywords.some((keyword) => searchableText.includes(keyword));
    });
  }

  /**
   * Find models related through associations (universal structural analysis)
   */
  private findRelatedModels(selectedModelNames: string[]): string[] {
    const related = new Set<string>();

    selectedModelNames.forEach((modelName) => {
      const model = this.allModels.find((m) => m.name === modelName);
      if (!model) return;

      // Add models this one references
      model.associations.forEach((assoc) => {
        related.add(assoc.target);
      });

      // Add models that reference this one
      this.allModels.forEach((otherModel) => {
        const referencesThis = otherModel.associations.some(
          (assoc) => assoc.target === modelName
        );
        if (referencesThis) {
          related.add(otherModel.name);
        }
      });

      // Add models referenced via foreign keys
      model.columns.forEach((col) => {
        if (col.references) {
          const referencedModel = this.allModels.find(
            (m) =>
              m.tableName === col.references!.model ||
              m.name === col.references!.model
          );
          if (referencedModel) {
            related.add(referencedModel.name);
          }
        }
      });
    });

    // Remove already selected models
    selectedModelNames.forEach((name) => related.delete(name));

    return Array.from(related);
  }

  /**
   * Get detailed scoring information for debugging
   */
  async explainSelection(query: string): Promise<
    Array<{
      model: string;
      scores: {
        vector: number;
        keyword: boolean;
        related: boolean;
      };
      reason: string;
    }>
  > {
    const keywords = this.extractKeywords(query);
    const vectorScores = await this.vectorSearch.getScores(query);
    const keywordMatches = new Set(
      this.findByKeywords(keywords).map((m) => m.name)
    );

    const vectorResults = await this.vectorSearch.findRelevant(query, 10, 0);
    const selectedModels = new Set(vectorResults.map((m) => m.name));
    const relatedModels = new Set(
      this.findRelatedModels(Array.from(selectedModels))
    );

    return vectorScores
      .map(({ name, score }) => {
        const reasons: string[] = [];

        if (score > 0.3)
          reasons.push(
            `high semantic similarity (${(score * 100).toFixed(1)}%)`
          );
        if (keywordMatches.has(name))
          reasons.push('keyword match in name/columns');
        if (relatedModels.has(name)) reasons.push('related to matched models');

        return {
          model: name,
          scores: {
            vector: score,
            keyword: keywordMatches.has(name),
            related: relatedModels.has(name),
          },
          reason: reasons.join(', ') || 'no match',
        };
      })
      .filter((item) => item.reason !== 'no match');
  }
}

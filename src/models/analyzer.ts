import * as fs from 'fs';
import * as path from 'path';
import * as t from '@babel/types';
import * as chokidar from 'chokidar';
import { parse } from '@babel/parser';
import traverse, { NodePath } from '@babel/traverse';

// At the top of analyzer.ts (around line 7)
interface ColumnInfo {
  name: string;
  type?: string;
  primaryKey?: boolean;
  allowNull?: boolean;
  unique?: boolean;
  defaultValue?: string;
  enumValues?: string[];
  references?: {
    model: string;
    key: string;
  };
}

export interface ModelInfo {
  name: string;
  tableName: string;
  columns: ColumnInfo[];
  associations: Array<{
    type: string;
    target: string;
    foreignKey?: string;
    as?: string;
  }>;
}

export interface SchemaInfo {
  models: ModelInfo[];
  schema: string;
}

/**
 * Parse Sequelize model files to extract schema information
 */
export async function analyzeProject(projectRoot: string): Promise<SchemaInfo> {
  const modelsPath = path.join(projectRoot, 'models');

  if (!fs.existsSync(modelsPath)) {
    throw new Error(
      `No models directory found at: ${modelsPath}\nPlease run this command from a project with a models/ directory.`
    );
  }

  const modelFiles = fs
    .readdirSync(modelsPath)
    .filter(
      (file) =>
        (file.endsWith('.js') || file.endsWith('.ts')) &&
        !file.endsWith('.d.ts') &&
        !file.endsWith('.test.js') &&
        !file.endsWith('.test.ts') &&
        file !== 'index.js' &&
        file !== 'index.ts' &&
        file !== 'associations.js' &&
        file !== 'associations.ts'
    );

  if (modelFiles.length === 0) {
    throw new Error('No model files found in the models directory');
  }

  const models: ModelInfo[] = [];

  // First pass: parse individual model files
  for (const file of modelFiles) {
    try {
      const filePath = path.join(modelsPath, file);
      const content = fs.readFileSync(filePath, 'utf-8');

      const modelInfo = parseModelFile(content, file);
      if (modelInfo) {
        models.push(modelInfo);
      }
    } catch (error) {
      console.warn(
        `⚠️  Failed to parse model file ${file}:`,
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  if (models.length === 0) {
    throw new Error('No valid Sequelize models found');
  }

  // Second pass: parse centralized association files
  const centralizedAssociations = parseCentralizedAssociations(modelsPath);

  // Merge centralized associations into models
  mergeCentralizedAssociations(models, centralizedAssociations);

  // Generate schema description
  const schema = generateSchemaDescription(models);

  return {
    models,
    schema,
  };
}

/**
 * Parse centralized association files (associations.js, index.js)
 * Priority: associations.js/ts > index.js/ts
 * If associations file exists, index file is ignored to avoid duplicates
 */
function parseCentralizedAssociations(
  modelsPath: string
): Map<
  string,
  Array<{ type: string; target: string; foreignKey?: string; as?: string }>
> {
  const associationMap = new Map<
    string,
    Array<{ type: string; target: string; foreignKey?: string; as?: string }>
  >();

  // First priority: dedicated association files
  const dedicatedFiles = ['associations.js', 'associations.ts'];
  for (const filename of dedicatedFiles) {
    const filePath = path.join(modelsPath, filename);
    if (fs.existsSync(filePath)) {
      console.log(`📋 Found centralized association file: ${filename}`);
      const content = fs.readFileSync(filePath, 'utf-8');
      const associations = parseCentralizedAssociationFile(content);

      // Merge associations from this file
      for (const [modelName, assocs] of associations.entries()) {
        const existing = associationMap.get(modelName) || [];
        associationMap.set(modelName, [...existing, ...assocs]);
      }

      // If dedicated association file found, skip index files
      console.log(
        `ℹ️  Using ${filename} for associations (ignoring index files)`
      );
      return associationMap;
    }
  }

  // Second priority: index files (only if no dedicated association file exists)
  const indexFiles = ['index.js', 'index.ts'];
  for (const filename of indexFiles) {
    const filePath = path.join(modelsPath, filename);
    if (fs.existsSync(filePath)) {
      console.log(`📋 Found centralized association file: ${filename}`);
      const content = fs.readFileSync(filePath, 'utf-8');
      const associations = parseCentralizedAssociationFile(content);

      // Merge associations from this file
      for (const [modelName, assocs] of associations.entries()) {
        const existing = associationMap.get(modelName) || [];
        associationMap.set(modelName, [...existing, ...assocs]);
      }
    }
  }

  return associationMap;
}

/**
 * Parse a centralized association file to extract associations by model
 * Handles patterns like: User.hasMany(Post, {...}), models.User.hasMany(models.Post, {...}), db.User.hasMany(db.Post, {...})
 */
function parseCentralizedAssociationFile(
  content: string
): Map<
  string,
  Array<{ type: string; target: string; foreignKey?: string; as?: string }>
> {
  const associationMap = new Map<
    string,
    Array<{ type: string; target: string; foreignKey?: string; as?: string }>
  >();

  try {
    const ast = parse(content, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });

    traverse(ast, {
      CallExpression(path: NodePath<t.CallExpression>) {
        const callee = path.node.callee;

        // Match: ModelName.hasMany(...), models.ModelName.hasMany(...), db.ModelName.hasMany(...)
        if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) {
          const associationType = callee.property.name;

          if (
            ['hasMany', 'hasOne', 'belongsTo', 'belongsToMany'].includes(
              associationType
            )
          ) {
            let sourceModel: string | null = null;

            // Extract source model name
            if (t.isMemberExpression(callee.object)) {
              // Pattern: models.User.hasMany or db.User.hasMany
              if (t.isIdentifier(callee.object.property)) {
                sourceModel = callee.object.property.name;
              }
            } else if (t.isIdentifier(callee.object)) {
              // Pattern: User.hasMany
              sourceModel = callee.object.name;
            }

            if (!sourceModel) return;

            // Extract target model and options
            const args = path.node.arguments;
            if (args.length === 0) return;

            let targetModel: string | null = null;

            // First argument is the target model
            const firstArg = args[0];
            if (t.isMemberExpression(firstArg)) {
              // Pattern: models.Post or db.Post
              if (t.isIdentifier(firstArg.property)) {
                targetModel = firstArg.property.name;
              }
            } else if (t.isIdentifier(firstArg)) {
              // Pattern: Post
              targetModel = firstArg.name;
            }

            if (!targetModel) return;

            const association: any = {
              type: associationType,
              target: targetModel,
            };

            // Extract options from second argument
            if (args.length >= 2 && t.isObjectExpression(args[1])) {
              for (const prop of args[1].properties) {
                if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
                  const key = prop.key.name;

                  if (key === 'foreignKey') {
                    if (t.isStringLiteral(prop.value)) {
                      association.foreignKey = prop.value.value;
                    } else if (t.isIdentifier(prop.value)) {
                      association.foreignKey = prop.value.name;
                    } else {
                      // Extract from source text for complex cases
                      const valueText = content
                        .slice(prop.value.start!, prop.value.end!)
                        .replace(/['"`]/g, '');
                      association.foreignKey = valueText;
                    }
                  }

                  if (key === 'as') {
                    if (t.isStringLiteral(prop.value)) {
                      association.as = prop.value.value;
                    } else {
                      const valueText = content
                        .slice(prop.value.start!, prop.value.end!)
                        .replace(/['"`]/g, '');
                      association.as = valueText;
                    }
                  }
                }
              }
            }

            // Add association to map
            const existing = associationMap.get(sourceModel) || [];
            existing.push(association);
            associationMap.set(sourceModel, existing);
          }
        }
      },
    });
  } catch (error) {
    console.warn(
      '⚠️  Failed to parse centralized association file:',
      error instanceof Error ? error.message : 'Unknown error'
    );
  }

  return associationMap;
}

/**
 * Merge centralized associations into model definitions
 */
function mergeCentralizedAssociations(
  models: ModelInfo[],
  centralizedAssociations: Map<
    string,
    Array<{ type: string; target: string; foreignKey?: string; as?: string }>
  >
): void {
  for (const model of models) {
    const centralized = centralizedAssociations.get(model.name);
    if (centralized && centralized.length > 0) {
      // Remove duplicates (prefer centralized associations as they're typically more complete)
      const existingKeys = new Set(
        model.associations.map((a) => `${a.type}-${a.target}-${a.as || ''}`)
      );

      const newAssociations = centralized.filter((a) => {
        const key = `${a.type}-${a.target}-${a.as || ''}`;
        return !existingKeys.has(key);
      });

      if (newAssociations.length > 0) {
        console.log(
          `  ✓ Added ${newAssociations.length} centralized association(s) to ${model.name}`
        );
        model.associations.push(...newAssociations);
      }
    }
  }
}

/**
 * Parse a Sequelize model file to extract model information
 */
function parseModelFile(content: string, filename: string): ModelInfo | null {
  // Extract model name from filename
  const modelName = path.basename(filename, path.extname(filename));

  // Try to extract table name
  let tableName = modelName.toLowerCase();
  const tableNameMatch = content.match(/tableName:\s*['"`]([^'"`]+)['"`]/);
  if (tableNameMatch) {
    tableName = tableNameMatch[1];
  }

  // Extract columns from the model definition
  const columns = parseColumns(content);

  if (columns.length === 0) {
    return null;
  }

  // Extract in-file associations
  const associations = parseAssociations(content);

  return {
    name: modelName,
    tableName,
    columns,
    associations,
  };
}

/**
 * Parse column definitions from model content
 */
export function parseColumns(content: string): ColumnInfo[] {
  const columns: ColumnInfo[] = [];

  const ast = parse(content, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
  });

  traverse(ast, {
    CallExpression(path: NodePath<t.CallExpression>) {
      const callee = path.node.callee;
      if (
        callee.type === 'MemberExpression' &&
        t.isIdentifier(callee.property, { name: 'define' })
      ) {
        const args = path.node.arguments;
        if (args.length >= 2 && t.isObjectExpression(args[1])) {
          for (const prop of args[1].properties) {
            if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
              const col: ColumnInfo = {
                name: prop.key.name,
              };

              if (t.isObjectExpression(prop.value)) {
                for (const field of prop.value.properties) {
                  if (!t.isObjectProperty(field) || !t.isIdentifier(field.key))
                    continue;
                  const key = field.key.name;
                  const valCode = content
                    .slice(field.value.start!, field.value.end!)
                    .trim();

                  if (key === 'type') {
                    col.type = valCode;

                    // Extract enum values if DataTypes.ENUM is used
                    if (
                      valCode.includes('DataTypes.ENUM') ||
                      valCode.includes('ENUM')
                    ) {
                      // Look for values array in the column definition
                      if (t.isObjectExpression(prop.value)) {
                        for (const enumField of prop.value.properties) {
                          if (
                            t.isObjectProperty(enumField) &&
                            t.isIdentifier(enumField.key) &&
                            enumField.key.name === 'values' &&
                            t.isArrayExpression(enumField.value)
                          ) {
                            const enumValues: string[] = [];
                            for (const element of enumField.value.elements) {
                              if (t.isStringLiteral(element)) {
                                enumValues.push(element.value);
                              } else if (t.isIdentifier(element)) {
                                enumValues.push(element.name);
                              } else if (element) {
                                // Fallback: extract from source
                                const valueText = content
                                  .slice(element.start!, element.end!)
                                  .replace(/['"]/g, '');
                                enumValues.push(valueText);
                              }
                            }

                            if (enumValues.length > 0) {
                              col.enumValues = enumValues;
                            }
                          }
                        }
                      }
                    }
                  }

                  if (key === 'primaryKey' && valCode === 'true')
                    col.primaryKey = true;
                  if (key === 'allowNull' && valCode === 'false')
                    col.allowNull = false;
                  if (key === 'unique' && valCode === 'true') col.unique = true;
                  if (key === 'defaultValue') col.defaultValue = valCode;

                  if (
                    key === 'references' &&
                    t.isObjectExpression(field.value)
                  ) {
                    let model: string | undefined;
                    let refKey: string | undefined;
                    for (const sub of field.value.properties) {
                      if (t.isObjectProperty(sub) && t.isIdentifier(sub.key)) {
                        if (sub.key.name === 'model')
                          model = content
                            .slice(sub.value.start!, sub.value.end!)
                            .replace(/['"`]/g, '');
                        if (sub.key.name === 'key')
                          refKey = content
                            .slice(sub.value.start!, sub.value.end!)
                            .replace(/['"`]/g, '');
                      }
                    }
                    if (model && refKey)
                      col.references = { model, key: refKey };
                  }
                }
              }

              columns.push(col);
            }
          }
        }
      }
    },
  });

  return columns;
}

/**
 * Parse association definitions from model content (in-file associations)
 */
function parseAssociations(
  content: string
): Array<{ type: string; target: string; foreignKey?: string; as?: string }> {
  const associations: Array<{
    type: string;
    target: string;
    foreignKey?: string;
    as?: string;
  }> = [];

  // Match hasMany, hasOne, belongsTo, belongsToMany
  const associationPatterns = [
    /\.hasMany\s*\(\s*(\w+)(?:,\s*\{([^}]+)\})?\)/g,
    /\.hasOne\s*\(\s*(\w+)(?:,\s*\{([^}]+)\})?\)/g,
    /\.belongsTo\s*\(\s*(\w+)(?:,\s*\{([^}]+)\})?\)/g,
    /\.belongsToMany\s*\(\s*(\w+)(?:,\s*\{([^}]+)\})?\)/g,
  ];

  const types = ['hasMany', 'hasOne', 'belongsTo', 'belongsToMany'];

  associationPatterns.forEach((pattern, index) => {
    let match;
    const regex = new RegExp(pattern);

    while ((match = regex.exec(content)) !== null) {
      const target = match[1];
      const options = match[2] || '';

      const association: any = {
        type: types[index],
        target,
      };

      // Extract foreignKey
      const foreignKeyMatch = options.match(/foreignKey:\s*['"`](\w+)['"`]/);
      if (foreignKeyMatch) {
        association.foreignKey = foreignKeyMatch[1];
      }

      // Extract as
      const asMatch = options.match(/as:\s*['"`](\w+)['"`]/);
      if (asMatch) {
        association.as = asMatch[1];
      }

      associations.push(association);
    }
  });

  return associations;
}

/**
 * Generate a human-readable schema description
 */
function generateSchemaDescription(models: ModelInfo[]): string {
  const schemaLines: string[] = [];

  models.forEach((model) => {
    schemaLines.push(`Table: ${model.tableName} (Model: ${model.name})`);
    schemaLines.push('Columns:');

    model.columns.forEach((col) => {
      const constraints: string[] = [];
      if (col.primaryKey) constraints.push('PRIMARY KEY');
      if (col.allowNull === false) constraints.push('NOT NULL');
      if (col.unique) constraints.push('UNIQUE');
      if (col.defaultValue) constraints.push(`DEFAULT ${col.defaultValue}`);

      if (col.enumValues && col.enumValues.length > 0) {
        constraints.push(`ALLOWED VALUES: [${col.enumValues.join(', ')}]`);
      }

      if (col.references)
        constraints.push(
          `REFERENCES ${col.references.model}(${col.references.key})`
        );

      const constraintStr =
        constraints.length > 0 ? ` [${constraints.join(', ')}]` : '';
      schemaLines.push(`  - ${col.name}: ${col.type}${constraintStr}`);
    });

    if (model.associations.length > 0) {
      schemaLines.push('Associations:');
      model.associations.forEach((assoc) => {
        const details: string[] = [];
        if (assoc.foreignKey) details.push(`foreignKey: ${assoc.foreignKey}`);
        if (assoc.as) details.push(`as: ${assoc.as}`);
        const detailStr = details.length > 0 ? ` (${details.join(', ')})` : '';
        schemaLines.push(`  - ${assoc.type} ${assoc.target}${detailStr}`);
      });
    }

    schemaLines.push('');
  });

  return schemaLines.join('\n');
}

/**
 * Watchable schema that can be updated when files change
 */
export class WatchableSchema {
  private _schemaInfo: SchemaInfo;
  private _modelsPath: string;
  private _watcher: chokidar.FSWatcher | null = null;

  constructor(schemaInfo: SchemaInfo, modelsPath: string) {
    this._schemaInfo = schemaInfo;
    this._modelsPath = modelsPath;
  }

  get schemaInfo(): SchemaInfo {
    return this._schemaInfo;
  }

  get models(): ModelInfo[] {
    return this._schemaInfo.models;
  }

  get schema(): string {
    return this._schemaInfo.schema;
  }

  /**
   * Reload the schema by re-analyzing all model files
   */
  async reload(): Promise<void> {
    try {
      const newSchemaInfo = await analyzeProject(
        path.dirname(this._modelsPath)
      );
      this._schemaInfo = newSchemaInfo;
      console.log('✅ Schema reloaded successfully');
    } catch (error) {
      console.error(
        '❌ Failed to reload schema:',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  /**
   * Start watching model files for changes
   */
  startWatching(onChange?: () => void): void {
    if (this._watcher) {
      console.warn('⚠️  File watcher already started');
      return;
    }

    this._watcher = chokidar.watch(`${this._modelsPath}/**/*.{js,ts}`, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
      ignorePermissionErrors: true,
    });

    this._watcher.on('change', async (filePath: string) => {
      console.log(`📄 Model file changed: ${path.basename(filePath)}`);
      try {
        await this.reload();
        if (onChange) onChange();
      } catch (error) {
        console.error(
          `❌ Failed to reload after ${path.basename(filePath)} changed:`,
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
    });

    this._watcher.on('add', async (filePath: string) => {
      if (filePath.endsWith('.js') || filePath.endsWith('.ts')) {
        console.log(`🆕 New model file added: ${path.basename(filePath)}`);
        try {
          await this.reload();
          if (onChange) onChange();
        } catch (error) {
          console.error(
            `❌ Failed to reload after ${path.basename(filePath)} was added:`,
            error instanceof Error ? error.message : 'Unknown error'
          );
        }
      }
    });

    this._watcher.on('unlink', async (filePath: string) => {
      if (filePath.endsWith('.js') || filePath.endsWith('.ts')) {
        console.log(`🗑️  Model file removed: ${path.basename(filePath)}`);
        try {
          await this.reload();
          if (onChange) onChange();
        } catch (error) {
          console.error(
            `❌ Failed to reload after ${path.basename(filePath)} was removed:`,
            error instanceof Error ? error.message : 'Unknown error'
          );
        }
      }
    });

    this._watcher.on('error', (error: Error) => {
      console.error('❌ File watcher error:', error);
    });

    console.log('👀 Watching for model file changes...');
  }

  /**
   * Stop watching model files
   */
  stopWatching(): void {
    if (this._watcher) {
      this._watcher.close();
      this._watcher = null;
      console.log('ℹ️ Stopped watching model files');
    }
  }
}

/**
 * Watchable schema that can be updated when files change
 */
export async function createWatchableSchema(
  projectRoot: string
): Promise<WatchableSchema> {
  const schemaInfo = await analyzeProject(projectRoot);
  const modelsPath = path.join(projectRoot, 'models');
  return new WatchableSchema(schemaInfo, modelsPath);
}

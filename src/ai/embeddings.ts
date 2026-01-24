import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

// Singleton pipeline instance
let extractor: FeatureExtractionPipeline | null = null;
let initPromise: Promise<FeatureExtractionPipeline> | null = null;

const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIMENSIONS = 384;

// Initialize the embedding pipeline (lazy, singleton)
async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (extractor) return extractor;

  if (!initPromise) {
    console.log(`Loading embedding model: ${MODEL_NAME}...`);
    initPromise = pipeline("feature-extraction", MODEL_NAME, {
      dtype: "fp32",
    }).then((ext) => {
      extractor = ext as FeatureExtractionPipeline;
      console.log("Embedding model loaded.");
      return extractor;
    });
  }

  return initPromise;
}

// Generate embedding for a single text
export async function embed(text: string): Promise<Float32Array> {
  const ext = await getExtractor();
  const result = await ext(text, { pooling: "mean", normalize: true });

  // Result is a Tensor, convert to Float32Array
  const data = result.data as Float32Array;
  return data;
}

// Generate embeddings for multiple texts (batched)
export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];

  const ext = await getExtractor();
  const results: Float32Array[] = [];

  // Process in batches to avoid memory issues
  const batchSize = 32;
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);

    for (const text of batch) {
      const result = await ext(text, { pooling: "mean", normalize: true });
      results.push(result.data as Float32Array);
    }
  }

  return results;
}

// Preload the model (call during startup for faster first query)
export async function preloadEmbeddingModel(): Promise<void> {
  await getExtractor();
}

// Compute cosine similarity between two embeddings
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error("Embeddings must have same dimensions");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  // If vectors are already normalized (which they should be), this simplifies
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

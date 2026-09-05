import { pipeline } from '@xenova/transformers';

export const EMBEDDING_DIMENSIONS = 384;
export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';

type FeatureExtractionPipeline = (
  text: string,
  options?: { pooling?: 'mean' | 'cls' | 'none'; normalize?: boolean },
) => Promise<{ tolist: () => number[][] }>;

let extractorPromise: Promise<FeatureExtractionPipeline> | undefined;

export async function embedText(text: string) {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  const values = output.tolist()[0];

  if (!values || values.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Expected ${EMBEDDING_DIMENSIONS} embedding dimensions, received ${values?.length ?? 0}`,
    );
  }

  return new Float32Array(values);
}

export async function getExtractor() {
  if (!extractorPromise) {
    console.error('Loading embedding model...');
    extractorPromise = pipeline('feature-extraction', EMBEDDING_MODEL, {
      dtype: 'fp32',
    } as never) as Promise<FeatureExtractionPipeline>;
  }

  return extractorPromise;
}

export function resetEmbedderForTests() {
  extractorPromise = undefined;
}

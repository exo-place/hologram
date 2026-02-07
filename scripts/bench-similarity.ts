/**
 * Benchmark for similarityMatrix and maxSimilarityMatrix at various scales.
 *
 * Usage: bun run scripts/bench-similarity.ts
 */

import { similarityMatrix, maxSimilarityMatrix } from "../src/ai/embeddings";

const D = 384; // all-MiniLM-L6-v2 dimensions

/** Generate a random L2-normalized Float32Array of dimension D */
function randomNormalizedVector(): Float32Array {
  const v = new Float32Array(D);
  let norm = 0;
  for (let i = 0; i < D; i++) {
    v[i] = Math.random() * 2 - 1;
    norm += v[i] * v[i];
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < D; i++) v[i] /= norm;
  return v;
}

function generateVectors(n: number): Float32Array[] {
  const vecs: Float32Array[] = [];
  for (let i = 0; i < n; i++) vecs.push(randomNormalizedVector());
  return vecs;
}

interface BenchResult {
  label: string;
  M: number;
  N: number;
  medianMs: number;
  throughput: string;
  gflops: string;
}

function bench(
  label: string,
  fn: (q: Float32Array[], t: Float32Array[]) => unknown,
  M: number, N: number, warmup = 3, iterations = 10,
): BenchResult {
  const queries = generateVectors(M);
  const targets = generateVectors(N);
  const ops = M * N * D;

  for (let i = 0; i < warmup; i++) fn(queries, targets);

  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn(queries, targets);
    times.push(performance.now() - start);
  }

  times.sort((a, b) => a - b);
  const medianMs = times[Math.floor(times.length / 2)];
  const gflops = (ops / medianMs / 1e6).toFixed(2);
  const mPairs = (M * N / medianMs / 1e3).toFixed(1);

  return { label, M, N, medianMs: Math.round(medianMs * 100) / 100, throughput: `${mPairs}M pairs/s`, gflops: `${gflops} GFLOP/s` };
}

const scales: [number, number][] = [
  [10, 50],      // typical: small channel, few memories
  [20, 100],     // moderate: default context, growing memories
  [50, 500],     // large: bigger context, many memories
  [100, 1000],   // heavy: large context window
  [500, 1000],   // extreme: very large context
  [1000, 1000],  // max: 1k x 1k
  [1000, 5000],  // beyond: stress test
];

function printTable(label: string, fn: (q: Float32Array[], t: Float32Array[]) => unknown) {
  console.log(`\n${label} (D=${D})\n`);
  console.log("  M (queries) × N (targets)  │  median ms  │  throughput      │  GFLOP/s");
  console.log("─────────────────────────────┼─────────────┼─────────────────┼──────────");

  for (const [M, N] of scales) {
    const r = bench(label, fn, M, N);
    const dims = `${String(r.M).padStart(5)} × ${String(r.N).padStart(5)}`;
    const ms = String(r.medianMs).padStart(9);
    const tp = r.throughput.padStart(15);
    const gf = r.gflops.padStart(8);
    console.log(`  ${dims}          │ ${ms} ms │ ${tp} │ ${gf}`);
  }
}

printTable("similarityMatrix (full M×N)", similarityMatrix);
printTable("maxSimilarityMatrix (max per target)", maxSimilarityMatrix);

// Verify consistency
console.log("\nConsistency check (100×200)...");
const q = generateVectors(100);
const t = generateVectors(200);
const full = similarityMatrix(q, t);
const maxOnly = maxSimilarityMatrix(q, t);
let ok = true;
for (let j = 0; j < 200; j++) {
  let max = -Infinity;
  for (let i = 0; i < 100; i++) {
    if (full[i * 200 + j] > max) max = full[i * 200 + j];
  }
  if (Math.abs(max - maxOnly[j]) > 1e-6) {
    console.log(`  MISMATCH at j=${j}: full max=${max}, maxOnly=${maxOnly[j]}`);
    ok = false;
  }
}
console.log(ok ? "  OK — results match" : "  FAIL — mismatch detected");

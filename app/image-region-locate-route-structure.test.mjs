import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const routePath = '/Volumes/ZO/ZO.DESIGN/app/api/image-tools/locate/route.ts';
const source = fs.readFileSync(routePath, 'utf8');

test('locate route exposes a strict multimodal candidate contract', () => {
  assert.equal(source.includes("export async function POST(request: NextRequest)"), true);
  assert.equal(source.includes("report_image_region_candidates"), true);
  assert.equal(source.includes("selectedCandidateId"), true);
  assert.equal(source.includes("lowConfidence"), true);
  assert.equal(source.includes("image_url"), true);
  assert.equal(source.includes("cropImageSrc"), true);
  assert.equal(source.includes("requestedRegionId || randomUUID()"), true);
  assert.equal(source.includes("normalizeRegionBox"), true);
  assert.equal(source.includes('isAllowedLocateImageSource'), true);
  assert.equal(source.includes('Only local or embedded image sources are supported'), true);
});

test('locate route reuses provider chat selection and bounds request sources', () => {
  assert.equal(source.includes("purpose: 'chat'"), true);
  assert.equal(source.includes('isLocateImageSourceTooLong'), true);
  assert.equal(source.includes('AbortSignal.timeout(60_000)'), true);
});

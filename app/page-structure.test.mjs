import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pageSource = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8');

test('image card floating menus are not rendered inside the pending connection menu block', () => {
  const pendingMenuStart = pageSource.indexOf('{pendingConnectionMenu && (');
  const pendingMenuEnd = pageSource.indexOf(
    '{selectedTextCardPanelItem && selectedTextCardPanelFrameBounds && selectedTextCardPanelCanvasRect && ('
  );

  assert.notEqual(pendingMenuStart, -1);
  assert.notEqual(pendingMenuEnd, -1);
  assert.ok(pendingMenuEnd > pendingMenuStart);

  const pendingMenuBlock = pageSource.slice(pendingMenuStart, pendingMenuEnd);

  assert.equal(
    pendingMenuBlock.includes('{showImageCardQualityMenu && selectedImageCardQualityPopoverOffset && ('),
    false
  );
  assert.equal(
    pendingMenuBlock.includes('{showImageCardCountMenu && selectedImageCardCountPopoverOffset && ('),
    false
  );
});

test('image card content images fill the card content area with object-cover', () => {
  const imageCardContentStart = pageSource.indexOf("{imageCardVisualState === 'content' && item.src && (");
  const imageCardContentEnd = pageSource.indexOf('{item.type === \'shape\' &&', imageCardContentStart);

  assert.notEqual(imageCardContentStart, -1);
  assert.notEqual(imageCardContentEnd, -1);
  assert.ok(imageCardContentEnd > imageCardContentStart);

  const imageCardContentBlock = pageSource.slice(imageCardContentStart, imageCardContentEnd);

  assert.equal(imageCardContentBlock.includes('object-cover'), true);
  assert.equal(imageCardContentBlock.includes('object-contain'), false);
});

test('left rail history uses a dedicated generated image history panel state', () => {
  assert.equal(
    pageSource.includes('const [showGeneratedImageHistoryPanel, setShowGeneratedImageHistoryPanel] = useState(false);'),
    true
  );
  assert.equal(pageSource.includes("if (item.id === 'history') {"), true);
  assert.equal(pageSource.includes('setShowGeneratedImageHistoryPanel((prev) => !prev);'), true);
  assert.equal(pageSource.includes('{showGeneratedImageHistoryPanel && ('), true);
});

test('left rail generated image history panel uses a wider layout than the original 320px menu', () => {
  assert.equal(pageSource.includes('w-[320px]'), false);
  assert.equal(pageSource.includes('w-[384px]'), true);
  assert.equal(pageSource.includes('className="min-w-0 flex-1"'), true);
});

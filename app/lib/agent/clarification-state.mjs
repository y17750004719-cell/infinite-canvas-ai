export function resolveImageOperationResponse(response = {}, ..._args) {
  const text = typeof response.customText === 'string' ? response.customText.trim().toLowerCase() : '';
  if (response.selectedOptionId === 'edit' || /编辑|修改|替换/.test(text)) return 'edit';
  if (response.selectedOptionId === 'generate' || /生成|制作|新建/.test(text)) return 'generate';
  return null;
}

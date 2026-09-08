export async function readCommandResponse(response) {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw Object.assign(new Error(body.error || '命令执行失败'), { code: body.code });
  }
  const events = (await response.text()).split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
  const result = events.find((event) => event.type === 'item.completed' && event.itemType === 'command_result');
  if (!result) throw new Error('命令响应缺少结果');
  return { events, item: result.item, result: result.item.result || result.item };
}

export function formatCommandResult(item) {
  const result = item.result || item;
  const command = item.command || result.command;
  if (typeof result.message === 'string') return result.message;
  if (command === 'archive') return '当前会话已归档。使用 /resume 恢复。';
  if (command === 'resume') return '当前会话已恢复。';
  if (command === 'fork') return `已创建分支会话：${result.threadId || result.thread?.threadId || ''}`;
  if (command === 'clear') return '已清空当前上下文窗口，历史 journal 保留。';
  if (command === 'compact') return '已压缩当前上下文窗口，原始 journal 保留。';
  if (command === 'status') return `会话：${result.threadId || ''}\n状态：${result.threadStatus || result.status || 'idle'}\nTurn 数：${result.turnCount ?? 0}\n最新序号：${result.lastSequence ?? 0}`;
  if (command === 'history') {
    const entries = result.turns || result.events || [];
    return entries.length ? entries.map((entry) => `${entry.turnId || entry.itemId || entry.sequence}: ${entry.status || entry.type || ''} ${entry.item?.text || entry.item?.content || ''}`).join('\n') : '暂无历史记录。';
  }
  return `/${command} 已完成。`;
}
